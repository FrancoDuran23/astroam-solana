// PolygonArqAdapter: Adapter interface and implementations for Polygon Treasury EOA -> ARQ Polygon USDC transfers.
//
// Official Specifications:
// - Network: Polygon Mainnet (Chain ID 137)
// - Native Circle USDC Contract: 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359
// - Bridged USDC.e Contract: 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174 (REJECTED)
// - Gas Token: POL (formerly MATIC)
//
// Principles:
// 1. Crash-Safe Execution: Local EVM transaction build & sign -> persist txHash and raw bytes -> broadcast -> receipt query.
// 2. Dynamic Gas Guard: Estimate gasLimit, maxFeePerGas, and maxPriorityFeePerGas dynamically before preparing/signing.
// 3. USDC Balance Guard: Check USDC balance >= amountAtomic before preparing or signing.
// 4. Nonce Safety: Query `blockTag: "pending"` to include mempool nonces. Max 1 active transfer per wallet.
// 5. Strict Chain ID Enforcement: Enforce Chain ID 137 (Polygon Mainnet) for all production transactions.

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  encodeFunctionData,
  type PublicClient,
  type Account,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

export const POLYGON_MAINNET_USDC_CONTRACT = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" as const;
export const POLYGON_BRIDGED_USDC_E_CONTRACT = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
export const POLYGON_MAINNET_CHAIN_ID = 137;

const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export function isValidEvmAddress(address: string | undefined): boolean {
  if (!address) return false;
  const clean = address.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(clean)) return false;
  if (clean.toLowerCase() === ZERO_ADDRESS) return false;
  return true;
}

export function validateUsdcContractAddress(contractAddress: string): void {
  if (contractAddress.toLowerCase() === POLYGON_BRIDGED_USDC_E_CONTRACT.toLowerCase()) {
    throw new Error(
      `Invalid USDC contract: ${contractAddress} is bridged USDC.e. Must use native Circle USDC (${POLYGON_MAINNET_USDC_CONTRACT}).`
    );
  }
  if (contractAddress.toLowerCase() !== POLYGON_MAINNET_USDC_CONTRACT.toLowerCase()) {
    throw new Error(
      `Invalid USDC contract: ${contractAddress}. Expected native Circle USDC on Polygon (${POLYGON_MAINNET_USDC_CONTRACT}).`
    );
  }
}

export function validatePolygonAddresses(treasuryEoa: string, arqDepositAddress: string): void {
  if (!isValidEvmAddress(treasuryEoa)) {
    throw new Error(`Invalid POLYGON_TREASURY_EOA: "${treasuryEoa}". Must be valid non-zero EVM address.`);
  }
  if (!isValidEvmAddress(arqDepositAddress)) {
    throw new Error(`Invalid ARQ_POLYGON_USDC_ADDRESS: "${arqDepositAddress}". Must be valid non-zero EVM address.`);
  }
  if (treasuryEoa.trim().toLowerCase() === arqDepositAddress.trim().toLowerCase()) {
    throw new Error(
      `POLYGON_TREASURY_EOA and ARQ_POLYGON_USDC_ADDRESS cannot be identical (${treasuryEoa}).`
    );
  }
}

/**
 * Calculates dynamic required POL gas in wei based on estimateGas, maxFeePerGas, and safety margin.
 */
export async function calculateRequiredGasWei(
  gasEstimate: bigint,
  maxFeePerGas: bigint,
  safetyMarginBps = 12000 // 120% = 1.2x safety margin
): Promise<bigint> {
  const estimatedCostWei = gasEstimate * maxFeePerGas;
  return (estimatedCostWei * BigInt(safetyMarginBps)) / 10000n;
}

