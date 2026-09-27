// Every tag seen on Sleeper's live player index (checked week 1, 2026): Out, IR,
// PUP, Questionable, Sus, DNR, COV, NA, and an occasional empty string. The
// first three unlisted ones used to fall through to 'caution', so a suspended
// starter read as a game-time decision. NA is Sleeper's own "not available"
// label with no stated reason; it stays a caution because it isn't a ruling.
export const INJURY_STATUS = {
  Out: 'sit',
  IR: 'sit',
  PUP: 'sit',
  Doubtful: 'sit',
  Sus: 'sit',
  DNR: 'sit',
  COV: 'sit',
  NA: 'caution',
  Questionable: 'caution',
  Probable: 'start',
  Healthy: 'start',
  null: 'start',
  undefined: 'start',
}

export function getStatusColor(injuryStatus) {
  const key = INJURY_STATUS[injuryStatus] ?? 'start'
  if (key === 'sit') return 'var(--color-sit)'
  if (key === 'caution') return 'var(--color-caution)'
  return 'var(--color-start)'
}

const STATUS_LABELS = { Sus: 'Suspended', DNR: 'Did not report', COV: 'COVID list', NA: 'Not available' }

export function getStatusLabel(injuryStatus) {
  if (!injuryStatus) return 'Active'
  return STATUS_LABELS[injuryStatus] ?? injuryStatus
}

export function getPositionColor(position) {
  const map = {
    QB: '#60a5fa',
    RB: '#34d399',
    WR: '#a78bfa',
    TE: '#fb923c',
    K: '#f472b6',
    DEF: '#94a3b8',
    // IDP — never shown on the main board (useDraftPlayers filters them out),
    // but Team Grades/Trade Analyzer resolve real IDP picks via Sleeper's raw
    // player index, so they need distinct colors too.
    LB: '#38bdf8',
    DL: '#f87171',
    DB: '#facc15',
  }
  return map[position] ?? '#94a3b8'
}

export function calcImpliedTotal(total, spread) {
  // Positive spread = underdog; implied = (total/2) - (spread/2)
  return (total / 2) - (spread / 2)
}
