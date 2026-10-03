import shipSmSrc from '../assets/ship-night.png'
import DotIcon from './dots/DotIcon'

const steps = [
  { icon: 'account_circle', color: 'text-[#B9A6FF]', step: 'STEP 01', title: 'TRAVELER', desc: 'Sets a budget and browses', img: null },
  { icon: null, color: '', step: 'STEP 02', title: 'ASTROAM APP', desc: 'Signs vouchers in the background', img: shipSmSrc },
  { icon: 'toll', color: 'text-starlight', step: 'STEP 03', title: 'CHECKPOINT', desc: 'Meters usage per reading', img: null },
  { icon: 'hub', color: 'text-tealbrand', step: 'STEP 04', title: 'SOLANA', desc: 'One transaction settles the trip', img: null },
  { icon: 'cell_tower', color: 'text-online', step: 'STEP 05', title: 'CARRIER', desc: 'Keeps the 4G/5G link up', img: null },
]

const stepColors: Record<string, string> = {
  'STEP 01': 'text-[#B9A6FF]',
  'STEP 02': 'text-[#B9A6FF]',
  'STEP 03': 'text-starlight',
  'STEP 04': 'text-tealbrand',
  'STEP 05': 'text-online',
}

const pillars = [
  { code: '01', title: 'Stable money', desc: 'No exchange-rate swings or unexpected bank fees while you travel.', glyph: 'paid', hot: [{ x: 0.5, y: 0.5, r: 0.14 }] },
  { code: '02', title: 'Tiny increments', desc: 'Pay for the megabytes you download and not a cent more.', glyph: 'grain', hot: [{ x: 0.7, y: 0.3, r: 0.16 }] },
  { code: '03', title: 'Your funds, locked', desc: 'AstroAm can only take what your app signed for; the rest returns to you.', glyph: 'lock', hot: [{ x: 0.5, y: 0.66, r: 0.12 }] },
  { code: '04', title: 'Verifiable record', desc: 'Deposit and settlement are on-chain, visible in the Solana explorer.', glyph: 'visibility', hot: [{ x: 0.5, y: 0.5, r: 0.12 }] },
]

export default function TechnologySection() {
  return (
    <section id="technology" className="scroll-mt-20 relative py-24 px-6 md:px-12 border-t border-cardborder/60 overflow-hidden">
      <div className="max-w-7xl mx-auto flex flex-col gap-16">

        {/* Header */}
        <div className="flex flex-col items-center text-center gap-3 max-w-3xl mx-auto">
          <span className="font-mono text-xs font-bold text-tealbrand uppercase tracking-widest">
            [ DETERMINISTIC SETTLEMENT ARCHITECTURE ]
          </span>
          <h2 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-textprimary text-glow">
            MICROPAYMENTS THAT POWER EVERY LEG
          </h2>
          <p className="text-base sm:text-lg text-textsecondary">
            An auditable circuit where usage accumulates off-chain, and one transaction on Solana devnet settles the trip.
          </p>
        </div>

        {/* 5-step circuit */}
        <div className="w-full p-8 md:p-10 rounded-3xl bg-cardbg glass border border-cardborder relative overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5 relative z-10 items-center">
            {steps.map((s) => (
              <div
                key={s.step}
                className="flex flex-col items-center text-center p-5 rounded-2xl bg-warmneutral border border-cardborder hover:border-primaryviolet hover:shadow-[0_0_24px_rgba(123,92,255,0.3)] transition-all"
              >
                <div className="w-12 h-12 rounded-full bg-[#14133A] border border-cardborder flex items-center justify-center mb-3">
                  {s.img ? (
                    <img src={s.img} alt={s.title} className="w-full h-full object-contain p-1.5" />
                  ) : (
                    <span className={`material-symbols-outlined text-2xl ${s.color}`}>{s.icon}</span>
                  )}
                </div>
                <span className={`font-mono text-[10px] font-bold uppercase tracking-wider ${stepColors[s.step]}`}>{s.step}</span>
                <span className="font-display text-base font-bold text-textprimary mt-1">{s.title}</span>
                <span className="text-xs text-textsecondary mt-1">{s.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 4 pillar cards: dot-art principles */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {pillars.map((p) => (
            <article
              key={p.code}
              className="pillar-card group flex flex-col gap-2 rounded-2xl border border-cardborder bg-[#0B0C20] p-5"
            >
              <div className="h-40">
                <DotIcon glyph={p.glyph} hot={p.hot} cols={26} />
              </div>
              <span className="mt-2 font-mono text-xs text-textsecondary">{p.code} / {String(pillars.length).padStart(2, '0')}</span>
              <h4 className="font-display text-lg font-bold text-textprimary">{p.title}</h4>
              <p className="text-sm leading-relaxed text-textsecondary">{p.desc}</p>
            </article>
          ))}
        </div>

      </div>
    </section>
  )
}
