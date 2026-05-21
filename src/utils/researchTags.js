export const TAGS = [
  { value: 'injury',       label: 'Injury',       color: '#f43f5e', bg: 'rgba(244,63,94,0.12)' },
  { value: 'depth-chart',  label: 'Depth Chart',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  { value: 'role-change',  label: 'Role Change',  color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  { value: 'camp-buzz',    label: 'Camp Buzz',    color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  { value: 'suspension',   label: 'Suspension',   color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
  { value: 'contract',     label: 'Contract',     color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  { value: 'coaching',     label: 'Coaching',     color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
  { value: 'rookie',       label: 'Rookie',       color: '#2dd4bf', bg: 'rgba(45,212,191,0.12)' },
  { value: 'offense',      label: 'Offense',      color: '#38bdf8', bg: 'rgba(56,189,248,0.12)' },
  { value: 'general',      label: 'General',      color: '#71717a', bg: 'rgba(113,113,122,0.12)' },
]

export const TAG_MAP = Object.fromEntries(TAGS.map((t) => [t.value, t]))

export function getTag(value) {
  return TAG_MAP[value] ?? { value, label: value, color: '#71717a', bg: 'rgba(113,113,122,0.12)' }
}
