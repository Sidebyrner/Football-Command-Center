import { beforeEach, describe, expect, it } from 'vitest'
import { computeDvP, facing } from '@core/DefenseVsPosition'
import { decodeSchedule } from '@core/Schedule'
import type { WRCandidate } from '@core/streams/WRStream'
import { standardTransport } from '../../../../tests/appHarness'
import type { StubTransport } from '../../../../tests/stubTransport'
import { streamCandidateID } from '../StreamKind'
import { MemoryStreamStorage } from '../StreamStore'
import { WRCandidateBuilder } from '../WRCandidateBuilder'
import { WRStreamScreenModel } from '../WRStreamKind'
import { buildWRContext, parseWRContext } from '../WRWeekContext'
import { makeLoader, onFixture, testStore } from './streamHarness'

/**
 * Port of WRStreamScreenModelTests: WR Stream against the recorded week-2
 * 2026 Sleeper stat lines (receivers and quarterbacks) and the 2026
 * schedule's week-3 lines, under the real Whack-A-Mole receiving scoring.
 */

// From stats-2026-w2.json.
const boston = '13346'      // CLE, 7 tgt, 55-yd TD (40+ catch, 50+ TD)
const tucker = '10213'      // LV, mine, starting
const olave = '8144'        // NO, mine, starting
const smithNjigba = '9488'  // SEA, the rival's
const london = '8112'       // ATL, a carry; ATL has no QB line
const white = '7039'        // LV, 2 tgt, 7 of 63 snaps

function transport(): StubTransport {
  const t = standardTransport()
  t.override('/state/nfl', '{"week":3,"season":"2026","season_type":"regular"}')
  t.replace('/league/L1', `
    {"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":2,
     "roster_positions":["QB","WR","WR","BN","BN","BN"],
     "scoring_settings":{"pass_yd":0.04,"rec":0,"rec_yd":0.1,"rec_fd":1,"rec_td":6,"rush_yd":0.1,"rush_fd":1,
       "rush_td":6,"rec_30_39":1,"rec_40p":2,"rec_td_40p":4,"rec_td_50p":8,"bonus_rec_yd_200":5,
       "rec_2pt":2,"fum":-3,"fum_lost":-5},
     "settings":{"waiver_type":2,"waiver_budget":100,"waiver_day_of_week":2}}`)
  t.replace('/league/L1/rosters', `
    [{"roster_id":1,"owner_id":"u1","players":["qb1","${tucker}","${olave}"],
      "starters":["qb1","${tucker}","${olave}"],"settings":{"waiver_budget_used":20}},
     {"roster_id":2,"owner_id":"u2","players":["qb2","${smithNjigba}"],"starters":["qb2","${smithNjigba}"]}]`)
  t.replace('/players/nfl', `
    {"qb1":{"full_name":"Starter QB","position":"QB","team":"BUF","active":true},
     "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true},
     "${boston}":{"full_name":"Denzel Boston","position":"WR","team":"CLE","active":true},
     "${tucker}":{"full_name":"Tre Tucker","position":"WR","team":"LV","active":true},
     "${olave}":{"full_name":"Chris Olave","position":"WR","team":"NO","active":true},
     "${smithNjigba}":{"full_name":"Jaxon Smith-Njigba","position":"WR","team":"SEA","active":true},
     "${london}":{"full_name":"Drake London","position":"WR","team":"ATL","active":true},
     "${white}":{"full_name":"Cody White","position":"WR","team":"LV","active":true}}`)
  onFixture(t, '/stats/nfl/2026/2', 'stats-2026-w2')
  return t
}

