import { beforeEach, describe, expect, it } from 'vitest'
import { computeDvP, facing } from '@core/DefenseVsPosition'
import { decodeSchedule } from '@core/Schedule'
import { tePointsBreakdown, type TECandidate } from '@core/streams/TEStream'
import { standardTransport } from '../../../../tests/appHarness'
import type { StubTransport } from '../../../../tests/stubTransport'
import { streamCandidateID } from '../StreamKind'
import { MemoryStreamStorage } from '../StreamStore'
import { TEStreamScreenModel } from '../TEStreamKind'
import { buildTEContext, parseTEContext } from '../TEWeekContext'
import { makeLoader, onFixture, testStore } from './streamHarness'

/**
 * Port of TEStreamScreenModelTests: TE Stream against the recorded week-2
 * 2026 Sleeper stat lines and the 2026 schedule's week-3 lines, under the
 * Whack-A-Mole receiving scoring plus a TE premium.
 *
 * The stat fixture is a sample of each team's lines, so team target totals
 * (and so target shares) run high; these tests check plumbing, not shares.
 */

// From stats-2026-w2.json.
const kelce = '1466'      // KC, mine, starting: 11 tgt, 6 first downs, a TD, 68 of 80 snaps
const schultz = '5001'    // HOU, free agent: 14 tgt; HOU has no QB line
const kincaid = '10236'   // BUF, the rival's
const adkins = '11433'    // DEN, free agent: 23 of 62 snaps

function transport(): StubTransport {
  const t = standardTransport()
  t.override('/state/nfl', '{"week":3,"season":"2026","season_type":"regular"}')
  t.replace('/league/L1', `
    {"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":2,
     "roster_positions":["QB","TE","BN","BN","BN"],
     "scoring_settings":{"pass_yd":0.04,"rec":0,"rec_yd":0.1,"rec_fd":1,"rec_td":6,"rush_yd":0.1,
       "rec_30_39":1,"rec_40p":2,"rec_td_40p":4,"rec_td_50p":8,"bonus_rec_yd_200":5,
       "bonus_rec_te":0.5,"rec_2pt":2,"fum":-3,"fum_lost":-5},
     "settings":{"waiver_type":2,"waiver_budget":100,"waiver_day_of_week":2}}`)
  t.replace('/league/L1/rosters', `
    [{"roster_id":1,"owner_id":"u1","players":["qb1","${kelce}"],
      "starters":["qb1","${kelce}"],"settings":{"waiver_budget_used":20}},
     {"roster_id":2,"owner_id":"u2","players":["qb2","${kincaid}"],"starters":["qb2","${kincaid}"]}]`)
  t.replace('/players/nfl', `
    {"qb1":{"full_name":"Starter QB","position":"QB","team":"BUF","active":true},
     "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true},
     "${kelce}":{"full_name":"Travis Kelce","position":"TE","team":"KC","active":true},
     "${schultz}":{"full_name":"Dalton Schultz","position":"TE","team":"HOU","active":true},
     "${kincaid}":{"full_name":"Dalton Kincaid","position":"TE","team":"BUF","active":true},
     "${adkins}":{"full_name":"Nate Adkins","position":"TE","team":"DEN","active":true}}`)
  onFixture(t, '/stats/nfl/2026/2', 'stats-2026-w2')
  return t
}

const near = (actual: number | undefined, expected: number, message?: string) => {
  expect(actual, message).toBeDefined()
  expect(Math.abs(actual! - expected), message).toBeLessThanOrEqual(1e-9)
}

