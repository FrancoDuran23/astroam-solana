import { Link } from 'react-router-dom'
import logoSrc from '../assets/logo-night.png'
import SystemBadge from './SystemBadge'

export default function Header() {
  return (
    <header className="fixed top-0 left-0 w-full z-50 bg-bglight/70 backdrop-blur-md border-b border-cardborder/80 transition-all">
      <div className="max-w-7xl mx-auto h-20 px-6 md:px-12 flex items-center justify-between">

        {/* Logo */}
        <a href="/" className="flex items-center gap-3.5 py-1.5 group">
          <img
            src={logoSrc}
            alt="AstroAm"
            className="h-8 sm:h-9 object-contain transition-transform duration-200 group-hover:scale-105"
          />
          <span className="hidden sm:inline-flex">
            <SystemBadge />
          </span>
        </a>

        {/* Nav links */}
        <nav className="hidden md:flex items-center gap-8">
          <a href="#how-it-works" className="py-2 text-sm font-medium text-textsecondary hover:text-white transition-colors">
            How it works
          </a>
          <a href="#technology" className="py-2 text-sm font-medium text-textsecondary hover:text-white transition-colors">
            Technology
          </a>
          <a href="#cockpit" className="py-2 text-sm font-medium text-textsecondary hover:text-white transition-colors">
            Live demo
          </a>
        </nav>

        {/* CTA button → /mission/new */}
        <div className="flex items-center">
          <Link
            to="/mission/new"
            className="px-6 py-2.5 rounded-full bg-primaryviolet text-white font-sans font-semibold text-xs tracking-wider uppercase hover:bg-primaryviolet-hover shadow-[0_0_18px_rgba(123,92,255,0.5)] hover:shadow-[0_0_28px_rgba(123,92,255,0.7)] hover:-translate-y-0.5 transition-all duration-200 flex items-center gap-2"
          >
            <span className="hidden sm:inline">START MISSION</span>
            <span className="sm:hidden">START</span>
            <span className="material-symbols-outlined text-sm">rocket_launch</span>
          </Link>
        </div>
      </div>
    </header>
  )
}
