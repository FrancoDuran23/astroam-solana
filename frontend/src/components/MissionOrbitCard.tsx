import shipSrc from '../assets/ship-night.png'

/** The orbital mission card from the Stellar-era hero: home → Brazil, the ship riding the orbit. */
export default function MissionOrbitCard() {
  return (
    <div className="w-full max-w-xl bg-cardbg glass rounded-3xl border border-cardborder shadow-[0_0_60px_rgba(123,92,255,0.18)] p-6 sm:p-8 relative overflow-hidden">

      {/* Card header */}
      <div className="flex items-center justify-between pb-5 border-b border-cardborder">
        <div className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-online animate-pulse shadow-[0_0_10px_#3DDC97]" />
          <span className="font-mono text-xs font-bold text-textprimary uppercase tracking-wider">LINK READY</span>
        </div>
        <span className="px-3 py-1 rounded-full bg-primaryviolet-light text-[#B9A6FF] font-mono text-[11px] font-semibold tracking-wide">
          Settled on Solana devnet
        </span>
      </div>

      {/* Orbital scene */}
      <div className="relative min-h-[300px] w-full rounded-2xl bg-[#0A0B1F] border border-primaryviolet/20 my-5 overflow-hidden flex items-center justify-center">
        <svg className="absolute inset-0 w-full h-full pointer-events-none" fill="none" viewBox="0 0 500 300">
          {/* Tiny stars */}
          {[[30, 30], [140, 260], [260, 40], [380, 150], [470, 270], [210, 220], [320, 250], [450, 30]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 1.6 : 1} fill="#F3F1FF" className="animate-pulse" style={{ animationDelay: `${i * 0.37}s` }} />
          ))}
          {/* Asteroid polygons */}
          <polygon className="animate-drift-a" fill="#1B1A3D" opacity="0.9" points="60,40 85,25 105,50 90,75 60,65" stroke="#7B5CFF" strokeOpacity="0.6" strokeWidth="1.2" />
          <polygon className="animate-drift-b" fill="#102633" opacity="0.9" points="410,220 440,205 455,235 435,265 400,250" stroke="#2FD0DD" strokeOpacity="0.6" strokeWidth="1.2" />
          {/* Orbital path home → Brazil */}
          <path d="M 80 230 Q 230 70 420 80" opacity="0.7" stroke="#7B5CFF" strokeDasharray="6 5" strokeLinecap="round" strokeWidth="2.5" />
          {/* Animated pulse beam */}
          <path
            d="M 80 230 Q 230 70 420 80"
            stroke="#FDDA24"
            strokeDasharray="25 180"
            strokeLinecap="round"
            strokeWidth="3"
            className="animate-pulse-beam"
            style={{ filter: 'drop-shadow(0 0 6px #FDDA24)' }}
          />
          {/* Checkpoints */}
          <circle cx="80" cy="230" fill="#7B5CFF" r="6" />
          <circle cx="80" cy="230" opacity="0.4" r="14" stroke="#7B5CFF" strokeWidth="1.5" />
          <circle cx="215" cy="135" fill="#FDDA24" r="5" />
          <circle className="animate-spin" style={{ transformOrigin: '215px 135px' }} cx="215" cy="135" r="12" stroke="#FDDA24" strokeDasharray="3 3" strokeWidth="1.5" />
          <circle cx="330" cy="92" fill="#2FD0DD" r="5" />
          {/* Planet Brazil */}
          <g transform="translate(420, 80)">
            <circle cx="0" cy="0" r="30" fill="#2FD0DD" opacity="0.12" />
            <ellipse cx="0" cy="0" rx="42" ry="14" stroke="#2FD0DD" strokeDasharray="4 3" strokeWidth="1.2" transform="rotate(-18)" />
            <circle cx="0" cy="0" fill="#0E2A36" r="20" stroke="#2FD0DD" strokeWidth="2" />
            <circle cx="-3" cy="-4" fill="#1B4A57" r="12" />
            <text fill="#2FD0DD" fontFamily="'Space Mono', monospace" fontSize="9" fontWeight="bold" letterSpacing="1" textAnchor="middle" x="0" y="32">BRAZIL [GIG]</text>
          </g>
          {/* Home base */}
          <g transform="translate(80, 230)">
            <text fill="#B9A6FF" fontFamily="'Space Mono', monospace" fontSize="9" fontWeight="bold" letterSpacing="1" textAnchor="middle" x="0" y="24">HOME [EZE]</text>
          </g>
        </svg>

        {/* Floating ship */}
        <div className="absolute left-[44%] top-[38%] -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center">
          <div className="w-24 h-24 relative animate-float-ship launch-thrust transition-all duration-300 cursor-pointer">
            <img
              src={shipSrc}
              alt="AstroAm ship"
              className="w-full h-full object-contain drop-shadow-[0_0_22px_rgba(123,92,255,0.7)]"
            />
            {/* +1 MB badge */}
            <div className="absolute -top-2 -right-2 px-2 py-0.5 rounded-full bg-starlight text-[#19181D] font-mono font-bold text-[10px] tracking-wider shadow-[0_0_14px_rgba(253,218,36,0.7)] animate-bounce">
              +1 MB
            </div>
          </div>
        </div>
      </div>

      {/* HUD telemetry */}
      <div className="grid grid-cols-2 gap-3 pt-2">
        <div className="p-3.5 rounded-2xl bg-warmneutral border border-cardborder">
          <div className="flex items-center gap-1.5 text-textsecondary font-mono text-[11px] uppercase font-semibold">
            <span className="material-symbols-outlined text-sm text-[#B9A6FF]">account_balance_wallet</span>
            FUEL
          </div>
          <div className="font-display text-2xl font-bold text-textprimary mt-1">
            5.00 <span className="text-xs font-mono font-normal text-textsecondary">USDC</span>
          </div>
        </div>
        <div className="p-3.5 rounded-2xl bg-warmneutral border border-cardborder">
          <div className="flex items-center gap-1.5 text-textsecondary font-mono text-[11px] uppercase font-semibold">
            <span className="material-symbols-outlined text-sm text-tealbrand">wifi_tethering</span>
            DATA
          </div>
          <div className="font-display text-2xl font-bold text-textprimary mt-1">
            ≈ 2 <span className="text-xs font-mono font-normal text-textsecondary">GB</span>
          </div>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-cardborder flex items-center justify-between text-xs">
        <span className="font-mono text-textsecondary uppercase tracking-wider">DESTINATION LOCKED</span>
        <span className="font-sans font-bold text-[#B9A6FF]">BRAZIL · 0.0025 USDC/MB</span>
      </div>
    </div>
  )
}
