// CctpArqTreasury: production treasury router with persistent transfer journal,
// Ambiguity Window Elimination, CCTP V2, and Wormhole Executor Integration.
//
// State Machine:
//   prepared
//     → source_tx_prepared           (signed locally with CCTP v2 depositForBurn + Executor request; signature + raw tx persisted)
//     → source_broadcast_started     (broadcast call initiated to RPC network)
//     → source_submitted             (broadcast accepted by network)
//     → source_confirmed             (burn confirmed on-chain)
//     → cctp_message_discovered      (cctpMessage and cctpMessageHash extracted from tx logs)
//     → executor_pending             (waiting for Wormhole Executor redemption on Polygon)
//     → destination_confirmed        (verified destinationTxHash on Polygon)
//     → completed                    (verifiable destination completion evidence)
//     → source_expired_unconfirmed   (tx blockhash expired before landing)
//     → source_quote_expired         (executor quote expired before broadcast)
//     → failed_retriable / failed_terminal

import type { TreasuryRouter, RebalanceInput, RebalanceResult, ThresholdConfig } from "./TreasuryRouter.ts";
import { computeSendable } from "./TreasuryRouter.ts";
import type { CctpBridge } from "./CctpBridge.ts";
import { MockCctpBridge } from "./CctpBridge.ts";
import type { TreasuryTransferStore, TreasuryTransferRecord } from "./TreasuryTransferStore.ts";
import { MemoryTreasuryTransferStore } from "./TreasuryTransferStore.ts";
import type { ExecutorClient } from "./ExecutorClient.ts";
import { MockExecutorClient } from "./ExecutorClient.ts";

import type { PolygonArqAdapter } from "./PolygonArqAdapter.ts";
import { MockPolygonArqAdapter, validatePolygonAddresses } from "./PolygonArqAdapter.ts";

export type CctpArqTreasuryOptions = {
  thresholds: ThresholdConfig;
  arqPolygonAddress: string;
  polygonTreasuryEoa?: string;
  solanaCluster: "mainnet-beta";
  polygonNetwork: "mainnet";
  bridge?: CctpBridge;
  executorClient?: ExecutorClient;
  polygonArqAdapter?: PolygonArqAdapter;
  store?: TreasuryTransferStore;
  currentBlockHeight?: number;
  logger?: (line: Record<string, unknown>) => void;
};

export class CctpArqTreasury implements TreasuryRouter {
  readonly mode = "cctp-arq";
  private readonly thresholds: ThresholdConfig;
  private readonly bridge: CctpBridge;
  private readonly executorClient: ExecutorClient;
  private readonly polygonArqAdapter: PolygonArqAdapter;
  private readonly store: TreasuryTransferStore;
  private readonly arqPolygonAddress: string;
  private readonly polygonTreasuryEoa: string | undefined;
  private readonly currentBlockHeight: number;
  private readonly logger: (line: Record<string, unknown>) => void;

  constructor(options: CctpArqTreasuryOptions) {
    this.thresholds = options.thresholds;
    this.bridge = options.bridge ?? new MockCctpBridge();
    this.executorClient = options.executorClient ?? new MockExecutorClient();
    this.polygonArqAdapter = options.polygonArqAdapter ?? new MockPolygonArqAdapter();
    this.store = options.store ?? new MemoryTreasuryTransferStore();
    this.arqPolygonAddress = options.arqPolygonAddress;
    this.polygonTreasuryEoa = options.polygonTreasuryEoa;
    this.currentBlockHeight = options.currentBlockHeight ?? 0;
    this.logger = options.logger ?? (() => {});

    if (this.polygonTreasuryEoa) {
      validatePolygonAddresses(this.polygonTreasuryEoa, this.arqPolygonAddress);
    }
  }

  async rebalance(input: RebalanceInput): Promise<RebalanceResult> {
    const sendable = computeSendable(input.availableAtomic, this.thresholds);
    if (sendable === null) {
      return { moved: false, reason: "below_threshold" };
    }

    const cctpDestination = this.polygonTreasuryEoa ?? this.arqPolygonAddress;

    // ACTIVE TRANSFER GUARD: Check if there is an active transfer for this destination
    const activeList = this.store.findActive();
    const active = activeList.find((r) => r.destinationAddress === cctpDestination);

    if (active) {
      return this.resumeActiveTransfer(active, sendable);
    }

    return this.initiateNewTransfer(sendable, cctpDestination);
  }

