/**
 * Local ports of the Swift formatting helpers the Board and My Team use —
 * `StreamFormat` (StreamScreenView.swift), `PanelFormat` (PanelBody.swift),
 * `Palette.delta` and the views' private `ordinal`.
 */
import { useEffect, useState } from 'react'
import { formatNumber } from '@core/numeric'

/** `StreamFormat.one` — one decimal, grouped. */
export const one = (x: number) => formatNumber(x, 1)

/** `StreamFormat.shortName` — last name, without a generational suffix. */
export function shortName(name: string): string {
  const parts = name.split(' ').filter((p) => p !== '' && !['Jr.', 'Sr.', 'II', 'III', 'IV'].includes(p))
  return parts[parts.length - 1] ?? name
}

/** `PanelFormat.points`. */
export const panelPoints = (value: number | undefined) => (value === undefined ? '—' : formatNumber(value, 1))

/** `PanelFormat.signed` — "+" on zero too. */
export const panelSigned = (value: number) => (value >= 0 ? '+' : '') + formatNumber(value, 1)

/** `Palette.delta` as a CSS colour. */
export function deltaColor(value: number | undefined): string {
  if (value === undefined) return 'var(--text-2)'
  if (value > 0.05) return 'var(--start)'
  if (value < -0.05) return 'var(--sit)'
  return 'var(--text-2)'
}

/** "1st", "2nd", "11th". */
export function ordinal(n: number): string {
  const mod100 = n % 100
  const mod10 = n % 10
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : mod10 === 1 ? 'st' : mod10 === 2 ? 'nd' : mod10 === 3 ? 'rd' : 'th'
  return `${n}${suffix}`
}

/** Swift's `TimelineView(.periodic(by:))`: re-render every `ms` while mounted. */
export function useTick(ms: number): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms)
    return () => clearInterval(id)
  }, [ms])
  return tick
}
