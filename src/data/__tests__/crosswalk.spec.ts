import { describe, expect, it } from 'vitest'
import {
  crosswalkNflverseTeam, crosswalkPosition, decodeCrosswalk, gsisID, isFreeAgent, resolveSleeperIDs, sleeperIDsByGSIS,
} from '@data/playerIdCrosswalk'
import { readFixture } from '../../../tests/swiftFixtures'

/** Port of PlayerIDCrosswalkTests, against the real shipped file. */
describe('PlayerIDCrosswalk', () => {
  const file = decodeCrosswalk(readFixture('FCData', 'player-ids.json'))
  const entries = Object.values(file.players)
  const withGSIS = Object.entries(file.players).find(([, e]) => e.gsisId !== undefined)!

  it('decodes the shipped file', () => {
    expect(entries.length).toBeGreaterThan(5000)
  })

  it('spells kickers PK and translates them to K', () => {
    const kickers = entries.filter((e) => e.positionCode === 'PK')
    expect(kickers.length).toBeGreaterThan(50)
    expect(entries.every((e) => e.positionCode !== 'K')).toBe(true)
    expect(kickers.every((e) => crosswalkPosition(e) === 'K')).toBe(true)
  })

  it('has no team defenses', () => {
    expect(entries.every((e) => e.positionCode !== 'DEF' && crosswalkPosition(e) !== 'DEF')).toBe(true)
  })

  it("collapses the IDP dialect to the app's positions", () => {
    const backs = entries.filter((e) => ['CB', 'S'].includes(e.positionCode ?? ''))
    const linemen = entries.filter((e) => ['DE', 'DT'].includes(e.positionCode ?? ''))
    expect(backs.length).toBeGreaterThan(100)
    expect(linemen.length).toBeGreaterThan(100)
    expect(backs.every((e) => crosswalkPosition(e) === 'DB')).toBe(true)
    expect(linemen.every((e) => crosswalkPosition(e) === 'DL')).toBe(true)
  })

  it('translates unmodelled positions to nothing', () => {
    const punters = entries.filter((e) => e.positionCode === 'PN')
    expect(punters.length).toBeGreaterThan(0)
    expect(punters.every((e) => crosswalkPosition(e) === undefined)).toBe(true)
  })

  it('resolves, reports defenses unmatched, and reverses', () => {
    const [sleeperID, entry] = withGSIS
    expect(gsisID(file, sleeperID)).toBe(entry.gsisId)
    const resolution = resolveSleeperIDs(file, [sleeperID, 'PHI', 'SF'])
    expect(Object.keys(resolution.gsisBySleeperID)).toHaveLength(1)
    expect(new Set(resolution.unmatched)).toEqual(new Set(['PHI', 'SF']))
    expect(sleeperIDsByGSIS(file)[entry.gsisId!]).toBe(sleeperID)
  })

  it('translates every team code to one the schedule contains', () => {
    const schedule = readFixture<{ byWeek: Record<string, { home?: string; away?: string }[]> }>('FCData', 'schedule-2025.json')
    const scheduleTeams = new Set(Object.values(schedule.byWeek).flat().flatMap((g) => [g.home, g.away]).filter(Boolean))
    expect(scheduleTeams.size).toBe(32)
    const untranslated = new Set(
      entries
        .filter((e) => !isFreeAgent(e) && e.team !== 'FA*' && e.team !== undefined)
        .map(crosswalkNflverseTeam)
        .filter((t) => t !== undefined && !scheduleTeams.has(t)),
    )
    expect([...untranslated]).toEqual([])
  })

  it('reads KCC as KC and flags free agents', () => {
    const chiefs = entries.filter((e) => e.team === 'KCC')
    expect(chiefs.length).toBeGreaterThan(0)
    expect(chiefs.every((e) => crosswalkNflverseTeam(e) === 'KC')).toBe(true)
    const fa = entries.filter((e) => e.team === 'FA')
    expect(fa.length).toBeGreaterThan(0)
    expect(fa.every(isFreeAgent)).toBe(true)
  })
})
