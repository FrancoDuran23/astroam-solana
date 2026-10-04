import { useEffect, useRef } from 'react'
import { DOT_HOT, DOT_INK, fitCanvas, fontReady, prefersReducedMotion, sampleText, watchVisibility, type Hot } from './dotMatrix'

type Props = {
  /** Material Symbols ligature, e.g. "account_balance_wallet". */
  glyph: string
  /** Gold zones, in 0..1 coordinates of the drawing. */
  hot?: Hot[]
  /** Grid columns; more columns, finer drawing. */
  cols?: number
  /** Brighter dots and pulsing gold when the card holding it is active. */
  active?: boolean
  ink?: string
  className?: string
}

const ICON_FONT = '"Material Symbols Outlined"'

/**
 * A concept plotted as dots. Dots arrive in a diagonal wave the first time the
 * drawing is seen; afterwards the gold dots breathe. Still under reduced motion.
 */
export default function DotIcon({ glyph, hot = [], cols = 22, active = true, ink = DOT_INK, className = '' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let raf = 0
    let visible = false
    let cancelled = false
    let started = 0
    let dots: ReturnType<typeof sampleText>['dots'] = []
    let grid = cols
    const reduce = prefersReducedMotion()
    let level = activeRef.current ? 1 : 0
    let { w, h, ctx } = fitCanvas(canvas)
    const resize = () => {
      ;({ w, h, ctx } = fitCanvas(canvas))
    }

    const draw = (now: number) => {
      if (!ctx) return
      const side = Math.min(w, h)
      const ox = (w - side) / 2
      const oy = (h - side) / 2
      const step = side / grid
      const t = now / 1000
      const since = started ? (now - started) / 1000 : 99
      level += ((activeRef.current ? 1 : 0) - level) * 0.12
      ctx.clearRect(0, 0, w, h)
      for (const d of dots) {
        // Entrance: a diagonal wave over ~0.7s.
        const delay = (d.x + d.y) * 0.35
        const enter = reduce ? 1 : Math.min(1, Math.max(0, (since - delay) / 0.35))
        if (enter <= 0) continue
        const ease = 1 - (1 - enter) ** 3
        let r = step * 0.3 * (0.6 + 0.4 * ease)
        let alpha = ease * (0.55 + 0.45 * level)
        if (d.hot && !reduce) {
          const pulse = 0.5 + 0.5 * Math.sin(t * 2.4 + d.phase)
          r *= 1 + 0.25 * pulse * level
          alpha = ease * (0.7 + 0.3 * pulse)
        }
        ctx.globalAlpha = alpha
        ctx.fillStyle = d.hot ? DOT_HOT : ink
        ctx.beginPath()
        ctx.arc(ox + d.x * side, oy + d.y * side, r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    const loop = (now: number) => {
      draw(now)
      if (visible && !reduce) raf = requestAnimationFrame(loop)
    }

    void fontReady(`48px ${ICON_FONT}`, glyph).then(() => {
      if (cancelled) return
      const sampled = sampleText({ text: glyph, font: ICON_FONT, cols, hot })
      dots = sampled.dots
      grid = sampled.cols
      draw(performance.now())
    })

    const stop = watchVisibility(canvas, (v) => {
      visible = v
      cancelAnimationFrame(raf)
      if (v) {
        if (!started) started = performance.now()
        raf = requestAnimationFrame(loop)
      }
    })
    const ro = new ResizeObserver(() => {
      resize()
      draw(performance.now())
    })
    ro.observe(canvas)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stop()
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glyph, cols, ink])

  return <canvas ref={canvasRef} aria-hidden="true" className={`block h-full w-full ${className}`} />
}
