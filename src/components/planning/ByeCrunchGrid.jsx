import { getPositionColor } from '../../utils/playerHelpers'

function shortfallCell(entry, onPick, week, selected) {
  const short = entry?.totalShortfall ?? 0
  const clickable = short > 0 && onPick
  const base = 'w-full text-center tabular-nums py-1 rounded text-[11px] '
  const tone = short === 0
    ? 'text-[var(--color-text-faint)]'
    : short === 1
      ? 'text-[var(--color-caution)] bg-[var(--color-caution)]/10 font-semibold'
      : 'text-[var(--color-sit)] bg-[var(--color-sit)]/10 font-semibold'
  const ring = selected ? ' ring-1 ring-[var(--color-accent)]' : ''

  const body = short === 0 ? '·' : `−${short}`
  if (!clickable) return <span className={base + tone + ring}>{body}</span>
  return (
    <button onClick={() => onPick(week)} className={base + tone + ring + ' hover:brightness-125'} title="Filter targets to players who help this week">
      {body}
    </button>
  )
}

/**
 * Upcoming bye damage, per week, for the whole league.
 *
 * A cell is the number of starting slots that team cannot fill that week from
 * players who are actually playing — computed against the league's real slot
 * template, flex included, not eyeballed from a bye count. Your row is broken
 * out above the rest so the comparison that matters is immediate: a week where
 * you are short and a rival isn't is a week they have leverage, and vice versa.
 */
export default function ByeCrunchGrid({ weeks, teams, myOutlook, selectedWeek, onPickWeek, loading, error }) {
  if (loading) return <p className="text-sm text-[var(--color-text-muted)]">Loading schedule…</p>
  if (error) return <p className="text-sm text-[var(--color-sit)]">Failed to load: {error}</p>
  if (!weeks.length) return <p className="text-sm text-[var(--color-text-muted)]">No bye weeks left this season.</p>

  const others = teams.filter((t) => !t.isMe)

  return (
    <div className="space-y-3">
      <div className="border border-[var(--color-border)] rounded bg-[var(--color-surface)] overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[9px] uppercase tracking-wide text-[var(--color-text-faint)] border-b border-[var(--color-border)]">
              <th className="text-left font-medium py-1.5 pl-3 pr-2 sticky left-0 bg-[var(--color-surface)]">Team</th>
              {weeks.map((w) => (
                <th key={w} className="font-medium py-1.5 px-1 text-center min-w-[38px]">wk {w}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {myOutlook && (
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                <td className="py-1 pl-3 pr-2 font-semibold text-[var(--color-text)] whitespace-nowrap sticky left-0 bg-[var(--color-surface-2)]">
                  {myOutlook.name} <span className="text-[var(--color-text-faint)] font-normal">(you)</span>
                </td>
                {weeks.map((w) => (
                  <td key={w} className="px-1 py-1">
                    {shortfallCell(myOutlook.byWeek[w], onPickWeek, w, selectedWeek === w)}
                  </td>
                ))}
              </tr>
            )}
            {others.map((t) => (
              <tr key={t.id} className="border-b border-[var(--color-border)] last:border-0">
                <td className="py-1 pl-3 pr-2 text-[var(--color-text-muted)] whitespace-nowrap truncate max-w-[140px] sticky left-0 bg-[var(--color-surface)]">
                  {t.name}
                </td>
                {weeks.map((w) => (
                  <td key={w} className="px-1 py-1">{shortfallCell(t.byWeek[w])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-[var(--color-text-faint)] leading-relaxed">
        Each cell counts starting slots that can't be filled that week from players who are actually
        playing — measured against your league's real slot template, flex included. A dot means the
        lineup still fills. Click one of your shortfalls to filter the targets below to players who
        are available that week.
      </p>

      {myOutlook && <MyBreakdown weeks={weeks} myOutlook={myOutlook} />}
    </div>
  )
}

function MyBreakdown({ weeks, myOutlook }) {
  const problems = weeks
    .map((week) => ({ week, ...myOutlook.byWeek[week] }))
    .filter((w) => w.totalShortfall > 0)

  if (!problems.length) {
    return (
      <p className="text-xs text-[var(--color-start)]">
        You can field a full lineup in every remaining bye week.
      </p>
    )
  }

  return (
    <div className="space-y-1.5">
      {problems.map((w) => {
        const short = Object.entries(w.byPosition).filter(([, v]) => v.shortfall > 0)
        return (
          <div key={w.week} className="text-xs">
            <span className="font-semibold text-[var(--color-text)]">Week {w.week}</span>{' '}
            <span className="text-[var(--color-text-muted)]">
              {short.map(([pos, v], i) => (
                <span key={pos}>
                  {i > 0 && ', '}
                  <span style={{ color: getPositionColor(pos) }} className="font-semibold">{pos}</span>
                  {' '}{v.available}/{v.required}
                </span>
              ))}
              {w.flex.shortfall > 0 && (
                <span>{short.length > 0 && ', '}FLEX {w.flex.available}/{w.flex.required}</span>
              )}
              {' · '}
              {w.onBye.length} rostered player{w.onBye.length === 1 ? '' : 's'} on bye
            </span>
          </div>
        )
      })}
    </div>
  )
}
