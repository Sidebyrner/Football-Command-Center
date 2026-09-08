import { useState, useMemo } from 'react'
import { ChevronDown, ChevronUp, Trophy } from 'lucide-react'
import { computeAllTeamGrades, GRADE_COLOR } from '../../utils/teamGrades'
import { useMissingPlayerMeta } from '../../hooks/useMissingPlayerMeta'
import TeamGradeRow from './TeamGradeRow'

/**
 * Grades every team in the live draft — not just yours — using value-vs-
 * expected-pick-slot (how much better each pick was than the player who
 * "should" have been there at that pick number, from evaluateDraft's .score)
 * blended with roster construction (are starter slots actually getting
 * filled, not just stacked at one position). Collapsed to your own grade by
 * default, same pattern as MyRosterPanel.
 */
export default function TeamGradesPanel({ picks, pickByPlayer, sleeperUserId, playersById, scores, slotTemplate }) {
  const [expanded, setExpanded] = useState(false)

  const teamsInput = useMemo(() => {
    const byTeam = new Map()
    for (const p of picks) {
      if (!p.player_id || !p.picked_by) continue
      if (!byTeam.has(p.picked_by)) {
        byTeam.set(p.picked_by, {
          id: p.picked_by,
          name: pickByPlayer[p.player_id]?.by ?? 'Unknown team',
          isMe: !!sleeperUserId && p.picked_by === sleeperUserId,
          playerIds: [],
          pickNos: {},
        })
      }
      const team = byTeam.get(p.picked_by)
      team.playerIds.push(p.player_id)
      if (p.pick_no != null) team.pickNos[p.player_id] = p.pick_no
    }
    return [...byTeam.values()]
  }, [picks, pickByPlayer, sleeperUserId])

  // IDP picks (LB/DL/DB) aren't in the main board's player pool — resolve
  // just those via Sleeper's raw player index so they show a name.
  const missingIds = useMemo(() => {
    const ids = new Set()
    for (const t of teamsInput) for (const id of t.playerIds) if (!playersById[id]) ids.add(id)
    return [...ids]
  }, [teamsInput, playersById])
  const idpMeta = useMissingPlayerMeta(missingIds)
  const mergedPlayersById = useMemo(() => ({ ...playersById, ...idpMeta }), [playersById, idpMeta])

  const teams = useMemo(() => {
    if (!slotTemplate || !teamsInput.length) return []
    return computeAllTeamGrades(teamsInput, { scores, playersById: mergedPlayersById, slotTemplate })
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
  }, [teamsInput, scores, mergedPlayersById, slotTemplate])

  if (!teams.length) return null

  const myTeam = teams.find((t) => t.isMe)

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 text-xs hover:bg-[var(--color-surface-2)] transition-colors"
      >
        <Trophy size={12} className="text-[var(--color-text-faint)] flex-shrink-0" />
        <span className="text-[var(--color-text-muted)] font-medium flex-shrink-0">Team grades</span>
        {myTeam?.grade && (
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded tabular-nums"
            style={{ color: GRADE_COLOR[myTeam.grade], backgroundColor: `${GRADE_COLOR[myTeam.grade]}20` }}
          >
            You: {myTeam.grade}
          </span>
        )}
        <span className="ml-auto text-[var(--color-text-faint)] flex-shrink-0">
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-1">
          {teams.map((t) => <TeamGradeRow key={t.id} team={t} />)}
        </div>
      )}
    </div>
  )
}
