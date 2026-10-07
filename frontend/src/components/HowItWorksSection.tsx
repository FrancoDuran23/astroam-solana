import { useLayoutEffect, useRef, useState } from 'react'
import DotIcon from './dots/DotIcon'
import Reel from './reel/Reel'

type Step = {
  n: string
  label: string
  title: string
  sub: string
  body: string
  tag: string
  glyph: string
  /** Card ground; numbers stay dark ink on it. */
  ground: string
  ink: string
}

const STEPS: Step[] = [
  {
    n: '01',
    label: 'Destination',
    title: 'Pick your destination',
    sub: 'country → price per MB',
    body: 'Brazil, 0.0025 USDC per MB. 5 USDC is about 2 GB. No hidden fees, no contract.',
    tag: 'rates',
    glyph: 'public',
    ground: 'linear-gradient(160deg, #2A1580 0%, #5B36F0 45%, #1A0F52 100%)',
    ink: '#0A0620',
  },
  {
    n: '02',
    label: 'Fuel',
    title: 'Load fuel',
    sub: 'wallet → escrow',
    body: 'USDC goes from your wallet into the trip escrow on Solana devnet. Only what you use can leave it.',
    tag: 'Solana',
    glyph: 'account_balance_wallet',
    ground: 'linear-gradient(160deg, #06464F 0%, #11929E 50%, #052E35 100%)',
    ink: '#021417',
  },
  {
    n: '03',
    label: 'eSIM',
    title: 'Activate your eSIM',
    sub: 'QR → data line',
    body: 'This demo shows a sample test profile. A live eSIM provider is not connected yet.',
    tag: 'sample eSIM',
    glyph: 'sim_card',
    ground: 'linear-gradient(160deg, #6B4A00 0%, #C99A0C 50%, #3E2A00 100%)',
    ink: '#1A1200',
  },
  {
    n: '04',
    label: 'Pay as you go',
    title: 'Pay as you go',
    sub: 'MB used → voucher → settled',
    body: 'Each reading gets a signed voucher. At the end, one transaction pays what you used; the rest comes back.',
    tag: 'vouchers',
    glyph: 'cell_tower',
    ground: 'linear-gradient(160deg, #0B4A30 0%, #1F9E66 50%, #062A1B 100%)',
    ink: '#03140D',
  },
]

function StoryCard({ s, active }: { s: Step; active: boolean }) {
  return (
    <article
      className={`relative flex h-full flex-col overflow-hidden rounded-[28px] p-5 text-white transition-shadow duration-300 ${
        active ? 'shadow-[0_30px_70px_-30px_rgba(106,69,255,0.8)]' : ''
      }`}
      style={{ background: s.ground }}
    >
      {/* Speed streaks */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{ backgroundImage: 'repeating-linear-gradient(180deg, rgba(255,255,255,0.18) 0 1px, transparent 1px 7px)' }}
      />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-xl font-bold leading-tight">{s.title}</h3>
          <p className="font-mono text-xs text-white/85">{s.sub}</p>
        </div>
        <span className="rounded-full bg-black/35 px-2.5 py-1 font-mono text-xs text-white">{s.tag}</span>
      </div>
      <div className="relative flex flex-1 items-center justify-between">
        <span className="font-display text-[clamp(96px,22vh,170px)] font-bold leading-none tracking-tighter" style={{ color: s.ink }}>
          {s.n}
        </span>
        <div className="h-20 w-20 shrink-0">
          <DotIcon glyph={s.glyph} cols={18} active={active} />
        </div>
      </div>
      <p className="relative text-[15px] leading-snug text-white">{s.body}</p>
      <span className="relative mt-3 self-end font-mono text-xs text-white/85">
        {s.n} / {String(STEPS.length).padStart(2, '0')}
      </span>
    </article>
  )
}

/** Step buttons with an active copy clipped to the current one (Emil Kowalski's tab indicator). */
function Stepper({ index, onSelect }: { index: number; onSelect: (i: number) => void }) {
  const listRef = useRef<HTMLDivElement>(null)
  const [clip, setClip] = useState('inset(0 100% 0 0 round 999px)')

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const update = () => {
      const btn = list.querySelectorAll<HTMLElement>('[data-step]')[index]
      if (!btn) return
      const w = list.offsetWidth
      const left = btn.offsetLeft
      const right = w - left - btn.offsetWidth
      setClip(`inset(4px ${right}px 4px ${left}px round 999px)`)
      // On narrow screens the stepper scrolls; keep the current step in view.
      const scroller = list.parentElement
      if (scroller && scroller.scrollWidth > scroller.clientWidth) {
        scroller.scrollTo({ left: left - (scroller.clientWidth - btn.offsetWidth) / 2, behavior: 'smooth' })
      }
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(list)
    return () => ro.disconnect()
  }, [index])

  const items = (active: boolean) =>
    STEPS.map((s, i) => (
      <button
        key={s.n}
        type="button"
        data-step={active ? undefined : true}
        tabIndex={active ? -1 : 0}
        aria-hidden={active || undefined}
        aria-current={!active && i === index ? 'step' : undefined}
        onClick={() => onSelect(i)}
        className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-full px-4 font-sans text-sm ${
          active ? 'text-white' : 'text-textsecondary hover:text-textprimary'
        }`}
      >
        <span className="font-mono text-xs">{s.n}</span>
        {s.label}
      </button>
    ))

  return (
    <div className="mx-auto max-w-full overflow-x-auto pb-1">
      <div ref={listRef} className="relative mx-auto flex w-max rounded-full border border-cardborder bg-cardbg p-1 glass">
        {items(false)}
        <div
          aria-hidden="true"
          className="stepper-active pointer-events-none absolute inset-0 flex rounded-full bg-primaryviolet p-1 shadow-[0_0_20px_rgba(106,69,255,0.5)]"
          style={{ clipPath: clip }}
        >
          {items(true)}
        </div>
      </div>
    </div>
  )
}

export default function HowItWorksSection() {
  const [index, setIndex] = useState(0)

  return (
    <section id="how-it-works" className="scroll-mt-20 relative overflow-hidden px-6 py-24 md:px-12">
      <div className="mx-auto flex max-w-7xl flex-col gap-10">
        <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
          <div>
            <div className="font-mono text-xs font-bold uppercase tracking-widest text-[#B9A6FF]">[ LAUNCH SEQUENCE // 4 CHECKPOINTS ]</div>
            <h2 className="mt-2 font-display text-4xl font-bold tracking-tight text-textprimary sm:text-5xl md:text-6xl">The mission, running</h2>
          </div>
          <p className="max-w-md text-base text-textsecondary">
            From picking a country to browsing, usage is metered off-chain and one close on Solana devnet settles the trip.
          </p>
        </div>

        <Reel
          items={STEPS}
          label="How it works"
          cardWidth="min(380px, 78vw, 44vh)"
          ratio={1.25}
          depth={220}
          tilt={36}
          autoplayMs={4200}
          index={index}
          onIndexChange={setIndex}
          arrows={false}
          renderCard={(s, { active }) => <StoryCard s={s} active={active} />}
        />

        <Stepper index={index} onSelect={setIndex} />
      </div>
    </section>
  )
}