export type PreparedPolygonTransfer = {
  transferId: string;
  txHash: string;
  serializedTransaction: string; // 0x hex signed EVM transaction bytes
  amountAtomic: bigint;
  destinationAddress: string;
  nonce: number;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

export interface PolygonArqAdapter {
  getUsdcBalance(address: string): Promise<bigint>;
  getPolBalance(address: string): Promise<bigint>;
  prepareUsdcTransfer(input: {
    amountAtomic: bigint;
    destinationAddress: string;
    transferId?: string;
  }): Promise<PreparedPolygonTransfer>;
  broadcastPreparedTransfer(input: {
    txHash: string;
    serializedTransaction: string;
  }): Promise<{ txHash: string; accepted: boolean }>;
  getTransactionStatus(txHash: string): Promise<"pending" | "confirmed" | "failed" | "not_found" | "polygon_stuck">;
}

// ---------------------------------------------------------------------------
// MockPolygonArqAdapter — for unit tests and offline environments
// ---------------------------------------------------------------------------

export class MockPolygonArqAdapter implements PolygonArqAdapter {
  simulatedUsdcBalance = 1_000_000_000n; // 1000 USDC
  simulatedPolBalance = 1_000_000_000_000_000_000n; // 1.0 POL
  simulatedGasEstimate = 65_000n;
  simulatedMaxFeePerGas = 100_000_000_000n; // 100 Gwei
  simulatedMaxPriorityFeePerGas = 30_000_000_000n; // 30 Gwei
  simulatedStatus: "pending" | "confirmed" | "failed" | "not_found" | "polygon_stuck" = "confirmed";
  shouldFailPrepare = false;
  prepareErrorDetail = "Polygon preparation failed (mock)";

  readonly preparedTransfers: PreparedPolygonTransfer[] = [];
  readonly broadcasts: Array<{ txHash: string; serializedTransaction: string }> = [];
  private seq = 0;

  async getUsdcBalance(_address: string): Promise<bigint> {
    return this.simulatedUsdcBalance;
  }

  async getPolBalance(_address: string): Promise<bigint> {
    return this.simulatedPolBalance;
  }

  async prepareUsdcTransfer(input: {
    amountAtomic: bigint;
    destinationAddress: string;
    transferId?: string;
  }): Promise<PreparedPolygonTransfer> {
    if (this.shouldFailPrepare) {
      throw new Error(this.prepareErrorDetail);
    }
    // 1. USDC Balance Check
    if (this.simulatedUsdcBalance < input.amountAtomic) {
      throw new Error(`insufficient_polygon_usdc: balance (${this.simulatedUsdcBalance}) < amount (${input.amountAtomic})`);
    }

    // 2. Dynamic Gas Check
    const requiredGasWei = await calculateRequiredGasWei(this.simulatedGasEstimate, this.simulatedMaxFeePerGas);
    if (this.simulatedPolBalance < requiredGasWei) {
      throw new Error(`insufficient_polygon_gas: POL balance (${this.simulatedPolBalance}) < required (${requiredGasWei})`);
    }

    this.seq++;
    const transferId = input.transferId ?? `pol_trf_${Date.now()}_${this.seq}`;
    const txHash = `0x${this.seq.toString(16).padStart(64, "0")}`;
    const serializedTransaction = `0x02f8...mock_signed_evm_tx_${this.seq}`;

    const prepared: PreparedPolygonTransfer = {
      transferId,
      txHash,
      serializedTransaction,
      amountAtomic: input.amountAtomic,
      destinationAddress: input.destinationAddress,
      nonce: this.seq,
      gasLimit: this.simulatedGasEstimate,
      maxFeePerGas: this.simulatedMaxFeePerGas,
      maxPriorityFeePerGas: this.simulatedMaxPriorityFeePerGas,
    };

    this.preparedTransfers.push(prepared);
    return prepared;
  }

  async broadcastPreparedTransfer(input: {
    txHash: string;
    serializedTransaction: string;
  }): Promise<{ txHash: string; accepted: boolean }> {
    this.broadcasts.push(input);
    return { txHash: input.txHash, accepted: true };
  }

  async getTransactionStatus(_txHash: string): Promise<"pending" | "confirmed" | "failed" | "not_found" | "polygon_stuck"> {
    return this.simulatedStatus;
  }
}

// ---------------------------------------------------------------------------
// ViemPolygonArqAdapter — Official EVM implementation using viem
// ---------------------------------------------------------------------------

export type ViemPolygonArqAdapterOptions = {
  rpcUrl?: string;
  privateKey?: Hex;
  treasuryEoa: string;
  usdcContractAddress?: string;
  chainId?: number;
};

export class ViemPolygonArqAdapter implements PolygonArqAdapter {
  readonly rpcUrl: string;
  readonly treasuryEoa: string;
  readonly usdcContractAddress: string;
  readonly chainId: number;
  private readonly publicClient: PublicClient;
  private readonly account?: Account;

  constructor(options: ViemPolygonArqAdapterOptions) {
    this.rpcUrl = options.rpcUrl ?? "https://polygon-rpc.com";
    this.treasuryEoa = options.treasuryEoa;
    this.usdcContractAddress = options.usdcContractAddress ?? POLYGON_MAINNET_USDC_CONTRACT;
    this.chainId = options.chainId ?? POLYGON_MAINNET_CHAIN_ID;

    if (this.chainId !== POLYGON_MAINNET_CHAIN_ID) {
      throw new Error(`Invalid Polygon Chain ID: ${this.chainId}. Must enforce Chain ID ${POLYGON_MAINNET_CHAIN_ID}.`);
    }

    validateUsdcContractAddress(this.usdcContractAddress);
    if (!isValidEvmAddress(this.treasuryEoa)) {
      throw new Error(`Invalid treasuryEoa address: "${this.treasuryEoa}"`);
    }

    this.publicClient = createPublicClient({
      chain: polygon,
      transport: http(this.rpcUrl),
    }) as PublicClient;

    if (options.privateKey) {
      this.account = privateKeyToAccount(options.privateKey);
    }
  }

  async getUsdcBalance(address: string): Promise<bigint> {
    try {
      const balance = await this.publicClient.readContract({
        address: this.usdcContractAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      });
      return balance;
    } catch {
      return 0n;
    }
  }

  async getPolBalance(address: string): Promise<bigint> {
    try {
      const balance = await this.publicClient.getBalance({
        address: address as `0x${string}`,
      });
      return balance;
    } catch {
      return 0n;
    }
  }

  async prepareUsdcTransfer(input: {
    amountAtomic: bigint;
    destinationAddress: string;
    transferId?: string;
  }): Promise<PreparedPolygonTransfer> {
    if (!this.account) {
      throw new Error("ViemPolygonArqAdapter requires a privateKey to sign transactions locally.");
    }

    const transferId = input.transferId ?? `pol_trf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const recipient = input.destinationAddress as `0x${string}`;

    // 1. USDC Balance Check BEFORE preparing or signing
    const usdcBalance = await this.getUsdcBalance(this.account.address);
    if (usdcBalance < input.amountAtomic) {
      throw new Error(`insufficient_polygon_usdc: balance (${usdcBalance}) < amount (${input.amountAtomic})`);
    }

    // Encode ERC20 transfer(to, amount)
    const callData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [recipient, input.amountAtomic],
    });

    // 2. Dynamic POL Gas Estimation
    const [gasEstimate, feeData] = await Promise.all([
      this.publicClient
        .estimateGas({
          account: this.account.address,
          to: this.usdcContractAddress as `0x${string}`,
          data: callData,
          value: 0n,
        })
        .catch(() => 65_000n),
      this.publicClient.estimateFeesPerGas().catch(() => ({
        maxFeePerGas: 100_000_000_000n,
        maxPriorityFeePerGas: 30_000_000_000n,
      })),
    ]);

    const maxFeePerGas = feeData.maxFeePerGas ?? 100_000_000_000n;
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 30_000_000_000n;
    const gasLimit = (gasEstimate * 120n) / 100n; // 20% gas limit buffer

    const requiredGasWei = await calculateRequiredGasWei(gasLimit, maxFeePerGas);
    const polBalance = await this.getPolBalance(this.account.address);
    if (polBalance < requiredGasWei) {
      throw new Error(
        `insufficient_polygon_gas: POL balance (${polBalance}) is less than required (${requiredGasWei})`
      );
    }

    // 3. Query Pending Nonce from mempool
    const nonce = await this.publicClient.getTransactionCount({
      address: this.account.address,
      blockTag: "pending",
    });

    const walletClient = createWalletClient({
      account: this.account,
      chain: polygon,
      transport: http(this.rpcUrl),
    });

    // 4. Build and sign EIP-1559 EVM transaction locally enforcing Chain ID 137
    const serializedTransaction = await walletClient.signTransaction({
      account: this.account,
      chain: polygon, // Chain ID 137
      to: this.usdcContractAddress as `0x${string}`,
      data: callData,
      value: 0n,
      nonce,
      gas: gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });

    // 5. Hash signed transaction locally to obtain deterministic EVM txHash
    const { keccak256 } = await import("viem");
    const txHash = keccak256(serializedTransaction);

    return {
      transferId,
      txHash,
      serializedTransaction,
      amountAtomic: input.amountAtomic,
      destinationAddress: input.destinationAddress,
      nonce,
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
    };
  }

  async broadcastPreparedTransfer(input: {
    txHash: string;
    serializedTransaction: string;
  }): Promise<{ txHash: string; accepted: boolean }> {
    try {
      await this.publicClient.sendRawTransaction({
        serializedTransaction: input.serializedTransaction as `0x${string}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("already known") && !msg.includes("nonce too low")) {
        throw err;
      }
    }
    return { txHash: input.txHash, accepted: true };
  }

  async getTransactionStatus(txHash: string): Promise<"pending" | "confirmed" | "failed" | "not_found" | "polygon_stuck"> {
    if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return "pending";
    }

    try {
      const receipt = await this.publicClient.getTransactionReceipt({
        hash: txHash as `0x${string}`,
      });

      if (!receipt) return "pending";
      if (receipt.status === "success") return "confirmed";
      if (receipt.status === "reverted") return "failed";
      return "pending";
    } catch {
      return "not_found";
    }
  }
}
