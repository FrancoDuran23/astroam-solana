import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MobileAppShell from '../components/MobileAppShell'
import WizardProgress from '../components/mission/WizardProgress'
import StepDestination from '../components/mission/StepDestination'
import StepDuration from '../components/mission/StepDuration'
import StepBudget from '../components/mission/StepBudget'
import StepConfirm from '../components/mission/StepConfirm'
import ActivationOverlay from '../components/mission/ActivationOverlay'
import WalletDeposit from '../components/mission/WalletDeposit'
import { useMission } from '../hooks/useMission'
import { addDays, shortTx, today } from '../utils/missionUtils'
import type { CancelResult, PaymentIntentInfo, WizardData, WizardStep } from '../types/mission'

const STEP_LABELS = ['DESTINATION', 'DATES', 'BUDGET', 'CONFIRM']

const DEFAULT_DATA: WizardData = {
  destination: null,
  startDate: today(),
  endDate: addDays(today(), 2),
  budgetUsdc: 5,
  dailyLimitUsdc: 5,
  alertAt20pct: true,
  autoPauseAtLimit: true,
}

const CARD = 'bg-cardbg glass rounded-3xl border border-cardborder shadow-[0_0_40px_rgba(123,92,255,0.12)] p-5 sm:p-8'

export default function MissionSetupPage() {
  const navigate = useNavigate()
  const { mission, createMission, createPaymentIntent, confirmPayment, activate, cancel, backendError, retryBackend, isDemoMode, caps } = useMission()

  const [step, setStep] = useState<WizardStep>(1)
  const [data, setData] = useState<WizardData>(DEFAULT_DATA)
  const [activating, setActivating] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // API payment flow state
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntentInfo | null>(null)
  const [txHashInput, setTxHashInput] = useState('')
  const [paymentValidating, setPaymentValidating] = useState(false)

  // A trip whose deposit went through but was never activated (the page was closed
  // or the eSIM failed): its USDC sits in the escrow until the trip is activated or cancelled.
  const [cancelResult, setCancelResult] = useState<CancelResult | null>(null)
  const [recovering, setRecovering] = useState(false)
  const stalledTrip =
    !isDemoMode && !paymentIntent && !activating && !preparing && mission?.status === 'paid' && !mission.iccid ? mission : null

  const simulated = isDemoMode || !caps?.solanaProgramId
  const networkLabel = simulated ? 'Simulated payments' : 'Solana Devnet'

  function update(field: string, value: unknown) {
    setData((prev) => ({ ...prev, [field]: value }))
  }

  function canAdvance(): boolean {
    if (step === 1) return data.destination !== null
    if (step === 2) return data.startDate <= data.endDate
    if (step === 3) {
      const { budgetUsdc: b, dailyLimitUsdc: d } = data
      return Number.isFinite(b) && Number.isFinite(d) && b > 0 && d > 0 && d <= b
    }
    return true
  }

  function next() {
    if (step < 4) setStep((prev) => (prev + 1) as WizardStep)
  }

  function back() {
    if (paymentIntent) setPaymentIntent(null)
    else if (step > 1) setStep((prev) => (prev - 1) as WizardStep)
    else navigate('/')
  }

  async function handleConfirm() {
    setError(null)
    setPreparing(true)
    try {
      if (isDemoMode) {
        setActivating(true)
        await createMission(data)
      } else {
        if (!caps || !caps.backendAvailable) throw new Error('The AstroAm server is not reachable. Check the connection and try again.')
        const created = await createMission(data)
        setPaymentIntent(await createPaymentIntent(created))
      }
    } catch (e) {
      setActivating(false)
      setError(e instanceof Error ? e.message : 'Could not create the mission')
    } finally {
      setPreparing(false)
    }
  }

  async function handleConfirmPaymentSubmit() {
    if (!paymentIntent) return
    setError(null)
    setPaymentValidating(true)
    try {
      const txHash = txHashInput.trim() || `0x${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`
      const res = await confirmPayment(paymentIntent.intentId, txHash)
      if (!res.valid) throw new Error('The deposit was not accepted.')
      setPaymentIntent(null)
      setActivating(true)
      await activate()
    } catch (e) {
      setActivating(false)
      setError(e instanceof Error ? e.message : 'Could not confirm the deposit')
    } finally {
      setPaymentValidating(false)
    }
  }

  // The wallet already sent the deposit; errors surface in the panel.
  async function handleWalletDeposit(txHash: string) {
    if (!paymentIntent) return
    const res = await confirmPayment(paymentIntent.intentId, txHash)
    if (!res.valid) throw new Error('The deposit was not accepted.')
    setPaymentIntent(null)
    setActivating(true)
    try {
      await activate()
    } catch (e) {
      setActivating(false)
      setError(e instanceof Error ? e.message : 'Could not activate the eSIM')
    }
  }

  async function handleCancelStalled() {
    setError(null)
    setRecovering(true)
    try {
      setCancelResult(await cancel())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not refund the deposit')
    } finally {
      setRecovering(false)
    }
  }

  async function handleActivateStalled() {
    setError(null)
    setRecovering(true)
    try {
      setActivating(true)
      await activate()
    } catch (e) {
      setActivating(false)
      setError(e instanceof Error ? e.message : 'Could not activate the eSIM')
    } finally {
      setRecovering(false)
    }
  }

  const title = paymentIntent
    ? 'Load your fuel'
    : step === 1
      ? 'Pick your destination'
      : step === 2
        ? 'Set the dates'
        : step === 3
          ? 'Set your budget'
          : 'Confirm the mission'

  return (
    <MobileAppShell title={`NEW MISSION (${step}/4)`} showBack showBottomNav={false}>
      {activating && <ActivationOverlay simulated={simulated} onComplete={() => navigate('/mission/esim')} />}

      {/* Server error banner */}
      {!isDemoMode && backendError && (
        <div role="alert" className="mb-6 p-6 bg-cardbg glass rounded-3xl border border-alerta/40">
          <div className="flex items-center gap-3 text-alerta mb-3">
            <span className="material-symbols-outlined text-2xl">cloud_off</span>
            <h2 className="font-mono text-sm font-bold uppercase tracking-wider">[ SERVER UNAVAILABLE ]</h2>
          </div>
          <p className="font-sans text-sm text-textsecondary mb-4 leading-relaxed">{backendError}</p>
          <button
            type="button"
            onClick={() => void retryBackend()}
            className="w-full sm:w-auto px-6 py-3 rounded-full bg-primaryviolet text-white font-sans font-semibold text-xs uppercase tracking-wider hover:bg-primaryviolet-hover transition-all flex items-center justify-center gap-2 min-h-[44px]"
          >
            <span className="material-symbols-outlined text-sm">refresh</span>
            RETRY
          </button>
        </div>
      )}

      {/* Paid but never activated */}
      {stalledTrip && (
        <div role="alert" className="mb-6 p-6 bg-cardbg glass rounded-3xl border border-starlight/40">
          <span className="font-mono text-[11px] font-bold text-starlight tracking-widest uppercase block mb-2">[ UNFINISHED TRIP ]</span>
          <p className="font-sans text-sm text-textsecondary mb-4 leading-relaxed">
            Your {stalledTrip.destination.name} deposit of {stalledTrip.budgetUsdc} USDC went through but the eSIM was never activated.
            Activate it now, or cancel and get the whole deposit back.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              disabled={recovering}
              onClick={() => void handleActivateStalled()}
              className="px-6 py-3 rounded-full bg-primaryviolet text-white font-sans font-semibold text-xs uppercase tracking-wider hover:bg-primaryviolet-hover disabled:opacity-50 transition-all min-h-[44px]"
            >
              ACTIVATE eSIM
            </button>
            <button
              type="button"
              disabled={recovering}
              onClick={() => void handleCancelStalled()}
              className="px-6 py-3 rounded-full border border-starlight/50 text-starlight font-sans font-semibold text-xs uppercase tracking-wider hover:bg-starlight/10 disabled:opacity-50 transition-all min-h-[44px]"
            >
              {recovering ? 'REFUNDING…' : 'CANCEL AND REFUND'}
            </button>
          </div>
        </div>
      )}
      {cancelResult && (
        <div role="status" className="mb-6 p-6 bg-cardbg glass rounded-3xl border border-tealbrand/40">
          <span className="font-mono text-[11px] font-bold text-tealbrand tracking-widest uppercase block mb-2">[ DEPOSIT REFUNDED ]</span>
          <p className="font-sans text-sm text-textsecondary leading-relaxed">
            {cancelResult.refundedUsdc?.toFixed(3)} USDC went back to your wallet. In Phantom or Solflare look under Tokens → USDC.
            {cancelResult.explorerUrl && (
              <>
                {' '}
                <a href={cancelResult.explorerUrl} target="_blank" rel="noreferrer" className="text-[#B9A6FF] underline">
                  See the transaction
                </a>
              </>
            )}
          </p>
        </div>
      )}

      {/* Section label */}
      <div className="flex flex-col gap-1 mb-6">
        <span className="font-mono text-[11px] font-bold text-[#B9A6FF] tracking-widest uppercase">[ NEW MISSION // SETUP ]</span>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-textprimary text-glow">{title}</h1>
      </div>

      {/* Wizard progress */}
      <div className="mb-8">
        <WizardProgress current={step} labels={STEP_LABELS} />
      </div>

      {/* Step content */}
      <div className={CARD}>
        {!paymentIntent && step === 1 && <StepDestination selected={data.destination} onSelect={(d) => update('destination', d)} />}
        {!paymentIntent && step === 2 && (
          <StepDuration
            startDate={data.startDate}
            endDate={data.endDate}
            onChange={(s, e) => setData((prev) => ({ ...prev, startDate: s, endDate: e }))}
          />
        )}
        {!paymentIntent && step === 3 && data.destination && (
          <StepBudget
            destination={data.destination}
            budgetUsdc={data.budgetUsdc}
            dailyLimitUsdc={data.dailyLimitUsdc}
            alertAt20pct={data.alertAt20pct}
            autoPauseAtLimit={data.autoPauseAtLimit}
            onChange={update}
          />
        )}
        {!paymentIntent && step === 4 && (
          <StepConfirm data={data} networkLabel={networkLabel} busy={preparing} onBack={back} onConfirm={() => void handleConfirm()} />
        )}

        {/* Deposit */}
        {paymentIntent && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-cardborder pb-4">
              <div>
                <span className="font-mono text-xs font-bold text-[#B9A6FF] uppercase tracking-wider block mb-1">
                  [ {networkLabel.toUpperCase()} // MISSION DEPOSIT ]
                </span>
                <h3 className="font-display text-xl font-bold text-textprimary">
                  Deposit {paymentIntent.amount} {paymentIntent.asset}
                </h3>
                <p className="text-xs text-textsecondary mt-1">
                  It goes into your trip&apos;s escrow, not to us. Unused USDC comes back when you end the trip.
                </p>
              </div>
              {simulated && (
                <span className="self-start sm:self-auto px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-starlight/10 text-starlight border border-starlight/30">
                  SIMULATED
                </span>
              )}
            </div>

            {paymentIntent.solana?.deployed ? (
              <WalletDeposit
                missionId={mission?.id ?? ''}
                plan={paymentIntent.solana}
                onDeposited={handleWalletDeposit}
                label={`Pay ${paymentIntent.amount} USDC with wallet`}
              />
            ) : (
              <>
                <div className="flex flex-col items-center gap-6">
                  {paymentIntent.qr && (
                    <div className="flex flex-col items-center justify-center p-4 bg-white rounded-2xl w-full max-w-[260px] shadow-[0_0_30px_rgba(123,92,255,0.3)]">
                      <img src={paymentIntent.qr} alt="Deposit QR code" className="w-52 h-52 object-contain rounded-lg" />
                    </div>
                  )}
                  {paymentIntent.payTo && (
                    <div className="w-full bg-warmneutral p-3.5 rounded-xl border border-cardborder font-mono text-xs">
                      <span className="text-textsecondary block text-[10px]">PAYMENT CHANNEL ADDRESS</span>
                      <span className="font-bold text-textprimary text-[10px] break-all">{paymentIntent.payTo}</span>
                    </div>
                  )}
                </div>

                <div className="border-t border-cardborder pt-4">
                  {!simulated && (
                    <>
                      <label htmlFor="tx-hash" className="block font-mono text-xs text-textsecondary mb-1">
                        TRANSACTION HASH
                      </label>
                      <input
                        id="tx-hash"
                        type="text"
                        value={txHashInput}
                        onChange={(e) => setTxHashInput(e.target.value)}
                        placeholder="transaction signature"
                        className="w-full mb-3 px-4 py-3 rounded-xl border border-[#6B6E9E] bg-warmneutral font-mono text-xs text-textprimary focus:outline-none focus:border-primaryviolet"
                      />
                    </>
                  )}
                  <button
                    type="button"
                    disabled={paymentValidating || (!simulated && !txHashInput.trim())}
                    onClick={() => void handleConfirmPaymentSubmit()}
                    className="w-full px-6 py-3.5 rounded-full bg-tealbrand text-[#04161A] font-sans text-sm font-bold uppercase tracking-wider shadow-[0_0_22px_rgba(47,208,221,0.5)] hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2 min-h-[48px]"
                  >
                    <span className={`material-symbols-outlined text-base ${paymentValidating ? 'animate-spin' : ''}`}>
                      {paymentValidating ? 'refresh' : 'check_circle'}
                    </span>
                    {simulated ? 'SIMULATE DEPOSIT' : 'CONFIRM DEPOSIT'}
                  </button>
                </div>
              </>
            )}

            <p className="text-center font-mono text-[11px] text-textsecondary">Intent {shortTx(paymentIntent.intentId)}</p>
          </div>
        )}

        {error && (
          <div role="alert" className="mt-4 p-3 rounded-xl bg-alerta/10 border border-alerta/30 font-mono text-xs text-alerta">
            {error}
          </div>
        )}
      </div>

      {/* Navigation (steps 1-3), sticky on mobile */}
      {!paymentIntent && step < 4 && (
        <div className="mt-6 sm:mt-8 flex items-center justify-between gap-3 sticky bottom-4 z-20 bg-bglight/85 backdrop-blur-md p-3 rounded-2xl border border-cardborder shadow-[0_0_30px_rgba(123,92,255,0.15)]">
          <button
            type="button"
            onClick={back}
            className="px-6 py-3.5 rounded-full border border-cardborder bg-warmneutral text-textsecondary font-sans font-semibold text-xs uppercase tracking-wider hover:text-white hover:border-primaryviolet/50 transition-all min-h-[48px]"
          >
            BACK
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!canAdvance()}
            className="flex-1 sm:flex-none px-8 py-3.5 rounded-full bg-primaryviolet text-white font-sans font-bold text-xs uppercase tracking-wider shadow-[0_0_20px_rgba(123,92,255,0.5)] hover:bg-primaryviolet-hover hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-none transition-all flex items-center justify-center gap-2 min-h-[48px]"
          >
            CONTINUE
            <span className="material-symbols-outlined text-base">arrow_forward</span>
          </button>
        </div>
      )}
    </MobileAppShell>
  )
}