describe('WRStreamScreenModel', () => {
  let storage: MemoryStreamStorage
  beforeEach(() => { storage = new MemoryStreamStorage() })

  async function model(t: StubTransport): Promise<WRStreamScreenModel> {
    const m = new WRStreamScreenModel(makeLoader(t), testStore(storage))
    await m.load('L1', 1)
    return m
  }

  const candidate = (m: WRStreamScreenModel, id: string): WRCandidate | undefined =>
    m.candidates.find((c) => streamCandidateID(c) === id)

  it("scores in the league's own receiving scoring", async () => {
    const m = await model(transport())
    expect(m.errorMessage).toBeUndefined()
    expect(m.leagueStartsKind).toBe(true)
    expect(m.scoring.firstDown).toBe(1)
    expect(m.scoring.bonus30 + m.scoring.bonus40).toBe(2)
    expect(m.scoring.touchdownBonus50).toBe(8)
    expect(m.unmodelledScoringKeys).toEqual(['bonus_rec_yd_200', 'rec_2pt'])
  })

  it('candidates are built from Sleeper lines', async () => {
    const m = await model(transport())
    const b = candidate(m, boston)!
    expect(b).toBeDefined()
    expect(b.team).toBe('CLE')
    expect(b.opponent).toBe('vs CAR')
    expect(b.spreadOff, 'CLE is a 2.5-point home underdog').toBe(2.5)
    expect(b.teamPassAttempts, "from the CLE quarterback's line").toBe(30)
    expect(b.teamGames).toBe(1)
    expect(b.statTargets).toBe(7)
    expect(b.targetShareLast1, '7 of the 18 CLE targets recorded').toBeDefined()
    expect(Math.abs(b.targetShareLast1! - 7.0 / 18.0), '7 of the 18 CLE targets recorded').toBeLessThanOrEqual(1e-9)
    expect(b.firstDowns).toBe(2)
    expect(b.adot).toBeDefined()
    expect(Math.abs(b.adot! - 45.0 / 7.0)).toBeLessThanOrEqual(1e-9)
    expect(b.catches30).toBe(1)
    expect(b.catches40).toBe(1)
    expect(b.catches50, 'his longest catch went 55').toBe(1)
    expect(b.dataFlags).toContain('50+ catches counted from longest catch only')
    expect(b.available).toBe(true)

    const p = m.projection(boston)!
    expect(p).toBeDefined()
    expect(p.eTouchdowns50).toBeGreaterThan(0)
    expect(p.expPts).toBeGreaterThan(0)
  })

  it('rushing usage makes a gadget and missing QB lines are flagged', async () => {
    const m = await model(transport())
    const l = candidate(m, london)!
    expect(l).toBeDefined()
    expect(l.role).toBe('GADGET')
    expect(l.rushAttemptsPerGame).toBe(1)
    expect(l.dataFlags).toContain('team pass attempts estimated from targets')
  })

  it('default starter is the weaker of my starting receivers', async () => {
    const m = await model(transport())
    const incumbent = m.report?.incumbent
    expect(incumbent).toBeDefined()
    expect([tucker, olave]).toContain(incumbent!.id)
    const other = m.projection(incumbent!.id === tucker ? olave : tucker)
    expect(other).toBeDefined()
    expect(incumbent!.expPts).toBeLessThanOrEqual(other!.expPts)
    expect(m.report?.ranked[0]?.pBeatIncumbent).toBeDefined()
  })

  it('any receiver can be compared or beaten and search forgives', async () => {
    const m = await model(transport())
    expect(m.rows.some((r) => r.id === smithNjigba), "the rival's receiver is hidden by default").toBe(false)
    expect(m.searchPlayers('jaxon smith njigba')[0]?.id).toBe(smithNjigba)
    expect(m.searchPlayers('bostn browns')[0]?.id).toBe(boston)

    await m.setIncumbent(smithNjigba)
    expect(m.report?.incumbent?.id).toBe(smithNjigba)
    expect(m.incumbentOwnerLabel).toBe("rival's starter")

    m.toggleCompare(boston)
    m.toggleCompare(tucker)
    const comparison = m.comparison
    expect(comparison).toBeDefined()
    expect(comparison!.players.map((p) => p.id)).toEqual([boston, tucker])
    expect(comparison!.verdict).toBeDefined()
  })

  it("recent games are scored in the league's settings", async () => {
    const m = await model(transport())
    const game = m.recentGames(boston)[0]
    expect(game).toBeDefined()
    expect(game!.week).toBe(2)
    expect(game!.targets).toBe(7)
    expect(game!.longCatches).toBe(1)
    // 95 yds + 2 first downs + a TD, plus 40+ catch (2), 40+ TD (4) and 50+ TD (8).
    expect(Math.abs(game!.points - (9.5 + 2 + 6 + 2 + 4 + 8))).toBeLessThanOrEqual(0.01)
  })

  it('snapshots are saved for the receiver stream', async () => {
    const m = await model(transport())
    expect(m.snapshots.length).toBe(1)
    const id = m.snapshots[0]?.id
    expect(id).toBeDefined()
    const snapshot = await m.loadSnapshot(id!)
    expect(snapshot).toBeDefined()
    expect(snapshot!.report).toEqual(m.report)
    expect(snapshot!.candidates.some((c) => streamCandidateID(c) === boston)).toBe(true)
  })
})

