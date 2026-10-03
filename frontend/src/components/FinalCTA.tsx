import { Link } from 'react-router-dom'
import shipCtaSrc from '../assets/ship-night.png'

export default function FinalCTA() {
  return (
    <section
      id="portal"
      className="relative py-28 px-6 md:px-12 border-t border-cardborder/60 overflow-hidden group-launch"
    >
      {/* Orbital glow rings */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] pointer-events-none flex items-center justify-center">
        <div className="absolute inset-0 rounded-full border border-primaryviolet/30 animate-portal launch-portal transition-all duration-700 shadow-[0_0_60px_rgba(123,92,255,0.15)]" />
        <div
          className="w-[450px] h-[450px] rounded-full border border-dashed border-tealbrand/30 animate-spin"
          style={{ animationDuration: '35s' }}
        />
        <div className="absolute w-[320px] h-[320px] rounded-full bg-gradient-to-tr from-primaryviolet/25 via-tealbrand/10 to-transparent blur-2xl" />
        {/* Sparkles orbiting the portal */}
        <span aria-hidden="true" className="absolute top-[12%] left-[30%] text-starlight text-xl animate-twinkle">✦</span>
        <span aria-hidden="true" className="absolute bottom-[18%] right-[22%] text-[#B9A6FF] text-lg animate-twinkle" style={{ animationDelay: '1.1s' }}>✦</span>
        <span aria-hidden="true" className="absolute top-[40%] right-[8%] text-tealbrand text-sm animate-twinkle" style={{ animationDelay: '2s' }}>✦</span>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto flex flex-col items-center text-center gap-6 relative z-10">

        {/* Floating ship */}
        <div className="w-24 h-24 relative animate-float-ship launch-thrust transition-all duration-500">
          <img
            src={shipCtaSrc}
            alt="AstroAm ship"
            className="w-full h-full object-contain drop-shadow-[0_0_26px_rgba(123,92,255,0.7)]"
          />
        </div>

        {/* Active portal badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1 rounded-full bg-primaryviolet-light border border-primaryviolet/40 font-mono text-xs font-bold text-[#B9A6FF] tracking-widest uppercase">
          <span className="w-2 h-2 rounded-full bg-primaryviolet animate-pulse" />
          HYPERLIGHT PORTAL ACTIVE
        </div>

        {/* Headline */}
        <h2 className="font-display text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-textprimary leading-tight">
          YOUR NEXT MISSION<br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primaryviolet to-tealbrand drop-shadow-[0_0_24px_rgba(123,92,255,0.5)]">IS READY.</span>
        </h2>

        {/* Subtitle */}
        <p className="text-base sm:text-lg text-textsecondary max-w-xl font-normal leading-relaxed">
          Pick your destination, load USDC and stay connected from the moment you land. Fixed roaming packages are a thing of the
          past.
        </p>

        {/* CTA button → /mission/new */}
        <div className="pt-2">
          <Link
            to="/mission/new"
            className="px-10 py-4 rounded-full bg-primaryviolet text-white font-sans text-base font-bold tracking-wider uppercase shadow-[0_0_30px_rgba(123,92,255,0.6)] hover:bg-primaryviolet-hover hover:scale-105 hover:shadow-[0_0_44px_rgba(123,92,255,0.8)] active:scale-95 transition-all duration-200 flex items-center gap-3"
          >
            <span className="material-symbols-outlined text-xl">rocket_launch</span>
            <span>START YOUR MISSION</span>
          </Link>
        </div>

        {/* Trust badges */}
        <div className="flex flex-wrap items-center justify-center gap-6 font-mono text-xs text-textsecondary uppercase tracking-widest pt-4">
          <span>NO CONTRACTS</span>
          <span>·</span>
          <span>NO SURPRISE CHARGES</span>
          <span>·</span>
          <span>USDC ON SOLANA DEVNET</span>
        </div>
      </div>
    </section>
  )
}
