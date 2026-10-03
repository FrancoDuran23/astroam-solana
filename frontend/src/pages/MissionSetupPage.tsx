import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MobileAppShell from '../components/MobileAppShell'
import WizardProgress from '../components/mission/WizardProgress'
import StepDestination from '../components/mission/StepDestination'
import StepDuration from '../components/mission/StepDuration'
import StepBudget from '../components/mission/StepBudget'
import StepConfirm from '../components/mission/StepConfirm'
import ActivationOverlay from '../components/mission/ActivationOverlay'
import { useMission } from '../hooks/useMission'
import { addDays, today } from '../utils/missionUtils'
import { connectSolanaWallet, depositUsdc, solanaTxUrl, walletError } from '../chain/solana'
import type { PaymentIntentInfo, WizardData, WizardStep } from '../types/mission'

const STEP_LABELS = ['DESTINO', 'DURACIÓN', 'PRESUPUESTO', 'CONFIRMAR']

const DEFAULT_DATA: WizardData = {
  destination: null,
  startDate: today(),
  endDate: addDays(today(), 2),
  budgetUsdc: 10,
  dailyLimitUsdc: 3,
  alertAt20pct: true,
  autoPauseAtLimit: true,
}

export default function MissionSetupPage() {
  const navigate = useNavigate()
  const {
    createMission,
    createPaymentIntent,
    confirmPayment,
    activate,
    backendError,
    retryBackend,
    isDemoMode,
    caps,
  } = useMission()

  const [step, setStep] = useState<WizardStep>(1)
  const [data, setData] = useState<WizardData>(DEFAULT_DATA)
  const [activating, setActivating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // API Payment flow state
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntentInfo | null>(null)
  const [paymentValidating, setPaymentValidating] = useState(false)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [depositTx, setDepositTx] = useState<string | null>(null)

  function update(field: string, value: unknown) {
    setData((prev) => ({ ...prev, [field]: value }))
  }

  function canAdvance(): boolean {
    if (step === 1) return data.destination !== null
    if (step === 2) return data.startDate <= data.endDate
    if (step === 3) {
      const b = data.budgetUsdc
      const d = data.dailyLimitUsdc
      return (
        Number.isFinite(b) &&
        Number.isFinite(d) &&
        !isNaN(b) &&
        !isNaN(d) &&
        b > 0 &&
        d > 0 &&
        d <= b
      )
    }
    return true
  }

  function next() {
    if (step < 4) setStep((prev) => (prev + 1) as WizardStep)
  }

  function back() {
    if (step > 1) setStep((prev) => (prev - 1) as WizardStep)
    else navigate('/')
  }

  async function handleConfirm() {
    setError(null)
    try {
      if (isDemoMode) {
        setActivating(true)
        await createMission(data)
      } else {
        // API Mode
        if (!caps || !caps.backendAvailable) {
          throw new Error('Servidor backend no disponible. Verificá la conexión.')
        }
        const created = await createMission(data)
        const intent = await createPaymentIntent(created)
        setPaymentIntent(intent)
      }
    } catch (e) {
      setActivating(false)
      setError(e instanceof Error ? e.message : 'Error al procesar la misión')
    }
  }

  async function handleConnectWallet() {
    setError(null)
    try {
      setWalletAddress(await connectSolanaWallet())
    } catch (e) {
      setError(walletError(e))
    }
  }

  async function handleDeposit() {
    if (!paymentIntent?.solana) return
    setError(null)
    setPaymentValidating(true)
    try {
      const { signature, traveler } = await depositUsdc(paymentIntent.solana)
      setDepositTx(signature)
      const res = await confirmPayment(paymentIntent.intentId, signature, traveler)
      if (res.valid) {
        setPaymentIntent(null)
        setActivating(true)
        await activate()
      } else {
        setError('El depósito no fue aceptado por el servidor.')
      }
    } catch (e) {
      setError(walletError(e))
    } finally {
      setPaymentValidating(false)
    }
  }

  function handleActivationComplete() {
    navigate('/mission/esim')
  }

  return (
    <MobileAppShell
      title={`NUEVA MISIÓN (${step}/4)`}
      showBack={true}
      showBottomNav={false}
    >
      {/* Activation overlay */}
      {activating && <ActivationOverlay onComplete={handleActivationComplete} />}

      {/* Backend Error Banner when in API Mode */}
      {!isDemoMode && backendError && (
        <div className="mb-6 p-6 bg-white rounded-3xl border border-alerta/30 shadow-md">
          <div className="flex items-center gap-3 text-alerta mb-3">
            <span className="material-symbols-outlined text-2xl">cloud_off</span>
            <h2 className="font-mono text-sm font-bold uppercase tracking-wider">[ BACKEND NO DISPONIBLE ]</h2>
          </div>
          <p className="font-sans text-sm text-textsecondary mb-4 leading-relaxed">
            {backendError}
          </p>
          {caps?.missingConfiguration && caps.missingConfiguration.length > 0 && (
            <div className="mb-4 p-3 bg-bglight rounded-xl border border-cardborder font-mono text-xs text-textsecondary">
              <span className="font-bold text-textprimary">Servicios pendientes en el servidor:</span>
              <ul className="list-disc list-inside mt-1 space-y-0.5">
                {caps.missingConfiguration.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            onClick={() => void retryBackend()}
            className="w-full sm:w-auto px-6 py-3 rounded-full bg-primaryviolet text-white font-sans font-semibold text-xs uppercase tracking-wider hover:bg-primaryviolet-hover transition-all flex items-center justify-center gap-2 min-h-[44px]"
          >
            <span className="material-symbols-outlined text-sm">refresh</span>
            REINTENTAR CONEXIÓN
          </button>
        </div>
      )}

      {/* Section label */}
      <div className="flex flex-col gap-1 mb-6">
        <span className="font-mono text-[11px] font-bold text-primaryviolet tracking-widest uppercase">
          [ NUEVA MISIÓN // CONFIGURACIÓN ]
        </span>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-textprimary">
          {step === 1 && 'Elegí tu destino'}
          {step === 2 && 'Definí la duración'}
          {step === 3 && 'Configurá tu presupuesto'}
          {step === 4 && 'Confirmá la misión'}
        </h1>
      </div>

      {/* Wizard progress */}
      <div className="mb-8">
        <WizardProgress current={step} labels={STEP_LABELS} />
      </div>

      {/* Step content */}
      <div className="bg-white rounded-3xl border border-cardborder shadow-sm p-5 sm:p-8">
        {step === 1 && (
          <StepDestination
            selected={data.destination}
            onSelect={(d) => update('destination', d)}
          />
        )}
        {step === 2 && (
          <StepDuration
            startDate={data.startDate}
            endDate={data.endDate}
            onChange={(s, e) => setData((prev) => ({ ...prev, startDate: s, endDate: e }))}
          />
        )}
        {step === 3 && data.destination && (
          <StepBudget
            destination={data.destination}
            budgetUsdc={data.budgetUsdc}
            dailyLimitUsdc={data.dailyLimitUsdc}
            alertAt20pct={data.alertAt20pct}
            autoPauseAtLimit={data.autoPauseAtLimit}
            onChange={update}
          />
        )}
        {step === 4 && !paymentIntent && (
          <StepConfirm
            data={data}
            onBack={back}
            onConfirm={() => void handleConfirm()}
          />
        )}

        {/* Payment Intent Modal / Section in API mode */}
        {paymentIntent?.solana && (
          <div className="flex flex-col gap-5">
            <div className="border-b border-cardborder pb-4">
              <span className="font-mono text-xs font-bold text-primaryviolet uppercase tracking-wider block mb-1">
                [ SOLANA DEVNET // DEPÓSITO USDC ]
              </span>
              <h3 className="font-display text-xl font-bold text-textprimary">
                Depositá {paymentIntent.solana.amountUsdc} USDC
              </h3>
              <p className="font-sans text-sm text-textsecondary mt-2">
                Un solo depósito. El consumo se mide off-chain y un cierre paga lo usado y devuelve el resto. No hay un débito por cada MB.
              </p>
            </div>
            <div className="grid gap-3 font-mono text-xs">
              <div className="bg-bglight p-3.5 rounded-xl border border-cardborder">
                <span className="text-textsecondary block text-[10px]">RED</span>
                <span className="font-bold text-textprimary">Solana Devnet</span>
              </div>
              <div className="bg-bglight p-3.5 rounded-xl border border-cardborder">
                <span className="text-textsecondary block text-[10px]">USDC (6 DECIMALES)</span>
                <a className="font-bold text-primaryviolet break-all" href={`${paymentIntent.solana.explorer}/address/${paymentIntent.solana.usdcMint}?cluster=devnet`} target="_blank" rel="noreferrer">
                  {paymentIntent.solana.usdcMint}
                </a>
              </div>
              <div className="bg-bglight p-3.5 rounded-xl border border-cardborder">
                <span className="text-textsecondary block text-[10px]">PROGRAMA</span>
                {paymentIntent.solana.programId ? (
                  <a className="font-bold text-primaryviolet break-all" href={`${paymentIntent.solana.explorer}/address/${paymentIntent.solana.programId}?cluster=devnet`} target="_blank" rel="noreferrer">
                    {paymentIntent.solana.programId}
                  </a>
                ) : (
                  <span className="font-bold text-alerta">Sin desplegar. Corré npm run solana:deploy y poné SOLANA_PROGRAM_ID en el servidor.</span>
                )}
              </div>
            </div>
            {walletAddress && (
              <p className="font-mono text-[11px] text-textsecondary">
                Wallet: <span className="text-textprimary font-bold">{walletAddress}</span>
              </p>
            )}
            {depositTx && (
              <a className="font-mono text-[11px] text-primaryviolet font-bold break-all" href={solanaTxUrl(depositTx)} target="_blank" rel="noreferrer">
                Depósito en el explorer: {depositTx}
              </a>
            )}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => void handleConnectWallet()}
                className="flex-1 py-3.5 rounded-xl border border-cardborder bg-white text-textprimary font-mono text-xs font-bold uppercase tracking-wider min-h-[48px]"
              >
                {walletAddress ? 'WALLET CONECTADA' : 'CONECTAR PHANTOM O SOLFLARE'}
              </button>
              <button
                type="button"
                disabled={paymentValidating || !paymentIntent.solana.deployed}
                onClick={() => void handleDeposit()}
                className="flex-1 py-3.5 rounded-xl bg-tealbrand text-white font-mono text-xs font-bold uppercase tracking-wider disabled:opacity-40 min-h-[48px]"
              >
                {paymentValidating ? 'ENVIANDO…' : 'DEPOSITAR USDC'}
              </button>
            </div>
            <p className="font-sans text-xs text-textsecondary">
              En Phantom o Solflare elegí Devnet. Hace falta SOL de prueba para el fee y USDC de Circle en esta red (mint de arriba, 6 decimales).
            </p>
          </div>
        )}

        {paymentIntent && !paymentIntent.solana && (
          <p className="font-mono text-xs text-alerta">La API no devolvió un plan de depósito en Solana.</p>
        )}

        {/* Error */}
        {error && (
          <div className="mt-4 p-3 rounded-xl bg-alerta/10 border border-alerta/20 font-mono text-xs text-alerta">
            {error}
          </div>
        )}
      </div>

      {/* Navigation (steps 1-3) Sticky CTA on Mobile */}
      {step < 4 && (
        <div className="mt-6 sm:mt-8 flex items-center justify-between gap-3 sticky bottom-4 z-20 bg-white/95 backdrop-blur-md p-3 rounded-2xl border border-cardborder shadow-lg">
          <button
            type="button"
            onClick={back}
            className="px-6 py-3.5 rounded-full border border-cardborder bg-white text-textsecondary font-sans font-semibold text-xs uppercase tracking-wider hover:bg-bglight hover:border-primaryviolet/30 transition-all min-h-[48px]"
          >
            ATRÁS
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!canAdvance()}
            className="flex-1 sm:flex-none px-8 py-3.5 rounded-full bg-primaryviolet text-white font-sans font-bold text-xs uppercase tracking-wider shadow-[0_4px_14px_rgba(105,65,255,0.3)] hover:bg-primaryviolet-hover hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-none transition-all flex items-center justify-center gap-2 min-h-[48px]"
          >
            CONTINUAR
            <span className="material-symbols-outlined text-base">arrow_forward</span>
          </button>
        </div>
      )}
    </MobileAppShell>
  )
}