  private async resumeActiveTransfer(
    record: TreasuryTransferRecord,
    availableSendable: bigint,
  ): Promise<RebalanceResult> {
    this.logger({
      level: "info",
      msg: "treasury_rebalance_resuming_active_transfer",
      transferId: record.transferId,
      state: record.state,
      sourceTxSignature: record.sourceTxSignature,
    });

    switch (record.state) {
      case "prepared":
        return this.prepareAndBroadcastRecord(record);

      case "source_tx_prepared":
      case "source_broadcast_started":
      case "source_submitted":
      case "source_confirmed":
      case "cctp_message_discovered":
      case "executor_pending":
      case "attestation_pending":
      case "destination_tx_prepared":
      case "destination_broadcast_started":
      case "destination_submitted":
      case "destination_confirmed":
      case "polygon_transfer_prepared":
      case "polygon_broadcast_started":
      case "polygon_submitted":
      case "polygon_confirmed": {
        if (!record.sourceTxSignature) {
          record.state = "failed_retriable";
          record.lastError = "Missing sourceTxSignature in active state";
          await this.store.save(record);
          return { moved: false, reason: "transfer_state_missing_signature" };
        }

        // If Polygon transfer is already confirmed/in-progress, jump directly to Polygon hop
        if (
          record.state === "destination_confirmed" ||
          record.state === "polygon_transfer_prepared" ||
          record.state === "polygon_broadcast_started" ||
          record.state === "polygon_submitted" ||
          record.state === "polygon_confirmed"
        ) {
          return this.executePolygonToArqHop(record);
        }

        // 1. Query source transaction status on-chain
        const status = await this.bridge.getSourceTransactionStatus(record.sourceTxSignature);

        if (status === "confirmed") {
          record.state = "source_confirmed";
          await this.store.save(record);

          // 2. Discover CCTP message bytes & cctpMessageHash
          if (!record.cctpMessageHash && this.bridge.extractCctpMessageFromTransaction) {
            const extracted = await this.bridge.extractCctpMessageFromTransaction(record.sourceTxSignature);
            if (extracted) {
              record.cctpMessage = extracted.cctpMessage;
              record.cctpMessageHash = extracted.cctpMessageHash;
              record.state = "cctp_message_discovered";
              await this.store.save(record);
            }
          }

          // 3. Query Wormhole Executor for destination redemption status
          record.state = "executor_pending";
          await this.store.save(record);

          const execRes = await this.executorClient.getExecutionStatus({
            quoteId: record.executorQuoteId,
            sourceTxSignature: record.sourceTxSignature,
            cctpMessageHash: record.cctpMessageHash,
          });

          if (execRes.status === "completed" && execRes.destinationTxHash) {
            record.destinationTxHash = execRes.destinationTxHash;
            record.state = "destination_confirmed";
            record.updatedAt = new Date().toISOString();
            await this.store.save(record);

            return this.executePolygonToArqHop(record);
          }

          // FAIL CLOSED: If Executor status is pending/submitted, stay in executor_pending
          return {
            moved: true,
            amountAtomic: BigInt(record.amountAtomic),
            txHash: record.sourceTxSignature,
            detail: "source burn confirmed; executor redemption pending on Polygon",
          };
        }

        if (status === "pending") {
          return {
            moved: true,
            amountAtomic: BigInt(record.amountAtomic),
            txHash: record.sourceTxSignature,
            detail: "source burn transaction pending on-chain (do not rebroadcast)",
          };
        }

        if (status === "failed") {
          record.state = "failed_terminal";
          record.lastError = "Source transaction failed on-chain";
          await this.store.save(record);
          return { moved: false, reason: "source_tx_failed_on_chain" };
        }

        // status === "not_found"
        // Check if recent blockhash has expired
        const isExpired =
          record.lastValidBlockHeight !== undefined &&
          this.currentBlockHeight > 0 &&
          this.currentBlockHeight > record.lastValidBlockHeight;

        if (isExpired) {
          record.state = "source_expired_unconfirmed";
          record.lastError = `Transaction expired without landing (blockHeight ${this.currentBlockHeight} > ${record.lastValidBlockHeight})`;
          await this.store.save(record);
          return { moved: false, reason: "source_tx_expired_unconfirmed" };
        }

        // Check if executor quote expired BEFORE broadcast
        if (record.executorQuoteExpiresAt && record.state === "source_tx_prepared") {
          const expiresMs = new Date(record.executorQuoteExpiresAt).getTime();
          if (Date.now() > expiresMs) {
            record.state = "source_quote_expired";
            record.lastError = "Executor quote expired before broadcast";
            await this.store.save(record);
            return { moved: false, reason: "source_quote_expired" };
          }
        }

        // Re-broadcast pre-signed transaction bytes if not yet confirmed
        if (record.serializedTransaction) {
          try {
            record.state = "source_broadcast_started";
            await this.store.save(record);

            await this.bridge.broadcastPreparedSourceTransaction({
              sourceTxSignature: record.sourceTxSignature,
              serializedTransaction: record.serializedTransaction,
            });

            record.state = "source_submitted";
            await this.store.save(record);

            return {
              moved: true,
              amountAtomic: BigInt(record.amountAtomic),
              txHash: record.sourceTxSignature,
              detail: "rebroadcast existing signed transaction",
            };
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            return { moved: false, reason: `rebroadcast_failed: ${detail}` };
          }
        }

        record.state = "failed_retriable";
        record.lastError = "Source transaction not found and no raw tx to rebroadcast";
        await this.store.save(record);
        return { moved: false, reason: "source_tx_not_found" };
      }

      default:
        return { moved: false, reason: `unhandled_transfer_state_${record.state}` };
    }
  }

