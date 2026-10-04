// Dot-matrix drawing: rasterize a glyph or a word on an offscreen canvas,
// sample it on a grid and keep one dot per lit cell. Concepts on AstroAm are
// plotted this way (see the astroam-design skill, section 2).

export type Dot = {
  /** Cell position, 0..1 across the drawing. */
  x: number
  y: number
  /** Gold dot: the measured or active part of the drawing. */
  hot: boolean
  /** Per-dot phase for twinkling and the entrance wave. */
  phase: number
}

export type Hot = { x: number; y: number; r: number }

export const DOT_INK = '#F3F1FF'
export const DOT_HOT = '#FDDA24'

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Waits for a font so the canvas does not rasterize the fallback face. */
export async function fontReady(font: string, text: string): Promise<void> {
  try {
    await document.fonts.load(font, text)
  } catch {
    // Draw with whatever face is there.
  }
}

/**
 * Samples `text` drawn with `font` (CSS shorthand without size) on a grid of
 * `cols` columns. Rows follow the text's aspect. Cells inside `hot` (in 0..1
 * coordinates of the drawing) become gold.
 */
export function sampleText(opts: {
  text: string
  /** Font family list, e.g. '"Space Grotesk", sans-serif'. */
  font: string
  /** CSS font-weight, e.g. "700". */
  weight?: string
  cols: number
  rows?: number
  hot?: Hot[]
  threshold?: number
  /** Width / height of the drawing box; 1 for icons. */
  aspect?: number
}): { dots: Dot[]; cols: number; rows: number } {
  const { text, font, cols, hot = [], threshold = 0.38, weight = '' } = opts
  const aspect = opts.aspect ?? 1
  const rows = opts.rows ?? Math.max(1, Math.round(cols / aspect))
  const cell = 8
  const w = cols * cell
  const h = rows * cell
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d', { willReadFrequently: true })
  if (!g) return { dots: [], cols, rows }
  g.fillStyle = '#000'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  // Fit the text to the box.
  let size = h * 0.92
  g.font = `${weight} ${size}px ${font}`
  const measured = g.measureText(text).width
  if (measured > w * 0.96) {
    size *= (w * 0.96) / measured
    g.font = `${weight} ${size}px ${font}`
  }
  g.fillText(text, w / 2, h / 2 + size * 0.04)
  const data = g.getImageData(0, 0, w, h).data

  const dots: Dot[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0
      for (let yy = 0; yy < cell; yy += 2) {
        for (let xx = 0; xx < cell; xx += 2) {
          sum += data[((r * cell + yy) * w + c * cell + xx) * 4 + 3]
        }
      }
      const coverage = sum / (16 * 255)
      if (coverage < threshold) continue
      const x = (c + 0.5) / cols
      const y = (r + 0.5) / rows
      const isHot = hot.some((z) => (x - z.x) ** 2 + (y - z.y) ** 2 <= z.r ** 2)
      dots.push({ x, y, hot: isHot, phase: Math.random() * Math.PI * 2 })
    }
  }
  return { dots, cols, rows }
}

/** Sizes a canvas to its CSS box at the device pixel ratio (max 2). */
export function fitCanvas(canvas: HTMLCanvasElement): { w: number; h: number; ctx: CanvasRenderingContext2D | null } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  // Layout size, not getBoundingClientRect: cards on a 3D reel are transformed.
  const w = Math.max(1, canvas.clientWidth)
  const h = Math.max(1, canvas.clientHeight)
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  const ctx = canvas.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { w, h, ctx }
}

/** Runs `onVisible(true|false)` as the element enters and leaves the viewport. */
export function watchVisibility(el: Element, onVisible: (visible: boolean) => void): () => void {
  const io = new IntersectionObserver(([entry]) => onVisible(entry.isIntersecting), { rootMargin: '80px' })
  io.observe(el)
  return () => io.disconnect()
}
