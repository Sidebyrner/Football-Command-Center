import './draft.css'

// Grade → design-token colour. The letter itself is always shown, so the
// colour only reinforces it: A is a start, B the accent, C a caution, D/F a sit.
const GRADE_TONE = {
  'A+': 'var(--start)', A: 'var(--start)',
  'B+': 'var(--accent)', B: 'var(--accent)',
  'C+': 'var(--caution)', C: 'var(--caution)',
  D: 'var(--sit)', F: 'var(--sit)',
}

/** A grade's colour as a CSS value (neutral when ungraded). */
export function gradeColor(grade) {
  return (grade && GRADE_TONE[grade]) || 'var(--text-3)'
}

/** A grade letter on a tinted pill. */
export function GradeBadge({ grade, label }) {
  const color = gradeColor(grade)
  return (
    <span
      className="dd-grade-badge"
      style={{ color, background: grade ? `color-mix(in srgb, ${color} 15%, transparent)` : 'var(--inset)' }}
    >
      {label ?? grade ?? '—'}
    </span>
  )
}

/**
 * One team's grade + lineup strength, shared between TeamGradesPanel (draft
 * mode) and TradeAnalyzer (season mode) so a grade means the same thing and
 * looks the same in both places.
 */
export default function TeamGradeRow({ team }) {
  const tooltip = team.grade
    ? `Value ${team.valueScore} · Construction ${team.constructionScore}` +
      (team.neededPositions.length ? ` · Needs: ${team.neededPositions.join(', ')}` : '')
    : 'No scoreable picks yet'

  return (
    <div className={`dd-grade-row t-meta${team.isMe ? ' me' : ''}`} title={tooltip}>
      <GradeBadge grade={team.grade} />
      <span className="name dd-truncate" style={{ color: 'var(--text)' }}>
        {team.name}{team.isMe ? ' (you)' : ''}
      </span>
      <span className="num">
        {team.lineupScore != null ? `${Math.round(team.lineupScore)} lineup` : 'unscored'}
      </span>
      <span className="num wide">
        {team.startersFilled}/{team.totalStarterSlots} starters
      </span>
    </div>
  )
}
