import { useMemo } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { expectedScoreAtPick } from '../../utils/teamGrades'
import { getPositionColor } from '../../utils/playerHelpers'
import { useDraftPicks } from '../../hooks/useDraftPicks'
import { useSeasonMatchupHistory } from '../../hooks/useSeasonMatchupHistory'
import useAppStore from '../../store/useAppStore'

const MAX_SHOWN = 5

function PickRow({ r }) {
  const positive = r.surplus >= 0
  return (
    <li className="flex items-center justify-between text-xs">
      <span className="min-w-0 truncate">
        <span className="font-semibold" style={{ color: getPositionColor(r.position) }}>{r.position ?? '?'}</span>{' '}
        <span className="text-[var(--color-text)]">{r.name}</span>{' '}
        <span className="text-[var(--color-text-faint)]">(pick {r.pickNo})</span>
      </span>
      <span
        className="font-semibold tabular-nums flex-shrink-0 ml-2"
        style={{ color: positive ? 'var(--color-start)' : 'var(--color-sit)' }}
      >
        {positive ? '+' : ''}{r.surplus.toFixed(1)}
      </span>
    </li>
  )
}

/**
 * "History of picks vs. actual point values." Same value-vs-expected-pick-
 * slot shape teamGrades.js already uses for draft grading, aimed at real
 * in-season results instead of a preseason score — ranks every player
 * drafted in the league by actual points scored so far, then compares each
 * of your picks against what a player at that pick number should have
 * produced.
 */
export default function DraftValueRealized({ playersById, throughWeek }) {
  const leagueId = useAppStore((s) => s.leagueId)
  const sleeperUserId = useAppStore((s) => s.sleeperUserId)

  const { picks, loading: draftLoading } = useDraftPicks(leagueId)
  const { actualPointsByPlayer, weeksLoaded, loading: historyLoading } = useSeasonMatchupHistory(leagueId, throughWeek)

  const loading = draftLoading || historyLoading

  const results = useMemo(() => {
    if (!picks?.length || weeksLoaded.length === 0) return []

    const rankedActual = Object.values(actualPointsByPlayer).sort((a, b) => b - a)
    const myPicks = picks.filter((p) => p.picked_by === sleeperUserId && p.player_id)

    return myPicks
      .map((p) => {
        const actual = actualPointsByPlayer[p.player_id] ?? 0
        const expected = expectedScoreAtPick(p.pick_no, rankedActual)
        const player = playersById[p.player_id]
        return {
          id: p.player_id,
          name: player?.name ?? p.player_id,
          position: player?.position,
          pickNo: p.pick_no,
          actual,
          surplus: expected == null ? null : actual - expected,
        }
      })
      .filter((r) => r.surplus != null)
      .sort((a, b) => b.surplus - a.surplus)
  }, [picks, actualPointsByPlayer, weeksLoaded, sleeperUserId, playersById])

  if (loading) return <p className="text-sm text-[var(--color-text-muted)]">Loading draft value…</p>
  if (weeksLoaded.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        Not enough completed weeks yet to compare picks against actual results.
      </p>
    )
  }
  if (results.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">No draft picks found for your account.</p>
  }

  const steals = results.slice(0, MAX_SHOWN)
  const busts = results.slice(-MAX_SHOWN).reverse().filter((r) => !steals.includes(r))

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h3 className="text-[10px] uppercase tracking-wide text-[var(--color-start)] mb-2 flex items-center gap-1">
            <TrendingUp size={11} /> Steals
          </h3>
          <ul className="space-y-1.5">
            {steals.map((r) => <PickRow key={r.id} r={r} />)}
          </ul>
        </div>
        {busts.length > 0 && (
          <div>
            <h3 className="text-[10px] uppercase tracking-wide text-[var(--color-sit)] mb-2 flex items-center gap-1">
              <TrendingDown size={11} /> Busts
            </h3>
            <ul className="space-y-1.5">
              {busts.map((r) => <PickRow key={r.id} r={r} />)}
            </ul>
          </div>
        )}
      </div>
      <p className="text-[10px] text-[var(--color-text-faint)] leading-relaxed mt-3">
        Actual points scored vs. what a player taken at that pick number should have produced, based on
        how every player drafted in this league has actually scored through week{' '}
        {weeksLoaded[weeksLoaded.length - 1]}. A stretch of free agency (dropped, unrostered) isn't
        captured in "actual."
      </p>
    </div>
  )
}
