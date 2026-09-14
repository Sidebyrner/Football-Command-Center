import { useMemo } from 'react'
import { AlertTriangle, CalendarX, Lock, ExternalLink } from 'lucide-react'
import { getStatusColor } from '../../utils/playerHelpers'
import { buildLineupAlerts } from '../../utils/lineupAlerts'
import { byeWeeksFromSchedule } from '../../utils/byeWeeks'
import { kickoffCalendar } from '../../utils/gameClock'
import { sleeperTeamUrl } from '../../utils/sleeperLinks'
import { useSchedule } from '../../hooks/useSchedule'
import { useNow } from '../../hooks/useNow'
import useAppStore from '../../store/useAppStore'

/**
 * "Can I still fix something before kickoff" — the first thing on the page.
 *
 * Starters on bye come first (a guaranteed zero), then unset slots, then injury
 * tags. Byes are derived from the schedule, so IDP players are covered — the
 * ADP-matched `bye` field this used to read never reached them. Starters whose
 * game has already kicked off are left out: Sleeper won't let you move them, so
 * an alert about them is noise. Logic lives in utils/lineupAlerts.js.
 */
export default function LineupAlerts({ myTeam, playersById, currentWeek }) {
  const season = useAppStore((s) => s.season)
  const leagueId = useAppStore((s) => s.leagueId)
  const { file: scheduleFile } = useSchedule(season, currentWeek)
  const now = useNow(30_000)

  const kickoffs = useMemo(() => (scheduleFile ? kickoffCalendar(scheduleFile) : null), [scheduleFile])
  const byeTeams = useMemo(
    () => new Set(scheduleFile ? byeWeeksFromSchedule(scheduleFile).byWeek[currentWeek] ?? [] : []),
    [scheduleFile, currentWeek]
  )

  if (!myTeam) return null

  const { onBye, emptySlots, injured, locked, nextLock } = buildLineupAlerts({
    starterIds: myTeam.starterIds ?? [],
    playersById,
    byeTeams,
    kickoffs,
    week: Number(currentWeek),
    now,
  })

  const nothingToFix = onBye.length === 0 && injured.length === 0 && emptySlots === 0
  if (nothingToFix && !nextLock) return null

  const sleeperUrl = sleeperTeamUrl(leagueId)
  const lockLabel = nextLock?.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })

  return (
    <div className="flex-shrink-0 border-b border-[var(--color-border)] bg-[var(--color-caution)]/5 px-6 py-3 space-y-1.5">
      {onBye.map((p) => (
        <div key={`bye-${p.id}`} className="flex items-center gap-2 text-xs">
          <CalendarX size={13} className="flex-shrink-0 text-[var(--color-sit)]" />
          <span className="text-[var(--color-text)] font-medium">{p.name}</span>
          <span className="text-[var(--color-sit)]">on bye this week — starting them scores 0</span>
        </div>
      ))}

      {emptySlots > 0 && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-caution)]">
          <AlertTriangle size={13} className="flex-shrink-0" />
          <span>
            {emptySlots} starter slot{emptySlots > 1 ? 's' : ''} not set yet on Sleeper.
          </span>
        </div>
      )}

      {injured.map((p) => (
        <div key={`inj-${p.id}`} className="flex items-center gap-2 text-xs">
          <AlertTriangle size={13} className="flex-shrink-0" style={{ color: getStatusColor(p.status) }} />
          <span className="text-[var(--color-text)] font-medium">{p.name}</span>
          <span style={{ color: getStatusColor(p.status) }}>{p.status}</span>
        </div>
      ))}

      <div className="flex items-center gap-3 text-[11px] text-[var(--color-text-muted)] pt-0.5 flex-wrap">
        {nothingToFix && <span className="text-[var(--color-start)]">Lineup looks clean.</span>}
        {nextLock && (
          <span className="flex items-center gap-1">
            <Lock size={11} /> Next lineup lock {lockLabel}
            {locked > 0 && <> · {locked} starter{locked === 1 ? ' has' : 's have'} kicked off</>}
          </span>
        )}
        {!nothingToFix && sleeperUrl && (
          <a href={sleeperUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 underline hover:text-[var(--color-text)]">
            Open in Sleeper <ExternalLink size={11} />
          </a>
        )}
      </div>
    </div>
  )
}
