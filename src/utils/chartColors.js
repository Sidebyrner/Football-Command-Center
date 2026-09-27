// Hardcoded hex twins of index.css's theme CSS variables, for recharts only.
//
// Recharts renders bars/points/lines via raw SVG fill/stroke presentation
// attributes in several code paths, which don't reliably resolve
// var(--color-*) custom-property strings the way style={{color}} does on an
// HTML element (that's how teamGrades.js's GRADE_COLOR — var(--color-start)
// etc. — safely works in TeamGradeRow today). Charts need real hex.
//
// Keep these in sync by hand with index.css if the theme ever changes:
//   --color-start:#10b981  --color-caution:#f59e0b  --color-sit:#f43f5e
//   --color-accent:#f59e0b  --color-text-faint:#475569

export const GRADE_COLOR_HEX = {
  'A+': '#10b981', A: '#10b981',
  'B+': '#818cf8', B: '#818cf8',
  'C+': '#f59e0b', C: '#f59e0b',
  D: '#f43f5e', F: '#f43f5e',
}

export const ACCENT_HEX = '#f59e0b'
export const NEUTRAL_HEX = '#475569'

// Axis/grid styling shared by every chart — --color-border is an rgba()
// value already (not a var() reference resolution issue), safe as a literal
// string; text-muted/text-faint are plain hex, included here just so every
// chart's axis styling comes from one place instead of being retyped.
export const BORDER_RGBA = 'rgba(248, 250, 252, 0.08)'
export const TEXT_MUTED_HEX = '#94a3b8'
export const TEXT_FAINT_HEX = '#475569'

/**
 * Diverging scale for matchup heat. t is a normalized deviation in [-1, 1]:
 * negative = a defense that gives up LESS than average (tough matchup, green),
 * positive = gives up MORE (soft matchup, rose). Zero is a neutral slate so the
 * eye only catches genuine outliers.
 *
 * Shared by the DvP heatmap and any future chart so one scale means one thing
 * everywhere. Returns an rgb() string — safe for both SVG attributes and CSS.
 */
export function heatColor(t) {
  if (t == null || isNaN(t)) return 'rgba(71, 85, 105, 0.25)'
  const c = Math.max(-1, Math.min(1, t))
  // Endpoints match --color-start (#10b981) and --color-sit (#f43f5e); the
  // midpoint is the app's surface-2 slate rather than white, so cells sit in
  // the dark theme instead of glowing out of it.
  const mid = [30, 41, 59]
  const tough = [16, 185, 129]
  const soft = [244, 63, 94]
  const end = c < 0 ? tough : soft
  const k = Math.abs(c)
  const ch = (i) => Math.round(mid[i] + (end[i] - mid[i]) * k)
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`
}
