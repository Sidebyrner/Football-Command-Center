import { describe, expect, it } from 'vitest'
import { DEFAULT_GRADE_WEIGHT, GRADE_KEY } from '@core/PlayerGrade'
import { LeagueContextLoader } from '@models/league/LeagueContextLoader'
import { PlayerCardModel } from '@models/player/PlayerCardModel'
import { PlayerCardCache } from '@models/workspaces/PlayerCardCache'
import { makeHarness, standardTransport, TestClock } from '../../../../tests/appHarness'
import { fixtureText } from '../../../../tests/swiftFixtures'
import { WorkspaceFixture as F } from '../../../../tests/workspaceFixture'

const SMITH_NJIGBA = '9488'
const GIBBS = '9221'

/**
 * The Player Card against recorded 2026 payloads: week-2 stat lines (served
 * for weeks 1 and 2), week-3 projections, and the shipped usage, depth and
 * team context files.
 */
async function context({ projectionsForPlayer = true } = {}) {
  const t = standardTransport()
    .override('/state/nfl', '{"week":3,"season":"2026","season_type":"regular"}')
    .replace('/league/L1', `
            {"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":2,
             "roster_positions":["RB","WR","BN"],
             "scoring_settings":{"rec":0,"rec_yd":0.1,"rec_td":6,"rush_yd":0.1,"rush_td":6,"rec_fd":1,"rush_fd":1}}`)
    .replace('/league/L1/rosters', `
            [{"roster_id":1,"owner_id":"u1","players":["${GIBBS}"],"starters":["${GIBBS}","0"]},
             {"roster_id":2,"owner_id":"u2","players":[],"starters":["0","0"]}]`)
    .replace('/players/nfl', `
            {"${GIBBS}":{"full_name":"Jahmyr Gibbs","position":"RB","team":"DET","active":true},
             "${SMITH_NJIGBA}":{"full_name":"Jaxon Smith-Njigba","position":"WR","team":"SEA","active":true,
                                    "injury_status":"Questionable","injury_body_part":"Ankle"}}`)
    .json('/projections/nfl/2026/3', fixtureText('FCApp', 'projections-2026-w3.json'))
    .json('/stats/nfl/2026/1', fixtureText('FCApp', 'stats-2026-w2.json'))
    .json('/stats/nfl/2026/2', fixtureText('FCApp', 'stats-2026-w2.json'))
  if (projectionsForPlayer) {
    // Rotowire's week-by-week line for JSN, keyed by week as Sleeper sends it.
    t.override(`/projections/nfl/player/${SMITH_NJIGBA}`, `
                {"1":{"player_id":"${SMITH_NJIGBA}","week":1,"stats":{"rec_yd":70,"rec_td":0.5,"rec_fd":4},"company":"rotowire"},
                 "2":{"player_id":"${SMITH_NJIGBA}","week":2,"stats":{"rec_yd":80,"rec_td":0.6,"rec_fd":4},"company":"rotowire"},
                 "3":{"player_id":"${SMITH_NJIGBA}","week":3,"stats":{"rec_yd":75,"rec_td":0.5,"rec_fd":4},"company":"rotowire"}}`)
  }
  t.json(`/players/nfl/${SMITH_NJIGBA}/news`, '[]')
  const { sleeper, staticData } = makeHarness(t)
  const loader = new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs)
  return { context: await loader.load({ leagueID: 'L1', userRosterID: 1 }), sleeper }
}

