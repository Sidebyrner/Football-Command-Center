export const INJURY_STATUS = {
  Out: 'sit',
  IR: 'sit',
  PUP: 'sit',
  Doubtful: 'sit',
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

export function getStatusLabel(injuryStatus) {
  if (!injuryStatus) return 'Active'
  return injuryStatus
}

export function getPositionColor(position) {
  const map = {
    QB: '#60a5fa',
    RB: '#34d399',
    WR: '#a78bfa',
    TE: '#fb923c',
    K: '#f472b6',
    DEF: '#94a3b8',
  }
  return map[position] ?? '#94a3b8'
}

export function calcImpliedTotal(total, spread) {
  // Positive spread = underdog; implied = (total/2) - (spread/2)
  return (total / 2) - (spread / 2)
}
