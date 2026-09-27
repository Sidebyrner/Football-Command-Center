import { describe, expect, it } from 'vitest'
import { POSITIONS } from '@core/Position'
import {
  DepthChartFile, InjuryReportFile, TeamContextFile, UsageFile, designationSeverity, generatedAt,
} from '@core/InSeasonFiles'
import { readFixture } from '../../../tests/swiftFixtures'

/**
 * Port of InSeasonFilesTests: the four in-season files, decoded from the real
 * shipped 2026 outputs of the preprocess script. Assertions are against what
 * the pipeline actually wrote, not a hand-typed fixture.
 */
const injuries = () => new InjuryReportFile(readFixture('FCCore', 'injuries-2026.json'))
const depth = () => new DepthChartFile(readFixture('FCCore', 'depth-2026.json'))
const usage = () => new UsageFile(readFixture('FCCore', 'usage-2026.json'))
const context = () => new TeamContextFile(readFixture('FCCore', 'context-2026.json'))

describe('InjuryReportFile', () => {
  it('decodes designations and practice status', () => {
    const file = injuries()
    expect(file.fileMeta?.season).toBe(2026)
    expect(file.weeks.length).toBeGreaterThan(0)
    expect(generatedAt(file.fileMeta)).toBeDefined()

    const latest = file.weeks[file.weeks.length - 1]!
    const reports = file.reports(latest)
    expect(reports.length).toBeGreaterThan(100)

    // Every designation and practice value in the file is one the enum knows;
    // an unknown one would silently read as undefined, so count them.
    const designated = reports.filter((r) => r.designation !== undefined)
    expect(designated.length).toBeGreaterThan(20)
    expect(reports.some((r) => r.practice === 'DNP')).toBe(true)
    expect(reports.some((r) => r.practice === 'FULL')).toBe(true)
    expect(reports.some((r) => r.designation === 'Out')).toBe(true)
    // positions are in Sleeper's dialect
    expect(reports.every((r) => r.position !== undefined)).toBe(true)

    const byPlayer = file.reportsByPlayer(latest)
    expect(byPlayer.size).toBe(reports.length)
    expect(file.reports(99)).toEqual([])
  })

  it('orders designations worst first', () => {
    expect(designationSeverity('Out')).toBeLessThan(designationSeverity('Doubtful'))
    expect(designationSeverity('Doubtful')).toBeLessThan(designationSeverity('Questionable'))
  })
})

describe('DepthChartFile', () => {
  it('covers every team in nflverse spelling', () => {
    const file = depth()
    expect(file.teamCount).toBe(32)
    expect(file.chart('LA', 'RB').length).toBeGreaterThan(0)
    // A Sleeper spelling is normalised at the boundary.
    expect(file.chart('LAR', 'RB')).toEqual(file.chart('LA', 'RB'))
    expect(file.chart(undefined, 'RB')).toEqual([])

    for (const position of POSITIONS) {
      if (position === 'DEF') continue
      expect(file.chart('KC', position).length, `KC has no ${position} group`).toBeGreaterThan(0)
    }
    expect(file.chart('KC', 'K')).toHaveLength(1)
  })

  /** Rank and "who is behind him" — the handcuff question. */
  it('reports depth rank and the players behind', () => {
    const file = depth()
    const backs = file.chart('PIT', 'RB')
    expect(backs.length).toBeGreaterThanOrEqual(3)
    const starter = backs[0]!
    expect(file.rank(starter, 'PIT', 'RB')).toBe(0)
    expect(file.behind(starter, 'PIT', 'RB')).toEqual(backs.slice(1))
    expect(file.rank('nobody', 'PIT', 'RB')).toBeUndefined()
    expect(file.behind('nobody', 'PIT', 'RB')).toEqual([])
  })
})