/** Port of PlayerCardModelTests. */
describe('PlayerCardModel', () => {
  it('overview joins status, depth and lines', async () => {
    const { context: c, sleeper } = await context()
    const model = new PlayerCardModel(SMITH_NJIGBA, c, sleeper)
    const status = model.status!
    expect(status).toBeDefined()
    expect(status.availability.kind).toBe('freeAgent')
    expect(status.sleeperTag).toBe('Questionable')
    expect(status.bodyPart).toBe('Ankle')
    expect(status.depthRank, "listed on SEA's official WR chart").toBeDefined()
    expect(status.byeWeek).toBeDefined()
    expect(model.rotowireThisWeek).toBeDefined()
  })

  it('grade ranks against the position cohort and chips stay separate', async () => {
    const { context: c, sleeper } = await context()
    const model = new PlayerCardModel(SMITH_NJIGBA, c, sleeper)
    const grade = model.grade!
    expect(grade).toBeDefined()
    expect(grade.score).toBeDefined()
    expect(grade.cohortSize).toBeGreaterThan(11)
    expect(grade.factors.some((f) => f.metric === 'targetShare')).toBe(true)
    expect(grade.factors.some((f) => f.metric === 'pointsPerGame')).toBe(true)
    // A three-touchdown week puts him at the very top of the receivers.
    expect(grade.factors.find((f) => f.metric === 'pointsPerGame')!.percentile).toBeGreaterThanOrEqual(0.95)

    const chipMetrics = new Set(model.chips.map((c) => c.metric))
    expect(chipMetrics.has('quarterbackPlay'), 'SEA has QBR in the team context file').toBe(true)
    expect(chipMetrics.has('targetCompetition')).toBe(true)
    expect(chipMetrics.has('depthChartRank')).toBe(true)
    expect(model.chips.find((c) => c.metric === 'depthChartRank')?.percentile, 'a rank is a fact, not a percentile').toBeUndefined()
  })

  it('weighted view is opt-in and persists its weights', async () => {
    const { context: c, sleeper } = await context()
    let saved: Record<string, number> | undefined
    const model = new PlayerCardModel(SMITH_NJIGBA, c, sleeper, {}, (w) => { saved = w })
    expect(model.showWeighted).toBe(false)
    expect(model.weight(GRADE_KEY)).toBe(DEFAULT_GRADE_WEIGHT)
    const before = model.weighted!
    expect(before).toBeDefined()
    // Swift mutates `weights[key]` in place, which fires `didSet`; here that is an assignment.
    model.weights = { ...model.weights, [GRADE_KEY]: 0 }
    expect(saved?.[GRADE_KEY]).toBe(0)
    const after = model.weighted!
    expect(after).toBeDefined()
    expect(after.parts.some((p) => p.name === 'Cohort grade')).toBe(false)
    expect(before.parts.length).not.toBe(after.parts.length)
  })

  it('calibration compares both projections with what happened', async () => {
    const { context: c, sleeper } = await context()
    const model = new PlayerCardModel(SMITH_NJIGBA, c, sleeper)
    await model.load()
    expect(model.calibration.map((w) => w.week)).toEqual([2, 1])
    const week2 = model.calibration[0]!
    // 155 yards, 3 touchdowns, 5 first downs under the fixture's rules.
    expect(Math.abs(week2.actual - 38.5)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(week2.rotowire! - (8 + 3.6 + 4))).toBeLessThanOrEqual(0.01)
    expect(week2.commandCenter).toBeDefined()
    const summary = model.calibrationSummary!
    expect(summary.weeks).toBe(2)
    expect(summary.rotowireError).toBeDefined()
    expect(summary.commandCenterError).toBeDefined()
    // The log carries each week's projection beside the result.
    expect(model.log[0]?.week, "this week's projection appears before the game").toBe(3)
    expect(model.log[0]?.points).toBeUndefined()
  })

  it('without per-player projections the card still builds', async () => {
    const { context: c, sleeper } = await context({ projectionsForPlayer: false })
    const model = new PlayerCardModel(SMITH_NJIGBA, c, sleeper)
    await model.load()
    expect(model.calibration.length).toBe(2)
    expect(model.calibration[0]?.rotowire).toBeUndefined()
    expect(model.calibration[0]?.commandCenter).toBeDefined()
  })
})

/** Port of AppServicesTests.testThePlayerCardCacheEvictsTheLeastRecent (WorkspaceFixture.swift). */
describe('PlayerCardCache', () => {
  it('evicts the least recent', async () => {
    const c = await F.context()
    const cache = new PlayerCardCache(2)
    const make = (id: string) => cache.model(id, () => new PlayerCardModel(id, c, undefined))
    const a = make('a')
    make('b')
    expect(make('a') === a, 'touching a makes b the oldest').toBe(true)
    make('c')
    expect(cache.count).toBe(2)
    expect(make('a') === a).toBe(true)
  })

  it('removeAll starts fresh', async () => {
    const c = await F.context()
    const cache = new PlayerCardCache()
    const first = cache.model(F.cook, () => new PlayerCardModel(F.cook, c, undefined))
    expect(cache.model(F.cook, () => new PlayerCardModel(F.cook, c, undefined))).toBe(first)
    expect(cache.model(F.gibbs, () => new PlayerCardModel(F.gibbs, c, undefined))).not.toBe(first)
    cache.removeAll()
    expect(cache.model(F.cook, () => new PlayerCardModel(F.cook, c, undefined)), 'a reload starts fresh').not.toBe(first)
  })
})
