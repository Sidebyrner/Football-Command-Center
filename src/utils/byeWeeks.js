// Bye weeks, and what they do to a starting lineup.
//
// Byes come from the schedule by absence: 32 teams, 18 weeks, and a team that
// appears in no game that week is on bye. That is exact and covers every
// position — unlike the `bye` field on player objects, which arrives through a
// FantasyPros ADP match and reaches no IDP player at all.

/**
 * @param {object} scheduleFile - public/data/schedule-{season}.json
 * @returns {{ byTeam: Record<string, number>, byWeek: Record<number, string[]>, teams: string[] }}
 *   Team codes are whatever the schedule uses (nflverse dialect — `LA`, not
 *   `LAR`), so callers joining from Sleeper ids must run toNflverseTeam first.
 */
export function byeWeeksFromSchedule(scheduleFile) {
  const weeks = scheduleFile?.byWeek ?? {}
  const teams = new Set()
  for (const games of Object.values(weeks)) {
    for (const g of games ?? []) {
      if (g.home) teams.add(g.home)
      if (g.away) teams.add(g.away)
    }
  }

  const byTeam = {}
  const byWeek = {}
  for (const [weekStr, games] of Object.entries(weeks)) {
    const week = Number(weekStr)
    const playing = new Set()
    for (const g of games ?? []) {
      if (g.home) playing.add(g.home)
      if (g.away) playing.add(g.away)
    }
    // An empty week means the file doesn't cover it, not that everyone is on
    // bye — don't invent 32 byes out of missing data.
    if (playing.size === 0) continue

    const off = [...teams].filter((t) => !playing.has(t)).sort()
    if (off.length) byWeek[week] = off
    for (const t of off) byTeam[t] ??= week
  }

  return { byTeam, byWeek, teams: [...teams].sort() }
}

/**
 * Can this roster still field a legal lineup in a given week?
 *
 * Reported per position rather than as one feasible/infeasible verdict,
 * because "RB: 1 available for 2 slots" is the thing you act on and a boolean
 * isn't. Dedicated slots are counted first; whatever is left over at a
 * flex-eligible position becomes flex supply.
 *
 * @param {string[]} playerIds
 * @param {object} args
 * @param {Record<string, {position?, team?}>} args.playersById
 * @param {Set<string>} args.byeTeams - teams on bye that week, in the SAME
 *   dialect as playersById[].team after normalisation by the caller
 * @param {{starters: Array<{type, pos, eligible?}>}} args.template
 * @param {(team: string) => string} [args.normalizeTeam] - applied to each
 *   player's team before the bye lookup
 * @returns {{ byPosition, flex, totalShortfall, onBye }}
 */
export function crunchForWeek(playerIds, { playersById, byeTeams, template, normalizeTeam = (t) => t }) {
  const slots = template?.starters ?? []

  const required = {}
  let flexRequired = 0
  const flexEligible = new Set()
  for (const s of slots) {
    if (s.type === 'flex') {
      flexRequired++
      for (const p of s.eligible ?? []) flexEligible.add(p)
    } else {
      required[s.pos] = (required[s.pos] ?? 0) + 1
    }
  }

  const availableByPos = {}
  const onBye = []
  for (const id of playerIds ?? []) {
    if (!id || id === '0') continue
    const p = playersById[id]
    const pos = p?.position
    if (!pos) continue
    const team = p.team ? normalizeTeam(p.team) : null
    if (team && byeTeams?.has(team)) {
      onBye.push({ id, position: pos, team })
      continue
    }
    availableByPos[pos] = (availableByPos[pos] ?? 0) + 1
  }

  const byPosition = {}
  let totalShortfall = 0
  let flexSupply = 0
  for (const pos of new Set([...Object.keys(required), ...Object.keys(availableByPos)])) {
    const req = required[pos] ?? 0
    const avail = availableByPos[pos] ?? 0
    const shortfall = Math.max(0, req - avail)
    if (req > 0) {
      byPosition[pos] = { required: req, available: avail, shortfall }
      totalShortfall += shortfall
    }
    // Surplus at a flex-eligible position is what flex actually draws on.
    if (flexEligible.has(pos)) flexSupply += Math.max(0, avail - req)
  }

  const flexShortfall = Math.max(0, flexRequired - flexSupply)
  totalShortfall += flexShortfall

  return {
    byPosition,
    flex: { required: flexRequired, available: flexSupply, shortfall: flexShortfall },
    totalShortfall,
    onBye,
  }
}
