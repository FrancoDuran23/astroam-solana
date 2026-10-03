import React from 'react'
import { useNavigate } from 'react-router-dom'
import logoSrc from '../assets/logo-night.png'
import MobileBottomNav from './MobileBottomNav'
import StarfieldBackground from './StarfieldBackground'
import SystemBadge from './SystemBadge'

interface MobileAppShellProps {
  title?: string
  showBack?: boolean
  showBottomNav?: boolean
  onActivityClick?: () => void
  children: React.ReactNode
}

export default function MobileAppShell({
  title,
  showBack = false,
  showBottomNav = true,
  onActivityClick,
  children,
}: MobileAppShellProps) {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen relative overflow-x-hidden flex flex-col">
      {/* Moving starfield + faint grid */}
      <StarfieldBackground />
      <div className="fixed inset-0 fintech-grid opacity-40 pointer-events-none" />

      {/* App Header */}
      <header className="sticky top-0 z-30 w-full bg-bglight/70 backdrop-blur-md border-b border-cardborder pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            {showBack && (
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="w-11 h-11 rounded-full bg-cardbg border border-cardborder flex items-center justify-center text-textsecondary hover:text-white hover:border-primaryviolet/50 transition-all shrink-0"
                aria-label="Go back"
              >
                <span className="material-symbols-outlined text-lg">arrow_back</span>
              </button>
            )}
            <a href="/" className="flex items-center gap-2 py-2.5 group shrink-0">
              <img src={logoSrc} alt="AstroAm" className="h-6 sm:h-7 object-contain group-hover:scale-105 transition-transform" />
            </a>
            {title && (
              <span className="hidden sm:inline font-mono text-xs font-semibold text-textsecondary border-l border-cardborder pl-3">
                {title}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <SystemBadge />
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className={`relative z-10 flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-6 ${showBottomNav ? 'pb-24 sm:pb-8' : 'pb-6'}`}>
        {children}
      </main>

      {/* Mobile Bottom Navigation */}
      {showBottomNav && <MobileBottomNav onActivityClick={onActivityClick} />}
    </div>
  )
}
