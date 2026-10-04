import { fmtTime, shortTx } from '../../utils/missionUtils'
import type { UsageEvent } from '../../types/mission'

type Props = {
  events: UsageEvent[]
  /** Label of the payment network, e.g. "Solana Devnet" or "Simulated". */
  networkLabel: string
}

const STATUS = {
  signed: { label: 'VOUCHER SIGNED', className: 'bg-online/10 border-online/30 text-online' },
  settled: { label: 'DEPOSITED', className: 'bg-tealbrand/10 border-tealbrand/30 text-tealbrand' },
  rejected: { label: 'NOT COVERED', className: 'bg-alerta/10 border-alerta/30 text-alerta' },
} as const

export default function ActivityFeed({ events, networkLabel }: Props) {
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="material-symbols-outlined text-3xl text-textsecondary/40">receipt_long</span>
        <p className="font-mono text-xs font-bold text-textsecondary/60 uppercase tracking-widest">No activity yet</p>
        <p className="text-xs text-textsecondary/50">Use some data to see the micropayments</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
      {events.map((ev) => {
        const isTopup = ev.kind === 'topup'
        const status = STATUS[ev.status]

        return (
          <div
            key={ev.id}
            className="flex items-center gap-3 p-3 rounded-xl bg-warmneutral border border-cardborder hover:border-primaryviolet/40 transition-all"
          >
            {/* Icon */}
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isTopup ? 'bg-tealbrand/15' : 'bg-primaryviolet-light'}`}>
              <span className={`material-symbols-outlined text-sm ${isTopup ? 'text-tealbrand' : 'text-[#B9A6FF]'}`}>
                {isTopup ? 'add_circle' : 'bolt'}
              </span>
            </div>

            {/* Details */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-sans text-xs font-semibold text-textprimary">
                  {isTopup ? 'Top-up' : `${ev.mb.toFixed(0)} MB used`}
                </span>
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full border font-mono text-[9px] font-bold tracking-wider ${status.className}`}>
                  {status.label}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-0.5">
                <span className="font-mono text-[10px] text-textsecondary">{fmtTime(ev.timestamp)}</span>
                {ev.txId &&
                  (ev.explorerUrl ? (
                    <a href={ev.explorerUrl} target="_blank" rel="noreferrer" className="font-mono text-[10px] font-semibold text-[#B9A6FF] hover:underline">
                      {shortTx(ev.txId)} ↗
                    </a>
                  ) : (
                    <span className="font-mono text-[10px] font-semibold text-textsecondary">{shortTx(ev.txId)}</span>
                  ))}
                <span className="font-mono text-[10px] text-[#B9A6FF] font-medium">{networkLabel}</span>
              </div>
            </div>

            {/* Amount */}
            <span className={`font-display text-sm font-bold shrink-0 ${isTopup ? 'text-tealbrand' : 'text-textprimary'}`}>
              {isTopup ? '+' : '-'}
              {ev.amountUsdc.toFixed(4)} USDC
            </span>
          </div>
        )
      })}
    </div>
  )
}
