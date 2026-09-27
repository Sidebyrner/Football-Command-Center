/**
 * A league-relative letter grade per roster from two named parts — a port of
 * FCCore `TeamGrades`: Lineup (best lineup, scaled weakest 0 → strongest 100)
 * and Depth (share of remaining weeks it can field every slot), 65 / 35.
 */
import { roundAwayFromZero } from './rounding'

export interface TeamGrade {
  rosterID: number
  lineupPoints?: number
  lineupScore?: number
  depthScore: number
  score?: number
  letter?: string
  /** 1 is the best in the league. */
  rank?: number
}

export interface TeamGradeInput {
  rosterID: number
  lineupPoints?: number
  /** Remaining weeks with any unfilled slot. */
  shortWeeks: number
  remainingWeeks: number
}

export const LINEUP_WEIGHT = 0.65
export const DEPTH_WEIGHT = 0.35
const BANDS: [number, string][] = [[90, 'A+'], [80, 'A'], [70, 'B+'], [60, 'B'], [50, 'C+'], [40, 'C'], [30, 'D'], [0, 'F']]

export const gradeLetter = (score: number) => BANDS.find(([min]) => score >= min)?.[1] ?? 'F'

export function gradeTeams(teams: readonly TeamGradeInput[]): TeamGrade[] {
  const points = teams.map((t) => t.lineupPoints).filter((p): p is number => p !== undefined)
  const low = points.length ? Math.min(...points) : 0
  const high = points.length ? Math.max(...points) : 0
  const graded = teams.map((team) => {
    const depth = team.remainingWeeks > 0 ? (100 * (team.remainingWeeks - team.shortWeeks)) / team.remainingWeeks : 100
    if (team.lineupPoints === undefined) return { team, lineup: undefined, depth: roundAwayFromZero(depth), composite: undefined }
    const lineup = high > low ? (100 * (team.lineupPoints - low)) / (high - low) : 50
    return { team, lineup: roundAwayFromZero(lineup), depth: roundAwayFromZero(depth), composite: lineup * LINEUP_WEIGHT + depth * DEPTH_WEIGHT }
  })
  const order = graded.map((g) => g.composite).filter((c): c is number => c !== undefined).sort((a, b) => b - a)
  return graded.map(({ team, lineup, depth, composite }) => {
    const out: TeamGrade = { rosterID: team.rosterID, depthScore: depth }
    if (team.lineupPoints !== undefined) out.lineupPoints = team.lineupPoints
    if (lineup !== undefined) out.lineupScore = lineup
    if (composite !== undefined) {
      out.score = roundAwayFromZero(composite)
      out.letter = gradeLetter(composite)
      out.rank = order.indexOf(composite) + 1
    }
    return out
  })
}
