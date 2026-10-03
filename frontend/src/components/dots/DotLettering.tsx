import { useEffect, useRef } from 'react'
import { DOT_HOT, fitCanvas, fontReady, prefersReducedMotion, sampleText, watchVisibility, type Dot } from './dotMatrix'

type Props = {
  text: string
  className?: string
}

const FONT = '"Space Grotesk", sans-serif'

/**
 * Giant halftone lettering behind the hero. Dots twinkle softly, a gold
 * "measured" zone drifts across the word, and dots near the pointer swell.
 * Decorative only (aria-hidden). Still under reduced motion.
 */
export default function DotLettering({ text, className = '' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const reduce = prefersReducedMotion()
    let raf = 0
    let visible = false
    let cancelled = false
    let dots: Dot[] = []
    let cols = 0
    let { w, h, ctx } = fitCanvas(canvas)
    const pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999 }

    const build = () => {
      ;({ w, h, ctx } = fitCanvas(canvas))
      // About one dot every 9px, capped so phones stay light.
      cols = Math.min(170, Math.max(60, Math.round(w / 9)))
      const sampled = sampleText({ text, font: FONT, weight: '700', cols, aspect: w / h, threshold: 0.45 })
      dots = sampled.dots
    }

    const draw = (now: number) => {
      if (!ctx || !cols) return
      const t = now / 1000
      const step = w / cols
      const hx = reduce ? 0.62 : 0.5 + 0.42 * Math.sin(t * 0.18)
      const hy = 0.5 + 0.18 * Math.sin(t * 0.31)
      pointer.x += (pointer.tx - pointer.x) * 0.12
      pointer.y += (pointer.ty - pointer.y) * 0.12
      ctx.clearRect(0, 0, w, h)
      for (const d of dots) {
        const px = d.x * w
        const py = d.y * h
        const dz = Math.hypot((d.x - hx) * (w / h), d.y - hy)
        const hot = dz < 0.16
        const near = Math.max(0, 1 - Math.hypot(px - pointer.x, py - pointer.y) / 110)
        const tw = reduce ? 0.8 : 0.6 + 0.4 * Math.sin(t * 1.3 + d.phase)
        const r = step * (0.22 + 0.16 * near + (hot ? 0.06 : 0))
        ctx.globalAlpha = hot ? 0.6 + 0.35 * tw : 0.2 + 0.12 * tw + near * 0.45
        ctx.fillStyle = hot ? DOT_HOT : near > 0.05 ? '#B9A6FF' : '#C9C5EA'
        ctx.beginPath()
        ctx.arc(px, py, r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    const loop = (now: number) => {
      draw(now)
      if (visible && !reduce) raf = requestAnimationFrame(loop)
    }

    void fontReady('700 64px "Space Grotesk"', text).then(() => {
      if (cancelled) return
      build()
      draw(performance.now())
    })

    const onPointer = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      pointer.tx = e.clientX - rect.left
      pointer.ty = e.clientY - rect.top
    }
    const onLeave = () => {
      pointer.tx = -9999
      pointer.ty = -9999
    }
    window.addEventListener('pointermove', onPointer, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    const stop = watchVisibility(canvas, (v) => {
      visible = v
      cancelAnimationFrame(raf)
      if (v) raf = requestAnimationFrame(loop)
    })
    const ro = new ResizeObserver(() => {
      build()
      draw(performance.now())
    })
    ro.observe(canvas)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stop()
      ro.disconnect()
      window.removeEventListener('pointermove', onPointer)
      document.removeEventListener('pointerleave', onLeave)
    }
  }, [text])

  return <canvas ref={canvasRef} aria-hidden="true" className={`pointer-events-none block h-full w-full ${className}`} />
}
