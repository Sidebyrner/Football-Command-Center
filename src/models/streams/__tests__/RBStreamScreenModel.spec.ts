import { beforeEach, describe, expect, it } from 'vitest'
import { computeDvP, facing } from '@core/DefenseVsPosition'
import { decodeSchedule } from '@core/Schedule'
import type { RBCandidate } from '@core/streams/RBStream'
import { standardTransport } from '../../../../tests/appHarness'
import type { StubTransport } from '../../../../tests/stubTransport'
import { RBCandidateBuilder } from '../RBCandidateBuilder'
import { RBStreamScreenModel } from '../RBStreamKind'
import { buildRBContext, parseRBContext, rbTeamImplied } from '../RBWeekContext'
import { streamCandidateID } from '../StreamKind'
import { MemoryStreamStorage } from '../StreamStore'
import { parseWRContext } from '../WRWeekContext'
import { makeLoader, onFixture, testStore } from './streamHarness'

/**
 * Port of RBStreamScreenModelTests: RB Stream against the recorded week-2
 * 2026 Sleeper stat lines and the 2026 schedule's week-3 lines, under the
 * real Whack-A-Mole rushing scoring.
 */

// From stats-2026-w2.json.
const cook = '8138'        // BUF, 21 of the 35 BUF carries, a 35-yd run, 4 of 7 RZ carries
const hampton = '12507'    // LAC, lost a fumble
const henderson = '12529'  // NE, a 39-yd run
const taylor = '6813'      // IND, mine, starting
const henry = '3198'       // BAL, mine, starting
const gibbs = '9221'       // DET, the rival's

function transport(): StubTransport {
  const t = standardTransport()
  t.override('/state/nfl', '{"week":3,"season":"2026","season_type":"regular"}')
  t.replace('/league/L1', `
    {"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":2,
     "roster_positions":["QB","RB","RB","BN","BN","BN"],
     "scoring_settings":{"pass_yd":0.04,"rec":0,"rec_yd":0.1,"rec_fd":1,"rec_td":6,"rush_yd":0.1,"rush_fd":1,
       "rush_td":6,"rush_40p":2,"rush_td_40p":4,"rush_td_50p":8,"rec_30_39":1,"rec_40p":2,
       "bonus_rush_yd_200":5,"rush_2pt":2,"fum":-3,"fum_lost":-5},
     "settings":{"waiver_type":2,"waiver_budget":100,"waiver_day_of_week":2}}`)
  t.replace('/league/L1/rosters', `
    [{"roster_id":1,"owner_id":"u1","players":["qb1","${taylor}","${henry}"],
      "starters":["qb1","${taylor}","${henry}"],"settings":{"waiver_budget_used":20}},
     {"roster_id":2,"owner_id":"u2","players":["qb2","${gibbs}"],"starters":["qb2","${gibbs}"]}]`)
  t.replace('/players/nfl', `
    {"qb1":{"full_name":"Starter QB","position":"QB","team":"BUF","active":true},
     "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true},
     "${cook}":{"full_name":"James Cook","position":"RB","team":"BUF","active":true},
     "${hampton}":{"full_name":"Omarion Hampton","position":"RB","team":"LAC","active":true},
     "${henderson}":{"full_name":"TreVeyon Henderson","position":"RB","team":"NE","active":true},
     "${taylor}":{"full_name":"Jonathan Taylor","position":"RB","team":"IND","active":true},
     "${henry}":{"full_name":"Derrick Henry","position":"RB","team":"BAL","active":true},
     "${gibbs}":{"full_name":"Jahmyr Gibbs","position":"RB","team":"DET","active":true}}`)
  onFixture(t, '/stats/nfl/2026/2', 'stats-2026-w2')
  return t
}

