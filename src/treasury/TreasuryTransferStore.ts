// TreasuryTransferStore: persistent journal for cross-chain treasury transfers.
//
// Ambiguity Window Elimination:
// The journal persists `sourceTxSignature` AND `serializedTransaction` on disk
// BEFORE calling broadcast over the RPC network.
//
// States:
// - prepared: intent created before local tx sign
// - source_tx_prepared: transaction signed locally, signature + raw tx persisted BEFORE broadcast
// - source_broadcast_started: broadcast call initiated to network RPC
// - source_submitted: broadcast accepted by RPC node
// - source_confirmed: burn tx confirmed on-chain
// - cctp_message_discovered: cctpMessage and hash extracted from logs
// - executor_pending: waiting for Wormhole Executor redemption on Polygon
// - attestation_pending: waiting for Circle/Wormhole attestation
// - destination_tx_prepared: destination EVM tx signed and persisted locally
// - destination_broadcast_started: destination tx broadcast initiated
// - destination_submitted: destination mint tx submitted on Polygon
// - destination_confirmed: destination mint tx confirmed on Polygon
// - polygon_transfer_prepared: Polygon USDC transfer prepared and signed locally
// - polygon_broadcast_started: Polygon USDC broadcast initiated
// - polygon_submitted: Polygon USDC transfer submitted to network
// - polygon_confirmed: Polygon USDC transfer confirmed on-chain (receipt 0x1)
// - arq_accreditation_pending: Polygon transfer confirmed, waiting for manual ARQ accreditation
// - arq_accreditation_confirmed: Manual/external verification confirmed ARQ credited account
// - completed: transfer finished with verifiable destination completion
// - source_expired_unconfirmed: tx expired on-chain without landing (not_found + blockhash expired)
// - source_quote_expired: quote expired before broadcast
// - polygon_stuck: stuck Polygon transfer requiring manual review/replacement
// - failed_retriable: transient failure (can be resumed/retried)
// - failed_terminal: unrecoverable failure

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export type TransferState =
  | "prepared"
  | "source_tx_prepared"
  | "source_broadcast_started"
  | "source_submitted"
  | "source_confirmed"
  | "cctp_message_discovered"
  | "executor_pending"
  | "attestation_pending"
  | "destination_tx_prepared"
  | "destination_broadcast_started"
  | "destination_submitted"
  | "destination_confirmed"
  | "polygon_transfer_prepared"
  | "polygon_broadcast_started"
  | "polygon_submitted"
  | "polygon_confirmed"
  | "arq_accreditation_pending"
  | "arq_deposit_pending"
  | "arq_deposit_confirmed"
  | "arq_accreditation_confirmed"
  | "polygon_stuck"
  | "completed"
  | "source_expired_unconfirmed"
  | "source_quote_expired"
  | "failed_retriable"
  | "failed_terminal";

export type TreasuryTransferRecord = {
  v: 1;
  transferId: string;
  amountAtomic: string;
  sourceChain: string;
  destinationChain: string;
  destinationAddress: string;
  sourceTxSignature?: string;
  serializedTransaction?: string; // signed raw tx bytes (base64)
  lastValidBlockHeight?: number;
  cctpMessageBytes?: string;
  cctpMessage?: string;
  cctpMessageHash?: string;
  executorQuoteId?: string;
  executorQuoteExpiresAt?: string;
  executorEstimatedCost?: string;
  attestation?: string;
  destinationTxHash?: string;
  polygonTxHash?: string;
  polygonSerializedTx?: string;
  polygonNonce?: number;
  polygonGasBalance?: string;
  polygonGasLimit?: string;
  polygonMaxFeePerGas?: string;
  polygonMaxPriorityFeePerGas?: string;
  polygonAmountAtomic?: string;
  polygonRecipient?: string;
  state: TransferState;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
};

export interface TreasuryTransferStore {
  save(record: TreasuryTransferRecord): Promise<void>;
  get(transferId: string): TreasuryTransferRecord | undefined;
  listAll(): TreasuryTransferRecord[];
  findActive(): TreasuryTransferRecord[];
}

/**
 * Manual ARQ Accreditation Reconciliation API:
 * Transition a transfer from `arq_accreditation_pending` to `arq_accreditation_confirmed` / `completed`.
 * This removes the transfer from `inTransitLiquidityAtomic`, eliminating the double-counting window
 * before updating confirmed manual operational balance.
 */
