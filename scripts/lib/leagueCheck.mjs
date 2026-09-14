// Runs the web app's own league logic against one real Sleeper league and
// reports what each page would show, plus every place the real data doesn't fit
// the assumptions the code makes.
//
// Pure: the caller fetches. Every function used here is the one the pages
// import, so a clean report means the pages see the same thing — this is not a
// second implementation that could agree with itself and disagree with the app.

import { parseRosterPositions } from '../../src/utils/rosterSlots.js'
import { joinLeagueTeams, findMyTeam } from '../../src/utils/leagueTeams.js'
import { byeWeeksFromSchedule, crunchForWeek } from '../../src/utils/byeWeeks.js'
import { kickoffCalendar, kickoffDate, isGameDay } from '../../src/utils/gameClock.js'
import { buildLineupAlerts } from '../../src/utils/lineupAlerts.js'
import { optimizeLineup } from '../../src/utils/lineupOptimizer.js'
import { pickStatsSeason, statsSeasonNote } from '../../src/utils/statsSeason.js'
import { toNflverseTeam } from '../../src/utils/nflTeams.js'
import { scoreWeeks } from '../../src/utils/weeklyScoring.js'
import { profileFromSleeperScoring } from '../../src/utils/sleeperScoring.js'
import { slotPositions, fitsSlot } from '../../src/utils/slotEligibility.js'

// Positions the weekly production file covers. Everything else is valued null
// by design (house rule: DEF and IDP are never scored as zero).
const PRODUCTION_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K'])
const NO_PRODUCTION_DATA = new Set(['LB', 'DL', 'DB', 'DEF'])

/**
 * Checks that need no league: does Sleeper's player index join the schedule?
 * @param {{ playersById: Record<string, {team, position, active}>, scheduleFile }} args
 */
export function checkJoins({ playersById, scheduleFile }) {
  const findings = []
  const byes = byeWeeksFromSchedule(scheduleFile)
  const scheduleTeams = new Set(byes.teams)

  if (scheduleTeams.size !== 32) {
    findings.push(finding('error', 'schedule', `Schedule lists ${scheduleTeams.size} teams, expected 32.`))
  }

  let unparsed = 0
  for (const games of Object.values(scheduleFile?.byWeek ?? {})) {
    for (const g of games ?? []) {
      if (!kickoffDate(g)) unparsed++
    }
  }
  if (unparsed) findings.push(finding('error', 'schedule', `${unparsed} games have a kickoff time the clock can't parse, so they never lock.`))

  const byesPerTeam = Object.values(byes.byWeek).flat().reduce((m, t) => ({ ...m, [t]: (m[t] ?? 0) + 1 }), {})
  const noBye = [...scheduleTeams].filter((t) => !byesPerTeam[t])
  if (noBye.length) findings.push(finding('warn', 'schedule', `No bye found for ${noBye.join(', ')}.`))

  const unknownTeams = new Map()
  for (const [id, p] of Object.entries(playersById ?? {})) {
    if (!p?.active || !p.team) continue
    const code = toNflverseTeam(p.team)
    if (!scheduleTeams.has(code)) {
      if (!unknownTeams.has(p.team)) unknownTeams.set(p.team, [])
      unknownTeams.get(p.team).push(id)
    }
  }
  for (const [team, ids] of unknownTeams) {
    findings.push(finding('error', 'team-codes',
      `Sleeper team code ${team} (${ids.length} active players) doesn't match any schedule team — those players never get a bye, a lock, or an opponent.`))
  }

  return { findings, scheduleTeams: scheduleTeams.size, byeWeeks: Object.keys(byes.byWeek).length }
}

