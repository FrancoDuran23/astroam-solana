// CctpBridge: adapter for Circle's Cross-Chain Transfer Protocol.
//
// Ambiguity Window Elimination Architecture:
// 1. `prepareSourceBurn`: Builds and signs the source transaction locally.
//    Generates `sourceTxSignature` AND `serializedTransaction` WITHOUT broadcasting.
// 2. `TreasuryTransferStore`: Persists `sourceTxSignature` and `serializedTransaction`
//    to disk BEFORE any RPC network call is made.
// 3. `broadcastPreparedSourceTransaction`: Transmits the exact pre-signed raw bytes.
//    If a network crash occurs during or after broadcast, the journal ALREADY holds
//    the deterministic `sourceTxSignature`, allowing `getSourceTransactionStatus(sig)`
//    to query on-chain status on restart.

export type PreparedSourceBurn = {
  transferId: string;
  sourceTxSignature: string;
  serializedTransaction: string; // base64 encoded signed raw tx
  lastValidBlockHeight?: number;
  amountAtomic: bigint;
  destinationChain: "polygon";
  destinationAddress: string;
  mock: boolean;
};

export type BroadcastResult = {
  sourceTxSignature: string;
  accepted: boolean;
};

export type TransactionStatus = "not_found" | "pending" | "confirmed" | "failed";

export interface CctpBridge {
  /**
   * Builds and signs the source burn transaction locally.
   * Returns deterministic signature and raw transaction bytes WITHOUT broadcasting.
   */
  prepareSourceBurn(input: {
    amountAtomic: bigint;
    destinationAddress: string;
    transferId?: string;
    executorRelayInstructions?: string;
    executorEstimatedCost?: bigint;
  }): Promise<PreparedSourceBurn>;

  /**
   * Transmits pre-signed raw transaction bytes to the network.
   */
  broadcastPreparedSourceTransaction(input: {
    sourceTxSignature: string;
    serializedTransaction: string;
  }): Promise<BroadcastResult>;

  /** Queries the status of a source transaction by signature. */
  getSourceTransactionStatus(signature: string): Promise<TransactionStatus>;

  /** Extracts raw CCTP Message and messageHash from a confirmed source transaction. */
  extractCctpMessageFromTransaction?(signature: string): Promise<{ cctpMessage: string; cctpMessageHash: string } | null>;

  /** Queries the status of a destination transaction by tx hash/signature/messageHash. */
  getDestinationTransactionStatus?(signature: string): Promise<TransactionStatus>;
}

// ---------------------------------------------------------------------------
// MockCctpBridge — for tests and devnet. Supports prepare/broadcast separation.
// ---------------------------------------------------------------------------

export class MockCctpBridge implements CctpBridge {
  readonly preparedBurns: PreparedSourceBurn[] = [];
  readonly broadcasts: { sourceTxSignature: string; serializedTransaction: string }[] = [];
  private readonly txStatuses = new Map<string, TransactionStatus>();
  private seq = 0;

  /** Set to true to simulate a bridge failure during prepare. */
  shouldFailOnPrepare = false;
  failPrepareError = "CCTP bridge prepare failed (mock)";

  /** Set to true to simulate a network crash during broadcast AFTER the mock network registered the tx. */
  crashDuringBroadcastAfterNetworkAccept = false;

  /** Set status to return for next query on a signature. Defaults to "confirmed". */
  setTxStatus(signature: string, status: TransactionStatus): void {
    this.txStatuses.set(signature, status);
  }

  async prepareSourceBurn(input: {
    amountAtomic: bigint;
    destinationAddress: string;
    transferId?: string;
  }): Promise<PreparedSourceBurn> {
    if (this.shouldFailOnPrepare) {
      throw new Error(this.failPrepareError);
    }
    const transferId = input.transferId ?? `trf_mock_${++this.seq}`;
    const signature = `mock-burn-sig-${this.seq}`;
    // Mock 64-byte signed transaction payload (base64 encoded)
    const mockRawTxBytes = Buffer.from(`mock_raw_tx_payload_${signature}_${input.amountAtomic}`).toString("base64");

    const prepared: PreparedSourceBurn = {
      transferId,
      sourceTxSignature: signature,
      serializedTransaction: mockRawTxBytes,
      lastValidBlockHeight: 100_000,
      amountAtomic: input.amountAtomic,
      destinationChain: "polygon",
      destinationAddress: input.destinationAddress,
      mock: true,
    };

    this.preparedBurns.push(prepared);
    return prepared;
  }

  async broadcastPreparedSourceTransaction(input: {
    sourceTxSignature: string;
    serializedTransaction: string;
  }): Promise<BroadcastResult> {
    // Record broadcast attempt
    this.broadcasts.push(input);

    // If crash scenario is enabled: register tx in network as confirmed, BUT throw network exception!
    if (this.crashDuringBroadcastAfterNetworkAccept) {
      this.txStatuses.set(input.sourceTxSignature, "confirmed");
      throw new Error("RPC Network Timeout right after transaction acceptance (simulated crash)");
    }

    if (!this.txStatuses.has(input.sourceTxSignature)) {
      this.txStatuses.set(input.sourceTxSignature, "confirmed");
    }

    return {
      sourceTxSignature: input.sourceTxSignature,
      accepted: true,
    };
  }

  async getSourceTransactionStatus(signature: string): Promise<TransactionStatus> {
    return this.txStatuses.get(signature) ?? "not_found";
  }

  async getDestinationTransactionStatus(signature: string): Promise<TransactionStatus> {
    return this.txStatuses.get(signature) ?? "confirmed";
  }
}
