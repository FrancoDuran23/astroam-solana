export type DestinationInfo = {
  id: string
  name: string
  flag: string
  network: string
  coverage: string
  pricePerMbUsdc: number
}

export type ProductMissionStatus =
  | 'pending_payment'
  | 'paid'
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed'

/** The highest cumulative voucher the app sent for a trip. */
export type StoredVoucher = {
  /** Total the traveler authorizes AstroAm to collect, in 6-decimal USDC atomic units. */
  cumulativeAtomic: string
  /** base64 of the ed25519 signature the program checks. */
  signature: string
  /** base58 key that signed: the session key or the traveler wallet. */
  signer: string
  receivedAt: string
}

/** One `claim` AstroAm sent: the escrow paid up to `cumulativeAtomic` and stayed open. */
export type ClaimRecord = {
  txHash: string
  explorerUrl?: string
  cumulativeAtomic: string
  at: string
}

export type TopUpRecord = {
  id: string
  intentId: string
  amountUsdc: number
  txHash?: string
  explorerUrl?: string
  status: 'pending' | 'settled'
  createdAt: string
}

export type PublicEsimInfo = {
  iccid: string
  lpaString: string
  qrCode: string
  directInstallUrl: string
  status: string
  isMock?: boolean
}

export type ProductMission = {
  id: string
  userId: string
  destination: DestinationInfo
  startDate: string
  endDate: string
  durationDays: number
  budgetUsdc: number
  dailyLimitUsdc: number
  autoPause: boolean
  lowBalanceAlert: boolean
  status: ProductMissionStatus
  paymentStatus: 'pending' | 'paid' | 'failed'
  paymentIntentId?: string
  depositTxHash?: string
  depositExplorerUrl?: string
  /** sha256("astroam-escrow:" + mission id), base58. Seeds the escrow PDA. */
  escrowId?: string
  /** Deposit in 6-decimal USDC atomic units. Not the 7-decimal Stellar raw amount. */
  depositAtomic?: string
  /** Traveler wallet that signed the deposit (base58). */
  travelerAddress?: string
  /** Session key the deposit registered in the escrow (base58). It signs vouchers without a wallet popup. */
  sessionKey?: string
  /** true once the backend read this deposit from the escrow account on-chain. */
  depositVerified?: boolean
  /** Deposit, last top-up or last claim, ISO. The escrow's refund timeout runs from here. */
  escrowActiveAt?: string
  voucher?: StoredVoucher
  /** Collected so far by `claim`, in 6-decimal USDC atomic units. */
  claimedAtomic?: string
  claims?: ClaimRecord[]
  /** USD cents funded into the eSIM wallet this trip. Never more than one tranche ahead of the voucher. */
  fundedCents?: number
  /** A fund sent to the provider and not confirmed yet. Settled against what the eSIM holds, never blindly retried. */
  pendingFund?: { amountCents: number; requestedAt: string }
  /** Provider's lifetime charged figure when the trip started, micro-USD. */
  chargedBaselineMicroUsd?: string
  /** Last time metered usage grew, ISO. */
  lastUsageAt?: string
  /** Why the backend closed the trip by itself. */
  autoCloseReason?: 'deposit_spent' | 'trip_ended' | 'timeout_near' | 'idle'
  /** Payment channel opened by the deposit (the in-memory meter, or the escrow PDA). */
  channelId?: string
  iccid?: string
  esim?: PublicEsimInfo
  esimStatus: 'active' | 'paused' | 'disabled' | 'not_provisioned'
  meteredBytes: string // string representation of bigint
  carrierBytes: string // string representation of bigint
  balanceUsdc: number
  consumedUsdc: number
  consumedMb: number
  topups: TopUpRecord[]
  closeTxHash?: string
  closeExplorerUrl?: string
  /** Settled to AstroAm when the channel closed, in USDC. */
  settledUsdc?: number
  /** Returned to the traveler when the channel closed, in USDC. */
  refundedUsdc?: number
  settlement?: 'close' | 'timeout_refund'
  createdAt: string
  updatedAt: string
}

export type Capabilities = {
  backendAvailable: boolean
  /** `<chain>:<name>` of the payment rail, e.g. "monad:testnet". */
  network: string
  /** Human name of the payment rail, e.g. "Monad testnet". */
  paymentRail: string
  /** false while payments are simulated (FakeRail). */
  paymentsLive: boolean
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
  solanaCluster: 'devnet'
  solanaRpcUrl: string
  solanaExplorer: string
  solanaUsdcMint: string
  solanaUsdcDecimals: 6
  solanaTokenProgram: string
  solanaProgramId: string | null
  solanaPayee: string | null
  solanaTimeoutSeconds: number
  /** The deployed program takes a session key at deposit and partial claims. */
  escrowSessionKeys: boolean
  /** The backend has an operator key: it claims and closes with the session vouchers. */
  escrowAutomation: boolean
  /** base58 address of that operator key. Null without automation. */
  escrowOperator: string | null
}
