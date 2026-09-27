// Which lineup slots a player can fill.
//
// A Sleeper player's `position` is his football position, not his fantasy one.
// Checked against the live player index: ~470 active defenders are listed as
// CB, DE, DT, NT, S, SS, FS or ILB, while league slots only ever say DB, DL and
// LB — the mapping lives in `fantasy_positions`. That field is also how Sleeper
// makes a player eligible for two slots (38 linebackers are ["DL", "LB"]).
// Matching on `position` left every one of those defenders unable to fill a
// slot in an IDP league: phantom bye shortfalls and an optimizer that couldn't
// seat them.

// Fallback for records without fantasy_positions (older caches, hand-built
// fixtures). Sleeper's own mapping wins whenever it is present.
const FANTASY_POSITION_BY_POSITION = {
  DE: 'DL', DT: 'DL', NT: 'DL',
  CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB',
  ILB: 'LB', OLB: 'LB', MLB: 'LB',
  FB: 'RB',
}

/** The fantasy positions a player may be started at. */
export function slotPositions(player) {
  const listed = player?.fantasyPositions ?? player?.fantasy_positions
  if (Array.isArray(listed) && listed.length) return listed
  const pos = player?.position
  if (!pos) return []
  return [FANTASY_POSITION_BY_POSITION[pos] ?? pos]
}

/**
 * Sleeper's fantasy_positions, or null when it says nothing the position
 * doesn't. Most players are ["WR"] for a WR and every CB is ["DB"]; storing
 * those grew the cached player index 28% toward the localStorage cap.
 */
export function distinctFantasyPositions(position, fantasyPositions) {
  if (!Array.isArray(fantasyPositions) || !fantasyPositions.length) return null
  return fantasyPositions.join() === slotPositions({ position }).join() ? null : fantasyPositions
}

/** Whether any of `positions` may fill `slot` (a parseRosterPositions starter). */
export function fitsSlot(slot, positions) {
  if (!slot || !positions?.length) return false
  if (slot.type === 'starter') return positions.includes(slot.pos)
  return positions.some((p) => (slot.eligible ?? []).includes(p))
}
