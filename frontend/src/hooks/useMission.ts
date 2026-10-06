import { useCallback, useEffect, useState } from 'react'
import { envConfig } from '../config/env'
import { demoMissionService } from '../services/DemoMissionService'
import { apiMissionService } from '../services/ApiMissionService'
import { DEMO_TRAFFIC_MB } from '../utils/missionUtils'
import type {
  BackendCapabilities,
  CancelResult,
  FinishResult,
  Mission,
  PaymentConfirmationResult,
  PaymentIntentInfo,
  SignedVoucher,
  UsageEvent,
  WizardData,
} from '../types/mission'

/** Bytes of a meter-signed voucher the wallet can attach to a close. */
async function meterSignature(voucher: SignedVoucher | null | undefined): Promise<{ signature: Uint8Array; signer: string }> {
  if (!voucher?.signature || !voucher.signer) {
    throw new Error("This close needs a voucher signed by AstroAm's meter key.")
  }
  const { Buffer } = await import('buffer')
  const signature = Uint8Array.from(Buffer.from(voucher.signature, 'base64'))
  if (signature.length !== 64) throw new Error("This close needs a voucher signed by AstroAm's meter key.")
  return { signature, signer: voucher.signer }
}

export function useMission() {
  const [mission, setMission] = useState<Mission | null>(null)
  const [events, setEvents] = useState<UsageEvent[]>([])
  const [caps, setCaps] = useState<BackendCapabilities | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [backendError, setBackendError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<boolean>(false)
  /** Highest amount this trip's vouchers authorize, 6-decimal USDC atomic units. */
  const [signedAtomic, setSignedAtomic] = useState<string | null>(null)
  const isDemoMode = envConfig.mode === 'demo'

  // After a usage reading the backend's meter key attests the new total and
  // checkpoints it. This browser does not sign the amount.
  const pushVoucher = useCallback(async (missionId: string): Promise<void> => {
    if (!caps?.escrowMeter) return
    try {
      const attested = await apiMissionService.attest(missionId)
      setSignedAtomic(attested.cumulativeAtomic)
    } catch {
      // The next reading attests the new total; a missed checkpoint is not fatal.
    }
  }, [caps?.escrowMeter])

  const loadBackendState = useCallback(async () => {
    setLoading(true)
    setBackendError(null)

    if (isDemoMode) {
      const state = demoMissionService.loadState()
      setMission(state.mission)
      setEvents(state.events)
      setLoading(false)
      return
    }

    // API Mode
    try {
      const capabilities = await apiMissionService.fetchCapabilities()
      setCaps(capabilities)

      if (!capabilities || !capabilities.backendAvailable) {
        setBackendError('The AstroAm server is not responding.')
        setLoading(false)
        return
      }

      const savedId = apiMissionService.getSavedMissionId()
      if (savedId) {
        try {
          const freshMission = await apiMissionService.getMission(savedId)
          setMission(freshMission)
          try {
            const usage = await apiMissionService.getUsage(savedId)
            if (usage) {
              setMission((prev) =>
                prev
                  ? {
                      ...prev,
                      carrierBytes: usage.carrierBytes,
                      meteredBytes: usage.meteredBytes,
                    }
                  : null,
              )
            }
          } catch {
            // Usage poll fail non-fatal
          }
        } catch {
          // Saved mission not found on server
          apiMissionService.clearSavedMissionId()
          setMission(null)
        }
      }
    } catch (err) {
      setBackendError(err instanceof Error ? err.message : 'Could not reach the API')
    } finally {
      setLoading(false)
    }
  }, [isDemoMode])

  useEffect(() => {
    void loadBackendState()
  }, [loadBackendState])

  // Polling in API Mode when mission is active
  useEffect(() => {
    if (isDemoMode || !mission || !mission.id) return

    const interval = setInterval(async () => {
      try {
        const fresh = await apiMissionService.getMission(mission.id)
        const usage = await apiMissionService.getUsage(mission.id)
        const meteredBytes = Number(usage.meteredBytes) || 0
        setMission({
          ...fresh,
          consumedMb: meteredBytes > 0 ? Math.round((meteredBytes / (1024 * 1024)) * 100) / 100 : fresh.consumedMb,
        })
        if (fresh.status === 'active' || fresh.status === 'paused') void pushVoucher(mission.id)
      } catch {
        // Polling error non-fatal
      }
    }, 8000)

    return () => clearInterval(interval)
  }, [isDemoMode, mission?.id, pushVoucher])

  const createMission = async (data: WizardData): Promise<Mission> => {
    setActionLoading(true)
    try {
      if (isDemoMode) {
        const newMission = await demoMissionService.createMission(data)
        setMission(newMission)
        setEvents([])
        return newMission
      } else {
        const newMission = await apiMissionService.createMission(data)
        setMission(newMission)
        return newMission
      }
    } finally {
      setActionLoading(false)
    }
  }

  // `target`: la misión recién creada. El estado `mission` de este render
  // todavía no la tiene cuando se llama justo después de createMission.
  const createPaymentIntent = async (target?: Mission): Promise<PaymentIntentInfo> => {
    const current = target ?? mission
    if (!current) throw new Error('No active mission')
    if (isDemoMode) {
      return {
        intentId: `intent_demo_${Date.now()}`,
        amount: current.budgetUsdc.toString(),
        asset: 'USDC',
        status: 'pending',
        isMock: true,
      }
    }
    return apiMissionService.createPaymentIntent(current.id)
  }

  const confirmPayment = async (intentId: string, txHash: string): Promise<PaymentConfirmationResult> => {
    if (!mission) throw new Error('No active mission')
    setActionLoading(true)
    try {
      if (isDemoMode) {
        const updated: Mission = { ...mission, paymentStatus: 'paid', status: 'paid', depositTxHash: txHash }
        setMission(updated)
        demoMissionService.saveState({ mission: updated, events })
        return { valid: true, status: 'paid', depositTxHash: txHash }
      }
      const [{ rememberedPayer }, { sessionPublicKey }] = await Promise.all([import('../chain/solana'), import('../chain/session')])
      const res = await apiMissionService.confirmPayment(
        mission.id,
        intentId,
        txHash,
        rememberedPayer(mission.id),
        sessionPublicKey(mission.id),
      )
      if (res.valid) {
        const fresh = await apiMissionService.getMission(mission.id)
        setMission(fresh)
      }
      return res
    } finally {
      setActionLoading(false)
    }
  }

  const activate = async (): Promise<void> => {
    if (!mission) throw new Error('No active mission')
    setActionLoading(true)
    try {
      if (isDemoMode) {
        const updated: Mission = { ...mission, status: 'active', esimStatus: 'active' }
        setMission(updated)
        demoMissionService.saveState({ mission: updated, events })
        return
      }
      const res = await apiMissionService.activateMission(mission.id)
      const fresh = await apiMissionService.getMission(mission.id)
      setMission({
        ...fresh,
        esim: res.esim || fresh.esim,
        isMock: res.isMock ?? fresh.isMock,
      })
    } finally {
      setActionLoading(false)
    }
  }

  const createTopUpIntent = async (amountUsdc: number): Promise<PaymentIntentInfo> => {
    if (!mission) throw new Error('No active mission')
    if (isDemoMode) {
      return {
        intentId: `top_intent_${Date.now()}`,
        amount: amountUsdc.toString(),
        asset: 'USDC',
        status: 'pending',
        isMock: true,
      }
    }
    return apiMissionService.createTopUpIntent(mission.id, amountUsdc)
  }

  const confirmTopUpPayment = async (intentId: string, txHash: string, amountUsdc: number): Promise<void> => {
    if (!mission) throw new Error('No active mission')
    setActionLoading(true)
    try {
      if (isDemoMode) {
        const newState = demoMissionService.topUp({ mission, events }, amountUsdc)
        setMission(newState.mission)
        setEvents(newState.events)
        return
      }
      await apiMissionService.confirmTopUpPayment(mission.id, intentId, txHash)
      const fresh = await apiMissionService.getMission(mission.id)
      setMission(fresh)
    } finally {
      setActionLoading(false)
    }
  }

  const togglePause = async (): Promise<void> => {
    if (!mission) return
    setActionLoading(true)
    try {
      if (isDemoMode) {
        const newState = demoMissionService.togglePause({ mission, events })
        setMission(newState.mission)
        setEvents(newState.events)
        return
      }
      const isPaused = mission.esimStatus === 'paused'
      if (isPaused) {
        await apiMissionService.resumeMission(mission.id)
      } else {
        await apiMissionService.pauseMission(mission.id)
      }
      const fresh = await apiMissionService.getMission(mission.id)
      setMission(fresh)
    } finally {
      setActionLoading(false)
    }
  }

  // The wallet's on-chain USDC, so the traveler sees the refund land. Never blocks the close.
  const walletUsdc = async (missionId: string) => {
    try {
      const { readTravelerUsdc } = await import('../chain/solana')
      return await readTravelerUsdc(missionId)
    } catch {
      return null
    }
  }

  // The RPC can lag a block behind the close: read again once if the refund is not there yet.
  const walletUsdcAfter = async (missionId: string, beforeUsdc: number, refundedUsdc: number) => {
    const first = await walletUsdc(missionId)
    if (!first || refundedUsdc <= 0 || first.usdc > beforeUsdc) return first
    await new Promise((resolve) => setTimeout(resolve, 1500))
    return (await walletUsdc(missionId)) ?? first
  }

  const finish = async (): Promise<FinishResult> => {
    if (!mission) throw new Error('No active mission')
    setActionLoading(true)
    try {
      if (isDemoMode) {
        const newState = demoMissionService.completeMission({ mission, events })
        setMission(newState.mission)
        setEvents(newState.events)
        return {
          status: 'completed',
          txHash: `demo_close_${Date.now().toString(16)}`,
          settledUsdc: mission.consumedUsdc,
          refundedUsdc: mission.balanceUsdc,
        }
      }
      const quoted = await apiMissionService.finishMission(mission.id)
      const used = Number(quoted.solana?.usedUsdc ?? quoted.settledUsdc ?? mission.consumedUsdc ?? 0)
      const refunded = Number(quoted.solana?.refundUsdc ?? quoted.refundedUsdc ?? mission.balanceUsdc ?? 0)
      if (quoted.status === 'awaiting_close' && quoted.solana?.deployed && quoted.solana.messageBase64) {
        const before = await walletUsdc(mission.id)
        let confirmed: FinishResult | null = null
        if (caps?.escrowAutomation) {
          // AstroAm sends the close with its meter voucher: nothing to approve in the wallet.
          try {
            confirmed = await apiMissionService.settle(mission.id)
          } catch {
            // The backend could not send it: the wallet submits the same close below.
          }
        }
        if (!confirmed) {
          const { closeEscrow } = await import('../chain/solana')
          const txHash = await closeEscrow(quoted.solana, await meterSignature(quoted.meterVoucher))
          confirmed = await apiMissionService.confirmClose(mission.id, txHash, 'close')
        }
        const fresh = await apiMissionService.getMission(mission.id)
        setMission(fresh)
        const after = before ? await walletUsdcAfter(mission.id, before.usdc, refunded) : null
        return {
          ...confirmed,
          status: 'completed',
          settledUsdc: used,
          refundedUsdc: refunded,
          wallet: before && after ? { address: before.address, beforeUsdc: before.usdc, afterUsdc: after.usdc } : undefined,
        }
      }
      const fresh = await apiMissionService.getMission(mission.id)
      setMission(fresh)
      return { ...quoted, settledUsdc: used, refundedUsdc: refunded }
    } finally {
      setActionLoading(false)
    }
  }

  /** Gives the unused deposit back for a trip that was paid but never activated. */
  const cancel = async (): Promise<CancelResult> => {
    if (!mission) throw new Error('No active mission')
    setActionLoading(true)
    try {
      if (caps?.solanaProgramId && mission.escrowId) {
        const quoted = await apiMissionService.finishMission(mission.id)
        if (!quoted.solana?.deployed || !quoted.solana.messageBase64) {
          throw new Error('The escrow is not deployed, so the wallet cannot refund it yet.')
        }
        let confirmed: FinishResult
        if (caps.escrowAutomation) {
          confirmed = await apiMissionService.settle(mission.id)
        } else {
          const { closeEscrow } = await import('../chain/solana')
          const txHash = await closeEscrow(quoted.solana, await meterSignature(quoted.meterVoucher))
          confirmed = await apiMissionService.confirmClose(mission.id, txHash, 'close')
        }
        apiMissionService.clearSavedMissionId()
        setMission(null)
        return {
          status: 'cancelled',
          txHash: confirmed.txHash,
          explorerUrl: confirmed.explorerUrl,
          refundedUsdc: Number(quoted.solana.refundUsdc),
        }
      }
      const res = await apiMissionService.cancelMission(mission.id)
      apiMissionService.clearSavedMissionId()
      setMission(null)
      return res
    } finally {
      setActionLoading(false)
    }
  }

  const refundDeposit = async (): Promise<FinishResult> => {
    if (!mission) throw new Error('No active mission')
    if (!mission.escrowId || !caps?.solanaProgramId || !caps.solanaRpcUrl || !caps.solanaUsdcMint || !caps.solanaPayee) {
      throw new Error('The escrow is not deployed. Run npm run solana:deploy and set SOLANA_PROGRAM_ID.')
    }
    setActionLoading(true)
    try {
      const { refundEscrow } = await import('../chain/solana')
      const before = await walletUsdc(mission.id)
      const txHash = await refundEscrow({
        rpcUrl: caps.solanaRpcUrl,
        programId: caps.solanaProgramId,
        usdcMint: caps.solanaUsdcMint,
        escrowId: mission.escrowId,
        payee: caps.solanaPayee,
      })
      const confirmed = await apiMissionService.confirmClose(mission.id, txHash, 'timeout_refund')
      const fresh = await apiMissionService.getMission(mission.id)
      setMission(fresh)
      const settled = confirmed.settledUsdc ?? 0
      const refunded = confirmed.refundedUsdc ?? 0
      const after = before ? await walletUsdcAfter(mission.id, before.usdc, refunded) : null
      return {
        ...confirmed,
        status: 'completed',
        settledUsdc: settled,
        refundedUsdc: refunded,
        wallet: before && after ? { address: before.address, beforeUsdc: before.usdc, afterUsdc: after.usdc } : undefined,
      }
    } finally {
      setActionLoading(false)
    }
  }

  // The backend holds the meter key, so usage is attested without this browser signing.
  const meterAttests = Boolean(caps?.escrowMeter)
  const authorizedAtomic = signedAtomic ?? mission?.voucher?.cumulativeAtomic ?? null
  const authorizedUsdc = authorizedAtomic === null ? null : Number(authorizedAtomic) / 1e6

  const simulate = async (): Promise<void> => {
    if (!mission) return
    if (isDemoMode) {
      const newState = demoMissionService.simulateConsumption({ mission, events })
      setMission(newState.mission)
      setEvents(newState.events)
    } else {
      const res = (await apiMissionService.triggerDemoTraffic(mission.id, DEMO_TRAFFIC_MB * 1_000_000)) as {
        voucher?: { kind: string; envelope?: { voucher?: { signature?: string } } }
        consumedUsdc?: number
      }
      const fresh = await apiMissionService.getMission(mission.id)
      const signed = res.voucher?.kind === 'signed'
      const event: UsageEvent = {
        id: `${Date.now()}`,
        timestamp: new Date().toISOString(),
        kind: 'usage',
        mb: DEMO_TRAFFIC_MB,
        amountUsdc: Math.max(0, (fresh.consumedUsdc ?? 0) - (mission.consumedUsdc ?? 0)),
        status: signed ? 'signed' : 'rejected',
        txId: res.voucher?.envelope?.voucher?.signature ?? '',
      }
      setEvents((prev) => [event, ...prev])
      setMission(fresh)
      await pushVoucher(mission.id)
    }
  }

  const reset = (): void => {
    if (isDemoMode) {
      demoMissionService.resetDemo()
    } else {
      apiMissionService.clearSavedMissionId()
    }
    setMission(null)
    setEvents([])
  }

  return {
    mission,
    events,
    caps,
    loading,
    actionLoading,
    backendError,
    isDemoMode,
    meterAttests,
    authorizedUsdc,
    refundDeposit,
    retryBackend: loadBackendState,
    createMission,
    createPaymentIntent,
    confirmPayment,
    activate,
    createTopUpIntent,
    confirmTopUpPayment,
    togglePause,
    finish,
    cancel,
    simulate,
    reset,
  }
}
