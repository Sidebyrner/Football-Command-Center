import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, ArrowRight, AlertTriangle, Swords } from 'lucide-react'
import Header from '../components/layout/Header'
import { useTeamPowerRankings } from '../hooks/useTeamPowerRankings'
import { useLeagueMatchups } from '../hooks/useLeagueMatchups'
import { useRosterWeekly } from '../hooks/useRosterWeekly'
import { useSchedule } from '../hooks/useSchedule'
import { useDefenseVsPosition } from '../hooks/useDefenseVsPosition'
import { useWeeklySeasons } from '../hooks/usePlayerWeekly'
import { optimizeLineup } from '../utils/lineupOptimizer'
import { getPositionColor, getStatusColor } from '../utils/playerHelpers'
import { GRADE_COLOR_HEX, TEXT_FAINT_HEX, heatColor } from '../utils/chartColors'
import { toNflverseTeam } from '../utils/nflTeams'
import useAppStore from '../store/useAppStore'

// Every basis is a DIFFERENT QUESTION, not a better answer to the same one.
// The optimizer takes exactly one at a time and the UI always names which.
const BASES = [
  { key: 'actual', label: 'Actual pts/gm', hint: 'what he averaged this season, your scoring' },
  { key: 'form', label: 'Last 4 pts/gm', hint: 'recent form only' },
  { key: 'floor', label: 'Floor', hint: 'his p20 week — protect a lead' },
  { key: 'ceiling', label: 'Ceiling', hint: 'his p80 week — you need a blowup' },
  { key: 'model', label: 'Model score', hint: '0-100 season-profile rank, not points' },
  // The only basis here that knows nothing about the player. On this one a
  // replacement-level body in a shootout outranks a stud in a slog — which is
  // the point of running it against the others, not instead of them.
  { key: 'environment', label: 'Game environment', hint: "his game's implied total — nothing about him" },
]

function slotLabel(slot) {
  if (!slot) return '—'
  return slot.type === 'starter' ? slot.pos : (slot.pos || 'FLEX')
}

function Num({ value, digits = 1, muted }) {
  if (value == null) return <span className="text-[var(--color-text-faint)]">—</span>
  return (
    <span className={`tabular-nums ${muted ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text)]'}`}>
      {value.toFixed(digits)}
    </span>
  )
}