  private async initiateNewTransfer(
    amountAtomic: bigint,
    destinationAddress: string,
  ): Promise<RebalanceResult> {
    const transferId = `trf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    const record: TreasuryTransferRecord = {
      v: 1,
      transferId,
      amountAtomic: amountAtomic.toString(),
      sourceChain: "solana:mainnet-beta",
      destinationChain: "polygon:mainnet",
      destinationAddress,
      state: "prepared",
      createdAt: now,
      updatedAt: now,
    };

    await this.store.save(record);
    return this.prepareAndBroadcastRecord(record);
  }

  private async prepareAndBroadcastRecord(record: TreasuryTransferRecord): Promise<RebalanceResult> {
    try {
      // 1. Check Executor capabilities
      const caps = await this.executorClient.fetchCapabilities();
      if (!caps.supported) {
        record.state = "failed_retriable";
        record.lastError = caps.details;
        await this.store.save(record);
        return { moved: false, reason: `executor_capabilities_unsupported: ${caps.details}` };
      }

      // 2. Fetch Executor Quote (Official API: srcChain, dstChain, relayInstructions)
      const quote = await this.executorClient.fetchQuote({
        sourceChain: "solana:mainnet-beta",
        destinationChain: "polygon:mainnet",
      });

      record.executorQuoteId = quote.quoteId;
      record.executorQuoteExpiresAt = quote.expiresAt;
      record.executorEstimatedCost = quote.estimatedCostAtomic.toString();
      await this.store.save(record);

      // Check quote expiration before building/signing
      if (Date.now() > quote.expiresAtMs) {
        record.state = "source_quote_expired";
        record.lastError = "Executor quote expired before preparation";
        await this.store.save(record);
        return { moved: false, reason: "source_quote_expired" };
      }

      // 3. Prepare and sign transaction locally (obtain sourceTxSignature WITHOUT broadcasting)
      // Official requirement: requestForExecution receives execAmount == estimatedCost from quote
      const prepared = await this.bridge.prepareSourceBurn({
        amountAtomic: BigInt(record.amountAtomic),
        destinationAddress: record.destinationAddress,
        transferId: record.transferId,
        executorRelayInstructions: quote.relayInstructions,
        executorEstimatedCost: quote.estimatedCostAtomic,
      });

      // 4. PERSIST sourceTxSignature AND serializedTransaction TO DISK BEFORE BROADCAST
      record.sourceTxSignature = prepared.sourceTxSignature;
      record.serializedTransaction = prepared.serializedTransaction;
      record.lastValidBlockHeight = prepared.lastValidBlockHeight;
      record.state = "source_tx_prepared";
      record.updatedAt = new Date().toISOString();
      await this.store.save(record);

      // 5. Re-check quote expiry right before broadcast
      if (Date.now() > quote.expiresAtMs) {
        record.state = "source_quote_expired";
        record.lastError = "Executor quote expired right before broadcast";
        await this.store.save(record);
        return { moved: false, reason: "source_quote_expired" };
      }

      // 6. Mark source_broadcast_started
      record.state = "source_broadcast_started";
      record.updatedAt = new Date().toISOString();
      await this.store.save(record);

      // 7. Broadcast pre-signed raw bytes (SANITY: Never log serializedTransaction!)
      this.logger({
        level: "info",
        msg: "broadcasting_signed_source_transaction",
        transferId: record.transferId,
        sourceTxSignature: prepared.sourceTxSignature,
        executorQuoteId: quote.quoteId,
      });

      const broadcastRes = await this.bridge.broadcastPreparedSourceTransaction({
        sourceTxSignature: prepared.sourceTxSignature,
        serializedTransaction: prepared.serializedTransaction,
      });

      record.state = "source_submitted";
      record.updatedAt = new Date().toISOString();
      await this.store.save(record);

      // 8. Verify source transaction status
      const status = await this.bridge.getSourceTransactionStatus(broadcastRes.sourceTxSignature);
      if (status === "confirmed") {
        record.state = "source_confirmed";
        await this.store.save(record);
      }

      // 9. Discover CCTP Message
      if (this.bridge.extractCctpMessageFromTransaction) {
        const extracted = await this.bridge.extractCctpMessageFromTransaction(prepared.sourceTxSignature);
        if (extracted) {
          record.cctpMessage = extracted.cctpMessage;
          record.cctpMessageHash = extracted.cctpMessageHash;
          record.state = "cctp_message_discovered";
          await this.store.save(record);
        }
      }

      // 10. Query Wormhole Executor for Polygon redemption status
      record.state = "executor_pending";
      await this.store.save(record);

      const execRes = await this.executorClient.getExecutionStatus({
        quoteId: quote.quoteId,
        sourceTxSignature: prepared.sourceTxSignature,
        cctpMessageHash: record.cctpMessageHash,
      });

      if (execRes.status === "completed" && execRes.destinationTxHash) {
        record.destinationTxHash = execRes.destinationTxHash;
        record.state = "destination_confirmed";
        record.updatedAt = new Date().toISOString();
        await this.store.save(record);

        return this.executePolygonToArqHop(record);
      }

      return {
        moved: true,
        amountAtomic: BigInt(record.amountAtomic),
        txHash: prepared.sourceTxSignature,
        detail: "source burn confirmed; executor redemption pending on Polygon",
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);

      if (record.sourceTxSignature) {
        record.lastError = detail;
        record.updatedAt = new Date().toISOString();
        await this.store.save(record);
      } else {
        record.state = "failed_retriable";
        record.lastError = detail;
        record.updatedAt = new Date().toISOString();
        await this.store.save(record);
      }

      this.logger({
        level: "error",
        msg: "treasury_rebalance_broadcast_failed",
        transferId: record.transferId,
        sourceTxSignature: record.sourceTxSignature ?? null,
        detail,
      });

      return { moved: false, reason: `cctp_broadcast_failed: ${detail}` };
    }
  }

  private async executePolygonToArqHop(record: TreasuryTransferRecord): Promise<RebalanceResult> {
    if (!this.polygonTreasuryEoa) {
      record.state = "completed";
      await this.store.save(record);
      return {
        moved: true,
        amountAtomic: BigInt(record.amountAtomic),
        txHash: record.sourceTxSignature ?? "",
        detail: "Completed directly to ARQ address",
      };
    }

    try {
      // 1. USDC Balance Check BEFORE gas check or signing
      const usdcBalance = await this.polygonArqAdapter.getUsdcBalance(this.polygonTreasuryEoa);
      if (usdcBalance < BigInt(record.amountAtomic)) {
        record.lastError = `insufficient_polygon_usdc: balance (${usdcBalance}) < amount (${record.amountAtomic})`;
        await this.store.save(record);
        return { moved: false, reason: "insufficient_polygon_usdc" };
      }

      // 2. Prepare signed EVM tx locally if not already prepared
      if (!record.polygonTxHash || !record.polygonSerializedTx) {
        const prepared = await this.polygonArqAdapter.prepareUsdcTransfer({
          amountAtomic: BigInt(record.amountAtomic),
          destinationAddress: this.arqPolygonAddress,
          transferId: record.transferId,
        });

        // Persist all EIP-1559 fields to journal BEFORE broadcast (NO private keys!)
        record.polygonTxHash = prepared.txHash;
        record.polygonSerializedTx = prepared.serializedTransaction;
        record.polygonNonce = prepared.nonce;
        record.polygonGasLimit = prepared.gasLimit.toString();
        record.polygonMaxFeePerGas = prepared.maxFeePerGas.toString();
        record.polygonMaxPriorityFeePerGas = prepared.maxPriorityFeePerGas.toString();
        record.polygonAmountAtomic = prepared.amountAtomic.toString();
        record.polygonRecipient = prepared.destinationAddress;
        record.state = "polygon_transfer_prepared";
        record.updatedAt = new Date().toISOString();
        await this.store.save(record);
      }

      const polygonTxHash = record.polygonTxHash!;
      const polygonSerializedTx = record.polygonSerializedTx!;

      // 3. Mark broadcast started & transmit exact same signed bytes
      if (record.state === "polygon_transfer_prepared") {
        record.state = "polygon_broadcast_started";
        await this.store.save(record);

        await this.polygonArqAdapter.broadcastPreparedTransfer({
          txHash: polygonTxHash,
          serializedTransaction: polygonSerializedTx,
        });

        record.state = "polygon_submitted";
        await this.store.save(record);
      }

      // 4. Verify EVM transaction status on Polygon
      const status = await this.polygonArqAdapter.getTransactionStatus(polygonTxHash);

      if (status === "confirmed") {
        record.state = "polygon_confirmed";
        record.updatedAt = new Date().toISOString();
        await this.store.save(record);

        // Transition to arq_accreditation_pending (ARQ accreditation is manual/external)
        record.state = "arq_accreditation_pending";
        await this.store.save(record);

        return {
          moved: true,
          amountAtomic: BigInt(record.amountAtomic),
          txHash: polygonTxHash,
          detail: `Polygon USDC transfer confirmed on-chain (tx: ${polygonTxHash}); ARQ accreditation pending manual/external verification`,
        };
      }

      if (status === "pending") {
        return {
          moved: true,
          amountAtomic: BigInt(record.amountAtomic),
          txHash: polygonTxHash,
          detail: "Polygon USDC transfer pending on Polygon network",
        };
      }

      if (status === "polygon_stuck") {
        record.state = "polygon_stuck";
        record.lastError = "Polygon transaction stuck pending (requires replacement with same nonce & higher fee)";
        await this.store.save(record);
        return { moved: false, reason: "polygon_stuck" };
      }

      if (status === "failed") {
        record.state = "failed_terminal";
        record.lastError = "Polygon USDC transfer to ARQ failed on-chain";
        await this.store.save(record);
        return { moved: false, reason: "polygon_usdc_transfer_failed" };
      }

      return { moved: false, reason: "polygon_usdc_transfer_status_unknown" };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (detail.includes("insufficient_polygon_usdc")) {
        record.lastError = detail;
        await this.store.save(record);
        return { moved: false, reason: "insufficient_polygon_usdc" };
      }
      if (detail.includes("insufficient_polygon_gas")) {
        record.lastError = detail;
        await this.store.save(record);
        return { moved: false, reason: "insufficient_polygon_gas" };
      }

      record.lastError = detail;
      await this.store.save(record);
      return { moved: false, reason: `polygon_transfer_error: ${detail}` };
    }
  }
}