export async function confirmArqAccreditation(
  store: TreasuryTransferStore,
  transferId: string,
  expectedAmountAtomic?: bigint,
): Promise<TreasuryTransferRecord> {
  const record = store.get(transferId);
  if (!record) {
    throw new Error(`confirmArqAccreditation failed: transferId "${transferId}" not found in journal.`);
  }

  const validPendingStates: TransferState[] = [
    "polygon_confirmed",
    "arq_accreditation_pending",
    "arq_deposit_pending",
  ];

  if (!validPendingStates.includes(record.state)) {
    throw new Error(
      `confirmArqAccreditation failed: transfer "${transferId}" is in state "${record.state}", expected pending accreditation ("arq_accreditation_pending" or "polygon_confirmed").`,
    );
  }

  if (expectedAmountAtomic !== undefined && BigInt(record.amountAtomic) !== expectedAmountAtomic) {
    throw new Error(
      `confirmArqAccreditation failed: amount mismatch for transfer "${transferId}". Expected ${expectedAmountAtomic}, record has ${record.amountAtomic}.`,
    );
  }

  const now = new Date().toISOString();
  record.state = "arq_accreditation_confirmed";
  record.updatedAt = now;
  await store.save(record);

  record.state = "completed";
  record.updatedAt = now;
  await store.save(record);

  return record;
}

// ---------------------------------------------------------------------------
// MemoryTreasuryTransferStore — for unit tests
// ---------------------------------------------------------------------------

export class MemoryTreasuryTransferStore implements TreasuryTransferStore {
  private readonly store = new Map<string, TreasuryTransferRecord>();

  async save(record: TreasuryTransferRecord): Promise<void> {
    this.store.set(record.transferId, structuredClone(record));
  }

  get(transferId: string): TreasuryTransferRecord | undefined {
    const found = this.store.get(transferId);
    return found ? structuredClone(found) : undefined;
  }

  listAll(): TreasuryTransferRecord[] {
    return [...this.store.values()].map((r) => structuredClone(r));
  }

  findActive(): TreasuryTransferRecord[] {
    return this.listAll().filter(
      (r) =>
        r.state !== "completed" &&
        r.state !== "arq_accreditation_confirmed" &&
        r.state !== "arq_deposit_confirmed" &&
        r.state !== "failed_terminal" &&
        r.state !== "source_expired_unconfirmed" &&
        r.state !== "source_quote_expired" &&
        r.state !== "polygon_stuck",
    );
  }
}

// ---------------------------------------------------------------------------
// FileTreasuryTransferStore — persistent storage under DATA_DIR
// ---------------------------------------------------------------------------

const recordSchema = z.object({
  v: z.literal(1),
  transferId: z.string().min(1),
  amountAtomic: z.string().min(1),
  sourceChain: z.string().min(1),
  destinationChain: z.string().min(1),
  destinationAddress: z.string().min(1),
  sourceTxSignature: z.string().optional(),
  serializedTransaction: z.string().optional(),
  lastValidBlockHeight: z.number().optional(),
  cctpMessageBytes: z.string().optional(),
  cctpMessage: z.string().optional(),
  cctpMessageHash: z.string().optional(),
  executorQuoteId: z.string().optional(),
  executorQuoteExpiresAt: z.string().optional(),
  executorEstimatedCost: z.string().optional(),
  attestation: z.string().optional(),
  destinationTxHash: z.string().optional(),
  polygonTxHash: z.string().optional(),
  polygonSerializedTx: z.string().optional(),
  polygonNonce: z.number().optional(),
  polygonGasBalance: z.string().optional(),
  polygonGasLimit: z.string().optional(),
  polygonMaxFeePerGas: z.string().optional(),
  polygonMaxPriorityFeePerGas: z.string().optional(),
  polygonAmountAtomic: z.string().optional(),
  polygonRecipient: z.string().optional(),
  state: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastError: z.string().optional(),
});

function parseStoreFile(filePath: string): Map<string, TreasuryTransferRecord> {
  const map = new Map<string, TreasuryTransferRecord>();
  if (!fs.existsSync(filePath)) return map;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = recordSchema.parse(JSON.parse(line));
      map.set(parsed.transferId, parsed as TreasuryTransferRecord);
    } catch (error) {
      throw new Error(`Corrupt transfer store file at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return map;
}

export class FileTreasuryTransferStore implements TreasuryTransferStore {
  private readonly filePath: string;
  private readonly records: Map<string, TreasuryTransferRecord>;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.records = parseStoreFile(filePath);
  }

  async save(record: TreasuryTransferRecord): Promise<void> {
    this.records.set(record.transferId, structuredClone(record));
    this.persist();
  }

  get(transferId: string): TreasuryTransferRecord | undefined {
    const found = this.records.get(transferId);
    return found ? structuredClone(found) : undefined;
  }

  listAll(): TreasuryTransferRecord[] {
    return [...this.records.values()].map((r) => structuredClone(r));
  }

  findActive(): TreasuryTransferRecord[] {
    return this.listAll().filter(
      (r) =>
        r.state !== "completed" &&
        r.state !== "arq_accreditation_confirmed" &&
        r.state !== "arq_deposit_confirmed" &&
        r.state !== "failed_terminal" &&
        r.state !== "source_expired_unconfirmed" &&
        r.state !== "source_quote_expired" &&
        r.state !== "polygon_stuck",
    );
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const lines = [...this.records.values()].map((r) => JSON.stringify(r)).join("\n");
    fs.writeFileSync(tmp, `${lines}\n`, "utf8");
    fs.renameSync(tmp, this.filePath);
  }
}
