// Treasury configuration: parses TREASURY_MODE and threshold/liquidity env vars.
// Enforces the devnet/mainnet separation: CctpArqTreasury requires mainnet
// settings, and the config explicitly refuses to mix devnet with real treasury.

import { DisabledTreasury, FakeTreasury, type TreasuryRouter, type ThresholdConfig } from "./TreasuryRouter.ts";
import { CctpArqTreasury, type CctpArqTreasuryOptions } from "./CctpArqTreasury.ts";
import { usdcToSolanaAtomic } from "../shared/solana/amounts.ts";
import { liquidityConfigFromEnv, type LiquidityConfig } from "./LiquidityPolicy.ts";
import { TreasuryRebalancer } from "./TreasuryRebalancer.ts";
import { ManualArqBalanceProvider } from "./OperationalBalanceProvider.ts";
import { WormholeExecutorClient } from "./ExecutorClient.ts";

export type TreasuryMode = "disabled" | "fake" | "cctp-arq";

export type TreasuryBootResult = {
  router: TreasuryRouter;
  mode: TreasuryMode;
  warnings: string[];
  liquidityConfig?: LiquidityConfig;
};

// Default thresholds (USDC, human units)
const DEFAULT_MIN_TRANSFER_USDC = 5;
const DEFAULT_TARGET_BUFFER_USDC = 20;
const DEFAULT_KEEP_USDC = 5;

function parsePositiveUsdc(raw: string | undefined, fallback: number): bigint {
  if (raw === undefined || raw.trim() === "") return usdcToSolanaAtomic(fallback);
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return usdcToSolanaAtomic(fallback);
  return usdcToSolanaAtomic(value);
}

function parseNonNegativeUsdc(raw: string | undefined, fallback: number): bigint {
  if (raw === undefined || raw.trim() === "") return usdcToSolanaAtomic(fallback);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return usdcToSolanaAtomic(fallback);
  return usdcToSolanaAtomic(value);
}

export function thresholdsFromEnv(env: Record<string, string | undefined>): ThresholdConfig {
  const targetArq = env.TREASURY_TARGET_ARQ_USDC ?? env.TREASURY_TARGET_BUFFER_USDC;
  return {
    minTransferAtomic: parsePositiveUsdc(env.TREASURY_MIN_TRANSFER_USDC, DEFAULT_MIN_TRANSFER_USDC),
    targetBufferAtomic: parseNonNegativeUsdc(targetArq, DEFAULT_TARGET_BUFFER_USDC),
    keepAtomic: parseNonNegativeUsdc(env.TREASURY_KEEP_USDC, DEFAULT_KEEP_USDC),
  };
}

/**
 * Validates an EVM address (basic check: 0x + 40 hex chars).
 * This does NOT verify the checksum — only the format.
 */
