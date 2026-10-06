// ── Core domain types for the AstroAm mission flow ──────────────────────────────

/** `<chain>:<name>` of the payment rail, e.g. "monad:testnet" or "demo:local". */
export type Network = string

export type MissionStatus =
  | 'pending_payment'
  | 'paid'
  | 'active'
  | 'paused'
  | 'closing'
  | 'refund_pending'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'error'

export type Destination = {
  id: string
  name: string
  flag: string
  network: string
  coverage: string
  pricePerMbUsdc: number
}

export type PublicEsimInfo = {
  iccid: string
  lpaString: string
  qrCode: string
  directInstallUrl: string
  status: string
  isMock?: boolean
}

export type Mission = {
  id: string
  origin: string
  destination: Destination
  startDate: string        // ISO date string (YYYY-MM-DD)
  endDate: string          // ISO date string (YYYY-MM-DD)
  durationDays: number
  budgetUsdc: number       // initial deposit
  dailyLimitUsdc: number
  alertAt20pct: boolean
  autoPauseAtLimit: boolean
  status: MissionStatus
  paymentStatus?: 'pending' | 'paid' | 'failed'
  depositTxHash?: string
  depositExplorerUrl?: string
  // live state
  balanceUsdc: number      // remaining
  consumedUsdc: number
  consumedMb: number
  esimStatus: 'active' | 'paused' | 'disabled' | 'not_provisioned'
  network: Network
  channelId: string        // payment channel opened by the deposit
  escrowId?: string
  /** Session key the deposit registered in the escrow (base58). */
  sessionKey?: string
  /** Highest voucher AstroAm holds for this trip. */
  voucher?: SignedVoucher
  /** Already collected from the escrow by AstroAm, 6-decimal USDC atomic units. */
  claimedAtomic?: string
  iccid?: string
  esim?: PublicEsimInfo
  isMock?: boolean
  closeTxHash?: string
  closeExplorerUrl?: string
  settledUsdc?: number
  refundedUsdc?: number
  createdAt: string        // ISO timestamp
}

export type UsageEvent = {
  id: string
  timestamp: string        // ISO timestamp
  kind: 'usage' | 'topup'
  mb: number
  amountUsdc: number
  /** signed: a voucher covers it; rejected: the channel could not pay. */
  status: 'signed' | 'rejected' | 'settled'
  /** Voucher signature or transaction id, shortened in the UI. */
  txId: string
  explorerUrl?: string
}

export type PaymentEvent = {
  id: string
  timestamp: string
  type: 'topup' | 'micropayment' | 'refund'
  amountUsdc: number
  description: string
}

export type MissionState = {
  mission: Mission | null
  events: UsageEvent[]
}

/** What Phantom or Solflare sends for a deposit on the Solana devnet escrow. */
export type SolanaDepositPlan = {
  cluster: 'devnet'
  rpcUrl: string
  explorer: string
  usdcMint: string
  usdcDecimals: number
  tokenProgram: string
  programId: string | null
  payee: string | null
  escrowId: string
  amount: string
  amountUsdc: string
  timeoutSeconds: number
  deployed: boolean
  /** The deposit may register a session key. That key does not sign vouchers. */
  sessionKeys?: boolean
}

/** A cumulative voucher: the total AstroAm's meter key authorizes the escrow to pay. */
export type SignedVoucher = {
  /** 6-decimal USDC atomic units. */
  cumulativeAtomic: string
  /** base64 of the ed25519 signature. */
  signature: string
  /** base58 meter key that signed. */
  signer: string
}

/** What the app has to sign next, and what AstroAm already holds. */
export type VoucherRequest = {
  escrowId: string
  programId: string | null
  depositAtomic: string
  cumulativeAtomic: string
  messageBase64: string | null
  signedAtomic: string
  claimedAtomic: string
  sessionKey: string | null
  /** Meter pubkey the program accepts. */
  meter?: string | null
  /** Latest voucher the meter already signed, when the backend holds the key. */
  voucher?: SignedVoucher | null
}

export type SolanaClosePlan = SolanaDepositPlan & {
  cumulativeAmount: string
  refundAtomic: string
  usedUsdc: string
  refundUsdc: string
  traveler: string | null
  messageBase64: string | null
}

export type PaymentIntentInfo = {
  intentId: string
  amount: string
  asset: string
  /** Address the deposit goes to (the payment channel contract). */
  payTo?: string
  /** Wallet deep link for the deposit. */
  paymentUri?: string
  qr?: string
  network?: string
  status: string
  isMock: boolean
  /** Present when the wallet sends the deposit itself on Solana devnet. */
  solana?: SolanaDepositPlan
}

export type PaymentConfirmationResult = {
  valid: boolean
  status: string
  depositTxHash?: string
  explorerUrl?: string
  channelId?: string
}

export type FinishResult = {
  txHash?: string
  explorerUrl?: string
  status: 'closing' | 'refund_pending' | 'settling' | 'completed' | 'failed' | 'awaiting_close'
  closeKind?: string
  settledUsdc?: number
  refundedUsdc?: number
  /** @deprecated kept for the offline demo; use refundedUsdc. */
  refundAmountUsdc?: number
  /** Traveler wallet and its USDC balance, read around the close. */
  wallet?: { address: string; beforeUsdc: number; afterUsdc: number }
  solana?: SolanaClosePlan
  /** Meter-signed voucher for this close. The wallet submits it and does not sign the amount. */
  meterVoucher?: SignedVoucher | null
}

export type CancelResult = {
  status: 'cancelled'
  txHash?: string
  explorerUrl?: string
  refundedUsdc?: number
}

export type BackendCapabilities = {
  backendAvailable: boolean
  network: string
  paymentRail: string
  paymentsLive: boolean
  /** The deployed escrow takes a session key. That key does not sign vouchers. */
  escrowSessionKeys?: boolean
  /** The backend holds the meter key and signs usage vouchers. */
  escrowMeter?: boolean
  /** Public key of that meter. */
  solanaMeter?: string | null
  /** The backend sends the checkpoint, the claims and the close itself. */
  escrowAutomation?: boolean
  escrowOperator?: string | null
  channelReady: boolean
  citrusReady: boolean
  connectivityProvider: 'fake' | 'citrus'
  citrusStatus: 'live' | 'unavailable'
  meteringMode: 'real' | 'demo' | 'unavailable'
  reconciliationAvailable: boolean
  demoTrafficEnabled: boolean
  mode: 'live' | 'partial' | 'demo'
  liveEnabled: boolean
  requiresAuth: boolean
  missingConfiguration: string[]
  solanaCluster?: string
  solanaRpcUrl?: string
  solanaExplorer?: string
  solanaUsdcMint?: string
  solanaProgramId?: string | null
  solanaPayee?: string | null
}

// ── Wizard step state ────────────────────────────────────────────────────────

export type WizardStep = 1 | 2 | 3 | 4

export type WizardData = {
  destination: Destination | null
  startDate: string
  endDate: string
  budgetUsdc: number
  dailyLimitUsdc: number
  alertAt20pct: boolean
  autoPauseAtLimit: boolean
}

// ── Activation step type ─────────────────────────────────────────────────────

export type ActivationStep = {
  label: string
  status: 'pending' | 'running' | 'done'
}
