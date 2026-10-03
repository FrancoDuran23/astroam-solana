import { useEffect, useRef } from 'react'

// Moving space background: three parallax layers of twinkling stars, a few
// bright stars with a halo and a four-point sparkle, a band of cosmic dust
// drifting across the sky and the odd shooting star. Canvas 2D, so it runs
// everywhere; a still frame when the user prefers reduced motion.

type Star = {
  x: number
  y: number
  r: number
  depth: number // 0.2 (far) … 1 (near): drift speed and parallax
  color: string
  twinkle: number // phase
  speed: number // twinkle speed
  bright: boolean
}

type Dust = { x: number; y: number; r: number; a: number; color: string; drift: number }

type Shooting = { x: number; y: number; vx: number; vy: number; life: number; max: number }

const STAR_COLORS = ['#FFFFFF', '#F3F1FF', '#D9D2FF', '#BFE9FF', '#FFF4C7']
const BRIGHT_COLORS = ['#B9A6FF', '#7FE7F2', '#FDDA24', '#FFFFFF']
const DUST_COLORS = ['139,108,255', '41,197,211', '255,180,240']

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]
}

/** Soft round glow, drawn once and stamped with drawImage. */
function glowSprite(color: string): HTMLCanvasElement {
  const size = 64
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, color)
  grad.addColorStop(0.18, color + 'AA')
  grad.addColorStop(0.45, color + '22')
  grad.addColorStop(1, color + '00')
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  return c
}

