import type { Destination } from '../types/mission'

// Rates: Citrus Mobile's public pay-as-you-go rate per GB × 1.35, as USDC
// per decimal MB (citrusmobile.com/rates, checked 2026-09-23).
export const DESTINATIONS: Destination[] = [
  { id: 'brazil', name: 'Brazil', flag: '🇧🇷', network: 'Vivo / TIM / Claro', coverage: '5G / 4G LTE', pricePerMbUsdc: 0.0025 },
  { id: 'mexico', name: 'Mexico', flag: '🇲🇽', network: 'Telcel / AT&T', coverage: '5G / 4G LTE', pricePerMbUsdc: 0.0027 },
  { id: 'argentina', name: 'Argentina', flag: '🇦🇷', network: 'Movistar / Personal', coverage: '4G LTE', pricePerMbUsdc: 0.0026 },
  { id: 'usa', name: 'United States', flag: '🇺🇸', network: 'T-Mobile / AT&T', coverage: '5G / 4G LTE', pricePerMbUsdc: 0.0013 },
  { id: 'spain', name: 'Spain', flag: '🇪🇸', network: 'Movistar / Orange', coverage: '5G / 4G LTE', pricePerMbUsdc: 0.0008 },
  { id: 'japan', name: 'Japan', flag: '🇯🇵', network: 'Docomo / SoftBank', coverage: '5G / 4G LTE', pricePerMbUsdc: 0.0021 },
]

export const ORIGIN = { id: 'home', name: 'Home', flag: '🏠' }

export const DEMO_NETWORK = 'demo:local'

/** MB used by each tap of "Simulate usage" in the demo: at 0.0025 USDC/MB
 * that is 0.625 USDC, so 5 USDC in Brazil runs out in 8 taps. */
export const DEMO_TRAFFIC_MB = 250

/** How many MB a given USDC budget buys at the destination's price */
export function estimateMb(budgetUsdc: number, pricePerMbUsdc?: number): number {
  if (!pricePerMbUsdc || pricePerMbUsdc <= 0) return 0
  return Math.floor(budgetUsdc / pricePerMbUsdc)
}

/** Format a USDC amount for display */
export function fmtUsdc(amount: number, decimals = 4): string {
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** Format MB for display (1 GB = 1000 MB decimal) */
export function fmtMb(mb: number): string {
  if (mb <= 0) return '0 MB'
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`
  return `${mb.toFixed(0)} MB`
}

/** Format MiB/GiB binary units */
export function fmtMib(mib: number): string {
  if (mib <= 0) return '0 MiB'
  if (mib >= 1024) return `${(mib / 1024).toFixed(2)} GiB`
  return `${mib.toFixed(1)} MiB`
}

/** Short tx hash for display */
export function shortTx(hash: string): string {
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`
}

/** Random hex string */
export function randomHex(len = 64): string {
  return Array.from({ length: len }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join('')
}

/** ISO date string (YYYY-MM-DD) for today */
export function today(): string {
  return new Date().toISOString().split('T')[0]
}

/** Add N days to an ISO date string */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

/** Count days between two ISO date strings (inclusive) */
export function daysBetween(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  return Math.max(1, Math.round(ms / 86_400_000) + 1)
}

/** Format date for display */
export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/** Format timestamp HH:MM */
export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })
}