describe('UsageFile', () => {
  it('decodes snaps, expected points and contact stats', () => {
    const file = usage()
    expect(file.playerCount).toBeGreaterThan(1_000)

    const gibbs = Object.entries(file.meta).find(([, m]) => m.name === 'Jahmyr Gibbs')?.[0]
    expect(gibbs).toBeDefined()
    expect(file.metaPosition(gibbs!)).toBe('RB')
    expect(file.meta[gibbs!]?.team).toBe('DET')
    const weeks = file.weeks(gibbs!)
    expect(weeks.map((w) => w.week)).toEqual([1, 2])
    const week1 = weeks[0]!
    expect(week1.offensiveSnaps).toBe(57)
    expect(Math.abs(week1.offensiveSnapShare! - 0.74)).toBeLessThanOrEqual(0.001)
    expect(Math.abs(week1.expectedPoints! - 32.96)).toBeLessThanOrEqual(0.001)
    expect(week1.rushAttempts).toBe(29)
    expect(week1.targets).toBe(5)
    expect(week1.yardsBeforeContactPerAttempt).toBeDefined()
    expect(file.recentWeeks(gibbs!, 1).map((w) => w.week)).toEqual([2])
  })

  /** An IDP has defensive snaps and nothing else — every offensive column is absent, not zero. */
  it('keeps absent sources as undefined', () => {
    const file = usage()
    const linebacker = Object.keys(file.meta).find((id) => file.metaPosition(id) === 'LB' && file.weeks(id).length > 0)
    expect(linebacker).toBeDefined()
    const week = file.weeks(linebacker!)[0]!
    expect(week.defensiveSnaps).toBeDefined()
    expect(week.expectedPoints).toBeUndefined()
    expect(week.targets).toBeUndefined()
    expect(file.weeks('nobody')).toEqual([])
  })

  /** A column the decoder does not know is ignored; one it expects but the file lacks reads as absent, never zero (§9). */
  it('tolerates unknown and missing fields', () => {
    const file = new UsageFile(JSON.parse('{"fields":["week","off_snp","brand_new_column"],"meta":{},"players":{"p":[[3,40,99]]}}'))
    const week = file.weeks('p')[0]
    expect(week).toBeDefined()
    expect(week!.week).toBe(3)
    expect(week!.offensiveSnaps).toBe(40)
    expect(week!.expectedPoints).toBeUndefined()
  })
})

describe('TeamContextFile', () => {
  it('decodes every team-week', () => {
    const file = context()
    expect(file.teamCount).toBe(32)
    const kc = file.weeks('KC')
    expect(kc.map((w) => w.week)).toEqual([1, 2])
    expect(kc[0]!.opponent).toBe('DEN')
    expect(kc[0]!.plays).toBe(67)
    expect(Math.abs(kc[0]!.pressureRate! - 0.182)).toBeLessThanOrEqual(0.0005)
    expect(kc[0]!.sacksAllowed).toBe(2)
    expect(kc[0]!.qbr).toBeDefined()
    expect(kc[0]!.passerRating).toBeDefined()
    expect(Math.abs(kc[0]!.topTargetShare! - 0.24)).toBeLessThanOrEqual(0.001)
    // Sleeper's spelling resolves to the same rows.
    expect(file.weeks('LAR').map((w) => w.week)).toEqual(file.weeks('LA').map((w) => w.week))
    expect(Object.keys(file.allTeams())).toHaveLength(32)
  })

  /** PFR publishes late: a team-week without a pfr row carries undefined pressure and sacks — a different claim from zero. */
  it('keeps unpublished columns undefined', () => {
    const file = context()
    const unpublished = Object.values(file.allTeams()).flat().filter((w) => w.pressureRate === undefined)
    // the fixture was taken while week 2 pfr data was partial
    expect(unpublished.length).toBeGreaterThan(0)
    for (const week of unpublished) {
      expect(week.sacksAllowed).toBeUndefined()
      // plays come from nflverse and are always present
      expect(week.plays).toBeDefined()
    }
  })
})
