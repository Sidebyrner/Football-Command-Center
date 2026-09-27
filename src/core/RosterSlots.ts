/**
 * A league's starting lineup shape, parsed from its own `roster_positions` —
 * a port of FCCore `RosterSlots`. Never hardcoded; read live every load.
 */
import { positionFromSleeper, type Position } from './Position'

/** One starting slot: a dedicated one takes one position, a flex takes a set. */
export interface Slot {
  /** The league's own token — `"QB"`, `"FLEX"`, `"IDP_FLEX"`. */
  token: string
  /** The single position this slot requires; `undefined` for a flex slot. */
  dedicated?: Position
  eligible: ReadonlySet<Position>
}

export const isFlex = (s: Slot) => s.dedicated === undefined
export const accepts = (s: Slot, p: Position | undefined) => p !== undefined && s.eligible.has(p)

export const dedicatedSlot = (p: Position): Slot => ({ token: p, dedicated: p, eligible: new Set([p]) })
export const flexSlot = (token: string, eligible: Iterable<Position>): Slot => ({ token, eligible: new Set(eligible) })

export interface SlotTemplate {
  starters: Slot[]
  benchCount: number
  /** Tokens the parser didn't recognise — reported, never silently dropped. */
  unrecognized: string[]
}

export const totalStarterSlots = (t: SlotTemplate) => t.starters.length
export const flexSlots = (t: SlotTemplate) => t.starters.filter(isFlex)

/**
 * Dedicated slots per position. Flex isn't counted: charging it to every
 * eligible position would count the same slot several times.
 */
export function dedicatedCounts(t: SlotTemplate): Partial<Record<Position, number>> {
  const counts: Partial<Record<Position, number>> = {}
  for (const slot of t.starters) if (slot.dedicated) counts[slot.dedicated] = (counts[slot.dedicated] ?? 0) + 1
  return counts
}

export const DIRECT_POSITIONS: ReadonlySet<string> = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'LB', 'DL', 'DB'])

export const FLEX_ELIGIBILITY: Readonly<Record<string, readonly Position[]>> = {
  FLEX: ['RB', 'WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  WRTE_FLEX: ['WR', 'TE'],
  REC_FLEX: ['WR', 'TE'],
  IDP_FLEX: ['LB', 'DL', 'DB'],
}

/** On the roster but neither a lineup slot nor a countable bench spot. */
export const IGNORED_TOKENS: ReadonlySet<string> = new Set(['TAXI', 'IR'])

/**
 * Parses `roster_positions`. An unknown token containing `FLEX` keeps its
 * place with standard offensive eligibility and is reported as unrecognised.
 */
export function parseSlots(rosterPositions: readonly string[] | undefined): SlotTemplate {
  const starters: Slot[] = []
  let benchCount = 0
  const unrecognized: string[] = []
  for (const raw of rosterPositions ?? []) {
    const token = raw.toUpperCase()
    if (token === 'BN') { benchCount++; continue }
    if (IGNORED_TOKENS.has(token)) continue
    const position = DIRECT_POSITIONS.has(token) ? positionFromSleeper(token) : undefined
    if (position) { starters.push(dedicatedSlot(position)); continue }
    const eligible = Object.prototype.hasOwnProperty.call(FLEX_ELIGIBILITY, token) ? FLEX_ELIGIBILITY[token] : undefined
    if (eligible) { starters.push(flexSlot(token, eligible)); continue }
    if (token.includes('FLEX')) {
      starters.push(flexSlot(token, ['RB', 'WR', 'TE']))
      unrecognized.push(raw)
      continue
    }
    unrecognized.push(raw)
  }
  return { starters, benchCount, unrecognized }
}

export interface Assignment {
  slots: Slot[]
  /** Player id per slot, aligned to `slots`. */
  filled: (string | undefined)[]
  bench: string[]
  overflow: string[]
}

/**
 * Greedy fill for roster-construction views, in roster order: exact slot, then
 * flex, then bench, then overflow. Deliberately *not* the lineup optimizer.
 */
export function assignSlots(playerIDs: readonly string[], template: SlotTemplate, positions: (id: string) => Position | undefined): Assignment {
  const filled: (string | undefined)[] = template.starters.map(() => undefined)
  const bench: string[] = []
  const overflow: string[] = []
  for (const id of playerIDs) {
    if (!id || id === '0') continue
    const position = positions(id)
    if (position === undefined) { overflow.push(id); continue }
    let index = template.starters.findIndex((s, i) => filled[i] === undefined && s.dedicated === position)
    if (index < 0) index = template.starters.findIndex((s, i) => filled[i] === undefined && isFlex(s) && accepts(s, position))
    if (index >= 0) { filled[index] = id; continue }
    if (bench.length < template.benchCount) bench.push(id)
    else overflow.push(id)
  }
  return { slots: template.starters, filled, bench, overflow }
}
