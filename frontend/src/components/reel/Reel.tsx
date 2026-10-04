import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { prefersReducedMotion } from '../dots/dotMatrix'

type Props<T> = {
  items: T[]
  /** Accessible name of the reel. */
  label: string
  renderCard: (item: T, state: { active: boolean; index: number }) => ReactNode
  /** Card width as a CSS length; height follows `ratio`. */
  cardWidth: string
  ratio?: number
  /** Wraps around (hero) or stops at both ends (story). */
  loop?: boolean
  autoplayMs?: number
  /** Controlled index, for a stepper outside the reel. */
  index?: number
  onIndexChange?: (index: number) => void
  depth?: number
  tilt?: number
  className?: string
  /** Show prev/next buttons under the reel. */
  arrows?: boolean
}

const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)'

/**
 * A 3D card reel (after kerostack.vercel.app): each card sits at d = i - k
 * from the current card and is moved, pushed back and turned from that one
 * number. Drag or swipe follows the finger, arrows and Left/Right step it,
 * autoplay stops while the reel is hovered, focused or off screen.
 */
export default function Reel<T>({
  items,
  label,
  renderCard,
  cardWidth,
  ratio = 1.32,
  loop = false,
  autoplayMs = 0,
  index,
  onIndexChange,
  depth = 170,
  tilt = 40,
  className = '',
  arrows = true,
}: Props<T>) {
  const n = items.length
  const [inner, setInner] = useState(0)
  const k = index ?? inner
  const [drag, setDrag] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [paused, setPaused] = useState(false)
  const [inView, setInView] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; y: number; width: number; moved: boolean; id: number } | null>(null)
  const suppressClick = useRef(false)
  const reduce = useRef(false)

  useEffect(() => {
    reduce.current = prefersReducedMotion()
  }, [])

  const go = useCallback(
    (next: number) => {
      const target = loop ? ((next % n) + n) % n : Math.max(0, Math.min(n - 1, next))
      if (index === undefined) setInner(target)
      onIndexChange?.(target)
    },
    [index, loop, n, onIndexChange],
  )

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.3 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!autoplayMs || paused || !inView || dragging || reduce.current) return
    const id = window.setTimeout(() => go(k + 1 >= n && !loop ? 0 : k + 1), autoplayMs)
    return () => window.clearTimeout(id)
  }, [autoplayMs, paused, inView, dragging, k, n, loop, go])

  function offset(i: number): number {
    const kf = k + drag
    let d = i - kf
    if (loop) {
      d = ((d % n) + n) % n
      if (d > n / 2) d -= n
    }
    return d
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    const card = stageRef.current?.querySelector<HTMLElement>('[data-reel-card]')
    start.current = { x: e.clientX, y: e.clientY, width: card?.offsetWidth ?? 280, moved: false, id: e.pointerId }
  }

  function onPointerMove(e: React.PointerEvent) {
    const s = start.current
    if (!s || s.id !== e.pointerId) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (!s.moved) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return
      s.moved = true
      setDragging(true)
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }
    let next = -dx / (s.width * 1.02)
    if (!loop) {
      // Rubber band past the ends.
      const at = k + next
      if (at < 0) next = -k + at * 0.3
      if (at > n - 1) next = n - 1 - k + (at - (n - 1)) * 0.3
    }
    setDrag(next)
  }

  function endDrag(e: React.PointerEvent) {
    const s = start.current
    start.current = null
    if (!s || !s.moved) return
    suppressClick.current = true
    const dx = e.clientX - s.x
    const steps = Math.round(-dx / (s.width * 1.02)) || (Math.abs(dx) > 40 ? (dx < 0 ? 1 : -1) : 0)
    setDragging(false)
    setDrag(0)
    go(k + steps)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      go(k + 1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      go(k - 1)
    }
  }

  const stageStyle = { '--cw': cardWidth, perspective: '1500px' } as CSSProperties

  return (
    <div
      className={`relative ${className}`}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setPaused(false)}
    >
      <div
        ref={stageRef}
        role="group"
        aria-roledescription="carousel"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            suppressClick.current = false
            e.preventDefault()
            e.stopPropagation()
          }
        }}
        className={`reel-stage relative w-full select-none outline-none focus-visible:ring-2 focus-visible:ring-primaryviolet/70 rounded-3xl ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ ...stageStyle, height: `calc(${cardWidth} * ${ratio} + 48px)` }}
      >
        {items.map((item, i) => {
          const d = offset(i)
          const a = Math.abs(d)
          const s = Math.max(-1, Math.min(1, d))
          const active = Math.round(a * 100) === 0
          const style: CSSProperties = {
            width: 'var(--cw)',
            height: `calc(var(--cw) * ${ratio})`,
            transformOrigin: `${50 - s * 50}% 50%`,
            transform: `translate(-50%, -50%) translateX(calc(${d} * var(--cw) * 1.02)) translateZ(${-a * depth}px) rotateY(${s * -tilt}deg)`,
            opacity: 1 - Math.max(0, Math.min(1, a - 1.8)),
            zIndex: 100 - Math.round(a * 10),
            transition: dragging || reduce.current ? 'none' : `transform 620ms ${EASE}, opacity 400ms ${EASE}`,
          }
          return (
            <div
              key={i}
              data-reel-card
              aria-hidden={!active}
              className="absolute left-1/2 top-1/2 will-change-transform"
              style={style}
              onClick={() => !active && go(k + Math.round(d))}
            >
              {renderCard(item, { active, index: i })}
            </div>
          )
        })}
      </div>

      {arrows && (
        <div className="mt-2 flex items-center justify-center gap-3">
          <button
            type="button"
            aria-label="Previous card"
            disabled={!loop && k === 0}
            onClick={() => go(k - 1)}
            className="reel-arrow w-11 h-11 rounded-full border border-cardborder bg-cardbg text-textprimary flex items-center justify-center disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-xl">chevron_left</span>
          </button>
          <span className="font-mono text-xs text-textsecondary tabular-nums min-w-[52px] text-center" aria-live="polite">
            {String(k + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}
          </span>
          <button
            type="button"
            aria-label="Next card"
            disabled={!loop && k === n - 1}
            onClick={() => go(k + 1)}
            className="reel-arrow w-11 h-11 rounded-full border border-cardborder bg-cardbg text-textprimary flex items-center justify-center disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-xl">chevron_right</span>
          </button>
        </div>
      )}
    </div>
  )
}
