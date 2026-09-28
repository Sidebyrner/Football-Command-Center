/**
 * Completed weeks for the whole league — a port of FCApp `SeasonHistory` and
 * `RosterWeek`.
 *
 * A finished week's scores never change, so these are read through
 * `completedMatchups` on the long TTL — the 5-minute roster TTL would have
 * every season aggregate re-fetching every past week every five minutes.
 */
import { live, weakestProvenance, type Provenance } from '@data/fetched'
import type { LeagueDataSource } from '@data/LeagueDataSource'

/** One roster's week, as Sleeper reported it after the fact. */
export interface RosterWeek {
  week: number
  rosterID: number
  /** Rosters sharing a matchup id played each other that week. */
  matchupID?: number
  points?: number
  /** Positionally aligned to the starting slots, `"0"` for unset. */
  starters: string[]
  players: string[]
  /**
   * Per-player points for that week. A player absent from this map is a
   * player Sleeper gave no number for, which is **not** the same as zero.
   */
  playersPoints: Record<string, number>
}

/** Points for one player, or `undefined` when Sleeper reported none (Swift `points(for:)`). */
export function rosterWeekPoints(week: RosterWeek, playerID: string): number | undefined {
  return Object.prototype.hasOwnProperty.call(week.playersPoints, playerID) ? week.playersPoints[playerID] : undefined
}

export class SeasonHistory {
  static readonly empty = new SeasonHistory([], new Map(), live)

  constructor(
    readonly weeks: number[],
    readonly byRoster: ReadonlyMap<number, RosterWeek[]>,
    readonly provenance: Provenance,
  ) {}

  weeksForRoster(rosterID: number): RosterWeek[] {
    return [...(this.byRoster.get(rosterID) ?? [])].sort((a, b) => a.week - b.week)
  }

  /** Every roster's total for one week, for ranking the field. */
  totals(week: number): Map<number, number> {
    const out = new Map<number, number>()
    for (const [rosterID, weeks] of this.byRoster) {
      const points = weeks.find((w) => w.week === week)?.points
      if (points !== undefined) out.set(rosterID, points)
    }
    return out
  }

  /**
   * Season points per player id, summed across every loaded week.
   *
   * This is the currency draft picks are graded in: what a player actually
   * produced, not what anyone projected.
   */
  actualPointsByPlayer(): Map<string, number> {
    const out = new Map<string, number>()
    for (const weeks of this.byRoster.values()) {
      for (const week of weeks) {
        for (const [playerID, points] of Object.entries(week.playersPoints)) {
          out.set(playerID, (out.get(playerID) ?? 0) + points)
        }
      }
    }
    return out
  }

  /**
   * Loads every completed week up to but not including `currentWeek`.
   *
   * The current week is excluded on purpose: it is still being played, so
   * including it would make "points left on your bench" accuse the user of
   * a mistake they can still fix.
   */
  static async load(
    sleeper: LeagueDataSource, leagueID: string, currentWeek: number): Promise<SeasonHistory> {
    const completed: number[] = []
    for (let w = 1; w < Math.max(1, currentWeek); w++) completed.push(w)
    if (completed.length === 0) return SeasonHistory.empty

    const byRoster = new Map<number, RosterWeek[]>()
    const loaded: number[] = []
    const provenances: Provenance[] = []

    for (const week of completed) {
      // A week that fails to load is skipped rather than failing the
      // screen — a missing week 3 should not cost the user weeks 1 and 2.
      let fetched
      try {
        fetched = await sleeper.completedMatchups(leagueID, week)
      } catch {
        continue
      }

      provenances.push(fetched.provenance)
      loaded.push(week)

      for (const matchup of fetched.value) {
        const entry: RosterWeek = {
          week,
          rosterID: matchup.rosterID,
          matchupID: matchup.matchupID,
          points: matchup.points,
          starters: matchup.starters ?? [],
          players: matchup.players ?? [],
          playersPoints: matchup.playersPoints ?? {},
        }
        let list = byRoster.get(matchup.rosterID)
        if (!list) byRoster.set(matchup.rosterID, (list = []))
        list.push(entry)
      }
    }

    return new SeasonHistory([...loaded].sort((a, b) => a - b), byRoster, weakestProvenance(provenances))
  }
}
