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
  | 'failed'

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
  /** Payment channel opened by the deposit (format depends on the rail). */
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
}
