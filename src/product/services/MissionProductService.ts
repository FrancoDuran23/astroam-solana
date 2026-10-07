import type { ConnectivityProvider } from '../../providers/connectivity/ConnectivityProvider.ts'
import type { MissionRepository } from '../persistence/MissionRepository.ts'
import type { Capabilities, ClaimRecord, DestinationInfo, ProductMission, PublicEsimInfo } from '../types/mission.ts'
import { IntegratedMeterService } from '../../meter/meter-service.ts'
import type { ChannelBalancePort } from '../../services/PolicyEnforcer.ts'
import { createConnectivitySession, type ConnectivitySession } from '../../models/ConnectivitySession.ts'
import { runReconciliation } from '../../jobs/reconciliation.ts'
import { parseNonNegativeIntegerRaw, pricePerMibFromPerMbRaw } from '../../shared/money.ts'
import type { PaymentRail } from '../../rails/PaymentRail.ts'
import { isSolanaAddress, isSolanaSignature } from '../../shared/solana/base58.ts'
import { solanaTxUrl } from '../../shared/solana/explorer.ts'
import {
  SOLANA_CLUSTER,
  SOLANA_EXPLORER,
  SOLANA_RPC_URL,
  SOLANA_USDC_DECIMALS,
  SOLANA_USDC_MINT,
  SPL_TOKEN_PROGRAM_ID,
} from '../../shared/solana/constants.ts'
import {
  buildClosePlan,
  buildDepositPlan,
  buildTopUpPlan,
  escrowIdBase58,
  type SolanaClosePlan,
  type SolanaDepositPlan,
} from '../../shared/solana/voucher.ts'
import { formatAtomic } from '../../shared/solana/amounts.ts'
import { verifyVoucher, type EscrowState, type SignedVoucher } from '../../shared/solana/escrow.ts'
import { createChannelMutex } from '../../shared/mutex.ts'
import { equivalentBytes } from '../../shared/usage-math.ts'
import type { EscrowChain } from '../../solana/EscrowChain.ts'
import type { MeterSigner } from '../../solana/meter-signer.ts'
import {
  DEFAULT_FUND_FLOW,
  autoCloseReason,
  claimIsDue,
  nextFundCents,
  type AutoCloseReason,
  type FundFlowConfig,
} from './fund-flow.ts'

const MICRO_USD_PER_CENT = 10_000n
/** Provider rounding on a fund, in cents (the same margin FundingService uses). */
const FUND_TOLERANCE_CENTS = 6

/** USDC (number) to raw units (1e-7 USDC). */
function usdcToRaw(usdc: number): bigint {
  return BigInt(Math.round(usdc * 1e7))
}

/** A non-empty raw-unit environment variable, or `undefined`. */
function envRaw(key: string): bigint | undefined {
  const value = process.env[key]
  return value ? parseNonNegativeIntegerRaw(value) : undefined
}

function unavailable(message: string): Error {
  const err = new Error(`503: ${message}`)
  ;(err as unknown as { statusCode: number }).statusCode = 503
  return err
}

export type MissionProductServiceOptions = {
  repo: MissionRepository
  connectivity: ConnectivityProvider
  /** How missions are paid: a real chain, or FakeRail for demos. */
  rail: PaymentRail
  hasCitrusReal?: boolean
  /** With it the backend reads deposits from the escrow and sends claims and closes itself. */
  escrowChain?: EscrowChain
  /** Signs cumulative usage vouchers. The traveler does not. */
  meter?: MeterSigner
  fundFlow?: FundFlowConfig
  /** How long to wait between reads while a deposit reaches the RPC node, ms. */
  depositReadRetryMs?: number
  logger?: (line: Record<string, unknown>) => void
}

/** What one pass of the fund flow did for a trip. */
export type AdvanceResult = {
  missionId: string
  fundedCents: number
  claimTxHash?: string
  closeTxHash?: string
  closeReason?: AutoCloseReason
  /** Set when a step failed; the next pass retries. */
  error?: string
}

export class MissionProductService {
  private repo: MissionRepository
  private connectivity: ConnectivityProvider
  private rail: PaymentRail
  private hasCitrusReal: boolean
  private chain: EscrowChain | undefined
  private meter: MeterSigner | undefined
  private fundFlow: FundFlowConfig
  private depositReadRetryMs: number
  private logger: (line: Record<string, unknown>) => void
  // One writer per trip: a request and the fund-flow job never save over each other.
  private locks = createChannelMutex()

  // Active sessions & meter services per mission
  private sessions = new Map<string, ConnectivitySession>()
  private meters = new Map<string, IntegratedMeterService>()

  constructor(options: MissionProductServiceOptions) {
    this.repo = options.repo
    this.connectivity = options.connectivity
    this.rail = options.rail
    this.hasCitrusReal = options.hasCitrusReal ?? false
    this.chain = options.escrowChain
    this.meter = options.meter
    this.fundFlow = options.fundFlow ?? DEFAULT_FUND_FLOW
    this.depositReadRetryMs = options.depositReadRetryMs ?? 600
    this.logger = options.logger ?? ((line) => process.stdout.write(`${JSON.stringify(line)}\n`))
  }

  private isLiveMode(): boolean {
    return process.env.ASTROAM_LIVE_ENABLED === 'true'
  }

  private async load(missionId: string): Promise<ProductMission> {
    const mission = await this.repo.findById(missionId)
    if (!mission) throw new Error(`Mission ${missionId} not found`)
    return mission
  }

  private getMissingConfiguration(): string[] {
    const missing: string[] = []
    if (!this.rail.isLive) missing.push('PAYMENT_RAIL')
    if (!buildDepositPlan({ missionId: 'capabilities', budgetUsdc: 0 }).deployed) {
      missing.push('SOLANA_PROGRAM_ID', 'SOLANA_PAYEE_ADDRESS')
    }
    if (!process.env.CITRUS_API_KEY) missing.push('CITRUS_API_KEY')
    if (this.isLiveMode()) {
      if (!process.env.ASTROAM_DEMO_ACCESS_TOKEN) missing.push('ASTROAM_DEMO_ACCESS_TOKEN')
      if (!process.env.FRONTEND_ORIGIN || process.env.FRONTEND_ORIGIN === '*') missing.push('FRONTEND_ORIGIN')
    }
    return missing
  }

