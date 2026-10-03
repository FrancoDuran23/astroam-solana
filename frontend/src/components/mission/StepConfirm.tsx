import { daysBetween, estimateMb, fmtDate, fmtMb } from '../../utils/missionUtils'
import type { WizardData } from '../../types/mission'

type Props = {
  data: WizardData
  /** Payment network shown to the traveler, e.g. "Solana Devnet". */
  networkLabel: string
  busy?: boolean
  onBack: () => void
  onConfirm: () => void
}

type RowProps = { label: string; value: string; mono?: boolean; accent?: string }

function Row({ label, value, mono, accent }: RowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 px-2 border-b border-cardborder last:border-0">
      <span className="font-mono text-[11px] font-bold text-textsecondary tracking-widest uppercase">{label}</span>
      <span className={`font-sans text-sm font-semibold text-right ${accent ?? 'text-textprimary'} ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

export default function StepConfirm({ data, networkLabel, busy = false, onBack, onConfirm }: Props) {
  const { destination, startDate, endDate, budgetUsdc, dailyLimitUsdc } = data
  if (!destination) return null

  const duration = daysBetween(startDate, endDate)
  const estimatedMb = estimateMb(budgetUsdc, destination.pricePerMbUsdc)

  return (
    <div className="flex flex-col gap-6">
      <div className="p-2 rounded-2xl bg-warmneutral border border-cardborder">
        <Row label="DESTINATION" value={`${destination.flag} ${destination.name}`} />
        <Row label="START" value={fmtDate(startDate)} />
        <Row label="END" value={fmtDate(endDate)} />
        <Row label="DURATION" value={`${duration} day${duration > 1 ? 's' : ''}`} />
        <Row label="DEPOSIT" value={`${budgetUsdc.toFixed(2)} USDC`} accent="text-[#B9A6FF]" />
        <Row label="DAILY LIMIT" value={`${dailyLimitUsdc.toFixed(2)} USDC/day`} accent="text-tealbrand" />
        <Row label="PRICE / MB" value={`${destination.pricePerMbUsdc} USDC`} mono />
        <Row label="EST. DATA" value={fmtMb(estimatedMb)} accent="text-tealbrand" />
        <Row label="COVERAGE" value={destination.coverage} />
        <Row label="NETWORK" value={networkLabel} accent="text-[#B9A6FF]" mono />
      </div>

      {/* Options summary */}
      <div className="flex flex-wrap gap-3">
        {data.autoPauseAtLimit && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-tealbrand/10 border border-tealbrand/30 font-mono text-[10px] font-bold text-tealbrand tracking-wider">
            <span className="material-symbols-outlined text-sm">pause_circle</span>
            AUTO-PAUSE ON
          </span>
        )}
        {data.alertAt20pct && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-starlight/10 border border-starlight/30 font-mono text-[10px] font-bold text-starlight tracking-wider">
            <span className="material-symbols-outlined text-sm">notifications_active</span>
            20% ALERT
          </span>
        )}
      </div>

      <p className="text-xs text-textsecondary leading-relaxed">
        Unused USDC goes back to your wallet when you end the trip.
      </p>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="flex-1 py-3.5 rounded-full border border-cardborder bg-warmneutral text-textprimary font-sans font-semibold text-sm uppercase tracking-wider hover:border-primaryviolet/50 transition-all duration-200"
        >
          EDIT
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="flex-1 py-3.5 rounded-full bg-primaryviolet text-white font-sans font-bold text-sm uppercase tracking-wider shadow-[0_0_24px_rgba(123,92,255,0.55)] hover:bg-primaryviolet-hover hover:shadow-[0_0_36px_rgba(123,92,255,0.75)] hover:-translate-y-0.5 disabled:opacity-60 disabled:translate-y-0 transition-all duration-200 flex items-center justify-center gap-2"
        >
          <span className={`material-symbols-outlined text-base ${busy ? 'animate-spin' : ''}`}>{busy ? 'refresh' : 'rocket_launch'}</span>
          {busy ? 'PREPARING…' : 'CONFIRM AND LAUNCH'}
        </button>
      </div>
    </div>
  )
}
