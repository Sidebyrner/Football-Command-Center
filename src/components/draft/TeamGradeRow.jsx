import { GRADE_COLOR } from '../../utils/teamGrades'

/**
 * One team's grade + lineup strength, shared between TeamGradesPanel (draft
 * mode) and TradeAnalyzer (season mode) so a grade means the same thing and
 * looks the same in both places.
 */
export default function TeamGradeRow({ team }) {
  const color = team.grade ? GRADE_COLOR[team.grade] : 'var(--color-text-faint)'
  const tooltip = team.grade
    ? `Value ${team.valueScore} · Construction ${team.constructionScore}` +
      (team.neededPositions.length ? ` · Needs: ${team.neededPositions.join(', ')}` : '')
    : 'No scoreable picks yet'

  return (
    <div
      className={`flex items-center gap-2 text-xs py-1 px-2 rounded ${team.isMe ? 'bg-[var(--color-surface-2)]' : ''}`}
      title={tooltip}
    >
      <span
        className="w-8 text-center text-[10px] font-bold px-1 py-0.5 rounded flex-shrink-0"
        style={{ color, backgroundColor: team.grade ? `${color}20` : 'transparent' }}
      >
        {team.grade ?? '—'}
      </span>
      <span className="truncate flex-1 text-[var(--color-text)]">
        {team.name}{team.isMe ? ' (you)' : ''}
      </span>
      <span className="text-[var(--color-text-faint)] tabular-nums flex-shrink-0">
        {team.lineupScore != null ? `${Math.round(team.lineupScore)} lineup` : 'unscored'}
      </span>
      <span className="text-[var(--color-text-faint)] tabular-nums flex-shrink-0 w-16 text-right">
        {team.startersFilled}/{team.totalStarterSlots} starters
      </span>
    </div>
  )
}