  async getCapabilities(): Promise<Capabilities> {
    const isLive = this.isLiveMode()
    const railReady = this.rail.isLive
    const citrusReady = this.hasCitrusReal

    let mode: Capabilities['mode'] = 'demo'
    if (isLive) {
      mode = railReady && citrusReady ? 'live' : railReady || citrusReady ? 'partial' : 'demo'
    }

    return {
      backendAvailable: true,
      network: this.rail.network,
      paymentRail: this.rail.displayName,
      paymentsLive: railReady,
      channelReady: railReady,
      citrusReady,
      connectivityProvider: citrusReady ? 'citrus' : 'fake',
      citrusStatus: citrusReady ? 'live' : 'unavailable',
      meteringMode: isLive ? (railReady && citrusReady ? 'real' : 'unavailable') : 'demo',
      reconciliationAvailable: citrusReady,
      demoTrafficEnabled: process.env.ENABLE_DEMO_TRAFFIC === 'true',
      mode,
      liveEnabled: isLive,
      requiresAuth: isLive && Boolean(process.env.ASTROAM_DEMO_ACCESS_TOKEN),
      missingConfiguration: this.getMissingConfiguration(),
      ...this.solanaCapabilities(),
    }
  }

  private solanaCapabilities() {
    const plan = buildDepositPlan({ missionId: 'capabilities', budgetUsdc: 0 })
    return {
      solanaCluster: SOLANA_CLUSTER,
      solanaRpcUrl: plan.rpcUrl || SOLANA_RPC_URL,
      solanaExplorer: SOLANA_EXPLORER,
      solanaUsdcMint: SOLANA_USDC_MINT,
      solanaUsdcDecimals: SOLANA_USDC_DECIMALS,
      solanaTokenProgram: SPL_TOKEN_PROGRAM_ID,
      solanaProgramId: plan.programId,
      solanaPayee: plan.payee,
      solanaTimeoutSeconds: plan.timeoutSeconds,
      solanaMeter: plan.meter,
      escrowSessionKeys: plan.sessionKeys,
      /** The backend holds the meter key, so it can sign usage vouchers. */
      escrowMeter: this.meter !== undefined,
      /** Operator key plus meter key: the backend checkpoints, claims and closes itself. */
      escrowAutomation: this.meter !== undefined && this.chain !== undefined,
      escrowOperator: this.chain?.operator ?? null,
    }
  }

