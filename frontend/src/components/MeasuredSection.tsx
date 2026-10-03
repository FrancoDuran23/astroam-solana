import { useEffect, useLayoutEffect, useRef, useState } from 'react'

type Box = { left: number; top: number; width: number; height: number; cap: number; base: number; right: number }

/**
 * "What can be measured is never asked", for data: the headline measures its
 * own key word with dashed guides and live pixel tags, the way kerostack
 * measures its type. Guides draw in once, when the block is first seen.
 */
export default function MeasuredSection() {
  const rootRef = useRef<HTMLDivElement>(null)
  const wordRef = useRef<HTMLSpanElement>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [seen, setSeen] = useState(false)

  useLayoutEffect(() => {
    const root = rootRef.current
    const word = wordRef.current
    if (!root || !word) return
    const measure = () => {
      const r = root.getBoundingClientRect()
      const w = word.getBoundingClientRect()
      const size = parseFloat(getComputedStyle(word).fontSize)
      setBox({
        left: w.left - r.left,
        right: r.width,
        top: w.top - r.top,
        width: w.width,
        height: w.height,
        // Space Grotesk: cap height ≈ 0.70em, baseline ≈ 0.80em from the top of the line box.
        cap: w.top - r.top + (w.height - size) / 2 + size * 0.1,
        base: w.top - r.top + (w.height - size) / 2 + size * 0.8,
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    void document.fonts.ready.then(measure)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true)
          io.disconnect()
        }
      },
      { threshold: 0.4 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <section className="relative px-6 py-24 md:px-12" aria-labelledby="measured-title">
      <div ref={rootRef} className={`relative mx-auto max-w-7xl ${seen ? 'is-seen' : ''}`}>
        <h2
          id="measured-title"
          className="max-w-4xl font-display text-5xl font-bold leading-[1.05] tracking-tight text-textprimary sm:text-7xl md:text-8xl"
        >
          Only what gets{' '}
          <span ref={wordRef} className="relative inline-block">
            measured
          </span>{' '}
          gets paid.
        </h2>

        {box && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            {/* Selection box around the word */}
            <div
              className="measure-box absolute rounded-sm border border-dashed border-starlight/80 bg-starlight/[0.06]"
              style={{ left: box.left - 6, top: box.top, width: box.width + 12, height: box.height }}
            />
            {/* Width tag */}
            <span
              className="guide-tag absolute rounded bg-starlight px-1.5 py-0.5 font-mono text-xs font-bold text-[#19181D]"
              style={{ left: box.left + box.width / 2 - 28, top: box.top - 26 }}
            >
              {Math.round(box.width)}px
            </span>
            {/* Height tag */}
            <span
              className="guide-tag absolute rounded bg-starlight px-1.5 py-0.5 font-mono text-xs font-bold text-[#19181D]"
              style={{ left: Math.min(box.left + box.width + 12, box.right - 48), top: box.top + box.height / 2 - 10 }}
            >
              {Math.round(box.height)}px
            </span>
            {/* Cap line and baseline across the block */}
            <div className="guide-line is-h absolute left-0 right-0 border-t border-dashed border-starlight/50" style={{ top: box.cap }} />
            <div className="guide-line is-h absolute left-0 right-0 border-t border-dashed border-starlight/50" style={{ top: box.base }} />
            <span className="guide-tag absolute right-0 hidden font-mono text-xs text-starlight sm:block" style={{ top: box.cap - 20 }}>
              cap 0.70em
            </span>
            <span className="guide-tag absolute right-0 hidden font-mono text-xs text-starlight sm:block" style={{ top: box.base + 4 }}>
              baseline
            </span>
            {/* Verticals at the word's edges */}
            <div className="guide-line is-v absolute bottom-0 top-0 border-l border-dashed border-starlight/40" style={{ left: box.left - 6 }} />
            <div className="guide-line is-v absolute bottom-0 top-0 border-l border-dashed border-starlight/40" style={{ left: box.left + box.width + 6 }} />
          </div>
        )}

        {/* What the meter reads, as tags */}
        <div className="relative mt-10 flex flex-wrap gap-3 font-mono text-sm">
          <span className="guide-tag rounded-md bg-textprimary px-2.5 py-1 text-[#070814]">250 MB · read by the carrier</span>
          <span className="guide-tag rounded-md bg-cardborder px-2.5 py-1 text-textprimary">× 0.0025 USDC/MB · Brazil</span>
          <span className="guide-tag rounded-md bg-starlight px-2.5 py-1 font-bold text-[#19181D]">= 0.625 USDC · voucher signed</span>
        </div>
        <p className="relative mt-6 max-w-2xl text-lg leading-relaxed text-textsecondary">
          The carrier reports your usage, your app signs a voucher for exactly that, and nothing else leaves the escrow. No
          package to guess, no estimate to trust.
        </p>
      </div>
    </section>
  )
}