describe('WRRoleInference', () => {
  it('usage maps to roles', () => {
    expect(WRCandidateBuilder.inferRole(0.10, 8, 1.5)).toBe('GADGET')
    expect(WRCandidateBuilder.inferRole(0.15, 3, 0)).toBe('GADGET')
    expect(WRCandidateBuilder.inferRole(0.12, 16, 0)).toBe('DEEP')
    expect(WRCandidateBuilder.inferRole(0.28, 16, 0)).toBe('ALPHA')
    expect(WRCandidateBuilder.inferRole(0.18, 7, 0)).toBe('SLOT')
    expect(WRCandidateBuilder.inferRole(0.18, 11, 0)).toBe('BOUNDARY')
    expect(WRCandidateBuilder.inferRole(undefined, undefined, 0)).toBe('BOUNDARY')
  })
})

describe('WRContext', () => {
  it('import accepts either spread key and nested DvP', () => {
    const file = `
      {"teams":{"CLE":{"spreadOff":2.5,"total":42.5,"dvpPct":{"WR":-15},"dvpGames":2,"coverageAdj":0.9},
                "LAR":{"spreadDef":-2.5,"dvpPct":12}},
       "players":{"_comment":"x","13346":{"role":"DEEP","rzShare":0.3}}}`
    const overrides = parseWRContext(file)
    expect(overrides.teams.CLE?.dvpPct).toBe(-15)
    expect(overrides.teams.CLE?.coverageAdj).toBe(0.9)
    expect(overrides.teams.LA?.spreadOff, 'LAR lands on LA').toBe(-2.5)
    expect(overrides.teams.LA?.dvpPct).toBe(12)
    expect(overrides.players['13346']?.role).toBe('DEEP')
    expect(overrides.players['13346']?.redZoneShare).toBe(0.3)
  })

  it('matchup uses points allowed to receivers over the sample floor', () => {
    const schedule = decodeSchedule(JSON.parse(`
      {"byWeek":{"3":[{"home":"DEN","away":"LA","spreadLine":2.5,"totalLine":45.5}]}}`))
    const lines = [facing(1, 'WR', 'DEN', 45), facing(1, 'WR', 'LAR', 15)]
    const table = computeDvP(lines, new Set(['WR'] as const), 1)
    const teams = buildWRContext(schedule, 3, table)
    // The Rams' receivers face DEN, which allowed 45 against a 30 average.
    expect(teams.LA?.dvpPct).toBeDefined()
    expect(Math.abs(teams.LA!.dvpPct! - 50)).toBeLessThanOrEqual(1e-9)
    expect(teams.LA?.dvpSource).toBe('sleeperDvP')
    expect(teams.LA?.spreadOff, 'away underdog by 2.5').toBe(2.5)
    expect(teams.DEN?.coverageAdj).toBe(1)
  })
})
