/**
 * Can this roster field a legal lineup in a given week? — a port of FCCore
 * `ByeCrunch`. Reported per position; each flex slot is matched only against
 * positions it accepts (maximum bipartite matching), unlike the old web app's
 * pooled flex, which let a spare receiver cover a missing linebacker.
 */
import { nflverseTeam } from './NFLTeams'
import type { Position } from './Position'
import { dedicatedCounts, flexSlots, type Slot, type SlotTemplate } from './RosterSlots'
import type { ByeCalendar } from './ByeWeeks'

export interface RosterEntry {
  id: string
  position?: Position
  /** Any dialect; normalised before the bye lookup. */
  team?: string
}

export interface PositionCrunch {
  required: number
  available: number
  shortfall: number
}

export interface FlexGroupCrunch {
  /** The league's tokens for the slots in this group, in template order. */
  tokens: string[]
  eligible: ReadonlySet<Position>
  required: number
  filled: number
  shortfall: number
}

export interface CrunchReport {
  byPosition: Partial<Record<Position, PositionCrunch>>
  flexGroups: FlexGroupCrunch[]
  flexRequired: number
  flexFilled: number
  flexShortfall: number
  totalShortfall: number
  onBye: RosterEntry[]
  /** Ids whose position is unknown — surfaced, not dropped. */
  unknownPosition: string[]
}

export const isFeasible = (r: CrunchReport) => r.totalShortfall === 0

/** Dedicated positions that are short, plus every position of a short flex group. */
export function neededPositions(r: CrunchReport): Set<Position> {
  const needed = shortDedicatedPositions(r)
  for (const g of r.flexGroups) if (g.shortfall > 0) for (const p of g.eligible) needed.add(p)
  return needed
}

export function shortDedicatedPositions(r: CrunchReport): Set<Position> {
  return new Set((Object.entries(r.byPosition) as [Position, PositionCrunch][]).filter(([, c]) => c.shortfall > 0).map(([p]) => p))
}

export function crunchForWeek(roster: readonly RosterEntry[], template: SlotTemplate, byeTeams: ReadonlySet<string>): CrunchReport {
  const required = dedicatedCounts(template)
  const flex = flexSlots(template)
  const available: Partial<Record<Position, number>> = {}
  const onBye: RosterEntry[] = []
  const unknownPosition: string[] = []
  for (const entry of roster) {
    if (!entry.id || entry.id === '0') continue
    if (entry.position === undefined) { unknownPosition.push(entry.id); continue }
    const team = nflverseTeam(entry.team)
    if (team !== undefined && byeTeams.has(team)) { onBye.push({ id: entry.id, position: entry.position, team }); continue }
    available[entry.position] = (available[entry.position] ?? 0) + 1
  }

  const byPosition: Partial<Record<Position, PositionCrunch>> = {}
  let totalShortfall = 0
  const surplus: Partial<Record<Position, number>> = {}
  for (const position of new Set([...Object.keys(required), ...Object.keys(available)] as Position[])) {
    const req = required[position] ?? 0
    const avail = available[position] ?? 0
    if (req > 0) {
      const shortfall = Math.max(0, req - avail)
      byPosition[position] = { required: req, available: avail, shortfall }
      totalShortfall += shortfall
    }
    const spare = Math.max(0, avail - req)
    if (spare > 0) surplus[position] = spare
  }
  const matching = matchFlexSlots(flex, surplus)
  const flexFilled = matching.filter((m) => m !== undefined).length
  const flexShortfall = flex.length - flexFilled
  totalShortfall += flexShortfall
  return {
    byPosition, flexGroups: groupFlex(flex, matching), flexRequired: flex.length, flexFilled, flexShortfall,
    totalShortfall, onBye, unknownPosition,
  }
}

/** Shortfall for every remaining week, for one roster. */
export function crunchOutlook(roster: readonly RosterEntry[], template: SlotTemplate, calendar: ByeCalendar, weeks: readonly number[]): Map<number, CrunchReport> {
  return new Map(weeks.map((w) => [w, crunchForWeek(roster, template, calendar.byeTeams(w))]))
}

/** Kuhn's algorithm: flex slots against spare players, maximising slots filled. */
export function matchFlexSlots(slots: readonly Slot[], surplus: Partial<Record<Position, number>>): (Position | undefined)[] {
  if (slots.length === 0) return []
  const units: Position[] = []
  for (const position of (Object.keys(surplus) as Position[]).sort()) {
    const count = Math.min(surplus[position] ?? 0, slots.length)
    for (let i = 0; i < count; i++) units.push(position)
  }
  if (units.length === 0) return slots.map(() => undefined)
  const slotForUnit: (number | undefined)[] = units.map(() => undefined)
  let visited: boolean[] = []
  const augment = (slotIndex: number): boolean => {
    for (let u = 0; u < units.length; u++) {
      if (visited[u] || !slots[slotIndex]!.eligible.has(units[u]!)) continue
      visited[u] = true
      const occupant = slotForUnit[u]
      if (occupant === undefined || augment(occupant)) {
        slotForUnit[u] = slotIndex
        return true
      }
    }
    return false
  }
  slots.forEach((_, s) => {
    visited = units.map(() => false)
    augment(s)
  })
  const assigned: (Position | undefined)[] = slots.map(() => undefined)
  slotForUnit.forEach((s, u) => { if (s !== undefined) assigned[s] = units[u] })
  return assigned
}

export const eligibilityKey = (s: ReadonlySet<Position>) => [...s].sort().join('/')

/** Flex slots grouped by eligibility set, in first-appearance order. */
export function groupFlex(slots: readonly Slot[], matching: readonly (Position | undefined)[]): FlexGroupCrunch[] {
  const groups = new Map<string, FlexGroupCrunch>()
  slots.forEach((slot, i) => {
    const key = eligibilityKey(slot.eligible)
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { tokens: [], eligible: slot.eligible, required: 0, filled: 0, shortfall: 0 }))
    g.required++
    g.tokens.push(slot.token)
    if (i < matching.length && matching[i] !== undefined) g.filled++
  })
  return [...groups.values()].map((g) => ({ ...g, shortfall: Math.max(0, g.required - g.filled) }))
}