describe('TEStreamScreenModel', () => {
  let storage: MemoryStreamStorage
  beforeEach(() => { storage = new MemoryStreamStorage() })

  async function model(t: StubTransport): Promise<TEStreamScreenModel> {
    const m = new TEStreamScreenModel(makeLoader(t), testStore(storage))
    await m.load('L1', 1)
    return m
  }

  const candidate = (m: TEStreamScreenModel, id: string): TECandidate | undefined =>
    m.candidates.find((c) => streamCandidateID(c) === id)

  it("scores in the league's own scoring with TE premium", async () => {
    const m = await model(transport())
    expect(m.errorMessage).toBeUndefined()
    expect(m.leagueStartsKind).toBe(true)
    expect(m.scoring.firstDown).toBe(1)
    expect(m.scoring.premiumReception).toBe(0.5)
    expect(m.scoring.bonus30 + m.scoring.bonus40).toBe(2)
    expect(m.unmodelledScoringKeys).toEqual(['bonus_rec_yd_200', 'rec_2pt'])

    const k = m.projection(kelce)!
    expect(k).toBeDefined()
    const premium = tePointsBreakdown(k, m.scoring).find((s) => s.stat === 'TE premium')
    expect(premium).toBeDefined()
    near(premium!.points, 0.5 * k.eRec)
  })

  it('candidates are built from Sleeper lines', async () => {
    const m = await model(transport())
    const k = candidate(m, kelce)!
    expect(k).toBeDefined()
    expect(k.team).toBe('KC')
    expect(k.opponent).toBe('@MIA')
    expect(k.spreadOff, 'KC is an 11.5-point road favourite').toBe(-11.5)
    expect(k.teamPassAttempts, "from the KC quarterback's line").toBe(47)
    expect(k.statTargets).toBe(11)
    expect(k.firstDowns).toBe(6)
    expect(k.touchdowns).toBe(1)
    near(k.snapShare, 68.0 / 80.0)
    near(k.redZoneShare, 1.0 / 3.0)
    near(k.adot, 35.0 / 11.0)
    expect(k.role).toBe('FEATURED')
    expect(k.available, 'on my roster').toBe(false)
    expect(k.dataFlags).toContain('routes estimated from snap share by role')

    const p = m.projection(kelce)!
    expect(p).toBeDefined()
    near(p.estRouteShare, (68.0 / 80.0) * 0.85)
    expect(p.expPts).toBeGreaterThan(0)

    const s = candidate(m, schultz)!
    expect(s).toBeDefined()
    expect(s.available).toBe(true)
    expect(s.dataFlags).toContain('team pass attempts estimated from targets')
  })

  it('only tight ends are candidates', async () => {
    const m = await model(transport())
    expect(m.candidates.length).toBeGreaterThan(0)
    const ids = new Set(m.candidates.map(streamCandidateID))
    for (const id of [kelce, schultz, adkins]) expect(ids.has(id), id).toBe(true)
    expect(ids.has('qb1')).toBe(false)
  })

  it('default starter is my starting tight end', async () => {
    const m = await model(transport())
    expect(m.report?.incumbent?.id).toBe(kelce)
    expect(m.rows.some((r) => r.id === kincaid), "the rival's TE is hidden by default").toBe(false)
    const best = m.report?.ranked.find((p) => p.id === schultz)
    expect(best).toBeDefined()
    expect(best!.pBeatIncumbent).toBeDefined()
    expect(best!.bidBand).toBeDefined()
  })

  it('player overrides reach the engine', async () => {
    const m = await model(transport())
    await m.setPlayerOverride({ role: 'ROTATIONAL', vacatedTargetBoost: 0.05 }, kelce)
    const k = candidate(m, kelce)!
    expect(k.role).toBe('ROTATIONAL')
    expect(k.vacatedTargetBoost).toBe(0.05)
    const p = m.projection(kelce)!
    near(p.estRouteShare, (68.0 / 80.0) * 0.55, 'an inline role blocks more')
    expect(p.vacatedTargetBoost).toBe(0.05)
  })

  it('compare gives a verdict', async () => {
    const m = await model(transport())
    m.toggleCompare(schultz)
    m.toggleCompare(kelce)
    const comparison = m.comparison
    expect(comparison).toBeDefined()
    expect(comparison!.players.map((p) => p.id)).toEqual([schultz, kelce])
    expect(comparison!.verdict).toBeDefined()
  })

  it('recent games carry red zone and snaps', async () => {
    const m = await model(transport())
    const game = m.recentGames(kelce)[0]
    expect(game).toBeDefined()
    expect(game!.week).toBe(2)
    expect(game!.targets).toBe(11)
    expect(game!.redZoneTargets).toBe(1)
    near(game!.snapShare, 68.0 / 80.0)
  })
})

describe('TEContext', () => {
  it('import reads TE keys', () => {
    const file = `
      {"teams":{"MIA":{"spreadOff":11.5,"dvpPct":{"TE":20},"dvpGames":2,"seamCoverageAdj":1.15},
                "LAR":{"spreadDef":-2.5,"teCoverageAdj":0.9}},
       "players":{"_comment":"x","1466":{"role":"SEAM","vacatedTargetBoost":0.04}}}`
    const overrides = parseTEContext(file)
    expect(overrides.teams.MIA?.dvpPct).toBe(20)
    expect(overrides.teams.MIA?.seamCoverageAdj).toBe(1.15)
    expect(overrides.teams.LA?.seamCoverageAdj).toBe(0.9)
    expect(overrides.players['1466']?.role).toBe('SEAM')
    expect(overrides.players['1466']?.vacatedTargetBoost).toBe(0.04)
  })

  it('matchup uses points allowed to tight ends', () => {
    const schedule = decodeSchedule(JSON.parse(`
      {"byWeek":{"3":[{"home":"DEN","away":"LA","spreadLine":2.5,"totalLine":45.5}]}}`))
    const lines = [
      facing(1, 'TE', 'DEN', 15), facing(1, 'TE', 'LAR', 5),
      facing(1, 'WR', 'DEN', 5), facing(1, 'WR', 'LAR', 45),
    ]
    const table = computeDvP(lines, new Set(['WR', 'TE'] as const), 1)
    const teams = buildTEContext(schedule, 3, table)
    // The Rams' tight ends face DEN, which allowed 15 against a 10 TE average.
    near(teams.LA?.dvpPct, 50)
    expect(teams.DEN?.seamCoverageAdj).toBe(1)
  })
})
