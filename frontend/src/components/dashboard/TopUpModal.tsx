import { useState } from 'react'
import { useMission } from '../../hooks/useMission'
import WalletDeposit from '../mission/WalletDeposit'
import type { PaymentIntentInfo } from '../../types/mission'

type Props = {
  onClose: () => void
}

export default function TopUpModal({ onClose }: Props) {
  const { mission, isDemoMode, caps, createTopUpIntent, confirmTopUpPayment, actionLoading } = useMission()
  const [amount, setAmount] = useState(5)
  const [intent, setIntent] = useState<PaymentIntentInfo | null>(null)
  const [txHashInput, setTxHashInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const simulated = isDemoMode || !caps?.solanaProgramId

  async function handleStartTopUp() {
    setError(null)
    try {
      if (isDemoMode) {
        await confirmTopUpPayment(`intent_demo_${Date.now()}`, `0x${Date.now().toString(16)}`, amount)
        onClose()
      } else {
        setIntent(await createTopUpIntent(amount))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the top-up')
    }
  }

  async function handleConfirmTopUp() {
    if (!intent) return
    setError(null)
    try {
      const txHash = txHashInput.trim() || `0x${Date.now().toString(16)}`
      await confirmTopUpPayment(intent.intentId, txHash, amount)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not confirm the top-up')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4" role="dialog" aria-modal="true" aria-labelledby="topup-title">
      {/* Backdrop overlay */}
      <div className="absolute inset-0 bg-[#03030B]/70 backdrop-blur-sm transition-opacity" onClick={() => !actionLoading && onClose()} />

      {/* Mobile bottom sheet / desktop card */}
      <div className="relative z-10 w-full max-w-md max-h-[92dvh] md:max-h-[90vh] overflow-y-auto bg-[#0E0F27] rounded-t-3xl rounded-b-none md:rounded-3xl border-t md:border border-cardborder shadow-[0_0_60px_rgba(123,92,255,0.25)] p-6 md:p-7 flex flex-col gap-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <div className="w-12 h-1.5 bg-cardborder rounded-full mx-auto -mt-2 mb-1 md:hidden shrink-0" />

        <div className="flex items-center justify-between">
          <div>
            <h3 id="topup-title" className="font-display text-xl font-bold text-textprimary">Top up balance</h3>
            <p className="text-xs text-textsecondary mt-0.5">Add USDC to the same trip escrow</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 rounded-full bg-warmneutral border border-cardborder flex items-center justify-center hover:border-primaryviolet/50 transition-colors"
          >
            <span className="material-symbols-outlined text-sm text-textsecondary">close</span>
          </button>
        </div>

        {!intent ? (
          <>
            {/* Amount selector */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <label htmlFor="topup-amount" className="font-mono text-[11px] font-bold text-textsecondary tracking-widest uppercase">
                  AMOUNT
                </label>
                <span className="font-display text-2xl font-bold text-[#B9A6FF]">{amount.toFixed(2)} USDC</span>
              </div>
              <input
                id="topup-amount"
                type="range"
                min={1}
                max={50}
                step={0.5}
                value={amount}
                onChange={(e) => setAmount(parseFloat(e.target.value))}
                className="w-full h-11 accent-primaryviolet"
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
                    aria-pressed={amount === v}
                    onClick={() => setAmount(v)}
                    className={`flex-1 py-2 min-h-[44px] rounded-xl font-mono text-xs font-bold tracking-wider border transition-all ${
                      amount === v
                        ? 'bg-primaryviolet text-white border-primaryviolet shadow-[0_0_14px_rgba(123,92,255,0.5)]'
                        : 'bg-warmneutral border-cardborder text-textsecondary hover:border-primaryviolet/50'
                    }`}
                  >
                    {v} USDC
                  </button>
                ))}
              </div>
            </div>

            {/* Badge */}
            <div className="flex items-center gap-2 p-3 rounded-xl bg-primaryviolet-light border border-primaryviolet/30">
              <span className="material-symbols-outlined text-sm text-[#B9A6FF]">hub</span>
              <p className="font-mono text-[10px] font-bold text-[#B9A6FF] tracking-wider">
                {simulated ? 'SIMULATED DEPOSIT' : 'DEPOSIT ON SOLANA DEVNET'}
              </p>
            </div>

            <button
              type="button"
              disabled={actionLoading}
              onClick={() => void handleStartTopUp()}
              className="w-full py-3.5 rounded-full bg-primaryviolet text-white font-sans font-bold text-sm uppercase tracking-wider shadow-[0_0_24px_rgba(123,92,255,0.5)] hover:bg-primaryviolet-hover disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-base">add_circle</span>
              {isDemoMode ? 'CONFIRM TOP-UP (DEMO)' : 'CONTINUE'}
            </button>
          </>
        ) : intent.solana?.deployed && mission ? (
          <WalletDeposit
            missionId={mission.id}
            method="topUp"
            plan={intent.solana}
            label={`Add ${amount.toFixed(2)} USDC with wallet`}
            onDeposited={async (hash) => {
              await confirmTopUpPayment(intent.intentId, hash, amount)
              onClose()
            }}
          />
        ) : (
          <div className="flex flex-col gap-4 font-mono text-xs">
            <div className="p-4 bg-warmneutral rounded-2xl border border-cardborder text-center">
              <span className="text-textsecondary text-[10px] block mb-1">TOP-UP AMOUNT</span>
              <span className="font-display text-xl font-bold text-[#B9A6FF]">
                {intent.amount} {intent.asset}
              </span>
              {intent.qr && <img src={intent.qr} alt="Top-up QR code" className="w-36 h-36 mx-auto my-3 object-contain rounded-lg bg-white p-1" />}
            </div>

            {!simulated && (
              <div>
                <label htmlFor="topup-tx" className="block text-[11px] text-textsecondary mb-1">
                  TRANSACTION HASH
                </label>
                <input
                  id="topup-tx"
                  type="text"
                  value={txHashInput}
                  onChange={(e) => setTxHashInput(e.target.value)}
                  placeholder="transaction signature"
                  className="w-full px-3 py-2 min-h-[44px] rounded-xl border border-[#6B6E9E] bg-warmneutral text-xs text-textprimary focus:outline-none focus:border-primaryviolet"
                />
              </div>
            )}

            <button
              type="button"
              disabled={actionLoading || (!simulated && !txHashInput.trim())}
              onClick={() => void handleConfirmTopUp()}
              className="w-full py-3 rounded-full bg-tealbrand text-[#04161A] font-bold text-xs uppercase tracking-wider shadow-[0_0_18px_rgba(47,208,221,0.45)] hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              <span className={`material-symbols-outlined text-sm ${actionLoading ? 'animate-spin' : ''}`}>{actionLoading ? 'refresh' : 'check_circle'}</span>
              {simulated ? 'SIMULATE DEPOSIT' : 'CONFIRM TOP-UP'}
            </button>
          </div>
        )}

        {error && (
          <div role="alert" className="p-3 rounded-xl bg-alerta/10 border border-alerta/30 font-mono text-xs text-alerta">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
