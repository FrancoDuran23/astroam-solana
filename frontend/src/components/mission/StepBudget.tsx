import { estimateMb, fmtMb } from '../../utils/missionUtils'
import type { Destination } from '../../types/mission'

type Props = {
  destination: Destination
  budgetUsdc: number
  dailyLimitUsdc: number
  alertAt20pct: boolean
  autoPauseAtLimit: boolean
  onChange: (field: string, value: number | boolean) => void
}

export default function StepBudget({
  destination,
  budgetUsdc,
  dailyLimitUsdc,
  alertAt20pct,
  autoPauseAtLimit,
  onChange,
}: Props) {
  const estimatedMb = estimateMb(budgetUsdc, destination.pricePerMbUsdc)

  return (
    <div className="flex flex-col gap-8">
      {/* Budget slider */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <label className="font-mono text-[11px] font-bold text-textsecondary tracking-widest uppercase">
            USDC DEPOSIT
          </label>
          <span className="font-display text-xl font-bold text-[#B9A6FF]">
            {budgetUsdc.toFixed(2)} USDC
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={50}
          step={0.5}
          value={budgetUsdc}
          onChange={(e) => {
            const val = parseFloat(e.target.value)
            const newBudget = isNaN(val) ? 1 : Math.max(1, Math.min(50, val))
            onChange('budgetUsdc', newBudget)
            if (dailyLimitUsdc > newBudget) {
              onChange('dailyLimitUsdc', newBudget)
            }
          }}
          className="w-full h-11 accent-primaryviolet"
        />
        <div className="flex justify-between font-mono text-[10px] text-textsecondary">
          <span>1 USDC</span>
          <span>50 USDC</span>
        </div>
      </div>

      {/* Estimated data */}
      <div className="p-5 rounded-2xl bg-warmneutral border border-cardborder flex items-start sm:items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-tealbrand/10 border border-tealbrand/20 flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
          <span className="material-symbols-outlined text-tealbrand text-xl">wifi_tethering</span>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-mono text-[10px] font-bold text-textsecondary uppercase tracking-wider">
              ESTIMATED DATA
            </span>
            <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold bg-tealbrand/10 text-tealbrand border border-tealbrand/20 uppercase">
              ESTIMATE
            </span>
          </div>
          {destination.pricePerMbUsdc && destination.pricePerMbUsdc > 0 ? (
            <>
              <p className="font-display text-2xl font-bold text-textprimary">{fmtMb(estimatedMb)}</p>
              <p className="text-xs text-textsecondary mt-0.5">
                at {destination.pricePerMbUsdc} USDC/MB in {destination.name}. <span className="text-[11px] text-textsecondary/80">This is a sample rate. A live carrier is not connected yet, so nothing here is a real data charge.</span>
              </p>
            </>
          ) : (
            <p className="font-mono text-xs font-bold text-alerta mt-1">Rate not available</p>
          )}
        </div>
      </div>

      {/* Daily limit slider */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <label className="font-mono text-[11px] font-bold text-textsecondary tracking-widest uppercase">
            DAILY LIMIT
          </label>
          <span className="font-display text-xl font-bold text-tealbrand">
            {dailyLimitUsdc.toFixed(2)} USDC/day
          </span>
        </div>
        <input
          type="range"
          min={0.5}
          max={Math.min(budgetUsdc, 10)}
          step={0.5}
          value={dailyLimitUsdc}
          onChange={(e) => onChange('dailyLimitUsdc', parseFloat(e.target.value))}
          className="w-full h-11 accent-tealbrand"
        />
        <div className="flex justify-between font-mono text-[10px] text-textsecondary">
          <span>0.5 USDC</span>
          <span>{Math.min(budgetUsdc, 10).toFixed(1)} USDC</span>
        </div>
      </div>

      {/* Toggles */}
      <div className="flex flex-col gap-4">
        <Toggle
          label="Pause data automatically at the limit"
          sublabel="A rule in the app pauses data when the daily limit runs out. It is not a language model."
          checked={autoPauseAtLimit}
          onChange={(v) => onChange('autoPauseAtLimit', v)}
          accent="tealbrand"
        />
        <Toggle
          label="Warn me below 20%"
          sublabel="You get a visual alert before your balance runs out."
          checked={alertAt20pct}
          onChange={(v) => onChange('alertAt20pct', v)}
          accent="primaryviolet"
        />
      </div>
    </div>
  )
}

function Toggle({
  label,
  sublabel,
  checked,
  onChange,
  accent,
}: {
  label: string
  sublabel: string
  checked: boolean
  onChange: (v: boolean) => void
  accent: 'tealbrand' | 'primaryviolet'
}) {
  const trackOn = accent === 'tealbrand' ? 'bg-tealbrand' : 'bg-primaryviolet'

  return (
    <div
      className="flex items-start gap-4 p-4 rounded-2xl bg-warmneutral border border-cardborder cursor-pointer hover:border-primaryviolet/40 transition-all"
      onClick={() => onChange(!checked)}
    >
      {/* Toggle switch */}
      <div className={`relative w-11 h-6 rounded-full shrink-0 transition-colors duration-200 mt-0.5 ${checked ? trackOn : 'bg-cardborder'}`}>
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${checked ? 'translate-x-5' : ''}`}
        />
      </div>
      <div>
        <p className="font-sans text-sm font-semibold text-textprimary">{label}</p>
        <p className="text-xs text-textsecondary mt-0.5">{sublabel}</p>
      </div>
    </div>
  )
}