export default function StarfieldBackground({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const sprites = new Map<string, HTMLCanvasElement>()
    const sprite = (color: string) => {
      let s = sprites.get(color)
      if (!s) sprites.set(color, (s = glowSprite(color)))
      return s
    }

    let w = 0
    let h = 0
    let stars: Star[] = []
    let dust: Dust[] = []
    const shooting: Shooting[] = []
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
    let scrollY = window.scrollY

    function build() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = window.innerWidth
      h = window.innerHeight
      canvas!.width = Math.floor(w * dpr)
      canvas!.height = Math.floor(h * dpr)
      canvas!.style.width = `${w}px`
      canvas!.style.height = `${h}px`
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)

      const area = w * h
      const count = Math.min(520, Math.floor(area / 3200))
      stars = Array.from({ length: count }, () => {
        const depth = pick([0.25, 0.25, 0.25, 0.5, 0.5, 1])
        const bright = Math.random() < 0.035
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          r: bright ? rand(1.4, 2.4) : rand(0.35, 1.1) * (0.6 + depth * 0.6),
          depth,
          color: bright ? pick(BRIGHT_COLORS) : pick(STAR_COLORS),
          twinkle: Math.random() * Math.PI * 2,
          speed: rand(0.6, 2.2),
          bright,
        }
      })

      // Cosmic dust: a diagonal band (the "trail") across the sky.
      const band = Math.min(160, Math.floor(area / 9000))
      dust = Array.from({ length: band }, () => {
        const t = Math.random()
        const spread = (Math.random() + Math.random() + Math.random() - 1.5) * h * 0.22
        return {
          x: t * w * 1.3 - w * 0.15,
          y: h * 0.85 - t * h * 0.7 + spread,
          r: rand(30, 120),
          a: rand(0.015, 0.05),
          color: pick(DUST_COLORS),
          drift: rand(0.02, 0.08),
        }
      })
    }

    function drawSparkle(x: number, y: number, size: number, color: string, alpha: number) {
      ctx!.save()
      ctx!.globalAlpha = alpha
      ctx!.strokeStyle = color
      ctx!.lineWidth = 0.9
      ctx!.beginPath()
      ctx!.moveTo(x - size, y)
      ctx!.lineTo(x + size, y)
      ctx!.moveTo(x, y - size)
      ctx!.lineTo(x, y + size)
      ctx!.stroke()
      ctx!.restore()
    }

    let last = performance.now()
    let raf = 0
    let nextShooting = performance.now() + rand(1500, 4000)

    function frame(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const t = now / 1000

      pointer.x += (pointer.tx - pointer.x) * 0.04
      pointer.y += (pointer.ty - pointer.y) * 0.04
      const scroll = window.scrollY
      const scrollDelta = scroll - scrollY
      scrollY = scroll

      ctx!.clearRect(0, 0, w, h)

      // Dust band
      ctx!.globalCompositeOperation = 'lighter'
      for (const d of dust) {
        if (!reduceMotion) {
          d.x += d.drift * 12 * dt
          if (d.x - d.r > w * 1.15) d.x = -d.r - w * 0.1
        }
        const g = ctx!.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r)
        g.addColorStop(0, `rgba(${d.color},${d.a})`)
        g.addColorStop(1, `rgba(${d.color},0)`)
        ctx!.fillStyle = g
        ctx!.fillRect(d.x - d.r, d.y - d.r, d.r * 2, d.r * 2)
      }

      // Stars
      for (const s of stars) {
        if (!reduceMotion) {
          s.x += s.depth * 6 * dt
          s.y -= s.depth * 2.5 * dt + scrollDelta * s.depth * 0.08
          if (s.x > w + 4) s.x = -4
          if (s.y < -4) s.y = h + 4
          if (s.y > h + 4) s.y = -4
        }
        const px = s.x + pointer.x * s.depth * 14
        const py = s.y + pointer.y * s.depth * 10
        const tw = reduceMotion ? 0.8 : 0.55 + 0.45 * Math.sin(t * s.speed + s.twinkle)

        if (s.bright) {
          const halo = s.r * (7 + tw * 4)
          ctx!.globalAlpha = 0.55 + tw * 0.45
          ctx!.drawImage(sprite(s.color), px - halo, py - halo, halo * 2, halo * 2)
          drawSparkle(px, py, s.r * (3 + tw * 3), s.color, 0.35 + tw * 0.5)
          ctx!.globalAlpha = 1
          ctx!.fillStyle = '#FFFFFF'
          ctx!.beginPath()
          ctx!.arc(px, py, s.r * 0.7, 0, Math.PI * 2)
          ctx!.fill()
        } else {
          ctx!.globalAlpha = tw * (0.45 + s.depth * 0.55)
          ctx!.fillStyle = s.color
          ctx!.beginPath()
          ctx!.arc(px, py, s.r, 0, Math.PI * 2)
          ctx!.fill()
          if (s.depth === 1) {
            const halo = s.r * 5
            ctx!.globalAlpha = tw * 0.35
            ctx!.drawImage(sprite(s.color), px - halo, py - halo, halo * 2, halo * 2)
          }
        }
      }
      ctx!.globalAlpha = 1

      // Shooting stars
      if (!reduceMotion && now > nextShooting) {
        nextShooting = now + rand(2500, 6500)
        const angle = rand(0.35, 0.6)
        const speed = rand(700, 1100)
        shooting.push({
          x: rand(w * 0.1, w * 0.9),
          y: rand(-20, h * 0.35),
          vx: Math.cos(angle) * speed * (Math.random() < 0.5 ? -1 : 1),
          vy: Math.sin(angle) * speed,
          life: 0,
          max: rand(0.6, 1.1),
        })
      }
      for (let i = shooting.length - 1; i >= 0; i--) {
        const m = shooting[i]
        m.life += dt
        m.x += m.vx * dt
        m.y += m.vy * dt
        const fade = 1 - m.life / m.max
        if (fade <= 0) {
          shooting.splice(i, 1)
          continue
        }
        const tail = 0.12
        const grad = ctx!.createLinearGradient(m.x, m.y, m.x - m.vx * tail, m.y - m.vy * tail)
        grad.addColorStop(0, `rgba(255,255,255,${0.9 * fade})`)
        grad.addColorStop(0.3, `rgba(185,166,255,${0.45 * fade})`)
        grad.addColorStop(1, 'rgba(127,231,242,0)')
        ctx!.strokeStyle = grad
        ctx!.lineWidth = 1.6
        ctx!.lineCap = 'round'
        ctx!.beginPath()
        ctx!.moveTo(m.x, m.y)
        ctx!.lineTo(m.x - m.vx * tail, m.y - m.vy * tail)
        ctx!.stroke()
        ctx!.globalAlpha = fade
        ctx!.drawImage(sprite('#FFFFFF'), m.x - 10, m.y - 10, 20, 20)
        ctx!.globalAlpha = 1
      }
      ctx!.globalCompositeOperation = 'source-over'

      if (!reduceMotion) raf = requestAnimationFrame(frame)
    }

    function onResize() {
      build()
      if (reduceMotion) frame(performance.now())
    }
    function onPointer(e: PointerEvent) {
      pointer.tx = (e.clientX / w - 0.5) * 2
      pointer.ty = (e.clientY / h - 0.5) * 2
    }
    function onVisibility() {
      cancelAnimationFrame(raf)
      if (!document.hidden && !reduceMotion) {
        last = performance.now()
        raf = requestAnimationFrame(frame)
      }
    }

    build()
    if (reduceMotion) frame(performance.now())
    else raf = requestAnimationFrame(frame)
    window.addEventListener('resize', onResize)
    window.addEventListener('pointermove', onPointer, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onPointer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return (
    <div aria-hidden="true" className={`pointer-events-none fixed inset-0 z-0 overflow-hidden ${className}`}>
      {/* Deep space gradient + nebula glows under the stars */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_10%,rgba(105,65,255,0.22),transparent_55%),radial-gradient(ellipse_at_85%_75%,rgba(41,197,211,0.14),transparent_55%),radial-gradient(ellipse_at_50%_120%,rgba(253,218,36,0.06),transparent_60%)]" />
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  )
}
