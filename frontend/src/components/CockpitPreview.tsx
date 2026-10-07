export default function CockpitPreview() {
  return (
    <section id="cockpit" className="scroll-mt-20 relative py-24 px-6 md:px-12 border-t border-cardborder/60 overflow-hidden">
      <div className="max-w-6xl mx-auto flex flex-col gap-12">

        {/* Header */}
        <div className="flex flex-col items-center text-center gap-2">
          <span className="font-mono text-xs font-bold text-[#B9A6FF] uppercase tracking-widest">
            [ REAL-TIME NAVIGATION COCKPIT ]
          </span>
          <h2 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-textprimary text-glow">
            A WINDOW INTO THE MISSION COCKPIT
          </h2>
          <p className="text-base text-textsecondary max-w-xl">
            A clear view of your data link: balance, usage and what is left, without crowded terminals or cryptic codes.
          </p>
        </div>

        {/* Cockpit panel */}
        <div className="relative rounded-3xl bg-cardbg glass border border-cardborder shadow-[0_0_60px_rgba(123,92,255,0.15)] overflow-hidden">

          {/* Top bar */}
          <div className="px-8 py-4 border-b border-cardborder flex flex-wrap items-center justify-between gap-4 bg-warmneutral/80">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-online animate-pulse shadow-[0_0_10px_#3DDC97]" />
              <span className="font-mono text-xs font-bold text-textprimary uppercase tracking-wider">
                eSIM STATUS: <strong className="text-online font-bold">LINK ACTIVE</strong>
              </span>
            </div>
            <div className="flex items-center gap-6 font-mono text-xs text-textsecondary">
              <span>CHANNEL: SOLANA ESCROW</span>
              <span>DESTINATION: BRAZIL [GIG]</span>
            </div>
          </div>

          {/* Interior */}
          <div className="p-8 md:p-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">

            {/* Left: arc chart */}
            <div className="lg:col-span-7 flex flex-col gap-5">
              <div className="relative h-60 w-full bg-[#0A0B1F] rounded-2xl border border-cardborder p-6 flex flex-col justify-between overflow-hidden">
                <svg className="absolute inset-0 w-full h-full pointer-events-none" fill="none" viewBox="0 0 450 200">
                  <circle cx="225" cy="180" r="150" stroke="#1C1D40" strokeWidth="1.5" />
                  {/* Base arc */}
                  <path d="M 75 180 A 150 150 0 0 1 375 180" stroke="#221F4D" strokeLinecap="round" strokeWidth="10" />
                  {/* Progress arc */}
                  <path d="M 75 180 A 150 150 0 0 1 190 35" stroke="url(#arcGradient)" strokeLinecap="round" strokeWidth="10" style={{ filter: 'drop-shadow(0 0 8px rgba(123,92,255,0.7))' }} />
                  {/* Ship dot */}
                  <circle className="animate-ping" style={{ transformOrigin: '190px 35px' }} cx="190" cy="35" fill="#7B5CFF" r="6" />
                  <circle cx="190" cy="35" fill="#FDDA24" r="5" />
                  <defs>
                    <linearGradient gradientUnits="userSpaceOnUse" id="arcGradient" x1="75" x2="190" y1="180" y2="35">
                      <stop stopColor="#7B5CFF" />
                      <stop offset="1" stopColor="#2FD0DD" />
                    </linearGradient>
                  </defs>
                </svg>

                <div className="relative z-10 flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-[#B9A6FF] tracking-wider">TRAJECTORY IN PROGRESS</span>
                  <span className="font-mono text-xs font-bold text-tealbrand">40% USED</span>
                </div>
                <div className="relative z-10 flex items-end justify-between pt-10">
                  <div>
                    <span className="font-mono text-[10px] font-semibold text-textsecondary block uppercase">DATA USED</span>
                    <span className="font-display text-3xl font-bold text-textprimary">
                      800 <span className="text-sm font-normal text-textsecondary">/ 2,000 MB</span>
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-[10px] font-semibold text-textsecondary block uppercase">REMAINING</span>
                    <span className="font-display text-3xl font-bold text-[#B9A6FF]">1,200 MB</span>
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between font-mono text-xs">
                  <span className="text-textsecondary uppercase tracking-wider font-semibold">DATA THRUSTER</span>
                  <span className="text-[#B9A6FF] font-bold">2.00 USDC SETTLED</span>
                </div>
                <div className="h-2.5 w-full bg-cardborder rounded-full overflow-hidden p-0.5">
                  <div className="h-full rounded-full bg-gradient-to-r from-primaryviolet to-tealbrand w-[40%] shadow-[0_0_12px_rgba(47,208,221,0.6)] transition-all duration-700" />
                </div>
              </div>
            </div>

            {/* Right: balance + rule-based budget assistant */}
            <div className="lg:col-span-5 flex flex-col gap-5">
              {/* Balance card */}
              <div className="p-6 rounded-2xl bg-warmneutral border border-cardborder flex flex-col gap-1.5">
                <span className="font-mono text-xs font-bold text-textsecondary uppercase tracking-wider">BALANCE LEFT IN ESCROW</span>
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-5xl font-bold text-textprimary tracking-tight">3.00</span>
                  <span className="font-mono text-lg font-bold text-[#B9A6FF]">USDC</span>
                </div>
                <span className="text-xs text-textsecondary mt-1">Locked in the AstroAm escrow on Solana devnet.</span>
              </div>

              {/* Copilot */}
              <div className="p-6 rounded-2xl bg-primaryviolet-light border border-primaryviolet/30 flex flex-col gap-2.5 relative">
                <div className="flex items-center gap-2 text-[#B9A6FF] font-mono text-xs font-bold tracking-wider uppercase">
                  <span className="material-symbols-outlined text-base">smart_toy</span>
                  BUDGET ASSISTANT // RULES
                </div>
                <p className="text-sm text-textprimary italic leading-relaxed">
                  &quot;Your mission is on budget. You have about 1.2 GB left in this zone. Data pauses automatically at your limit
                  to protect your balance.&quot;
                </p>
              </div>
            </div>

          </div>
        </div>
      </div>
    </section>
  )
}