/** One player's row on one side of the matchup. */
function PlayerRow({ id, slot, player, score, weekly, game, dvpCell, dvpAvg, align }) {
  const pos = player?.position
  const empty = !id || id === '0'

  const matchupT = dvpCell?.perGame != null && dvpAvg
    ? Math.max(-1, Math.min(1, (dvpCell.perGame - dvpAvg) / (dvpAvg * 0.35)))
    : null

  return (
    <div className={`flex-1 min-w-0 ${align === 'right' ? 'text-right' : ''}`}>
      {empty ? (
        <p className="text-xs text-[var(--color-text-faint)] italic">slot not set in Sleeper</p>
      ) : (
        <>
          <div className={`flex items-center gap-1.5 ${align === 'right' ? 'justify-end' : ''}`}>
            <span
              className="text-[9px] font-bold px-1 py-0.5 rounded flex-shrink-0"
              style={{ color: getPositionColor(pos), backgroundColor: `${getPositionColor(pos)}20` }}
            >
              {pos ?? '?'}
            </span>
            <span className="text-xs font-semibold text-[var(--color-text)] truncate">
              {player?.name ?? id}
            </span>
            {player?.injuryStatus && (
              <span
                className="text-[9px] font-bold flex-shrink-0"
                style={{ color: getStatusColor(player.injuryStatus) }}
              >
                {player.injuryStatus}
              </span>
            )}
          </div>

          <div className={`flex gap-3 mt-1 text-[10px] ${align === 'right' ? 'justify-end' : ''}`}>
            <span title="Actual points per game this season, your league's scoring">
              <Num value={weekly?.perGame} />
              <span className="text-[var(--color-text-faint)]">/gm</span>
            </span>
            <span className="text-[var(--color-text-faint)]" title="p20 to p80 of his actual weeks">
              <Num value={weekly?.floor} muted />–<Num value={weekly?.ceiling} muted />
            </span>
            <span
              className="text-[var(--color-text-faint)]"
              title="Model season-profile rank (0-100). Not points."
            >
              mdl {score?.available ? score.score : '—'}
            </span>
          </div>

          <div className={`flex gap-3 mt-0.5 text-[10px] ${align === 'right' ? 'justify-end' : ''}`}>
            {game ? (
              <span className="text-[var(--color-text-muted)]">
                {game.isHome ? 'vs' : '@'} {game.opponent}
                {game.impliedTotal != null && (
                  <span className="text-[var(--color-text-faint)]"> · {game.impliedTotal.toFixed(1)} imp</span>
                )}
              </span>
            ) : player?.team ? (
              <span className="text-[var(--color-caution)]">bye — no game this week</span>
            ) : (
              <span className="text-[var(--color-text-faint)]">no team on record</span>
            )}
            {dvpCell?.perGame != null && (
              <span
                className="px-1 rounded"
                style={{ backgroundColor: matchupT != null ? heatColor(matchupT) : 'transparent', color: '#f8fafc' }}
                title={`Opponent allows ${dvpCell.perGame}/gm to ${pos} — rank ${dvpCell.rank} softest`}
              >
                D {dvpCell.perGame.toFixed(1)}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Your lineup against the team you actually play this week, slot by slot.
 *
 * Every column is labeled by where it came from and they are never merged into
 * one verdict — the app removed a blended start/sit score once already for
 * claiming a precision it didn't have. When two bases disagree about a swap,
 * that disagreement is displayed rather than resolved: it is the most
 * decision-useful thing on the page.
 */
export default function MatchupPlanner() {
  const leagueId = useAppStore((s) => s.leagueId)
  const sleeperUserId = useAppStore((s) => s.sleeperUserId)
  const currentWeek = useAppStore((s) => s.currentWeek)
  const season = useAppStore((s) => s.season)

  const [basis, setBasis] = useState('actual')

  const { teams, playersById, scores, slotTemplate, loading, error } =
    useTeamPowerRankings(leagueId, sleeperUserId)
  const { matchups, loading: matchupsLoading } = useLeagueMatchups(leagueId, currentWeek)

  const myTeam = teams.find((t) => t.isMe)
  const opponent = useMemo(() => {
    if (!myTeam) return null
    const m = matchups.find((mm) => mm.sides.some((s) => s.rosterId === myTeam.rosterId))
    const other = m?.sides.find((s) => s.rosterId !== myTeam.rosterId)
    return other ? teams.find((t) => t.rosterId === other.rosterId) ?? null : null
  }, [matchups, myTeam, teams])

  // Weekly actuals are scored from the most recent season that has data on
  // disk, which in September is last season — stated in the footnote rather
  // than passed off as this week's form.
  const weeklySeasons = useWeeklySeasons()
  const statsSeason = weeklySeasons[0]?.season ?? null

  const allIds = useMemo(
    () => [...(myTeam?.playerIds ?? []), ...(opponent?.playerIds ?? [])],
    [myTeam, opponent]
  )
  const { byPlayer: seasonWeekly, profileName } = useRosterWeekly(allIds, playersById, statsSeason)
  const { byPlayer: formWeekly } = useRosterWeekly(allIds, playersById, statsSeason, { lastN: 4 })

  const { byTeam: schedule, hasSchedule } = useSchedule(season, currentWeek)
  const { dvp } = useDefenseVsPosition(statsSeason)

  const valueOf = useMemo(() => {
    const pick = (id) => {
      const s = seasonWeekly[id]
      const f = formWeekly[id]
      switch (basis) {
        case 'actual': return s?.perGame ?? null
        case 'form': return f?.perGame ?? null
        case 'floor': return s?.floor ?? null
        case 'ceiling': return s?.ceiling ?? null
        case 'model': return scores?.[id]?.available ? scores[id].score : null
        // Same number the game column above already shows, read from the same
        // schedule — so the basis and the display can't disagree.
        case 'environment': {
          const team = playersById[id]?.team
          return team ? (schedule[toNflverseTeam(team)]?.impliedTotal ?? null) : null
        }
        default: return null
      }
    }
    return pick
  }, [basis, seasonWeekly, formWeekly, scores, schedule, playersById])

  const optimized = useMemo(() => {
    if (!myTeam || !slotTemplate) return null
    return optimizeLineup({
      currentStarterIds: myTeam.starterIds,
      playerIds: myTeam.playerIds,
      template: slotTemplate,
      playersById,
      valueOf,
    })
  }, [myTeam, slotTemplate, playersById, valueOf])

  // The check that makes the recommendation honest: does a DIFFERENT basis
  // reach a different lineup? If so, say so instead of hiding behind one.
  const contrastBasis = basis === 'model' ? 'actual' : 'model'
  const contrast = useMemo(() => {
    if (!myTeam || !slotTemplate) return null
    const pick = (id) => {
      if (contrastBasis === 'model') return scores?.[id]?.available ? scores[id].score : null
      return seasonWeekly[id]?.perGame ?? null
    }
    return optimizeLineup({
      currentStarterIds: myTeam.starterIds,
      playerIds: myTeam.playerIds,
      template: slotTemplate,
      playersById,
      valueOf: pick,
    })
  }, [myTeam, slotTemplate, playersById, contrastBasis, scores, seasonWeekly])

  // Split "we can't value him" into its two very different causes, because the
  // fix differs: one is a data limitation you can't do anything about, the
  // other resolves itself once the player plays.
  const unrankedReason = useMemo(() => {
    let dataset = 0
    let noGames = 0
    // The weekly file keeps QB/RB/WR/TE/K only. Everything else — team
    // defenses and every IDP position, which Sleeper spells DE/DT/LB/CB/S
    // rather than the tidy DL/DB the flex slots use — is absent by
    // construction, not because the player didn't play.
    const IN_DATASET = new Set(['QB', 'RB', 'WR', 'TE', 'K'])
    for (const id of optimized?.unranked ?? []) {
      const pos = playersById[id]?.position
      if (!IN_DATASET.has(pos)) dataset++
      else noGames++
    }
    return { dataset, noGames }
  }, [optimized, playersById])

  const disagrees = useMemo(() => {
    if (!optimized || !contrast) return false
    return optimized.proposedIds.some((id, i) => id !== contrast.proposedIds[i])
  }, [optimized, contrast])

  // Team defenses and IDP are not in nflverse's player-stats file, so those
  // starter slots have no actual-points number at all. Both sides lose the
  // same slots, which keeps the comparison fair — but the total covers fewer
  // than eleven players and the page has to say so rather than imply a full
  // lineup was measured.
  const sideTotal = (team, source) => {
    if (!team) return { total: null, covered: 0, slots: 0 }
    const ids = team.starterIds ?? []
    let t = 0
    let covered = 0
    for (const id of ids) {
      const v = source[id]?.perGame
      if (v != null) { t += v; covered++ }
    }
    return { total: covered ? Math.round(t * 10) / 10 : null, covered, slots: ids.length }
  }
  const mineTotals = sideTotal(myTeam, seasonWeekly)
  const oppTotals = sideTotal(opponent, seasonWeekly)

  if (!leagueId) {
    return (
      <div className="flex flex-col h-screen">
        <Header title="Matchup" />
        <main className="flex-1 overflow-auto p-6">
          <p className="text-sm text-[var(--color-text-muted)]">
            Connect your Sleeper league in{' '}
            <Link to="/settings" className="underline font-semibold">Settings</Link>{' '}
            to plan this week's matchup.
          </p>
        </main>
      </div>
    )
  }

  const slots = slotTemplate?.starters ?? []
  const activeBasis = BASES.find((b) => b.key === basis)

  return (
    <div className="flex flex-col h-screen">
      <Header title="Matchup" />
      <main className="flex-1 overflow-auto p-6 space-y-5">
        {error && <p className="text-sm text-[var(--color-sit)]">{error}</p>}

        {(loading || matchupsLoading) && (
          <p className="text-sm text-[var(--color-text-muted)] flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Loading week {currentWeek}…
          </p>
        )}

        {!loading && !myTeam && (
          <p className="text-sm text-[var(--color-text-muted)]">
            Couldn't find your roster in this league.
          </p>
        )}

        {!loading && myTeam && !opponent && (
          <p className="text-sm text-[var(--color-text-muted)]">
            No week {currentWeek} matchup posted for your team yet.
          </p>
        )}

        {!loading && myTeam && opponent && (
          <>
            {/* ── Scoreboard strip: one row per basis, never merged ────────── */}
            <div className="border border-[var(--color-border)] rounded bg-[var(--color-surface)] px-4 py-3">
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--color-text)] truncate">{myTeam.name} (you)</p>
                </div>
                <Swords size={13} className="text-[var(--color-text-faint)] flex-shrink-0" />
                <div className="flex-1 min-w-0 text-right">
                  <p className="text-sm font-semibold text-[var(--color-text)] truncate">{opponent.name}</p>
                </div>
              </div>

              <div className="mt-2 space-y-1">
                <div className="flex items-center gap-4 text-xs">
                  <span className="flex-1 tabular-nums font-bold text-[var(--color-text)]">
                    <Num value={mineTotals.total} />
                  </span>
                  <span className="text-[9px] uppercase tracking-wide text-[var(--color-text-faint)] flex-shrink-0">
                    actual pts/gm
                  </span>
                  <span className="flex-1 text-right tabular-nums font-bold text-[var(--color-text)]">
                    <Num value={oppTotals.total} />
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="flex-1 tabular-nums" style={{ color: GRADE_COLOR_HEX[myTeam.grade] ?? TEXT_FAINT_HEX }}>
                    {myTeam.grade ?? '—'}
                  </span>
                  <span className="text-[9px] uppercase tracking-wide text-[var(--color-text-faint)] flex-shrink-0">
                    model grade
                  </span>
                  <span className="flex-1 text-right tabular-nums" style={{ color: GRADE_COLOR_HEX[opponent.grade] ?? TEXT_FAINT_HEX }}>
                    {opponent.grade ?? '—'}
                  </span>
                </div>
              </div>

              <p className="text-[10px] text-[var(--color-text-faint)] mt-2">
                Two different measurements of the same two teams, deliberately not averaged
                together. Actual points are {statsSeason} results in {profileName ?? 'your scoring'};
                the grade ranks roster quality against the rest of your league.
              </p>
              {mineTotals.slots > 0 && mineTotals.covered < mineTotals.slots && (
                <p className="text-[10px] text-[var(--color-caution)] mt-1">
                  Covers {mineTotals.covered} of {mineTotals.slots} starting slots on your side
                  and {oppTotals.covered} of {oppTotals.slots} on theirs — team defenses and IDP
                  aren't in nflverse's player stats, so those slots contribute nothing to either
                  total. Both sides drop the same slot types, so the gap is still comparable.
                </p>
              )}
            </div>

            {/* ── Optimizer ─────────────────────────────────────────────────── */}
            <section>
              <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
                  Best lineup by
                </h2>
                <div className="flex gap-1 flex-wrap">
                  {BASES.map((b) => (
                    <button
                      key={b.key}
                      onClick={() => setBasis(b.key)}
                      title={b.hint}
                      className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                        basis === b.key
                          ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] font-semibold'
                          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                      }`}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border border-[var(--color-border)] rounded bg-[var(--color-surface)] px-4 py-3">
                {!optimized?.swaps.length ? (
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Your lineup is already the best one by{' '}
                    <span className="text-[var(--color-text)]">{activeBasis.label}</span> ({activeBasis.hint}).
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-[var(--color-text)] mb-2">
                      By <span className="font-semibold text-[var(--color-accent)]">{activeBasis.label}</span>{' '}
                      ({activeBasis.hint}), {optimized.swaps.length} change
                      {optimized.swaps.length === 1 ? '' : 's'} worth{' '}
                      <span className="font-semibold tabular-nums">
                        {optimized.gain > 0 ? '+' : ''}{optimized.gain}
                      </span>:
                    </p>
                    <ul className="space-y-1">
                      {optimized.swaps.map((s) => (
                        <li key={s.slotIndex} className="text-xs flex items-center gap-2 flex-wrap">
                          <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-text-faint)]">
                            {slotLabel(s.slot)}
                          </span>
                          <span className="text-[var(--color-text-muted)] line-through">
                            {playersById[s.outId]?.name ?? 'empty'}
                          </span>
                          <ArrowRight size={11} className="text-[var(--color-text-faint)]" />
                          <span className="text-[var(--color-text)] font-semibold">
                            {playersById[s.inId]?.name ?? s.inId}
                          </span>
                          <span
                            className="tabular-nums"
                            style={{ color: s.delta >= 0 ? 'var(--color-start)' : 'var(--color-sit)' }}
                          >
                            {s.delta >= 0 ? '+' : ''}{s.delta}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {disagrees && (
                  <p className="text-[10px] text-[var(--color-caution)] mt-2 flex items-start gap-1">
                    <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" />
                    <span>
                      <span className="font-semibold">{BASES.find((b) => b.key === contrastBasis)?.label}</span>{' '}
                      picks a different lineup. That's the real signal — the two measures
                      disagree about these players, so this is a judgement call, not a
                      calculation. Switch bases above to see both.
                    </span>
                  </p>
                )}

                {optimized?.unranked.length > 0 && (
                  <p className="text-[10px] text-[var(--color-text-faint)] mt-2">
                    {optimized.unranked.length} of your players have no{' '}
                    {activeBasis.label.toLowerCase()} value and were left out of this
                    entirely — excluded, never scored as zero.
                    {unrankedReason.dataset > 0 && (
                      <> {unrankedReason.dataset} are DEF or IDP, which nflverse's player
                      stats don't cover, so their slots can't be optimized on actual points at all.</>
                    )}
                    {unrankedReason.noGames > 0 && (
                      <> {unrankedReason.noGames} didn't record a {statsSeason} game
                      (rookies, or players who missed the year).</>
                    )}
                  </p>
                )}
              </div>
            </section>

            {/* ── Slot-by-slot ──────────────────────────────────────────────── */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)] mb-2">
                Slot by slot · week {currentWeek}
              </h2>
              <div className="border border-[var(--color-border)] rounded bg-[var(--color-surface)] divide-y divide-[var(--color-border)]">
                {slots.map((slot, i) => {
                  const mineId = myTeam.starterIds?.[i]
                  const oppId = opponent.starterIds?.[i]
                  const mineP = playersById[mineId]
                  const oppP = playersById[oppId]
                  // Sleeper's codes must be normalized before touching anything
                  // nflverse-derived, or every Rams player reads as a bye.
                  const mineGame = mineP?.team ? schedule[toNflverseTeam(mineP.team)] : null
                  const oppGame = oppP?.team ? schedule[toNflverseTeam(oppP.team)] : null
                  return (
                    <div key={i} className="px-4 py-2.5 flex items-center gap-3">
                      <PlayerRow
                        id={mineId}
                        slot={slot}
                        player={mineP}
                        score={scores?.[mineId]}
                        weekly={seasonWeekly[mineId]}
                        game={mineGame}
                        dvpCell={mineGame?.opponent ? dvp?.byDefense?.[mineGame.opponent]?.[mineP?.position] : null}
                        dvpAvg={dvp?.leagueAvgByPos?.[mineP?.position]}
                      />
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-text-faint)] flex-shrink-0 w-14 text-center">
                        {slotLabel(slot)}
                      </span>
                      <PlayerRow
                        id={oppId}
                        slot={slot}
                        player={oppP}
                        score={scores?.[oppId]}
                        weekly={seasonWeekly[oppId]}
                        game={oppGame}
                        dvpCell={oppGame?.opponent ? dvp?.byDefense?.[oppGame.opponent]?.[oppP?.position] : null}
                        dvpAvg={dvp?.leagueAvgByPos?.[oppP?.position]}
                        align="right"
                      />
                    </div>
                  )
                })}
              </div>

              <div className="mt-2 space-y-1 text-[10px] text-[var(--color-text-faint)]">
                <p>
                  <span className="text-[var(--color-text-muted)]">pts/gm and floor–ceiling</span> are what
                  he actually scored in {statsSeason} under {profileName ?? 'your league profile'}.{' '}
                  <span className="text-[var(--color-text-muted)]">mdl</span> is the 0–100 season-profile
                  rank — a rank, not points, and not addable.{' '}
                  <span className="text-[var(--color-text-muted)]">D</span> is what this week's opponent
                  allows per game to that position.
                </p>
                {!hasSchedule && (
                  <p className="text-[var(--color-caution)]">
                    No schedule file for {season} — run npm run preprocess-nflverse to show opponents.
                  </p>
                )}
                {statsSeason && season && Number(statsSeason) !== Number(season) && (
                  <p className="text-[var(--color-caution)] flex items-start gap-1">
                    <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" />
                    Production above is from {statsSeason}, not {season} — nflverse hasn't
                    published {season} weekly stats yet. Early in a season that is the best
                    available evidence, but it is last year's evidence.
                  </p>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
