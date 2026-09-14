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
 * position becomes supply for the flex slots that accept it.
 *
 * Each flex slot is matched only against positions it actually accepts. This
 * used to pool every flex slot against the union of their eligibility sets —
 * in a league with FLEX and two IDP_FLEX slots that union is
 * {RB, WR, TE, LB, DL, DB}, so a spare receiver read as covering a missing
 * linebacker and a broken week looked fillable. A maximum bipartite matching
 * fixes that and still fills overlapping sets (WRRB_FLEX + WRTE_FLEX)
 * optimally. The reported shortfall is never smaller than the pooled one,
 * which is the safe direction for an alarm. Same rule as the iOS app's
 * ByeCrunch.
 *
 * @param {string[]} playerIds
 * @param {object} args
 * @param {Record<string, {position?, team?}>} args.playersById
 * @param {Set<string>} args.byeTeams - teams on bye that week, in the SAME
 *   dialect as playersById[].team after normalisation by the caller
 * @param {{starters: Array<{type, pos, eligible?}>}} args.template
 * @param {(team: string) => string} [args.normalizeTeam] - applied to each
 *   player's team before the bye lookup
 * @returns {{ byPosition, flex, flexGroups, neededPositions, totalShortfall, onBye }}
 *   `flex.available` is the number of flex slots that can be filled.
 *   `flexGroups` splits flex slots by eligibility set, and `neededPositions`
 *   lists every position that would help: dedicated positions that are short,
 *   plus everything a short flex group accepts.
 */
export function crunchForWeek(playerIds, { playersById, byeTeams, template, normalizeTeam = (t) => t }) {
  const slots = template?.starters ?? []

  const required = {}
  const flexSlots = []
  for (const s of slots) {
    if (s.type === 'flex') flexSlots.push(s)
    else required[s.pos] = (required[s.pos] ?? 0) + 1
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
  const surplus = {}
  let totalShortfall = 0
  for (const pos of new Set([...Object.keys(required), ...Object.keys(availableByPos)])) {
    const req = required[pos] ?? 0
    const avail = availableByPos[pos] ?? 0
    if (req > 0) {
      const shortfall = Math.max(0, req - avail)
      byPosition[pos] = { required: req, available: avail, shortfall }
      totalShortfall += shortfall
    }
    const spare = Math.max(0, avail - req)
    if (spare > 0) surplus[pos] = spare
  }

  const matching = matchFlexSlots(flexSlots, surplus)
  const flexFilled = matching.filter(Boolean).length
  const flexShortfall = flexSlots.length - flexFilled
  totalShortfall += flexShortfall

  const flexGroups = groupFlex(flexSlots, matching)
  const neededPositions = new Set(
    Object.entries(byPosition).filter(([, v]) => v.shortfall > 0).map(([pos]) => pos)
  )
  for (const group of flexGroups) {
    if (group.shortfall > 0) for (const pos of group.eligible) neededPositions.add(pos)
  }

  return {
    byPosition,
    flex: { required: flexSlots.length, available: flexFilled, shortfall: flexShortfall },
    flexGroups,
    neededPositions: [...neededPositions].sort(),
    totalShortfall,
    onBye,
  }
}

/**
 * Assigns flex slots to spare players, maximising how many slots are filled
 * (Kuhn's algorithm). Returns the position used by each slot, aligned to
 * `flexSlots`, with null for a slot nothing can fill.
 */
export function matchFlexSlots(flexSlots, surplus) {
  if (!flexSlots.length) return []
  // One unit per spare player, capped at the number of slots.
  const units = []
  for (const pos of Object.keys(surplus).sort()) {
    const count = Math.min(surplus[pos] ?? 0, flexSlots.length)
    for (let i = 0; i < count; i++) units.push(pos)
  }
  if (!units.length) return flexSlots.map(() => null)

  const slotForUnit = new Array(units.length).fill(null)
  let visited

  const augment = (slotIndex) => {
    for (let u = 0; u < units.length; u++) {
      if (visited[u]) continue
      if (!(flexSlots[slotIndex].eligible ?? []).includes(units[u])) continue
      visited[u] = true
      if (slotForUnit[u] === null || augment(slotForUnit[u])) {
        slotForUnit[u] = slotIndex
        return true
      }
    }
    return false
  }

  for (let i = 0; i < flexSlots.length; i++) {
    visited = new Array(units.length).fill(false)
    augment(i)
  }

  const assigned = flexSlots.map(() => null)
  slotForUnit.forEach((slotIndex, u) => {
    if (slotIndex !== null) assigned[slotIndex] = units[u]
  })
  return assigned
}

function groupFlex(flexSlots, matching) {
  const groups = new Map()
  flexSlots.forEach((slot, i) => {
    const eligible = [...(slot.eligible ?? [])].sort()
    const key = eligible.join(',')
    if (!groups.has(key)) groups.set(key, { tokens: [], eligible, required: 0, filled: 0 })
    const g = groups.get(key)
    g.required++
    g.tokens.push(slot.pos)
    if (matching[i]) g.filled++
  })
  return [...groups.values()].map((g) => ({ ...g, shortfall: Math.max(0, g.required - g.filled) }))
}