export function isEvmAddress(value: string | undefined): value is string {
  if (value === undefined) return false;
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

/**
 * Builds the TreasuryRouter from environment configuration.
 *
 * TREASURY_MODE=disabled → DisabledTreasury (default, safe)
 * TREASURY_MODE=fake     → FakeTreasury (demos, devnet)
 * TREASURY_MODE=cctp-arq → CctpArqTreasury wrapped in TreasuryRebalancer (requires mainnet config)
 *
 * Fail-closed: any misconfiguration falls back to disabled with warnings.
 */
import { FileTreasuryTransferStore } from "./TreasuryTransferStore.ts";
import path from "node:path";

export function bootTreasury(
  env: Record<string, string | undefined>,
  options?: { dataDir?: string },
): TreasuryBootResult {
  const mode = (env.TREASURY_MODE?.trim().toLowerCase() ?? "disabled") as TreasuryMode;
  const warnings: string[] = [];
  const thresholds = thresholdsFromEnv(env);
  const liquidityConfig = liquidityConfigFromEnv(env);

  switch (mode) {
    case "disabled":
      return { router: new DisabledTreasury(), mode: "disabled", warnings, liquidityConfig };

    case "fake":
      return {
        router: new FakeTreasury(thresholds),
        mode: "fake",
        warnings,
        liquidityConfig,
      };

    case "cctp-arq": {
      // Guard 1: Explicit real confirmation
      if (env.TREASURY_REAL_ENABLED !== "true") {
        throw new Error("TREASURY_MODE=cctp-arq requires TREASURY_REAL_ENABLED=true for real cross-chain operations.");
      }

      // Guard 2: Solana mainnet-beta
      const solanaCluster = env.SOLANA_CLUSTER?.trim() ?? "devnet";
      if (solanaCluster !== "mainnet-beta") {
        throw new Error(
          `TREASURY_MODE=cctp-arq requires SOLANA_CLUSTER=mainnet-beta, got "${solanaCluster}". Cannot run real treasury on devnet.`,
        );
      }

      // Guard 3: Polygon mainnet
      const polygonNetwork = env.POLYGON_NETWORK?.trim() ?? "";
      if (polygonNetwork !== "mainnet") {
        throw new Error(
          `TREASURY_MODE=cctp-arq requires POLYGON_NETWORK=mainnet, got "${polygonNetwork}".`,
        );
      }

      // Guard 4: ARQ address
      const arqAddress = env.ARQ_POLYGON_USDC_ADDRESS?.trim() ?? "";
      if (!isEvmAddress(arqAddress)) {
        throw new Error(
          `TREASURY_MODE=cctp-arq requires a valid EVM ARQ_POLYGON_USDC_ADDRESS (0x + 40 hex), got "${arqAddress}".`,
        );
      }

      const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
      if (arqAddress.toLowerCase() === ZERO_ADDRESS) {
        throw new Error("ARQ_POLYGON_USDC_ADDRESS cannot be the zero address.");
      }

      // Guard 5: Optional intermediate EOA validation
      const eoa = env.POLYGON_TREASURY_EOA?.trim();
      if (eoa !== undefined && eoa !== "") {
        if (!isEvmAddress(eoa) || eoa.toLowerCase() === ZERO_ADDRESS) {
          throw new Error(`POLYGON_TREASURY_EOA must be a valid non-zero EVM address, got "${eoa}".`);
        }
        if (eoa.toLowerCase() === arqAddress.toLowerCase()) {
          throw new Error("POLYGON_TREASURY_EOA and ARQ_POLYGON_USDC_ADDRESS cannot be identical.");
        }
      }

      // Guard 6: Explicit non-empty SOLANA_RPC_URL in production real mode
      const solanaRpcUrl = env.SOLANA_RPC_URL?.trim();
      if (!solanaRpcUrl || solanaRpcUrl === "" || solanaRpcUrl.includes("api.devnet.solana.com")) {
        throw new Error("TREASURY_MODE=cctp-arq requires an explicit non-empty mainnet SOLANA_RPC_URL configuration.");
      }

      // Guard 7: Explicit non-empty POLYGON_RPC_URL in production real mode
      const polygonRpcUrl = env.POLYGON_RPC_URL?.trim();
      if (!polygonRpcUrl || polygonRpcUrl === "") {
        throw new Error("TREASURY_MODE=cctp-arq requires an explicit non-empty mainnet POLYGON_RPC_URL configuration.");
      }

      const executorApiUrl = env.EXECUTOR_API_URL?.trim() || "https://executor.labsapis.com";
      const executorClient = new WormholeExecutorClient({ executorApiUrl, polygonRpcUrl });

      const dataDir = options?.dataDir ?? env.DATA_DIR ?? "./data";
      const store = new FileTreasuryTransferStore(path.join(dataDir, "treasury-transfers.jsonl"));

      const cctpOptions: CctpArqTreasuryOptions = {
        thresholds,
        arqPolygonAddress: arqAddress,
        polygonTreasuryEoa: eoa,
        solanaCluster: solanaCluster as "mainnet-beta",
        polygonNetwork: polygonNetwork as "mainnet",
        executorClient,
        store,
      };

      const underlyingCctpTreasury = new CctpArqTreasury(cctpOptions);
      const arqBalanceProvider = new ManualArqBalanceProvider(0n);

      // Wrap in TreasuryRebalancer so production routing MANDATORILY passes through LiquidityPolicy
      const rebalancerRouter = new TreasuryRebalancer({
        treasuryRouter: underlyingCctpTreasury,
        store,
        arqBalanceProvider,
        config: liquidityConfig,
      });

      return { router: rebalancerRouter, mode: "cctp-arq", warnings, liquidityConfig };
    }

    default:
      warnings.push(`Unknown TREASURY_MODE="${mode}". Falling back to disabled.`);
      return { router: new DisabledTreasury(), mode: "disabled", warnings, liquidityConfig };
  }
}
