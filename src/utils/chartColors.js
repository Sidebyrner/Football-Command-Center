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
