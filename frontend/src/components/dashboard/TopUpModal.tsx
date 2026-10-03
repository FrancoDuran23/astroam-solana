import { useState } from 'react'
import { useMission } from '../../hooks/useMission'
import { topUpUsdc, walletError } from '../../chain/solana'
import type { PaymentIntentInfo } from '../../types/mission'

type Props = {
  onClose: () => void
}

export default function TopUpModal({ onClose }: Props) {
  const { isDemoMode, createTopUpIntent, confirmTopUpPayment, actionLoading } = useMission()
  const [amount, setAmount] = useState(5)
  const [intent, setIntent] = useState<PaymentIntentInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleStartTopUp() {
    setError(null)
    try {
      if (isDemoMode) {
        await confirmTopUpPayment(`intent_demo_${Date.now()}`, `tx_${Date.now()}`, amount)
        onClose()
      } else {
        const topIntent = await createTopUpIntent(amount)
        setIntent(topIntent)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al solicitar recarga')
    }
  }

  async function handleSolanaTopUp() {
    if (!intent?.solana) return
    setError(null)
    try {
      const { signature } = await topUpUsdc(intent.solana)
      await confirmTopUpPayment(intent.intentId, signature, amount)
      onClose()
    } catch (e) {
      setError(walletError(e))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      {/* Backdrop overlay */}
      <div
        className="absolute inset-0 bg-textprimary/40 backdrop-blur-sm transition-opacity"
        onClick={() => !actionLoading && onClose()}
      />

      {/* Real mobile bottom-sheet / Desktop centered modal card */}
      <div className="relative z-10 w-full max-w-md max-h-[92dvh] md:max-h-[90vh] overflow-y-auto bg-white rounded-t-3xl rounded-b-none md:rounded-3xl border-t md:border border-cardborder shadow-[0_-12px_40px_rgba(15,23,42,0.2)] md:shadow-[0_20px_60px_rgba(25,24,29,0.12)] p-6 md:p-7 flex flex-col gap-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {/* Mobile drag handle indicator */}
        <div className="w-12 h-1.5 bg-cardborder rounded-full mx-auto -mt-2 mb-1 md:hidden shrink-0" />

        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-xl font-bold text-textprimary">Recargar saldo</h3>
            <p className="text-xs text-textsecondary mt-0.5">Agregá USDC al escrow de la misión en Solana devnet</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-bglight border border-cardborder flex items-center justify-center hover:bg-cardborder transition-colors"
          >
            <span className="material-symbols-outlined text-sm text-textsecondary">close</span>
          </button>
        </div>

        {!intent ? (
          <>
            {/* Amount selector */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <label className="font-mono text-[11px] font-bold text-textsecondary tracking-widest uppercase">
                  IMPORTE
                </label>
                <span className="font-display text-2xl font-bold text-primaryviolet">
                  {amount.toFixed(2)} USDC
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={50}
                step={0.5}
                value={amount}
                onChange={(e) => setAmount(parseFloat(e.target.value))}
                className="w-full accent-primaryviolet"
              />
              <div className="flex justify-between font-mono text-[10px] text-textsecondary">
                <span>1 USDC</span>
                <span>50 USDC</span>
              </div>

              {/* Quick amounts */}
              <div className="flex gap-2 pt-1">
                {[5, 10, 20].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAmount(v)}
                    className={`flex-1 py-2 rounded-xl font-mono text-xs font-bold tracking-wider border transition-all ${
                      amount === v
                        ? 'bg-primaryviolet text-white border-primaryviolet'
                        : 'bg-bglight border-cardborder text-textsecondary hover:border-primaryviolet/40'
                    }`}
                  >
                    {v} USDC
                  </button>
                ))}
              </div>
            </div>

            {/* Badge */}
            <div className="flex items-center gap-2 p-3 rounded-xl bg-primaryviolet-light border border-primaryviolet/20">
              <span className="material-symbols-outlined text-sm text-primaryviolet">hub</span>
              <p className="font-mono text-[10px] font-bold text-primaryviolet tracking-wider">
                {isDemoMode ? 'RECARGA DEMO — SIN RED' : 'RECARGA EN EL ESCROW DE SOLANA'}
              </p>
            </div>

            {/* Confirm */}
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => void handleStartTopUp()}
              className="w-full py-3.5 rounded-full bg-primaryviolet text-white font-sans font-bold text-sm uppercase tracking-wider shadow-[0_4px_16px_rgba(105,65,255,0.35)] hover:bg-primaryviolet-hover disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-base">add_circle</span>
              {isDemoMode ? 'CONFIRMAR RECARGA (DEMO)' : 'GENERAR INTENCIÓN DE PAGO'}
            </button>
          </>
        ) : (
          /* Payment Intent Step in API Mode */
          <div className="flex flex-col gap-4 font-mono text-xs">
            <div className="p-4 bg-bglight rounded-2xl border border-cardborder text-center">
              <span className="text-textsecondary text-[10px] block mb-1">RECARGÁ</span>
              <span className="font-display text-xl font-bold text-primaryviolet">{intent.solana?.amountUsdc ?? intent.amount} USDC</span>
              <p className="text-textsecondary mt-2">
                {intent.solana?.deployed ? 'Phantom firma un top-up del mismo escrow.' : 'Sin desplegar. Corré npm run solana:deploy.'}
              </p>
            </div>
            <button
              type="button"
              disabled={actionLoading || !intent.solana?.deployed}
              onClick={() => void handleSolanaTopUp()}
              className="w-full py-3 rounded-full bg-tealbrand text-white font-bold text-xs uppercase tracking-wider hover:opacity-90 disabled:opacity-40 transition-all"
            >
              {actionLoading ? 'ENVIANDO…' : 'RECARGAR CON PHANTOM'}
            </button>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-alerta/10 border border-alerta/20 font-mono text-xs text-alerta">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
