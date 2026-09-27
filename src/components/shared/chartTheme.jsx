/**
 * Recharts styling from the design tokens, so charts read in light and dark
 * mode. Local to the web-only tools — utils/chartColors.js keeps its dark hex
 * twins for anything still using them.
 */
import '../../screens/tools/researchTools.css'

export const AXIS_TICK = { fill: 'var(--text-2)', fontSize: 11 }
export const GRID_STROKE = 'var(--stroke)'
export const CURSOR_FILL = { fill: 'var(--inset)' }
export const HIGHLIGHT = 'var(--accent)'
export const NEUTRAL = 'var(--text-3)'
export const FAINT = 'var(--text-3)'

/** A grade's colour — same families as TeamGradeRow (A green, B indigo, C amber, D/F red). */
export const GRADE_TOKEN = {
  'A+': 'var(--start)', A: 'var(--start)',
  'B+': 'var(--accent)', B: 'var(--accent)',
  'C+': 'var(--caution)', C: 'var(--caution)',
  D: 'var(--sit)', F: 'var(--sit)',
}
export const gradeColor = (grade) => (grade ? GRADE_TOKEN[grade] ?? 'var(--text-3)' : 'var(--text-3)')

/**
 * Diverging matchup heat, t in [-1, 1]: negative = tough (green), positive =
 * soft (red), zero = the card surface. Mixed from tokens so it sits on either
 * theme; the value is always printed too, so colour never carries it alone.
 */
export function heatFill(t) {
  if (t == null || Number.isNaN(t)) return 'var(--inset)'
  const c = Math.max(-1, Math.min(1, t))
  const pct = Math.round(Math.abs(c) * 55)
  return `color-mix(in srgb, ${c < 0 ? 'var(--start)' : 'var(--sit)'} ${pct}%, var(--card))`
}

/** The same scale for bars, which need to stay visible at "average": grey there, full colour at the ends. */
export function heatBarFill(t) {
  if (t == null || Number.isNaN(t)) return NEUTRAL
  const c = Math.max(-1, Math.min(1, t))
  const pct = Math.round(Math.abs(c) * 100)
  return `color-mix(in srgb, ${c < 0 ? 'var(--start)' : 'var(--sit)'} ${pct}%, var(--text-3))`
}

/** The box a chart's custom tooltip draws in. */
export function ChartTooltipBox({ children }) {
  return <div className="rt-tooltip">{children}</div>
}