describe('RBStreamScreenModel', () => {
  let storage: MemoryStreamStorage
  beforeEach(() => { storage = new MemoryStreamStorage() })

  async function model(t: StubTransport): Promise<RBStreamScreenModel> {
    const m = new RBStreamScreenModel(makeLoader(t), testStore(storage))
    await m.load('L1', 1)
    return m
  }

  const candidate = (m: RBStreamScreenModel, id: string): RBCandidate | undefined =>
    m.candidates.find((c) => streamCandidateID(c) === id)

  it("scores in the league's own rushing scoring", async () => {
    const m = await model(transport())
    expect(m.errorMessage).toBeUndefined()
    expect(m.leagueStartsKind).toBe(true)
    expect(m.scoring.runBonus30).toBe(0)
    expect(m.scoring.runBonus40).toBe(2)
    expect(m.scoring.fumble + m.scoring.fumbleLost).toBe(-8)
    expect(m.unmodelledScoringKeys).toEqual(['bonus_rush_yd_200', 'rush_2pt'])
  })

  it('candidates are built from Sleeper lines', async () => {
    const m = await model(transport())
    const c = candidate(m, cook)!
    expect(c).toBeDefined()
    expect(c.opponent).toBe('vs LAC')
    expect(c.spreadOff, 'BUF is a 7-point home favorite').toBe(-7)
    expect(c.total).toBe(50.5)
    expect(c.teamRushAttempts, 'every BUF carry recorded').toBe(35)
    expect(c.teamPassAttempts, "from the BUF quarterback's line").toBe(31)
    expect(Math.abs(c.carryShareLast1! - 21.0 / 35.0)).toBeLessThanOrEqual(1e-9)
    expect(Math.abs(c.targetShareLast1! - 3.0 / 11.0)).toBeLessThanOrEqual(1e-9)
    expect(Math.abs(c.redZoneShare! - 4.0 / 7.0)).toBeLessThanOrEqual(1e-9)
    expect(c.rushFirstDowns).toBe(6)
    expect(c.runs30, 'his longest run went 35').toBe(1)
    expect(c.runs40).toBe(0)
    expect(c.role).toBe('BELLCOW')
    expect(c.dataFlags).toContain('long runs counted from longest run only')

    const p = m.projection(cook)!
    expect(p).toBeDefined()
    expect(Math.abs(p.implied - (50.5 + 7) / 2)).toBeLessThanOrEqual(1e-9)
    expect(p.impliedMult, 'a 28.75-point implied total lifts TDs').toBeGreaterThan(1)
    expect(candidate(m, henderson)?.runs30).toBe(1)
    expect(candidate(m, henderson)?.runs40, '39 yards is not 40+').toBe(0)
  })

  it('default starter is the weaker of my starting backs', async () => {
    const m = await model(transport())
    const incumbent = m.report?.incumbent
    expect(incumbent).toBeDefined()
    expect([taylor, henry]).toContain(incumbent!.id)
    const other = m.projection(incumbent!.id === taylor ? henry : taylor)
    expect(other).toBeDefined()
    expect(incumbent!.expPts).toBeLessThanOrEqual(other!.expPts)
  })

  it('any back can be compared or beaten and search forgives', async () => {
    const m = await model(transport())
    expect(m.rows.some((r) => r.id === gibbs)).toBe(false)
    expect(m.searchPlayers('jahmyr gibs')[0]?.id).toBe(gibbs)
    expect(m.searchPlayers('cook bills')[0]?.id).toBe(cook)
    await m.setIncumbent(gibbs)
    expect(m.report?.incumbent?.id).toBe(gibbs)
    m.toggleCompare(cook)
    m.toggleCompare(hampton)
    expect(m.comparison?.players.map((p) => p.id)).toEqual([cook, hampton])
  })

  it('a lost fumble costs eight in recent games', async () => {
    const m = await model(transport())
    const game = m.recentGames(hampton)[0]
    expect(game).toBeDefined()
    expect(game!.fumblesLost).toBe(1)
    expect(game!.carries).toBe(23)
    // 94 rush yds, 5 rush + 1 rec first downs, a TD, 21 rec yds, then −3 fumble and −5 lost.
    expect(Math.abs(game!.points - (9.4 + 6 + 6 + 2.1 - 8))).toBeLessThanOrEqual(0.01)
  })

  it('snapshots are saved for the back stream', async () => {
    const m = await model(transport())
    expect(m.snapshots.length).toBe(1)
    const id = m.snapshots[0]?.id
    expect(id).toBeDefined()
    const loaded = await m.loadSnapshot(id!)
    expect(loaded).toBeDefined()
    expect(loaded!.report).toEqual(m.report)
  })
})

describe('RBRoleAndContext', () => {
  it('usage maps to roles', () => {
    expect(RBCandidateBuilder.inferRole(0.65, 0.1, 0.7)).toBe('BELLCOW')
    expect(RBCandidateBuilder.inferRole(0.50, 0.05, undefined)).toBe('LEAD')
    expect(RBCandidateBuilder.inferRole(0.20, 0.12, undefined)).toBe('PASS_DOWN')
    expect(RBCandidateBuilder.inferRole(0.25, 0.03, 0.5)).toBe('GOAL_LINE')
    expect(RBCandidateBuilder.inferRole(0.38, 0.06, 0.3)).toBe('COMMITTEE')
    expect(RBCandidateBuilder.inferRole(undefined, undefined, undefined)).toBe('COMMITTEE')
  })

  /**
   * The zip's shared week-context file nests DvP per position and names the
   * line adjustment `rbLineAdj`.
   */
  it('import reads the shared context file', () => {
    const file = `
      {"_comment":"x","season":2026,"week":3,"teams":{
        "GB":{"opp":"vs ATL (TNF)","home":true,"spreadDef":-6.5,"total":45.5,
              "dvpPct":{"LB":89.7,"WR":-9.8,"RB":-36.7},"dvpGames":2,"oppSackEnv":1.0,"wrCoverageAdj":1.1,"rbLineAdj":0.9},
        "LAR":{"spreadOff":-2.5,"total":46.5}},
       "players":{}}`
    const rb = parseRBContext(file)
    expect(rb.teams.GB?.spreadOff).toBe(-6.5)
    expect(rb.teams.GB?.dvpPct).toBe(-36.7)
    expect(rb.teams.GB?.lineAdj).toBe(0.9)
    expect(rb.teams.LA?.total, 'LAR lands on LA').toBe(46.5)
    // The same file feeds WR Stream.
    const wr = parseWRContext(file)
    expect(wr.teams.GB?.dvpPct).toBe(-9.8)
    expect(wr.teams.GB?.coverageAdj).toBe(1.1)
  })

  it('matchup uses points allowed to backs', () => {
    const schedule = decodeSchedule(JSON.parse(`
      {"byWeek":{"3":[{"home":"BUF","away":"LAC","spreadLine":7,"totalLine":50.5}]}}`))
    const lines = [facing(1, 'RB', 'LAC', 30), facing(1, 'RB', 'BUF', 10)]
    const table = computeDvP(lines, new Set(['RB'] as const), 1)
    const teams = buildRBContext(schedule, 3, table)
    expect(Math.abs(teams.BUF!.dvpPct! - 50)).toBeLessThanOrEqual(1e-9)
    expect(teams.BUF?.spreadOff).toBe(-7)
    expect(Math.abs(rbTeamImplied(teams.BUF!) - 28.75)).toBeLessThanOrEqual(1e-9)
    expect(teams.LAC?.spreadOff).toBe(7)
  })
})
