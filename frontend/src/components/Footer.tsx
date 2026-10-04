import logoFooterSrc from '../assets/logo-footer-night.png'

export default function Footer() {
  return (
    <footer className="relative z-10 border-t border-cardborder bg-bglight/80 backdrop-blur-sm py-10 px-6 md:px-12">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">

        {/* Logo + network badge */}
        <div className="flex items-center gap-3.5">
          <img src={logoFooterSrc} alt="AstroAm" className="h-6 object-contain" />
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-cardbg border border-cardborder text-[10px] font-mono text-online font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-online" />
            NETWORK ONLINE
          </span>
        </div>

        {/* Copyright */}
        <p className="text-xs text-textsecondary text-center md:text-left">
          Borderless connectivity. Payments on Solana devnet. The app base came from the Stellar build.
        </p>

        {/* Nav links */}
        <div className="flex items-center gap-6 font-mono text-xs text-textsecondary">
          <a href="#how-it-works" className="py-3.5 hover:text-white transition-colors">HOW IT WORKS</a>
          <a href="#technology" className="py-3.5 hover:text-white transition-colors">TECHNOLOGY</a>
          <a href="#cockpit" className="py-3.5 hover:text-white transition-colors">COCKPIT</a>
        </div>

      </div>
    </footer>
  )
}
