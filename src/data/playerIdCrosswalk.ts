/**
 * `player-ids.json` — Sleeper id → gsis id, the bridge to every nflverse file.
 * A port of FCData `PlayerIDCrosswalk`.
 *
 * This dynastyprocess export **does not speak Sleeper's dialect**: kickers are
 * `PK`, there are zero `DEF` entries, IDP is `CB`/`S`/`DE`/`DT`, and teams have
 * their own spellings (`KCC`, `GBP`…). Read positions through
 * `positionFromDynastyProcess`, never as raw strings.
 */
import { positionFromDynastyProcess } from '@core/Position'
import { nflverseTeam } from '@core/NFLTeams'
import { asObject, compact, isObject, str } from './decode'

export interface CrosswalkEntry {
  gsisId?: string
  fantasyprosId?: string
  /** ESPN's numeric player id, as a string. Absent for team defenses. */
  espnId?: string
  name?: string
  /** The **dynastyprocess** spelling. Use `crosswalkPosition` instead. */
  positionCode?: string
  team?: string
}

export interface PlayerIDCrosswalk {
  players: Record<string, CrosswalkEntry>
}

/** dynastyprocess team code → the common code Sleeper and nflverse share. */
export const DYNASTY_PROCESS_TEAMS: Readonly<Record<string, string>> = {
  GBP: 'GB', KCC: 'KC', NEP: 'NE', NOS: 'NO', SFO: 'SF', TBB: 'TB',
  LVR: 'LV', JAC: 'JAX', OAK: 'LV', SDC: 'LAC', STL: 'LA', RAM: 'LA',
}

export function decodeCrosswalk(json: unknown): PlayerIDCrosswalk {
  const players = asObject(asObject(json, 'player-ids').players, 'players')
  const out: Record<string, CrosswalkEntry> = {}
  for (const [id, raw] of Object.entries(players)) {
    if (!isObject(raw)) throw new Error(`player-ids: entry ${id} is not an object`)
    out[id] = compact({
      gsisId: str(raw, 'gsisId'),
      fantasyprosId: str(raw, 'fantasyprosId'),
      espnId: str(raw, 'espnId'),
      name: str(raw, 'name'),
      positionCode: str(raw, 'position'),
      team: str(raw, 'team'),
    })
  }
  return { players: out }
}

/** `undefined` for codes the app doesn't model — punters and the `XX` placeholder. */
export const crosswalkPosition = (e: CrosswalkEntry) => positionFromDynastyProcess(e.positionCode)

/** Team in nflverse's spelling, translated from the file's own dialect first. */
export function crosswalkNflverseTeam(e: CrosswalkEntry): string | undefined {
  if (e.team === undefined) return undefined
  return nflverseTeam(DYNASTY_PROCESS_TEAMS[e.team] ?? e.team)
}

/** dynastyprocess marks unrostered players `FA`. */
export const isFreeAgent = (e: CrosswalkEntry) => e.team === 'FA'

/** `undefined` is routine: every team defense has no row. */
export const gsisID = (c: PlayerIDCrosswalk, sleeperID: string) => c.players[sleeperID]?.gsisId

/** ESPN id → Sleeper id, for translating an ESPN roster into the ids everything else is keyed by. */
export function sleeperIDsByESPN(c: PlayerIDCrosswalk): Record<string, string> {
  const reverse: Record<string, string> = {}
  for (const [sleeperID, entry] of Object.entries(c.players)) {
    if (entry.espnId) reverse[entry.espnId] = sleeperID
  }
  return reverse
}

export function sleeperIDsByGSIS(c: PlayerIDCrosswalk): Record<string, string> {
  const reverse: Record<string, string> = {}
  for (const [sleeperID, entry] of Object.entries(c.players)) {
    if (entry.gsisId !== undefined) reverse[entry.gsisId] = sleeperID
  }
  return reverse
}

export interface Resolution {
  gsisBySleeperID: Record<string, string>
  /** No row in the file — team defenses always, plus anyone too new. */
  unmatched: string[]
}

/** Reports misses rather than dropping them, so the UI can state the gap. */
export function resolveSleeperIDs(c: PlayerIDCrosswalk, sleeperIDs: string[]): Resolution {
  const gsisBySleeperID: Record<string, string> = {}
  const unmatched: string[] = []
  for (const id of sleeperIDs) {
    const gsis = gsisID(c, id)
    if (gsis !== undefined) gsisBySleeperID[id] = gsis
    else unmatched.push(id)
  }
  return { gsisBySleeperID, unmatched }
}
