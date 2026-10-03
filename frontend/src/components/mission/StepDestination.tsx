import type { Destination } from '../../types/mission'
import { DESTINATIONS, ORIGIN } from '../../utils/missionUtils'

type Props = {
  selected: Destination | null
  onSelect: (d: Destination) => void
}

export default function StepDestination({ selected, onSelect }: Props) {
  return (
    <div className="flex flex-col gap-8">
      {/* Origin (fixed) */}
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[11px] font-bold text-textsecondary tracking-widest uppercase">
          FROM
        </span>
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-warmneutral border border-cardborder">
          <span className="text-3xl">{ORIGIN.flag}</span>
          <div>
            <p className="font-display text-base font-bold text-textprimary">{ORIGIN.name}</p>
            <p className="font-mono text-xs text-textsecondary">Your eSIM works from the moment you land</p>
          </div>
        </div>
      </div>

      {/* Destination selector */}
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[11px] font-bold text-textsecondary tracking-widest uppercase">
          DESTINATION
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {DESTINATIONS.map((dest) => {
            const isSelected = selected?.id === dest.id
            return (
              <button
                key={dest.id}
                type="button"
                onClick={() => onSelect(dest)}
                className={`flex flex-col gap-3 p-5 rounded-2xl border text-left transition-all duration-200 group ${
                  isSelected
                    ? 'bg-primaryviolet-light border-primaryviolet shadow-[0_0_0_2px_rgba(123,92,255,0.3),0_0_24px_rgba(123,92,255,0.35)]'
                    : 'bg-warmneutral border-cardborder hover:border-primaryviolet/50 hover:shadow-[0_0_18px_rgba(123,92,255,0.2)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-4xl">{dest.flag}</span>
                  {isSelected && (
                    <span className="w-5 h-5 rounded-full bg-primaryviolet flex items-center justify-center">
                      <span className="material-symbols-outlined text-white text-sm">check</span>
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  <p className="font-display text-lg font-bold text-textprimary">{dest.name}</p>
                  <p className="font-mono text-[11px] text-tealbrand font-semibold tracking-wide">{dest.coverage}</p>
                  <p className="text-xs text-textsecondary">{dest.network}</p>
                </div>
                <div className="pt-2 border-t border-cardborder flex items-center gap-1.5">
                  <span className="font-mono text-[11px] font-bold text-[#B9A6FF]">
                    {dest.pricePerMbUsdc} USDC/MB
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
