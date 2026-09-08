// Parses a Sleeper league's roster_positions into a starter-slot template,
// and assigns a list of players onto it (starters first, then flex-eligible
// slots, then bench) the same way a real lineup gets built. Read live from
// the league on every call site — never hardcode a starter count, since
// league settings (this one's IDP requirement included) change over time.

const DIRECT_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'LB', 'DL', 'DB'])

const FLEX_ELIGIBILITY = {
  FLEX: ['RB', 'WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  WRTE_FLEX: ['WR', 'TE'],
  REC_FLEX: ['WR', 'TE'],
  IDP_FLEX: ['LB', 'DL', 'DB'],
}

// Slots that exist on a Sleeper roster but aren't part of the active lineup
// or a countable bench spot (taxi squad, IR) — skipped entirely.
const IGNORED_TOKENS = new Set(['TAXI', 'IR'])

/**
 * @param {string[]} rosterPositions - league.roster_positions from Sleeper
 * @returns {{ starters: Array<{type:'starter'|'flex', pos:string, eligible?:string[]}>,
 *             benchCount: number, totalStarterSlots: number, unrecognized: string[] }}
 */
export function parseRosterPositions(rosterPositions) {
  const starters = []
  let benchCount = 0
  const unrecognized = []

  for (const token of rosterPositions ?? []) {
    if (token === 'BN') { benchCount++; continue }
    if (IGNORED_TOKENS.has(token)) continue
    if (DIRECT_POSITIONS.has(token)) { starters.push({ type: 'starter', pos: token }); continue }
    if (FLEX_ELIGIBILITY[token]) {
      starters.push({ type: 'flex', pos: token, eligible: FLEX_ELIGIBILITY[token] })
      continue
    }
    // Unknown flex-shaped token (a league-specific hybrid slot, say) — assume
    // standard offensive flex eligibility rather than silently dropping the
    // slot from roster-construction accounting.
    if (token.includes('FLEX')) {
      starters.push({ type: 'flex', pos: token, eligible: ['RB', 'WR', 'TE'] })
      unrecognized.push(token)
      continue
    }
    unrecognized.push(token)
  }

  return { starters, benchCount, totalStarterSlots: starters.length, unrecognized }
}

/**
 * Greedy fill: each player lands in the first empty starter slot matching
 * their exact position, else the first empty flex slot they're eligible for,
 * else bench (up to benchCount), else overflow.
 *
 * @param {string[]} playerIds
 * @param {{ starters, benchCount }} template - from parseRosterPositions
 * @param {Record<string, {id, position, name}>} playersById
 */
export function assignPicksToSlots(playerIds, template, playersById) {
  const slots = template.starters.map((s) => ({ ...s, filled: null }))
  const bench = []
  const overflow = []

  for (const id of playerIds) {
    const player = playersById[id]
    if (!player) { overflow.push(id); continue }

    let slot = slots.find((s) => s.type === 'starter' && s.pos === player.position && !s.filled)
    if (!slot) {
      slot = slots.find((s) => s.type === 'flex' && !s.filled && s.eligible?.includes(player.position))
    }
    if (slot) { slot.filled = player; continue }

    if (bench.length < template.benchCount) bench.push(player)
    else overflow.push(player)
  }

  return { slots, bench, overflow }
}