  /**
   * Reads the deposit from the escrow account. The transaction can reach the
   * RPC node a moment after the wallet reports it, so it retries a few times.
   */
  private async readDeposit(escrowId: string, expectedAtomic: bigint): Promise<EscrowState> {
    let state: EscrowState | null = null
    for (let attempt = 0; attempt < 6 && state === null; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, this.depositReadRetryMs))
      state = await this.chain!.readEscrow(escrowId)
    }
    if (state === null) throw new Error('The deposit is not in the escrow yet. Wait for the transaction to confirm and try again.')
    if (state.settled) throw new Error('This escrow was already closed')
    if (state.deposit < expectedAtomic) {
      throw new Error(`The escrow holds ${formatAtomic(state.deposit)} USDC; this trip needs ${formatAtomic(expectedAtomic)}`)
    }
    return state
  }

  private solanaDeposit(missionId: string, budgetUsdc = 0): SolanaDepositPlan {
    return buildDepositPlan({ missionId, budgetUsdc })
  }

  private solanaClose(mission: ProductMission): SolanaClosePlan {
    return buildClosePlan({
      missionId: mission.id,
      budgetUsdc: mission.budgetUsdc,
      meteredBytes: BigInt(mission.meteredBytes || '0'),
      pricePerMbUsdc: mission.destination.pricePerMbUsdc,
      traveler: mission.travelerAddress,
    })
  }

  async createMission(payload: {
    userId?: string
    destination: DestinationInfo
    startDate: string
    endDate: string
    budgetUsdc: number
    dailyLimitUsdc: number
    autoPause?: boolean
    lowBalanceAlert?: boolean
  }): Promise<{ id: string; status: string }> {
    const id = `mis_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const start = new Date(payload.startDate)
    const end = new Date(payload.endDate)
    const diffTime = Math.abs(end.getTime() - start.getTime())
    const durationDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)))

    const mission: ProductMission = {
      id,
      userId: payload.userId || 'usr_demo',
      destination: payload.destination,
      startDate: payload.startDate,
      endDate: payload.endDate,
      durationDays,
      budgetUsdc: payload.budgetUsdc,
      dailyLimitUsdc: payload.dailyLimitUsdc,
      autoPause: payload.autoPause ?? true,
      lowBalanceAlert: payload.lowBalanceAlert ?? true,
      status: 'pending_payment',
      paymentStatus: 'pending',
      esimStatus: 'not_provisioned',
      meteredBytes: '0',
      carrierBytes: '0',
      balanceUsdc: payload.budgetUsdc,
      consumedUsdc: 0,
      consumedMb: 0,
      topups: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await this.repo.save(mission)
    return { id: mission.id, status: mission.status }
  }

  async createPaymentIntent(missionId: string) {
    const mission = await this.load(missionId)
    if (this.isLiveMode() && !this.rail.isLive) {
      throw unavailable('payments are simulated; configure a live payment rail for live mode')
    }

    const solana = this.solanaDeposit(mission.id, mission.budgetUsdc)
    if (this.isLiveMode() && !solana.deployed) {
      throw unavailable('Set SOLANA_PROGRAM_ID and SOLANA_PAYEE_ADDRESS before depositing USDC on Solana devnet')
    }

    const intent = await this.rail.createDepositIntent({
      missionId: mission.id,
      amountUsdc: mission.budgetUsdc,
      purpose: 'mission',
    })

    mission.paymentIntentId = intent.intentId
    mission.escrowId = solana.escrowId
    mission.depositAtomic = solana.amount
    await this.repo.save(mission)

    return {
      intentId: intent.intentId,
      amount: String(intent.amountUsdc),
      asset: intent.asset,
      payTo: solana.programId ?? intent.payTo,
      paymentUri: intent.paymentUri,
      qr: intent.qr,
      network: 'solana:devnet',
      status: 'pending',
      isMock: intent.isMock,
      rail: 'solana' as const,
      solana,
    }
  }

  async confirmPayment(missionId: string, intentId: string, txHash: string, traveler?: string, sessionKey?: string) {
    const mission = await this.load(missionId)

    if (mission.paymentStatus === 'paid' && mission.depositTxHash) {
      return {
        valid: true,
        status: 'paid',
        depositTxHash: mission.depositTxHash,
        explorerUrl: mission.depositExplorerUrl,
        channelId: mission.channelId,
      }
    }

    if (this.isLiveMode() && !this.rail.isLive) {
      throw unavailable('payments are simulated; configure a live payment rail for live mode')
    }

    // With an operator key the deposit is read from the escrow account, not
    // taken from the request. Read first: the rail consumes the intent.
    const plan = this.solanaDeposit(mission.id, mission.budgetUsdc)
    const onChain = this.chain && plan.deployed ? await this.readDeposit(plan.escrowId, BigInt(plan.amount)) : null

    const result = await this.rail.confirmDeposit({ missionId, intentId, txHash, purpose: 'mission' })
    if (!result.valid) {
      mission.paymentStatus = 'failed'
      await this.repo.save(mission)
      throw new Error(`Deposit for intent ${intentId} was not accepted: ${result.reason}`)
    }

    mission.paymentStatus = 'paid'
    mission.status = 'paid'
    mission.depositTxHash = result.txHash
    mission.channelId = result.channelId
    mission.escrowId = mission.escrowId ?? escrowIdBase58(mission.id)
    mission.depositAtomic = mission.depositAtomic ?? this.solanaDeposit(mission.id, mission.budgetUsdc).amount
    if (onChain) {
      mission.travelerAddress = onChain.traveler
      if (onChain.sessionKey) mission.sessionKey = onChain.sessionKey
      mission.depositVerified = true
      mission.escrowActiveAt = new Date(onChain.activeAt * 1000).toISOString()
    } else {
      if (traveler && isSolanaAddress(traveler)) mission.travelerAddress = traveler
      if (plan.sessionKeys && sessionKey && isSolanaAddress(sessionKey)) mission.sessionKey = sessionKey
    }
    const explorerUrl = solanaTxUrl(txHash) ?? result.explorerUrl
    if (explorerUrl) mission.depositExplorerUrl = explorerUrl
    await this.repo.save(mission)

    return {
      valid: true,
      status: 'paid',
      depositTxHash: result.txHash,
      explorerUrl,
      channelId: result.channelId,
      sessionKey: mission.sessionKey,
      depositVerified: mission.depositVerified === true,
    }
  }

  async activateMission(missionId: string) {
    const mission = await this.load(missionId)

    if (mission.paymentStatus !== 'paid' || !mission.channelId) {
      throw new Error('A mission can only be activated after its deposit is confirmed')
    }
    if (this.isLiveMode() && !this.hasCitrusReal) {
      throw unavailable('Citrus Mobile is not configured for live mode (missing CITRUS_API_KEY)')
    }

    // Idempotent
    if (mission.status === 'active' && mission.iccid && mission.esim) {
      return { missionId: mission.id, status: mission.status, isMock: !this.hasCitrusReal, esim: mission.esim }
    }

    const esimRecord = await this.connectivity.provisionEsim(mission.userId)
    const publicEsim: PublicEsimInfo = {
      iccid: esimRecord.iccid,
      lpaString: esimRecord.lpaString,
      qrCode: esimRecord.qrCode,
      directInstallUrl: esimRecord.directInstallUrl,
      status: esimRecord.status,
      isMock: !this.hasCitrusReal,
    }

    mission.iccid = esimRecord.iccid
    mission.esim = publicEsim
    mission.status = 'active'
    mission.esimStatus = 'active'

    this.sessions.set(
      mission.id,
      createConnectivitySession({
        id: `ses_${mission.id}`,
        userId: mission.userId,
        iccid: esimRecord.iccid,
        channelId: mission.channelId,
      }),
    )

    // The provider's charged figure is lifetime: what it shows now is not this trip's.
    try {
      mission.chargedBaselineMicroUsd = (await this.connectivity.getUsage(esimRecord.iccid)).chargedMicroUsd.toString()
    } catch {
      // The first usage reading sets the baseline instead.
    }
    await this.repo.save(mission)

    // First tranche. A failure here does not undo the activation: the fund-flow job retries.
    try {
      await this.locks.withChannelLock(mission.id, async () => this.fundTranche(await this.load(mission.id)))
    } catch (error) {
      this.logger({ level: 'error', msg: 'first tranche not funded', missionId: mission.id, detail: messageOf(error) })
    }
    return { missionId: mission.id, status: 'active', isMock: !this.hasCitrusReal, esim: publicEsim }
  }

  async getMission(missionId: string): Promise<ProductMission> {
    return this.load(missionId)
  }

  async getUsage(missionId: string) {
    const mission = await this.load(missionId)

    let session = this.sessions.get(missionId)
    if (!session && mission.iccid && mission.channelId) {
      session = createConnectivitySession({
        id: `ses_${mission.id}`,
        userId: mission.userId,
        iccid: mission.iccid,
        channelId: mission.channelId,
      })
      this.sessions.set(missionId, session)
    }

    if (!session || !mission.iccid) {
      return {
        chargedMicroUsd: '0',
        walletMicroUsd: '0',
        providerStatus: 'not_provisioned',
        meteredBytes: mission.meteredBytes,
        carrierBytes: '0',
        differenceBytes: mission.meteredBytes,
        isEstimation: true,
        note: 'Estimate based on the USDC rate',
      }
    }

    const recon = await runReconciliation(session, { provider: this.connectivity })
    const usage = await this.connectivity.getUsage(mission.iccid)

    return {
      chargedMicroUsd: recon.chargedMicroUsd.toString(),
      tripChargedMicroUsd: recon.tripChargedMicroUsd.toString(),
      walletMicroUsd: recon.walletMicroUsd.toString(),
      providerStatus: usage.status,
      meteredBytes: mission.meteredBytes,
      carrierBytes: mission.carrierBytes,
      differenceBytes: (BigInt(mission.meteredBytes) - BigInt(mission.carrierBytes)).toString(),
      isEstimation: true,
      note: 'Estimate based on the USDC rate',
    }
  }

  async pauseMission(missionId: string) {
    return this.locks.withChannelLock(missionId, () => this.pauseLocked(missionId))
  }

  private async pauseLocked(missionId: string) {
    const mission = await this.load(missionId)
    if (this.isLiveMode() && !this.hasCitrusReal) {
      throw unavailable('Citrus Mobile is not configured for live mode')
    }

    if (mission.iccid) await this.connectivity.suspend(mission.iccid)

    mission.esimStatus = 'paused'
    mission.status = 'paused'
    if (mission.esim) mission.esim.status = 'suspended'
    await this.repo.save(mission)

    return { status: 'paused', esimStatus: 'paused' }
  }

  async resumeMission(missionId: string) {
    return this.locks.withChannelLock(missionId, () => this.resumeLocked(missionId))
  }

  private async resumeLocked(missionId: string) {
    const mission = await this.load(missionId)
    if (this.isLiveMode() && !this.hasCitrusReal) {
      throw unavailable('Citrus Mobile is not configured for live mode')
    }

    if (mission.iccid) await this.connectivity.resume(mission.iccid)

    mission.esimStatus = 'active'
    mission.status = 'active'
    if (mission.esim) mission.esim.status = 'active'
    await this.repo.save(mission)

    return { status: 'active', esimStatus: 'active' }
  }

  async createTopUpIntent(missionId: string, amountUsdc: number) {
    const mission = await this.load(missionId)
    if (!mission.channelId) throw new Error('This mission has no payment channel yet')
    if (this.isLiveMode() && !this.rail.isLive) {
      throw unavailable('payments are simulated; configure a live payment rail for live mode')
    }

    const solana = buildTopUpPlan({ missionId, amountUsdc })
    if (this.isLiveMode() && !solana.deployed) {
      throw unavailable('Set SOLANA_PROGRAM_ID and SOLANA_PAYEE_ADDRESS before topping up USDC on Solana devnet')
    }

    const intent = await this.rail.createDepositIntent({
      missionId,
      amountUsdc,
      purpose: 'topup',
      channelId: mission.channelId,
    })

    mission.topups.push({
      id: `top_${Date.now()}`,
      intentId: intent.intentId,
      amountUsdc,
      status: 'pending',
      createdAt: new Date().toISOString(),
    })
    await this.repo.save(mission)

    return {
      intentId: intent.intentId,
      amount: String(intent.amountUsdc),
      asset: intent.asset,
      payTo: solana.programId ?? intent.payTo,
      paymentUri: intent.paymentUri,
      qr: intent.qr,
      network: 'solana:devnet',
      status: 'pending',
      isMock: intent.isMock,
      rail: 'solana' as const,
      solana,
    }
  }

  async confirmTopUpPayment(missionId: string, intentId: string, txHash: string) {
    return this.locks.withChannelLock(missionId, () => this.confirmTopUpLocked(missionId, intentId, txHash))
  }

  private async confirmTopUpLocked(missionId: string, intentId: string, txHash: string) {
    const mission = await this.load(missionId)

    const topup = mission.topups.find((t) => t.intentId === intentId)
    if (!topup) throw new Error(`Top-up for intent ${intentId} not found`)
    if (topup.status === 'settled' && topup.txHash) {
      return { valid: true, status: 'settled', txHash: topup.txHash, explorerUrl: topup.explorerUrl }
    }
    if (this.isLiveMode() && !this.rail.isLive) {
      throw unavailable('payments are simulated; configure a live payment rail for live mode')
    }

    const result = await this.rail.confirmDeposit({
      missionId,
      intentId,
      txHash,
      purpose: 'topup',
      channelId: mission.channelId,
    })
    if (!result.valid) throw new Error(`Top-up was not accepted: ${result.reason}`)

    if (mission.iccid) {
      try {
        const amountCents = Math.max(1, Math.round(topup.amountUsdc * 100))
        await this.connectivity.topUp(mission.iccid, amountCents)
      } catch {
        // The eSIM wallet catches up on the next funding pass.
      }
    }

    topup.status = 'settled'
    topup.txHash = result.txHash
    topup.explorerUrl = solanaTxUrl(txHash) ?? result.explorerUrl
    mission.balanceUsdc += topup.amountUsdc
    mission.budgetUsdc += topup.amountUsdc
    mission.depositAtomic = this.solanaDeposit(mission.id, mission.budgetUsdc).amount
    // A top-up restarts the escrow's refund timeout.
    if (mission.escrowActiveAt) mission.escrowActiveAt = new Date().toISOString()
    if (mission.status === 'paused' && mission.balanceUsdc > 0) {
      mission.status = 'active'
      mission.esimStatus = 'active'
    }

    await this.repo.save(mission)
    return {
      valid: true,
      status: 'settled',
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
      balanceUsdc: mission.balanceUsdc,
    }
  }

  async cancelMission(missionId: string) {
    const mission = await this.load(missionId)
    if (mission.status === 'cancelled') {
      return {
        status: 'cancelled' as const,
        txHash: mission.closeTxHash,
        explorerUrl: mission.closeExplorerUrl,
        refundedUsdc: mission.refundedUsdc,
      }
    }
    if (mission.paymentStatus !== 'paid' || !mission.channelId) {
      throw new Error('Only a paid trip can be cancelled and refunded')
    }
    if (mission.status !== 'paid' || mission.iccid || BigInt(mission.meteredBytes || '0') > 0n) {
      throw new Error('This trip already started; finish it instead so what you used is settled')
    }
    if (this.solanaDeposit(mission.id, mission.budgetUsdc).deployed) {
      throw unavailable('The deposit is in the Solana escrow. Refund it from Phantom or Solflare.')
    }

    const outcome = await this.rail.closeChannel(mission.channelId)
    const alreadyClosed = outcome.kind === 'failed' && outcome.detail.includes('already closed')
    if (outcome.kind === 'failed' && !alreadyClosed) {
      throw new Error(`Could not refund the deposit: ${outcome.detail}`)
    }
    if (outcome.kind === 'blocked') {
      throw new Error(`Could not refund the deposit: ${outcome.detail}`)
    }

    mission.status = 'cancelled'
    mission.esimStatus = 'disabled'
    mission.settledUsdc = 0
    mission.refundedUsdc = mission.budgetUsdc
    mission.balanceUsdc = 0
    await this.repo.save(mission)
    return {
      status: 'cancelled' as const,
      refundedUsdc: mission.refundedUsdc,
    }
  }

  async finishMission(missionId: string) {
    const mission = await this.load(missionId)
    if (mission.paymentStatus !== 'paid') {
      throw new Error('This mission has no confirmed deposit to close')
    }

    if (mission.status === 'completed' && mission.closeTxHash) {
      return {
        status: 'completed' as const,
        txHash: mission.closeTxHash,
        explorerUrl: mission.closeExplorerUrl ?? solanaTxUrl(mission.closeTxHash),
        settlement: mission.settlement ?? 'close',
        settledUsdc: mission.settledUsdc,
        refundedUsdc: mission.refundedUsdc,
        solana: this.solanaClose(mission),
      }
    }

    const solana = this.solanaClose(mission)
    if (this.isLiveMode() && !solana.deployed) {
      throw unavailable('Set SOLANA_PROGRAM_ID and SOLANA_PAYEE_ADDRESS before closing the Solana devnet deposit')
    }

    // The meter signs the cumulative voucher, including a zero voucher so an
    // unused deposit can be closed. The wallet may submit the close, but it
    // does not sign the amount.
    if (this.ensureMeterVoucher(mission, true)) await this.repo.save(mission)
    return {
      status: 'awaiting_close' as const,
      refundAmountUsdc: Number(solana.refundUsdc),
      solana,
      meterVoucher: mission.voucher ?? null,
    }
  }

  async confirmClose(missionId: string, txHash: string, settlement: 'close' | 'timeout_refund' = 'close') {
    return this.locks.withChannelLock(missionId, () => this.recordClose(missionId, txHash, settlement))
  }

  /** The traveler's wallet sent the close or the timeout refund; this records it. */
  private async recordClose(missionId: string, txHash: string, settlement: 'close' | 'timeout_refund') {
    const mission = await this.load(missionId)

    if (mission.status === 'completed' && mission.closeTxHash) {
      return {
        txHash: mission.closeTxHash,
        status: 'completed' as const,
        explorerUrl: mission.closeExplorerUrl ?? solanaTxUrl(mission.closeTxHash),
        settlement: mission.settlement ?? settlement,
        settledUsdc: mission.settledUsdc,
        refundedUsdc: mission.refundedUsdc,
      }
    }

    if (!isSolanaSignature(txHash)) {
      throw new Error('The close needs the Solana transaction signature (base58, 64 bytes)')
    }

    if (mission.iccid) {
      try {
        await this.connectivity.refundUnused(mission.iccid)
      } catch {
        // The eSIM wallet is demo-only unless Citrus is configured. The USDC
        // refund already happened in the escrow transaction.
      }
    }

    const quote = this.solanaClose(mission)
    const explorerUrl = solanaTxUrl(txHash)
    mission.status = 'completed'
    mission.esimStatus = 'disabled'
    mission.closeTxHash = txHash
    mission.settlement = settlement
    if (explorerUrl) mission.closeExplorerUrl = explorerUrl
    if (settlement === 'timeout_refund') {
      const attested = BigInt(mission.voucher?.cumulativeAtomic ?? '0')
      const deposit = BigInt(mission.depositAtomic && mission.depositAtomic !== '0' ? mission.depositAtomic : quote.amount)
      const refund = deposit > attested ? deposit - attested : 0n
      mission.settledUsdc = Number(formatAtomic(attested))
      mission.refundedUsdc = Number(formatAtomic(refund))
    } else {
      mission.settledUsdc = Number(quote.usedUsdc)
      mission.refundedUsdc = Number(quote.refundUsdc)
    }
    await this.repo.save(mission)

    return {
      txHash,
      status: 'completed' as const,
      explorerUrl,
      settlement,
      settledUsdc: mission.settledUsdc,
      refundedUsdc: mission.refundedUsdc,
      solana: quote,
    }
  }

  private getOrCreateMeterService(mission: ProductMission, channelId: string): IntegratedMeterService {
    const existing = this.meters.get(mission.id)
    if (existing) return existing

    let session = this.sessions.get(mission.id)
    if (!session) {
      session = createConnectivitySession({
        id: `ses_${mission.id}`,
        userId: mission.userId,
        iccid: mission.iccid || `iccid_${mission.id}`,
        channelId,
      })
      this.sessions.set(mission.id, session)
    }

    // Rate: PRICE_PER_MB_RAW when set; otherwise the destination's own rate,
    // the one the app shows. Vouchers bill the same rate per MiB.
    const pricePerMbRaw = envRaw('PRICE_PER_MB_RAW') ?? usdcToRaw(mission.destination.pricePerMbUsdc)
    const rail = this.rail
    const balancePort: ChannelBalancePort = {
      getChannelBalance: (id) => rail.getChannelDepositRaw(id),
    }

    const meterService = new IntegratedMeterService({
      session,
      provider: this.connectivity,
      balancePort,
      voucherPort: rail.voucherPortFor(channelId),
      network: rail.network,
      pricePerMbRaw,
      voucherPricePerMibRaw: pricePerMibFromPerMbRaw(pricePerMbRaw),
    })

    this.meters.set(mission.id, meterService)
    return meterService
  }

  async processDemoTraffic(missionId: string, bytes: number) {
    return this.locks.withChannelLock(missionId, () => this.meterDemoTraffic(missionId, bytes))
  }

  private async meterDemoTraffic(missionId: string, bytes: number) {
    if (process.env.ENABLE_DEMO_TRAFFIC !== 'true') {
      throw new Error('Demo traffic injection is not enabled on this server')
    }

    const mission = await this.load(missionId)
    if (mission.status !== 'active' || mission.esimStatus !== 'active' || !mission.channelId) {
      throw new Error('Traffic can only be injected into an active mission')
    }
    if (this.isLiveMode() && (!this.rail.isLive || !this.hasCitrusReal)) {
      throw unavailable('live mode needs both a live payment rail and Citrus Mobile to meter traffic')
    }

    const meterService = this.getOrCreateMeterService(mission, mission.channelId)
    const result = await meterService.processTraffic(bytes)

    applyMeteredBytes(mission, BigInt(mission.meteredBytes || '0') + BigInt(bytes))

    if (result.actionApplied.kind === 'suspend' || mission.balanceUsdc <= 0) {
      mission.status = 'paused'
      mission.esimStatus = 'paused'
    }

    await this.repo.save(mission)

    let cumulativeAmount: string | undefined
    let remaining: string | undefined
    let reused: boolean | undefined
    let meterReadingId: string | undefined
    if (result.voucher.kind === 'signed') {
      cumulativeAmount = result.voucher.envelope.voucher.cumulativeAmount
      remaining = result.voucher.envelope.remaining
      reused = result.voucher.envelope.reused
      meterReadingId = result.voucher.envelope.meterReadingId
    } else if (result.voucher.kind === 'unsigned') {
      remaining = result.voucher.envelope.remaining
    }

    return {
      bytes,
      meterStatus: result.meterStatus,
      actionApplied: { ...result.actionApplied, remainingRaw: result.actionApplied.remainingRaw.toString() },
      voucher: result.voucher,
      cumulativeAmount,
      remaining,
      reused,
      meterReadingId,
      meteredBytes: mission.meteredBytes,
      consumedMb: mission.consumedMb,
      consumedUsdc: mission.consumedUsdc,
      balanceUsdc: mission.balanceUsdc,
      status: mission.status,
      demoTraffic: true,
    }
  }

  // ---------------------------------------------------------------------
  // Automatic fund flow: vouchers, tranches, claims and the backend's close.
  // ---------------------------------------------------------------------

  /** What the app has to sign next, and what AstroAm already holds. */
  async voucherRequest(missionId: string) {
    const mission = await this.load(missionId)
    const plan = this.solanaClose(mission)
    return {
      escrowId: plan.escrowId,
      programId: plan.programId,
      depositAtomic: plan.amount,
      /** Metered usage so far, capped by the deposit: the amount to sign. */
      cumulativeAtomic: plan.cumulativeAmount,
      messageBase64: plan.messageBase64,
      signedAtomic: mission.voucher?.cumulativeAtomic ?? '0',
      claimedAtomic: mission.claimedAtomic ?? '0',
      sessionKey: mission.sessionKey ?? null,
      meter: this.meter?.publicKey ?? plan.meter,
      voucher: mission.voucher ?? null,
    }
  }

  /**
   * Signs the metered amount with the meter key when it is higher than the
   * voucher already held. `allowZero` lets a close refund an unused deposit.
   * Returns true when a new voucher was stored.
   */
  private ensureMeterVoucher(mission: ProductMission, allowZero: boolean): boolean {
    if (!this.meter) return false
    const plan = this.solanaClose(mission)
    if (!plan.programId) return false
    const amount = BigInt(plan.cumulativeAmount)
    if (amount === 0n && !allowZero) return false
    const held = mission.voucher ? BigInt(mission.voucher.cumulativeAtomic) : -1n
    if (amount <= held) return false
    return this.acceptVoucher(mission, this.meter.sign(plan.programId, plan.escrowId, amount))
  }

  /** Writes the held voucher onto the escrow when the chain does not have it yet. */
  private async checkpointIfDue(mission: ProductMission): Promise<string | undefined> {
    if (!this.chain || !mission.depositVerified || !mission.escrowId || !mission.voucher) return undefined
    const amount = BigInt(mission.voucher.cumulativeAtomic)
    if (amount === 0n) return undefined
    const state = await this.chain.readEscrow(mission.escrowId)
    if (!state || state.settled || amount <= state.attested) return undefined
    try {
      return await this.chain.checkpoint({ escrowId: mission.escrowId, voucher: mission.voucher })
    } catch (error) {
      const again = await this.chain.readEscrow(mission.escrowId)
      if (again && again.attested >= amount) return undefined
      throw error
    }
  }

  /**
   * Checks a voucher and keeps it when it is the highest so far. It must be
   * signed by the meter key, and it cannot authorize more than the metered
   * usage or the deposit. Throws when it is not acceptable.
   */
  private acceptVoucher(mission: ProductMission, voucher: SignedVoucher): boolean {
    if (mission.paymentStatus !== 'paid' || mission.status === 'completed' || mission.status === 'cancelled') {
      throw new Error('This trip is not open, so it takes no vouchers')
    }
    const plan = this.solanaClose(mission)
    if (!plan.deployed || !plan.programId) throw new Error('The escrow program is not configured')
    if (!this.meter) throw new Error('The meter key is not configured, so it cannot sign a voucher')
    if (voucher.signer !== this.meter.publicKey) {
      throw new Error('The voucher is not signed by the meter key')
    }
    const amount = BigInt(voucher.cumulativeAtomic)
    if (amount > BigInt(plan.amount)) throw new Error('The voucher authorizes more than the deposit')
    if (amount > BigInt(plan.cumulativeAmount)) throw new Error('The voucher authorizes more than the metered usage')
    const held = mission.voucher ? BigInt(mission.voucher.cumulativeAtomic) : -1n
    if (amount < held) throw new Error('A higher voucher was already received')
    if (amount < BigInt(mission.claimedAtomic ?? '0')) throw new Error('The voucher is below what was already collected')
    if (!verifyVoucher(plan.programId, plan.escrowId, voucher)) throw new Error('The voucher signature does not verify')
    if (amount === held) return false
    mission.voucher = { ...voucher, receivedAt: new Date().toISOString() }
    return true
  }

  /**
   * Signs the metered usage with the meter key, records it on the escrow, and
   * funds the next tranche. The traveler does not sign.
   */
  async attestMission(missionId: string) {
    return this.locks.withChannelLock(missionId, async () => {
      const mission = await this.load(missionId)
      const isNew = this.ensureMeterVoucher(mission, false)
      if (isNew) await this.repo.save(mission)
      let checkpointTxHash: string | undefined
      try {
        checkpointTxHash = await this.checkpointIfDue(mission)
      } catch (error) {
        this.logger({ level: 'error', msg: 'checkpoint not recorded', missionId, detail: messageOf(error) })
      }
      let fundedNow = 0
      try {
        fundedNow = await this.fundTranche(mission)
      } catch (error) {
        this.logger({ level: 'error', msg: 'tranche not funded', missionId, detail: messageOf(error) })
      }
      return {
        accepted: mission.voucher != null,
        cumulativeAtomic: mission.voucher?.cumulativeAtomic ?? '0',
        claimedAtomic: mission.claimedAtomic ?? '0',
        fundedCents: mission.fundedCents ?? 0,
        fundedNowCents: fundedNow,
        checkpointTxHash: checkpointTxHash ?? null,
        voucher: mission.voucher ?? null,
      }
    })
  }

  /** The app sends a cumulative voucher after a usage reading. Funds the next tranche when it covers one. */
  async submitVoucher(missionId: string, voucher: SignedVoucher) {
    return this.locks.withChannelLock(missionId, async () => {
      const mission = await this.load(missionId)
      const isNew = this.acceptVoucher(mission, voucher)
      if (isNew) await this.repo.save(mission)
      let fundedNow = 0
      try {
        fundedNow = await this.fundTranche(mission)
      } catch (error) {
        this.logger({ level: 'error', msg: 'tranche not funded', missionId, detail: messageOf(error) })
      }
      return {
        accepted: true,
        cumulativeAtomic: mission.voucher!.cumulativeAtomic,
        claimedAtomic: mission.claimedAtomic ?? '0',
        fundedCents: mission.fundedCents ?? 0,
        fundedNowCents: fundedNow,
      }
    })
  }

  /**
   * Keeps the eSIM wallet at most one tranche ahead of what the vouchers
   * cover. Only for a deposit read from the chain. Returns the cents funded.
   *
   * A fund is never blindly retried: the intent is saved before the call,
   * and an unconfirmed one is settled against what the eSIM holds.
   */
  private async fundTranche(mission: ProductMission): Promise<number> {
    if (!mission.depositVerified || !mission.iccid || mission.status !== 'active') return 0
    const iccid = mission.iccid
    let funded = mission.fundedCents ?? 0

    if (mission.pendingFund) {
      const usage = await this.connectivity.getUsage(iccid)
      const baseline = BigInt(mission.chargedBaselineMicroUsd ?? usage.chargedMicroUsd.toString())
      const spent = usage.chargedMicroUsd > baseline ? usage.chargedMicroUsd - baseline : 0n
      // Everything funded this trip is either still in the wallet or already spent.
      const expected = BigInt(funded + mission.pendingFund.amountCents - FUND_TOLERANCE_CENTS) * MICRO_USD_PER_CENT
      if (usage.walletMicroUsd + spent >= expected) funded += mission.pendingFund.amountCents
      mission.fundedCents = funded
      mission.pendingFund = undefined
      await this.repo.save(mission)
    }

    const amount = nextFundCents(
      {
        depositAtomic: BigInt(mission.depositAtomic ?? '0'),
        voucherAtomic: BigInt(mission.voucher?.cumulativeAtomic ?? '0'),
        fundedCents: funded,
      },
      this.fundFlow,
    )
    if (amount === 0) return 0

    mission.pendingFund = { amountCents: amount, requestedAt: new Date().toISOString() }
    await this.repo.save(mission)
    await this.connectivity.topUp(iccid, amount)
    mission.fundedCents = funded + amount
    mission.pendingFund = undefined
    await this.repo.save(mission)
    this.logger({ level: 'info', msg: 'esim tranche funded', missionId: mission.id, amountCents: amount, fundedCents: mission.fundedCents })
    return amount
  }

  /** Reads the provider's charged figure and turns this trip's part into metered usage. */
  private async readProviderUsage(mission: ProductMission): Promise<void> {
    if (!mission.iccid) return
    const usage = await this.connectivity.getUsage(mission.iccid)
    if (mission.chargedBaselineMicroUsd === undefined) {
      mission.chargedBaselineMicroUsd = usage.chargedMicroUsd.toString()
      await this.repo.save(mission)
      return
    }
    const baseline = BigInt(mission.chargedBaselineMicroUsd)
    const charged = usage.chargedMicroUsd > baseline ? usage.chargedMicroUsd - baseline : 0n
    const pricePerMbRaw = envRaw('PRICE_PER_MB_RAW') ?? usdcToRaw(mission.destination.pricePerMbUsdc)
    const bytes = equivalentBytes(charged, this.fundFlow.markupBps, this.fundFlow.usdcUsdRateBps, pricePerMbRaw)
    // Monotonic: a late or lower reading never takes usage back.
    if (bytes > BigInt(mission.meteredBytes || '0')) {
      applyMeteredBytes(mission, bytes)
      mission.carrierBytes = bytes.toString()
      await this.repo.save(mission)
    }
  }

  /** Sends a `claim` when the voucher holds a tranche not collected yet. */
  private async claimIfDue(mission: ProductMission, now: Date): Promise<ClaimRecord | null> {
    if (!this.chain || !mission.depositVerified || !mission.escrowId || !mission.voucher) return null
    const voucherAtomic = BigInt(mission.voucher.cumulativeAtomic)
    if (!claimIsDue(voucherAtomic, BigInt(mission.claimedAtomic ?? '0'), this.fundFlow)) return null

    let txHash: string
    try {
      txHash = await this.chain.claim({ escrowId: mission.escrowId, voucher: mission.voucher })
    } catch (error) {
      // A claim that landed but was never recorded (a crash in between) fails
      // as "nothing to claim": take what the escrow says before giving up.
      const state = await this.chain.readEscrow(mission.escrowId)
      if (state && state.claimed >= voucherAtomic) {
        mission.claimedAtomic = state.claimed.toString()
        mission.escrowActiveAt = new Date(state.activeAt * 1000).toISOString()
        await this.repo.save(mission)
        return null
      }
      throw error
    }
    const record: ClaimRecord = {
      txHash,
      explorerUrl: solanaTxUrl(txHash) ?? undefined,
      cumulativeAtomic: voucherAtomic.toString(),
      at: now.toISOString(),
    }
    mission.claimedAtomic = voucherAtomic.toString()
    mission.claims = [...(mission.claims ?? []), record]
    // A claim restarts the escrow's refund timeout.
    mission.escrowActiveAt = record.at
    await this.repo.save(mission)
    this.logger({ level: 'info', msg: 'escrow claim', missionId: mission.id, txHash, cumulativeAtomic: record.cumulativeAtomic })
    return record
  }

  /** Closes the escrow with the highest voucher: the rest is paid and the traveler is refunded. */
  private async closeWithVoucher(mission: ProductMission, reason?: AutoCloseReason) {
    if (!this.chain) throw unavailable('No operator key is configured, so the backend cannot close the escrow')
    if (!mission.escrowId || !mission.voucher || !mission.travelerAddress) {
      throw new Error('There is no signed voucher to close this trip with')
    }
    if (mission.iccid) {
      try {
        await this.connectivity.refundUnused(mission.iccid)
      } catch {
        // The eSIM wallet goes back to the reseller balance later; the USDC refund does not wait for it.
      }
    }

    let txHash: string | undefined
    try {
      txHash = await this.chain.close({
        escrowId: mission.escrowId,
        voucher: mission.voucher,
        traveler: mission.travelerAddress,
      })
    } catch (error) {
      // Already closed on-chain (by the traveler, or by a close this process did not get to record).
      const state = await this.chain.readEscrow(mission.escrowId)
      if (!state?.settled) throw error
    }

    const settled = BigInt(mission.voucher.cumulativeAtomic)
    const deposit = BigInt(mission.depositAtomic ?? '0')
    mission.status = 'completed'
    mission.esimStatus = 'disabled'
    mission.settlement = 'close'
    mission.settledUsdc = Number(formatAtomic(settled))
    mission.refundedUsdc = Number(formatAtomic(deposit > settled ? deposit - settled : 0n))
    mission.claimedAtomic = settled.toString()
    if (txHash) {
      mission.closeTxHash = txHash
      mission.closeExplorerUrl = solanaTxUrl(txHash) ?? undefined
    }
    if (reason) mission.autoCloseReason = reason
    await this.repo.save(mission)
    this.logger({ level: 'info', msg: 'escrow close', missionId: mission.id, txHash, reason: reason ?? 'traveler' })
    return {
      txHash,
      status: 'completed' as const,
      explorerUrl: mission.closeExplorerUrl,
      settlement: 'close' as const,
      settledUsdc: mission.settledUsdc,
      refundedUsdc: mission.refundedUsdc,
    }
  }

  /**
   * Ends the trip and the backend sends the close. The meter signs the final
   * voucher from metered usage. A voucher in the request is accepted only when
   * that same meter key signed it. The traveler cannot block this.
   */
  async settleMission(missionId: string, voucher?: SignedVoucher) {
    return this.locks.withChannelLock(missionId, async () => {
      const mission = await this.load(missionId)
      if (mission.status === 'completed') {
        return {
          txHash: mission.closeTxHash,
          status: 'completed' as const,
          explorerUrl: mission.closeExplorerUrl,
          settlement: mission.settlement ?? ('close' as const),
          settledUsdc: mission.settledUsdc,
          refundedUsdc: mission.refundedUsdc,
        }
      }
      if (mission.paymentStatus !== 'paid') throw new Error('This mission has no confirmed deposit to close')
      if (!this.chain) throw unavailable('No operator key is configured, so the backend cannot close the escrow')
      if (!this.meter) throw unavailable('The meter key is not configured, so this trip cannot be settled')
      if (voucher) {
        if (this.acceptVoucher(mission, voucher)) await this.repo.save(mission)
      } else if (this.ensureMeterVoucher(mission, true)) {
        await this.repo.save(mission)
      }
      if (!mission.voucher) throw new Error('The meter key is not configured, so this trip cannot be settled')
      return this.closeWithVoucher(mission)
    })
  }

  /** Trips the fund flow still has work on: paid, open, and with a deposit read from the chain. */
  async openMissionIds(): Promise<string[]> {
    const missions = await this.repo.findAll()
    return missions
      .filter((m) => m.depositVerified && m.paymentStatus === 'paid' && (m.status === 'active' || m.status === 'paused'))
      .map((m) => m.id)
  }

  /**
   * One pass of the fund flow for a trip: read usage, fund the next tranche,
   * collect what the voucher covers, and close when it is time. Never throws:
   * a failed step is reported and the next pass retries.
   */
  async advance(missionId: string, now: Date = new Date()): Promise<AdvanceResult> {
    return this.locks.withChannelLock(missionId, async () => {
      const result: AdvanceResult = { missionId, fundedCents: 0 }
      try {
        const mission = await this.load(missionId)
        if (!mission.depositVerified || mission.paymentStatus !== 'paid') return result
        if (mission.status !== 'active' && mission.status !== 'paused') return result

        await this.readProviderUsage(mission)
        if (this.ensureMeterVoucher(mission, false)) await this.repo.save(mission)
        await this.checkpointIfDue(mission)

        const reason = autoCloseReason(mission, this.fundFlow, now, this.solanaDeposit(mission.id).timeoutSeconds)
        if (reason && mission.voucher) {
          const closed = await this.closeWithVoucher(mission, reason)
          result.closeTxHash = closed.txHash
          result.closeReason = reason
          return result
        }
        if (reason) {
          // Nothing signed: the escrow's own timeout refund is what returns this deposit.
          this.logger({ level: 'warn', msg: 'trip is due to close but has no voucher', missionId, reason })
        }

        result.fundedCents = await this.fundTranche(mission)
        result.claimTxHash = (await this.claimIfDue(mission, now))?.txHash
      } catch (error) {
        result.error = messageOf(error)
        this.logger({ level: 'error', msg: 'fund flow step failed', missionId, detail: result.error })
      }
      return result
    })
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Sets the trip's metered usage and what it costs at the destination's rate. */
function applyMeteredBytes(mission: ProductMission, totalBytes: bigint): void {
  if (totalBytes > BigInt(mission.meteredBytes || '0')) mission.lastUsageAt = new Date().toISOString()
  mission.meteredBytes = totalBytes.toString()
  const totalMb = Number(totalBytes) / 1_000_000
  const costUsdc = totalMb * mission.destination.pricePerMbUsdc
  mission.consumedMb = parseFloat(totalMb.toFixed(2))
  mission.consumedUsdc = parseFloat(costUsdc.toFixed(6))
  mission.balanceUsdc = Math.max(0, parseFloat((mission.budgetUsdc - costUsdc).toFixed(6)))
}
