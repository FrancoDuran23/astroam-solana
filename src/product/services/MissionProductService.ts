import type { ConnectivityProvider } from '../../providers/connectivity/ConnectivityProvider.ts'
import type { MissionRepository } from '../persistence/MissionRepository.ts'
import type { Capabilities, DestinationInfo, ProductMission, PublicEsimInfo } from '../types/mission.ts'
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
}

export class MissionProductService {
  private repo: MissionRepository
  private connectivity: ConnectivityProvider
  private rail: PaymentRail
  private hasCitrusReal: boolean

  // Active sessions & meter services per mission
  private sessions = new Map<string, ConnectivitySession>()
  private meters = new Map<string, IntegratedMeterService>()

  constructor(options: MissionProductServiceOptions) {
    this.repo = options.repo
    this.connectivity = options.connectivity
    this.rail = options.rail
    this.hasCitrusReal = options.hasCitrusReal ?? false
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
    }
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
      throw unavailable('Falta SOLANA_PROGRAM_ID y SOLANA_PAYEE_ADDRESS para depositar USDC en Solana devnet')
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

  async confirmPayment(missionId: string, intentId: string, txHash: string, traveler?: string) {
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
    if (traveler && isSolanaAddress(traveler)) mission.travelerAddress = traveler
    const explorerUrl = solanaTxUrl(txHash) ?? result.explorerUrl
    if (explorerUrl) mission.depositExplorerUrl = explorerUrl
    await this.repo.save(mission)

    return {
      valid: true,
      status: 'paid',
      depositTxHash: result.txHash,
      explorerUrl,
      channelId: result.channelId,
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

    await this.repo.save(mission)
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
      throw unavailable('Falta SOLANA_PROGRAM_ID y SOLANA_PAYEE_ADDRESS para recargar USDC en Solana devnet')
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
      throw unavailable('Falta SOLANA_PROGRAM_ID y SOLANA_PAYEE_ADDRESS para cerrar el depósito en Solana devnet')
    }

    // The cumulative voucher is quoted here. The traveler's wallet signs it
    // and sends the single close. Usage stays off-chain until that transaction.
    return {
      status: 'awaiting_close' as const,
      refundAmountUsdc: Number(solana.refundUsdc),
      solana,
    }
  }

  async confirmClose(missionId: string, txHash: string, settlement: 'close' | 'timeout_refund' = 'close') {
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
      throw new Error('El cierre necesita la firma de la transacción en Solana (base58, 64 bytes)')
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
      mission.settledUsdc = 0
      mission.refundedUsdc = Number(quote.amountUsdc)
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

    const currentBytes = BigInt(mission.meteredBytes || '0') + BigInt(bytes)
    mission.meteredBytes = currentBytes.toString()

    const totalMb = Number(currentBytes) / 1_000_000
    const costUsdc = totalMb * mission.destination.pricePerMbUsdc
    mission.consumedMb = parseFloat(totalMb.toFixed(2))
    mission.consumedUsdc = parseFloat(costUsdc.toFixed(6))
    mission.balanceUsdc = Math.max(0, parseFloat((mission.budgetUsdc - costUsdc).toFixed(6)))

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
}
