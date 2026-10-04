import { Link } from 'react-router-dom'
import shipSrc from '../assets/ship-night.png'
import DotIcon from './dots/DotIcon'
import DotLettering from './dots/DotLettering'
import MissionOrbitCard from './MissionOrbitCard'
import Reel from './reel/Reel'
import type { Hot } from './dots/dotMatrix'

type Concept = { code: string; title: string; flow: string; glyph?: string; hot?: Hot[] }

// The trip, one card per step. Gold dots mark what gets measured or moves.
const CONCEPTS: Concept[] = [
  { code: '00', title: 'AstroAm', flow: 'USDC in → data out' },
  { code: '01', title: 'Pick a country', flow: 'destination → price per MB', glyph: 'public', hot: [{ x: 0.68, y: 0.34, r: 0.16 }] },
  { code: '02', title: 'Load USDC', flow: 'wallet → escrow on Solana devnet', glyph: 'account_balance_wallet', hot: [{ x: 0.7, y: 0.56, r: 0.12 }] },
  { code: '03', title: 'Install the eSIM', flow: 'QR → data line', glyph: 'sim_card', hot: [{ x: 0.5, y: 0.62, r: 0.16 }] },
  { code: '04', title: 'Browse', flow: 'MB used → signed voucher', glyph: 'cell_tower', hot: [{ x: 0.5, y: 0.2, r: 0.14 }] },
  { code: '05', title: 'Auto-pause', flow: 'limit reached → data paused', glyph: 'pause_circle', hot: [{ x: 0.5, y: 0.5, r: 0.12 }] },
  { code: '06', title: 'Get the rest back', flow: 'unused USDC → your wallet', glyph: 'currency_exchange', hot: [{ x: 0.3, y: 0.3, r: 0.18 }] },
]

function ConceptCard({ c, active }: { c: Concept; active: boolean }) {
  return (
    <article
      className={`flex h-full flex-col rounded-3xl border p-4 transition-[border-color,box-shadow] duration-300 ${
        active
          ? 'border-primaryviolet/80 bg-[#0E0C2C] shadow-[0_0_40px_rgba(106,69,255,0.45)]'
          : 'border-cardborder bg-[#0B0C20]'
      }`}
    >
      <div className="flex items-center justify-between font-mono text-xs text-textsecondary">
        <span>@astroam</span>
        <span className={active ? 'text-starlight' : ''}>{c.code}</span>
      </div>
      <div className="relative my-3 flex-1">
        {c.glyph ? (
          <DotIcon glyph={c.glyph} hot={c.hot} active={active} />
        ) : (
          <img src={shipSrc} alt="" draggable={false} className="absolute inset-0 m-auto h-[78%] w-[78%] object-contain animate-float-ship drop-shadow-[0_0_24px_rgba(106,69,255,0.7)]" />
        )}
      </div>
      <h3 className="font-display text-lg font-bold text-textprimary">{c.title}</h3>
      <p className="mt-0.5 font-mono text-xs text-textsecondary">{c.flow}</p>
    </article>
  )
}

export default function Hero() {
  return (
    <section className="relative overflow-hidden px-6 pb-16 pt-6 md:px-12">
      {/* Giant dot lettering behind the reel */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[300px] sm:h-[440px]">
        <DotLettering text="ASTROAM" />
      </div>

      {/* The trip as a 3D reel */}
      <div className="relative mx-auto max-w-7xl">
        <Reel
          items={CONCEPTS}
          label="How a trip works, step by step"
          cardWidth="min(250px, 62vw, 34vh)"
          ratio={1.3}
          loop
          autoplayMs={3200}
          renderCard={(c, { active }) => <ConceptCard c={c} active={active} />}
        />
        <p className="mt-4 text-center font-mono text-sm text-textsecondary">
          Pay per MB. Nothing is charged <span className="rounded bg-textprimary px-1.5 py-0.5 text-[#070814]">unmeasured</span>.
        </p>
      </div>

      {/* Headline + the orbital mission card */}
      <div className="relative mx-auto mt-16 grid max-w-7xl grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-10">
        <div className="flex flex-col items-start gap-6 lg:col-span-6">
          <div className="inline-flex items-center gap-2.5 rounded-full border border-cardborder bg-cardbg px-3.5 py-1.5 glass">
            <span className="h-2 w-2 rounded-full bg-tealbrand shadow-[0_0_10px_#2FD0DD]" />
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-tealbrand">PAY-PER-MB ROAMING · SETTLED ON SOLANA DEVNET</span>
          </div>

          <h1 className="font-display text-5xl font-bold leading-tight tracking-tight text-textprimary sm:text-6xl md:text-7xl">
            YOUR CONNECTION.
            <br />
            <span className="bg-gradient-to-r from-[#8F74FF] via-[#A58BFF] to-tealbrand bg-clip-text text-transparent">YOUR MISSION.</span>
          </h1>

          <p className="max-w-xl text-lg leading-relaxed text-textsecondary md:text-xl">
            Travel connected and pay only for the data you actually use, in USDC. No fixed packages, no surprise bills: what you
            don&apos;t use comes back to your wallet.
          </p>

          <div className="group-launch flex flex-wrap items-center gap-4 pt-1">
            <Link
              to="/mission/new"
              className="flex items-center gap-2.5 rounded-full bg-primaryviolet px-8 py-3.5 font-sans text-sm font-semibold uppercase tracking-wider text-white shadow-[0_0_24px_rgba(106,69,255,0.55)] transition-[transform,box-shadow,background-color] duration-150 hover:bg-primaryviolet-hover active:scale-[0.97]"
            >
              <span>START MISSION</span>
              <span className="material-symbols-outlined text-base">rocket_launch</span>
            </Link>
            <a
              href="#how-it-works"
              className="rounded-full border border-cardborder bg-cardbg px-7 py-3.5 font-sans text-sm font-semibold uppercase tracking-wider text-textprimary transition-[border-color,transform] duration-150 glass hover:border-primaryviolet/60 active:scale-[0.97]"
            >
              SEE HOW IT WORKS
            </a>
          </div>
        </div>

        <div className="relative flex items-center justify-center lg:col-span-6">
          <MissionOrbitCard />
        </div>
      </div>
    </section>
  )
}
