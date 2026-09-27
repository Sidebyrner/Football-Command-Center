/**
 * A roster position in Sleeper's dialect, which is the dialect the app speaks
 * internally — a port of FCCore `Position`.
 *
 * Everything that crosses a boundary translates *into* this type rather than
 * comparing raw strings, because the feeds disagree:
 * - Sleeper: `QB RB WR TE K DEF LB DL DB`
 * - nflverse weekly file: `QB RB WR TE K` only — no DEF, no IDP
 * - dynastyprocess `player-ids.json`: kickers are `PK`, IDP is `CB`/`S`/`DE`/`DT`,
 *   and there are zero `DEF` entries
 */
export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'LB', 'DL', 'DB'] as const
export type Position = (typeof POSITIONS)[number]

/** Offensive skill positions the nflverse weekly file actually covers. */
export const COVERED_BY_WEEKLY_DATA: ReadonlySet<Position> = new Set(['QB', 'RB', 'WR', 'TE', 'K'])

/** Individual defensive players. */
export const IDP: ReadonlySet<Position> = new Set(['LB', 'DL', 'DB'])

function exact(code: string): Position | undefined {
  return (POSITIONS as readonly string[]).includes(code) ? (code as Position) : undefined
}

/**
 * Parses a Sleeper position code. `DST` is a synonym for `DEF`. Sleeper lists
 * most defenders by their football position (CB, DE, OLB…) rather than the IDP
 * slot; without these, about 2,000 active players would have no position.
 */
export function positionFromSleeper(code: string | null | undefined): Position | undefined {
  if (!code) return undefined
  switch (code.toUpperCase()) {
    case 'DST': return 'DEF'
    case 'CB': case 'S': case 'SS': case 'FS': return 'DB'
    case 'DE': case 'DT': case 'NT': return 'DL'
    case 'ILB': case 'OLB': case 'MLB': return 'LB'
    default: return exact(code.toUpperCase())
  }
}

/**
 * Parses a dynastyprocess position code (`player-ids.json`). No `DEF` case on
 * purpose: team defenses are absent from that file.
 */
export function positionFromDynastyProcess(code: string | null | undefined): Position | undefined {
  if (!code) return undefined
  switch (code.toUpperCase()) {
    case 'PK': return 'K'
    case 'CB': case 'S': case 'SS': case 'FS': case 'DB': return 'DB'
    case 'DE': case 'DT': case 'NT': case 'DL': return 'DL'
    case 'LB': case 'ILB': case 'OLB': case 'MLB': return 'LB'
    default: return exact(code.toUpperCase())
  }
}

/**
 * Whether the nflverse weekly file carries production rows for this position.
 * `false` means "unsupported", a different claim from "scored zero".
 */
export function hasWeeklyProductionData(position: Position): boolean {
  return COVERED_BY_WEEKLY_DATA.has(position)
}
