import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import shipSrc from '../assets/ship-night.png'
import MobileAppShell from '../components/MobileAppShell'
import ActivityFeed from '../components/dashboard/ActivityFeed'
import TopUpModal from '../components/dashboard/TopUpModal'
import { useMission } from '../hooks/useMission'
import { DEMO_TRAFFIC_MB, estimateMb, fmtDate, fmtMb, fmtUsdc, shortTx } from '../utils/missionUtils'
import type { FinishResult } from '../types/mission'

const CARD = 'bg-cardbg glass border border-cardborder'

export default function ActiveMissionPage() {
  const navigate = useNavigate()
  const {
    mission,
    events,
    caps,
    loading,
    actionLoading,
    isDemoMode,
    travelerSigns,
    authorizedUsdc,
    retryBackend,
    simulate,
    togglePause,
    finish,
    refundDeposit,
    reset,
  } = useMission()

  const [showTopUp, setShowTopUp] = useState(false)
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false)
  const [finishResult, setFinishResult] = useState<FinishResult | null>(null)
  const [flash, setFlash] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showTechDetails, setShowTechDetails] = useState(false)

  // Redirect if there is no mission (once it has finished loading from the backend)
  useEffect(() => {
    if (!loading && !mission && !isDemoMode) navigate('/mission/new', { replace: true })
  }, [loading, mission, isDemoMode, navigate])

  if (!mission) return null

  const isPaused = mission.esimStatus === 'paused' || mission.status === 'paused'
  const isClosing = mission.status === 'closing' || mission.status === 'refund_pending'
  const isCompleted = mission.status === 'completed'
  const pctRemaining = mission.budgetUsdc > 0 ? (mission.balanceUsdc / mission.budgetUsdc) * 100 : 0
  const mbLeft = estimateMb(mission.balanceUsdc, mission.destination.pricePerMbUsdc)
  const simulated = isDemoMode || !caps?.solanaProgramId
  const networkLabel = simulated ? 'Simulated' : 'Solana Devnet'

  async function handleSimulate() {
    setError(null)
    setFlash(true)
    setTimeout(() => setFlash(false), 400)
    try {
      await simulate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not use data')
    }
  }

  async function handleCompleteSubmit() {
    setError(null)
    try {
      setFinishResult(await finish())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not end the mission')
    }
  }

  async function handleTimeoutRefund() {
    setError(null)
    setFinishResult(null)
    setShowCompleteConfirm(true)
    try {
      setFinishResult(await refundDeposit())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The timeout refund was rejected')
    }
  }

  function handleReset() {
    reset()
    navigate('/', { replace: true })
  }

  const statusColor = isCompleted ? 'text-textsecondary' : isClosing ? 'text-amber-300' : isPaused ? 'text-starlight' : 'text-online'
  const statusDot = isCompleted
    ? 'bg-textsecondary/40'
    : isClosing
      ? 'bg-amber-400 animate-pulse'
      : isPaused
        ? 'bg-starlight animate-pulse shadow-[0_0_10px_#FDDA24]'
        : 'bg-online animate-pulse shadow-[0_0_10px_#3DDC97]'
  const statusLabel = isCompleted
    ? 'MISSION COMPLETE'
    : isClosing
      ? 'SETTLING AND REFUNDING'
      : isPaused
        ? mission.balanceUsdc <= 0
          ? 'OUT OF BALANCE'
          : 'DATA PAUSED'
        : 'LINK ACTIVE'

  const providerLabel = isDemoMode || mission.isMock !== false ? 'Citrus Mobile (simulated)' : 'Citrus Mobile'
  const iccidDisplay = mission.iccid || mission.esim?.iccid || '—'

  function scrollToActivity() {
    document.getElementById('activity-feed')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <MobileAppShell title="ACTIVE MISSION" onActivityClick={scrollToActivity} showBottomNav={!showCompleteConfirm}>
      {/* Top-up modal */}
      {showTopUp && (
        <TopUpModal
          onClose={() => {
            setShowTopUp(false)
            void retryBackend()
          }}
        />
      )}

      {/* Finish modal */}
      {showCompleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="finish-title">
          <div className="absolute inset-0 bg-[#03030B]/70 backdrop-blur-sm" onClick={() => !actionLoading && setShowCompleteConfirm(false)} />
          <div className="relative z-10 w-full max-w-md max-h-[85vh] sm:max-h-[90vh] overflow-y-auto bg-[#0E0F27] rounded-t-3xl sm:rounded-3xl border border-cardborder shadow-[0_0_60px_rgba(123,92,255,0.25)] p-6 sm:p-7 flex flex-col gap-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <div className="w-12 h-1.5 bg-cardborder rounded-full mx-auto -mt-2 mb-1 sm:hidden" />
            {!finishResult ? (
              <>
                <h3 id="finish-title" className="font-display text-xl font-bold text-textprimary">End the mission?</h3>
                <p className="text-sm text-textsecondary leading-relaxed">
                  Your eSIM is turned off, the final usage is settled in one transaction and the rest of your deposit goes back to your
                  wallet.{simulated && ' (Simulated.)'}
                </p>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => setShowCompleteConfirm(false)}
                    className="flex-1 py-3 rounded-full border border-cardborder bg-warmneutral text-textsecondary font-sans font-semibold text-xs uppercase tracking-wider hover:text-white transition-all min-h-[44px]"
                  >
                    CANCEL
                  </button>
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => void handleCompleteSubmit()}
                    className="flex-1 py-3 rounded-full bg-[#C8323F] text-white font-sans font-bold text-xs uppercase tracking-wider shadow-[0_0_20px_rgba(255,107,122,0.45)] hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5 min-h-[44px]"
                  >
                    {actionLoading && <span className="material-symbols-outlined text-sm animate-spin">refresh</span>}
                    END MISSION
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-4 font-mono text-xs">
                <div className="flex items-center gap-2 text-tealbrand">
                  <span className="material-symbols-outlined text-2xl">task_alt</span>
                  <h4 id="finish-title" className="font-bold text-sm uppercase">
                    {finishResult.status === 'completed' ? 'MISSION SETTLED' : 'REFUND QUOTE'}
                  </h4>
                </div>
                <div className="bg-warmneutral p-4 rounded-2xl border border-cardborder flex flex-col gap-2">
                  <div className="flex justify-between">
                    <span className="text-textsecondary">PAID FOR DATA</span>
                    <span className="font-bold text-textprimary">{fmtUsdc(finishResult.settledUsdc ?? mission.consumedUsdc, 3)} USDC</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-textsecondary">BACK TO YOUR WALLET</span>
                    <span className="font-bold text-tealbrand">{fmtUsdc(finishResult.refundedUsdc ?? mission.balanceUsdc, 3)} USDC</span>
                  </div>
                  {finishResult.wallet && (
                    <>
                      <div className="flex justify-between border-t border-cardborder pt-2">
                        <span className="text-textsecondary">WALLET USDC BEFORE</span>
                        <span className="font-bold text-textprimary">{fmtUsdc(finishResult.wallet.beforeUsdc, 3)} USDC</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-textsecondary">WALLET USDC NOW</span>
                        <span className="font-bold text-tealbrand">{fmtUsdc(finishResult.wallet.afterUsdc, 3)} USDC</span>
                      </div>
                    </>
                  )}
                  {finishResult.txHash && (
                    <div className="flex justify-between gap-3">
                      <span className="text-textsecondary">CLOSE TX</span>
                      {finishResult.explorerUrl ? (
                        <a href={finishResult.explorerUrl} target="_blank" rel="noreferrer" className="font-bold text-[#B9A6FF] hover:underline">
                          {shortTx(finishResult.txHash)} ↗
                        </a>
                      ) : (
                        <span className="font-bold text-[#B9A6FF]">{shortTx(finishResult.txHash)}</span>
                      )}
                    </div>
                  )}
                </div>
                <p className="font-sans text-xs text-textsecondary">
                  {finishResult.status === 'completed'
                    ? finishResult.wallet
                      ? `Done. The unused part of your deposit went to ${finishResult.wallet.address.slice(0, 4)}…${finishResult.wallet.address.slice(-4)}. In Phantom or Solflare look under Tokens → USDC.`
                      : 'Done. The unused part of your deposit was released to your wallet.'
                    : 'This is the quote for one close. The escrow program is not deployed, so nothing was sent. Run npm run solana:deploy, then end the mission from Phantom or Solflare.'}
                </p>
                <button
                  type="button"
                  onClick={() => setShowCompleteConfirm(false)}
                  className="w-full py-3.5 rounded-full bg-primaryviolet text-white font-bold text-xs uppercase tracking-wider hover:bg-primaryviolet-hover transition-all min-h-[44px]"
                >
                  CLOSE
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
      )}

      {/* 1. Status */}
      <div className={`flex flex-wrap items-center justify-between gap-4 mb-6 p-4 sm:p-5 rounded-2xl ${CARD}`}>
        <div className="flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full ${statusDot}`} />
          <div>
            <span className={`font-mono text-xs font-bold tracking-wider uppercase ${statusColor}`}>{statusLabel}</span>
            <p className="font-mono text-xs text-textsecondary mt-0.5">
              {mission.destination.flag} {mission.destination.name} · {mission.destination.coverage}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 font-mono text-xs text-textsecondary">
          <span>
            {fmtDate(mission.startDate)} → {fmtDate(mission.endDate)}
          </span>
          <span className="hidden sm:inline uppercase">{networkLabel}</span>
        </div>
      </div>

      {/* 2. Balance */}
      <div className={`p-6 rounded-3xl mb-6 flex flex-col gap-4 shadow-[0_0_50px_rgba(123,92,255,0.15)] ${CARD}`}>
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs font-bold text-textsecondary tracking-widest uppercase">BALANCE</span>
          <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-primaryviolet-light text-[#B9A6FF] border border-primaryviolet/30">
            {pctRemaining.toFixed(0)}% LEFT
          </span>
        </div>

        <div className="flex items-baseline gap-2">
          <span className="font-display text-4xl sm:text-5xl font-bold text-textprimary tracking-tight text-glow">{fmtUsdc(mission.balanceUsdc, 2)}</span>
          <span className="font-mono text-lg font-bold text-[#B9A6FF]">USDC</span>
        </div>

        <div className="h-3 bg-cardborder rounded-full overflow-hidden my-1">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primaryviolet via-tealbrand to-starlight shadow-[0_0_14px_rgba(47,208,221,0.6)] transition-all duration-500"
            style={{ width: `${pctRemaining}%` }}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-cardborder/60 font-mono text-xs">
          <div>
            <span className="text-textsecondary text-[10px] block uppercase">SPENT</span>
            <span className="font-bold text-textprimary">{fmtUsdc(mission.consumedUsdc, 2)} USDC</span>
          </div>
          <div className="text-right">
            <span className="text-textsecondary text-[10px] block uppercase">TOTAL DEPOSIT</span>
            <span className="font-bold text-textprimary">{fmtUsdc(mission.budgetUsdc, 2)} USDC</span>
          </div>
        </div>

        {travelerSigns && !isCompleted && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-online/30 bg-online/10 p-3">
            <span className="flex items-center gap-2 text-xs text-textsecondary">
              <span className="material-symbols-outlined text-base text-online">verified_user</span>
              Authorized by this app
            </span>
            <span className="font-mono text-sm font-bold text-online">{fmtUsdc(authorizedUsdc ?? 0, 2)} USDC</span>
          </div>
        )}
      </div>

      {/* 3. Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <MetricCard label="DATA USED" value={fmtMb(mission.consumedMb)} icon="wifi_tethering" iconColor="text-[#B9A6FF]" />
        <MetricCard label="DATA LEFT" value={`≈ ${fmtMb(mbLeft)}`} icon="signal_cellular_alt" iconColor="text-tealbrand" />
        <MetricCard label="DAILY LIMIT" value={`${fmtUsdc(mission.dailyLimitUsdc, 2)} USDC`} icon="timelapse" iconColor="text-starlight" />
        <MetricCard label="CARRIER" value={isDemoMode || mission.isMock !== false ? 'Citrus (sim)' : 'Citrus Mobile'} icon="sim_card" iconColor="text-online" />
      </div>

      {/* 4. Quick actions */}
      {!isCompleted && !isClosing && (
        <div className="grid grid-cols-2 gap-3 mb-2">
          <button
            type="button"
            disabled={actionLoading}
            onClick={() => setShowTopUp(true)}
            className="py-3.5 px-4 rounded-2xl bg-primaryviolet text-white font-sans font-bold text-xs uppercase tracking-wider shadow-[0_0_22px_rgba(123,92,255,0.5)] hover:bg-primaryviolet-hover transition-all flex items-center justify-center gap-2 min-h-[48px]"
          >
            <span className="material-symbols-outlined text-base">add_circle</span>
            TOP UP
          </button>

          <button
            type="button"
            disabled={actionLoading}
            onClick={() => void togglePause()}
            className={`py-3.5 px-4 rounded-2xl font-sans font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 min-h-[48px] border-2 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed ${
              isPaused
                ? 'border-online bg-online/15 text-online hover:bg-online/25'
                : 'border-amber-400/70 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20'
            }`}
          >
            <span className={`material-symbols-outlined text-base ${actionLoading ? 'animate-spin' : ''}`}>
              {actionLoading ? 'refresh' : isPaused ? 'play_circle' : 'pause_circle'}
            </span>
            {isPaused ? 'RESUME' : 'PAUSE DATA'}
          </button>

          <button
            type="button"
            onClick={() => navigate('/mission/esim')}
            className="py-3.5 px-4 rounded-2xl border border-cardborder bg-cardbg text-textprimary font-sans font-bold text-xs uppercase tracking-wider hover:border-primaryviolet/50 transition-all flex items-center justify-center gap-2 min-h-[48px]"
          >
            <span className="material-symbols-outlined text-base">qr_code_2</span>
            VIEW eSIM
          </button>

          <button
            type="button"
            disabled={isPaused || actionLoading}
            onClick={() => void handleSimulate()}
            className="py-3.5 px-4 rounded-2xl border border-tealbrand/40 bg-tealbrand/10 text-tealbrand font-sans font-bold text-xs uppercase tracking-wider hover:bg-tealbrand/20 hover:shadow-[0_0_18px_rgba(47,208,221,0.35)] disabled:opacity-40 transition-all flex items-center justify-center gap-2 min-h-[48px]"
          >
            <span className="material-symbols-outlined text-base">bolt</span>
            USE {DEMO_TRAFFIC_MB} MB
          </button>
        </div>
      )}
      {!isCompleted && !isClosing && (
        <p className="mb-6 text-center font-mono text-[11px] text-textsecondary">
          “Use {DEMO_TRAFFIC_MB} MB” simulates a reading from the carrier.
          {travelerSigns && ' The app signs a voucher for it first, with no wallet popup.'}
        </p>
      )}

      {error && !showCompleteConfirm && (
        <div role="alert" className="mb-6 p-3 rounded-xl bg-alerta/10 border border-alerta/30 font-mono text-xs text-alerta">
          {error}
        </div>
      )}

      {/* 5. Copilot */}
      <div className="p-5 rounded-2xl bg-primaryviolet-light border border-primaryviolet/30 flex flex-col gap-3 mb-6">
        <div className="flex items-center gap-2 text-[#B9A6FF] font-mono text-xs font-bold tracking-wider uppercase">
          <span className="material-symbols-outlined text-base">smart_toy</span>
          AI COPILOT
        </div>
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 shrink-0 animate-float-ship ${flash ? 'scale-125' : ''} transition-transform`}>
            <img src={shipSrc} alt="" className="w-full h-full object-contain drop-shadow-[0_0_12px_rgba(123,92,255,0.7)]" />
          </div>
          <p className="text-xs text-textprimary italic leading-relaxed">
            {isCompleted
              ? '"Mission complete. The USDC you didn’t use was released to your wallet."'
              : isClosing
                ? '"Closing in progress. Settling the final usage."'
                : isPaused
                  ? mission.balanceUsdc <= 0
                    ? '"Your balance is used up, so data is paused. Top up to keep browsing."'
                    : '"Data is paused. Resume whenever you’re ready."'
                  : pctRemaining < 20
                    ? `"Heads up! Less than 20% left — about ${fmtMb(mbLeft)}. Consider topping up."`
                    : `"You’re on budget. About ${fmtMb(mbLeft)} of data left in ${mission.destination.name}."`}
          </p>
        </div>
      </div>

      {/* 6. Activity */}
      <div id="activity-feed" className={`scroll-mt-24 rounded-2xl p-5 sm:p-6 flex flex-col gap-4 mb-6 ${CARD}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-textprimary uppercase tracking-widest">ACTIVITY</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primaryviolet-light border border-primaryviolet/30 font-mono text-[9px] font-bold text-[#B9A6FF]">
              {events.length} OPS
            </span>
          </div>
          <span className="font-mono text-[10px] text-textsecondary">{networkLabel}</span>
        </div>
        <ActivityFeed events={events} networkLabel={networkLabel} />
      </div>

      {/* 7. Technical details */}
      <div className={`rounded-2xl p-5 mb-6 ${CARD}`}>
        <button
          type="button"
          onClick={() => setShowTechDetails(!showTechDetails)}
          aria-expanded={showTechDetails}
          className="w-full min-h-[44px] flex items-center justify-between font-mono text-xs font-bold text-textsecondary uppercase tracking-widest hover:text-white transition-colors"
        >
          <span>TECHNICAL DETAILS</span>
          <span className="material-symbols-outlined text-base">{showTechDetails ? 'expand_less' : 'expand_more'}</span>
        </button>

        {showTechDetails && (
          <div className="mt-4 pt-4 border-t border-cardborder grid grid-cols-2 sm:grid-cols-3 gap-3 font-mono text-[10px]">
            <TechRow label="PAYMENTS" value={caps?.solanaProgramId ? 'Solana Devnet' : 'Simulated'} />
            <TechRow label="NETWORK" value="solana:devnet" />
            <TechRow label="ESCROW" value={mission.escrowId || caps?.solanaProgramId || 'NOT DEPLOYED'} />
            <TechRow label="USDC" value="6 decimals" />
            {mission.depositTxHash && <TechRow label="DEPOSIT TX" value={mission.depositTxHash} href={mission.depositExplorerUrl} />}
            {travelerSigns && <TechRow label="VOUCHERS" value="Signed in this browser" />}
            <TechRow label="eSIM" value={mission.esimStatus.toUpperCase()} />
            <TechRow label="CARRIER" value={providerLabel} />
            <TechRow label="ICCID" value={iccidDisplay} />
          </div>
        )}
      </div>

      {/* 8. End mission */}
      {!isCompleted && !isClosing && (
        <div className="pt-2 pb-6 flex flex-col sm:flex-row justify-center gap-3">
          <button
            type="button"
            disabled={actionLoading}
            onClick={() => {
              setError(null)
              setFinishResult(null)
              setShowCompleteConfirm(true)
            }}
            className="w-full sm:w-auto px-8 py-3.5 rounded-full border border-alerta/40 bg-alerta/5 text-alerta font-sans font-bold text-xs uppercase tracking-wider hover:bg-alerta/15 transition-all flex items-center justify-center gap-2 min-h-[48px]"
          >
            <span className="material-symbols-outlined text-base">flag</span>
            END MISSION AND GET THE REST BACK
          </button>
          <button
            type="button"
            disabled={actionLoading || !caps?.solanaProgramId}
            onClick={() => void handleTimeoutRefund()}
            className="w-full sm:w-auto px-6 py-3.5 rounded-full border border-cardborder bg-warmneutral text-textsecondary font-sans font-bold text-xs uppercase tracking-wider hover:text-white disabled:opacity-40 transition-all min-h-[48px]"
          >
            REFUND AFTER TIMEOUT
          </button>
        </div>
      )}

      {/* Completed */}
      {isCompleted && (
        <div className="pt-2 pb-6 flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={() => navigate('/mission/new')}
            className="flex-1 py-3.5 rounded-full bg-primaryviolet text-white font-sans font-bold text-xs uppercase tracking-wider shadow-[0_0_22px_rgba(123,92,255,0.5)] hover:bg-primaryviolet-hover transition-all min-h-[48px] flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-base">rocket_launch</span>
            NEW MISSION
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="flex-1 py-3.5 rounded-full border border-cardborder bg-warmneutral text-textsecondary font-sans font-semibold text-xs uppercase tracking-wider hover:text-white transition-all min-h-[48px]"
          >
            {isDemoMode ? 'RESET DEMO' : 'DONE'}
          </button>
        </div>
      )}
    </MobileAppShell>
  )
}

function MetricCard({ label, value, icon, iconColor }: { label: string; value: string; icon: string; iconColor: string }) {
  return (
    <div className={`p-4 rounded-2xl flex flex-col gap-1.5 hover:border-primaryviolet/50 transition-colors ${CARD}`}>
      <div className="flex items-center gap-1.5">
        <span className={`material-symbols-outlined text-base ${iconColor}`}>{icon}</span>
        <span className="font-mono text-[10px] font-bold text-textsecondary uppercase tracking-wider">{label}</span>
      </div>
      <span className="font-display text-base sm:text-lg font-bold text-textprimary leading-tight">{value}</span>
    </div>
  )
}

function TechRow({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-textsecondary/60 uppercase tracking-wider">{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="font-bold text-[#B9A6FF] truncate hover:underline">
          {value} ↗
        </a>
      ) : (
        <span className="font-bold text-textprimary truncate">{value}</span>
      )}
    </div>
  )
}
