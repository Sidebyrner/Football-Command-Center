/**
 * Defense-vs-position from both sources, each used only for the positions it
 * covers — a port of FCApp `DefenseLookup`. nflverse for the offensive
 * positions; Sleeper's lines this season for the rest, the only path that
 * ranks defenses against IDP.
 */
import { computeDvP, computeDvPFromWeekly, dvpCell, dvpCovers, EMPTY_DVP, facing, type DefenseCell, type DefenseFacing, type DefenseVsPositionTable } from '@core/DefenseVsPosition'
import { POSITIONS, type Position } from '@core/Position'
import { linePosition, played, scoreLine } from '@data/insightsModels'
import type { LeagueContext } from '../league/LeagueContext'

export type DefenseSource = { kind: 'nflverse'; season: number } | { kind: 'sleeper'; season: number }

export const defenseSourceLabel = (s: DefenseSource) =>
  s.kind === 'nflverse' ? `nflverse ${s.season} weekly stats` : `Sleeper ${s.season} stat lines`

export class DefenseLookup {
  static readonly empty = new DefenseLookup(EMPTY_DVP, EMPTY_DVP, 0, 0)

  constructor(
    readonly nflverse: DefenseVsPositionTable,
    readonly sleeper: DefenseVsPositionTable,
    /** The season the nflverse table scores; Sleeper's is always the schedule season. */
    readonly nflverseSeason: number,
    readonly sleeperSeason: number,
  ) {}

  /** nflverse when it has anyone at the position, Sleeper otherwise. */
  source(position: Position | undefined): DefenseSource | undefined {
    if (!position) return undefined
    if (dvpCovers(this.nflverse, position)) return { kind: 'nflverse', season: this.nflverseSeason }
    if (dvpCovers(this.sleeper, position)) return { kind: 'sleeper', season: this.sleeperSeason }
    return undefined
  }

  cell(defense: string | undefined, position: Position | undefined): DefenseCell | undefined {
    const s = this.source(position)
    if (!s) return undefined
    return dvpCell(s.kind === 'nflverse' ? this.nflverse : this.sleeper, defense, position)
  }

  leagueAverage(position: Position | undefined): number | undefined {
    const s = this.source(position)
    if (!s || !position) return undefined
    return (s.kind === 'nflverse' ? this.nflverse : this.sleeper).leagueAverage[position]
  }

  /** Scoring every row of a season is the expensive part of a screen build. */
  static build(context: LeagueContext): DefenseLookup {
    const nflverse = computeDvPFromWeekly(context.weekly, context.scoring.profile)
    const scoring = context.league.scoringSettings ?? {}
    const lines: DefenseFacing[] = []
    for (const [week, byID] of context.inSeason.weekStats) {
      for (const line of byID.values()) {
        const position = linePosition(line)
        if (!played(line) || !position || position === 'DEF' || !line.opponent) continue
        lines.push(facing(week, position, line.opponent, scoreLine(line, scoring).points))
      }
    }
    const sleeper = computeDvP(lines, new Set(POSITIONS.filter((p) => p !== 'DEF')))
    return new DefenseLookup(nflverse, sleeper, context.statsSeason, context.scheduleSeason)
  }
}