/**
 * @param {object} args
 * @param {object} args.league Sleeper /league/:id
 * @param {object[]} args.rosters Sleeper /league/:id/rosters
 * @param {object[]} args.users Sleeper /league/:id/users
 * @param {object[]} args.matchups Sleeper /league/:id/matchups/:week
 * @param {{week, season}} args.state Sleeper /state/nfl
 * @param {string} args.userId the connected user's id
 * @param {Record<string, object>} args.playersById trimPlayerIndex() output
 * @param {object} args.scheduleFile public/data/schedule-{season}.json
 * @param {object} [args.weeklyManifest] public/data/weekly/index.json
 * @param {object} [args.weeklyFile] public/data/weekly/{statsSeason}.json
 * @param {Record<string, {gsisId}>} [args.idsBySleeper] player-ids.json players
 * @param {Date} [args.now]
 */
export function checkLeague({
  league, rosters, users, matchups, state, userId, playersById, scheduleFile,
  weeklyManifest, weeklyFile, idsBySleeper = {}, now = new Date(),
}) {
  const findings = []
  const week = Number(state?.week) || 1
  const season = String(league?.season ?? state?.season ?? '')
  const template = parseRosterPositions(league?.roster_positions)
  const teams = joinLeagueTeams(rosters, users)
  const me = findMyTeam(teams, userId)

  // ── League ────────────────────────────────────────────────────────────────
  if (state?.season && season && season !== String(state.season)) {
    findings.push(finding('warn', 'league', `This is a ${season} league but Sleeper's current season is ${state.season} — rosters, byes and locks will be last year's.`))
  }
  if (league?.status && league.status !== 'in_season') {
    findings.push(finding('info', 'league', `League status is "${league.status}" — rosters and lineups may be incomplete until the draft finishes.`))
  }
  for (const token of template.unrecognized) {
    findings.push(finding('error', 'slots', `Roster slot "${token}" isn't one the app knows; ${token.includes('FLEX') ? 'it is being treated as RB/WR/TE flex' : 'it is ignored'}.`))
  }
  const openTeams = teams.filter((t) => t.isOpen)
  if (openTeams.length) findings.push(finding('info', 'league', `${openTeams.length} open team(s) with no manager: ${openTeams.map((t) => t.name).join(', ')}.`))

  const { profile, unmapped } = profileFromSleeperScoring(league?.scoring_settings, league?.name)
  const relevantUnmapped = unmapped.filter((k) => !/^(idp_|def_|pts_allow|yds_allow|blk_kick|st_|fum_rec_td|safe|int$|sack$|ff$|fum_rec$|bonus_def)/.test(k))
  if (relevantUnmapped.length) {
    findings.push(finding('info', 'scoring', `Offensive scoring rules the app doesn't model: ${relevantUnmapped.join(', ')} — point values from production are approximate for these.`))
  }

  if (!me) {
    findings.push(finding('error', 'you', 'Your account doesn\'t own or co-own a team in this league, so My Team, Sit/Start and Matchup have nothing to show.'))
  } else if (me.id !== userId) {
    findings.push(finding('info', 'you', `You co-own ${me.name}.`))
  }

  // ── Every roster: does the data fit the code? ─────────────────────────────
  const slotCount = template.starters.length
  const scheduleTeams = new Set(byeWeeksFromSchedule(scheduleFile).teams)
  for (const t of teams) {
    const label = t.isOpen ? t.name : `${t.name}`
    if (t.starterIds.length && t.starterIds.length !== slotCount) {
      findings.push(finding('error', 'lineup', `${label}: ${t.starterIds.length} starters for ${slotCount} slots — starters are read by position, so every slot after the mismatch is wrong.`))
    }
    const unknown = t.playerIds.filter((id) => !playersById[id])
    if (unknown.length) findings.push(finding('error', 'players', `${label}: ${unknown.length} player id(s) missing from Sleeper's player index (${unknown.slice(0, 5).join(', ')}).`))

    const notOnRoster = t.starterIds.filter((id) => id && id !== '0' && !t.playerIds.includes(id))
    if (notOnRoster.length) findings.push(finding('warn', 'lineup', `${label}: ${notOnRoster.length} starter(s) not on the roster.`))

    const unstartable = t.startableIds.filter((id) => {
      const positions = slotPositions(playersById[id])
      return positions.length && !template.starters.some((s) => fitsSlot(s, positions))
    })
    if (unstartable.length && t === me) {
      findings.push(finding('info', 'players', `${unstartable.length} of your players fit no starting slot: ${unstartable.map((id) => nameOf(playersById, id)).join(', ')}.`))
    }

    const badDef = t.playerIds.filter((id) => playersById[id]?.position === 'DEF' && !scheduleTeams.has(toNflverseTeam(id)))
    if (badDef.length) findings.push(finding('error', 'team-codes', `${label}: defense id(s) ${badDef.join(', ')} don't match a schedule team.`))
  }

  // ── Matchups ──────────────────────────────────────────────────────────────
  const inMatchups = new Set((matchups ?? []).map((m) => m.roster_id))
  const missing = teams.filter((t) => !inMatchups.has(t.rosterId))
  if (matchups?.length && missing.length) {
    findings.push(finding('warn', 'matchups', `Week ${week} matchups have no entry for ${missing.map((t) => t.name).join(', ')}.`))
  }
  if (!matchups?.length && league?.status === 'in_season') {
    findings.push(finding('warn', 'matchups', `Sleeper returned no week ${week} matchups.`))
  }
  const myMatchupRow = me ? (matchups ?? []).find((m) => m.roster_id === me.rosterId) : null
  const opponentRow = myMatchupRow?.matchup_id != null
    ? matchups.find((m) => m.matchup_id === myMatchupRow.matchup_id && m.roster_id !== me.rosterId)
    : null
  const opponent = opponentRow ? teams.find((t) => t.rosterId === opponentRow.roster_id) ?? null : null
  if (myMatchupRow && me && myMatchupRow.starters?.length &&
      myMatchupRow.starters.join() !== me.starterIds.join()) {
    findings.push(finding('info', 'matchups', 'Your week\'s matchup lineup differs from your roster\'s current starters (normal after a lineup change mid-week).'))
  }

  // ── Your team, as the pages compute it ────────────────────────────────────
  let mine = null
  if (me) {
    const byes = byeWeeksFromSchedule(scheduleFile)
    const kickoffs = kickoffCalendar(scheduleFile)
    const byeTeams = new Set(byes.byWeek[week] ?? [])

    const alerts = buildLineupAlerts({ starterIds: me.starterIds, playersById, byeTeams, kickoffs, week, now })

    const crunch = Object.keys(byes.byWeek).map(Number).filter((w) => w >= week).sort((a, b) => a - b)
      .map((w) => ({ week: w, ...crunchForWeek(me.startableIds, { playersById, byeTeams: new Set(byes.byWeek[w]), template, normalizeTeam: toNflverseTeam }) }))
      .filter((c) => c.totalShortfall > 0)
      .map((c) => ({ week: c.week, shortfall: c.totalShortfall, positions: c.neededPositions, onBye: c.onBye.map((p) => nameOf(playersById, p.id)) }))

    const { statsSeason, currentSeasonWeeks } = pickStatsSeason(weeklyManifest?.seasons, season)
    const statsNote = statsSeasonNote({ statsSeason, scheduleSeason: season, currentSeasonWeeks })

    const perGame = seasonPerGame({ weeklyFile, idsBySleeper, playersById, ids: me.playerIds, profile })
    const valueOf = (id) => {
      const team = playersById[id]?.team
      if (team && byeTeams.has(toNflverseTeam(team))) return null
      return perGame[id] ?? null
    }
    const locked = me.playerIds.filter((id) => kickoffs.isLocked(playersById[id]?.team, week, now))
    const optimized = optimizeLineup({
      currentStarterIds: me.starterIds, playerIds: me.startableIds, template, playersById, valueOf, locked,
    })

    const noStatsJoin = me.startableIds.filter((id) => {
      const pos = playersById[id]?.position
      return PRODUCTION_POSITIONS.has(pos) && perGame[id] == null
    })
    if (noStatsJoin.length) {
      findings.push(finding('info', 'stats', `${noStatsJoin.length} of your QB/RB/WR/TE/K have no ${statsSeason} production (rookies, or a missing id crosswalk): ${noStatsJoin.map((id) => nameOf(playersById, id)).join(', ')}.`))
    }
    const idp = me.playerIds.filter((id) => slotPositions(playersById[id]).some((p) => NO_PRODUCTION_DATA.has(p))).length
    if (idp) findings.push(finding('info', 'stats', `${idp} DEF/IDP player(s) have no production data; they're shown unranked, never as zero.`))
    if (me.reserveIds.length || me.taxiIds.length) {
      findings.push(finding('info', 'lineup', `${me.reserveIds.length} IR and ${me.taxiIds.length} taxi player(s) are left out of lineup and bye math.`))
    }

    mine = {
      name: me.name,
      rosterId: me.rosterId,
      coOwner: me.id !== userId,
      record: me.record,
      opponent: opponent?.name ?? null,
      lineup: me.starterIds.map((id, i) => {
        const slot = template.starters[i]
        if (!id || id === '0') return { slot: slot?.pos, id: null, name: null, note: 'empty' }
        const p = playersById[id] ?? {}
        const team = p.team ? toNflverseTeam(p.team) : null
        const note = kickoffs.isLocked(team, week, now) ? 'locked'
          : team && byeTeams.has(team) ? 'bye'
          : p.injuryStatus ? p.injuryStatus
          : null
        return { slot: slot?.pos, id, name: p.name ?? id, position: p.position, team: p.team, note, perGame: perGame[id] ?? null }
      }),
      alerts: {
        onBye: alerts.onBye.map((p) => p.name),
        emptySlots: alerts.emptySlots,
        injured: alerts.injured.map((p) => `${p.name} (${p.status})`),
        locked: alerts.locked,
        nextLock: alerts.nextLock?.toISOString() ?? null,
        readiness: alerts.readiness,
      },
      gameDay: isGameDay(kickoffs, week, now),
      crunch,
      statsSeason,
      statsNote,
      optimizer: {
        basis: `${statsSeason} points per game, league scoring`,
        gain: optimized.gain,
        swaps: optimized.swaps.map((s) => ({ slot: s.slot.pos, out: nameOf(playersById, s.outId), in: nameOf(playersById, s.inId), delta: s.delta })),
        unranked: optimized.unranked.length,
        locked: locked.length,
      },
    }
  }

  return {
    league: {
      id: league?.league_id, name: league?.name, season, status: league?.status,
      teams: teams.length, slots: template.starters.map((s) => s.pos), bench: template.benchCount,
    },
    week,
    mine,
    teams: teams.map((t) => ({ name: t.name, rosterId: t.rosterId, open: t.isOpen, record: t.record, players: t.playerIds.length })),
    findings,
  }
}

/** Season points per game in league scoring, keyed by Sleeper id. */
export function seasonPerGame({ weeklyFile, idsBySleeper, playersById, ids, profile }) {
  const out = {}
  if (!weeklyFile?.players) return out
  for (const id of ids) {
    const position = playersById[id]?.position
    if (!PRODUCTION_POSITIONS.has(position)) continue
    const gsis = idsBySleeper[id]?.gsisId
    const tuples = gsis ? weeklyFile.players[gsis] : null
    if (!tuples?.length) continue
    const rows = tuples.map((t) => Object.fromEntries(weeklyFile.fields.map((f, i) => [f, t[i]])))
    const perGame = scoreWeeks(rows, profile ?? undefined, position).perGame
    if (perGame != null) out[id] = perGame
  }
  return out
}

function finding(level, area, message) {
  return { level, area, message }
}

function nameOf(playersById, id) {
  if (!id) return '—'
  return playersById[id]?.name ?? id
}
