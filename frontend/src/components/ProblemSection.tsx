const obstacles = [
  {
    icon: 'event_busy',
    iconClass: 'group-hover:rotate-12',
    number: 'OBSTACLE 01',
    title: 'PACKAGES THAT ARE TOO LONG',
    desc: 'You pay for 7, 15 or 30 days when your trip is a weekend or a layover of a few hours.',
    penalty: 'Paying for days you never use',
  },
  {
    icon: 'cloud_off',
    iconClass: 'group-hover:-rotate-12',
    number: 'OBSTACLE 02',
    title: 'DATA YOU NEVER USE',
    desc: 'You buy 10 GB, use 2 GB, and the rest disappears when the package expires. That money never comes back.',
    penalty: 'Leftover balance lost',
  },
  {
    icon: 'receipt_long',
    iconClass: 'group-hover:scale-110',
    number: 'OBSTACLE 03',
    title: 'SPENDING OUT OF CONTROL',
    desc: 'Background data adds roaming charges you only find out about on next month’s bill.',
    penalty: 'Surprise bills',
  },
]

export default function ProblemSection() {
  return (
    <section className="relative py-24 px-6 md:px-12 border-y border-cardborder/60 overflow-hidden">
      <div className="max-w-7xl mx-auto flex flex-col gap-14">

        {/* Section title */}
        <div className="max-w-3xl flex flex-col gap-3">
          <div className="inline-flex items-center gap-2 font-mono text-xs font-bold text-alerta tracking-widest uppercase">
            <span className="material-symbols-outlined text-sm">warning</span>
            ANOMALY ZONE DETECTED
          </div>
          <h2 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-textprimary leading-tight">
            TRADITIONAL ROAMING BURNS MORE THAN YOU NEED.
          </h2>
          <p className="text-base sm:text-lg text-textsecondary leading-relaxed">
            Carriers make you buy closed, rigid packages. The AstroAm ship flies around the asteroids of that model with metered
            data and automatic micropayments.
          </p>
        </div>

        {/* 3 obstacle cards - mobile carousel, desktop grid */}
        <div className="flex md:grid md:grid-cols-3 gap-5 overflow-x-auto snap-x snap-mandatory pb-4 md:pb-0 -mx-6 px-6 md:mx-0 md:px-0 scrollbar-none relative z-10">
          {obstacles.map((o) => (
            <div
              key={o.number}
              className="w-[82%] sm:w-[320px] md:w-auto shrink-0 snap-center flex flex-col justify-between p-6 sm:p-8 rounded-2xl bg-cardbg glass border border-cardborder hover:border-primaryviolet/60 hover:shadow-[0_0_30px_rgba(123,92,255,0.2)] transition-all group"
            >
              <div className="flex flex-col gap-4">
                <div className="w-14 h-14 rounded-2xl bg-primaryviolet-light border border-primaryviolet/30 flex items-center justify-center text-[#B9A6FF]">
                  <span className={`material-symbols-outlined text-2xl transition-transform ${o.iconClass}`}>{o.icon}</span>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="font-mono text-xs font-bold text-textsecondary tracking-wider">{o.number}</span>
                  <h3 className="font-display text-xl font-bold text-textprimary group-hover:text-[#B9A6FF] transition-colors">
                    {o.title}
                  </h3>
                  <p className="text-sm text-textsecondary leading-relaxed">{o.desc}</p>
                </div>
              </div>
              <div className="pt-6 mt-6 border-t border-cardborder font-mono text-xs text-alerta font-medium flex items-center gap-1.5">
                <span className="material-symbols-outlined text-base">close</span>
                {o.penalty}
              </div>
            </div>
          ))}
        </div>

        {/* Mobile carousel scroll indicator hint */}
        <div className="flex md:hidden justify-center items-center gap-1.5 -mt-6">
          <span className="w-2 h-2 rounded-full bg-primaryviolet" />
          <span className="w-1.5 h-1.5 rounded-full bg-cardborder" />
          <span className="w-1.5 h-1.5 rounded-full bg-cardborder" />
          <span className="font-mono text-xs text-textsecondary ml-2">SWIPE FOR MORE &rarr;</span>
        </div>
      </div>
    </section>
  )
}
