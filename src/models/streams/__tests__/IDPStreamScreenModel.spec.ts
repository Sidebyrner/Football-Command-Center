import { beforeEach, describe, expect, it } from 'vitest'
import { computeDvP, EMPTY_DVP, facing } from '@core/DefenseVsPosition'
import { decodeSchedule } from '@core/Schedule'
import type { IDPProjection } from '@core/streams/IDPStream'
import { standardTransport } from '../../../../tests/appHarness'
import type { StubTransport } from '../../../../tests/stubTransport'
import { IDPStreamScreenModel } from '../IDPStreamKind'
import { buildIDPContext, idpOpponentLabel, idpTeamOverride } from '../IDPWeekContext'
import { MemoryStreamStorage } from '../StreamStore'
import { makeLoader, onFixture, testStore } from './streamHarness'

/**
 * Port of IDPStreamScreenModelTests: IDP Stream against the recorded week-2
 * 2026 Sleeper stat lines and the 2026 schedule's week-3 lines, in a league
 * with two IDP_FLEX slots and the real Whack-A-Mole IDP scoring.
 */

// From stats-2026-w2.json.
const bolton = '7648'     // KC LB, 65/65 snaps, 6 solo 7 ast
const carter = '12574'    // NYG DE, 55/62, a sack and a QB hit
const curl = '7136'       // LAR SS, on the rival's roster
const nubin = '11674'     // NYG DB with no listed alignment
const newsome = '7630'    // NYG CB
const edmunds = '4968'    // NYG LB, mine, starting
const downs = '13376'     // DAL FS, mine, starting
const landman = '8659'    // LAR LB, 49/58
const johnson = '11021'   // LAR DT, 10/58 — under the snap floor

function transport(): StubTransport {
  const t = standardTransport()
  t.override('/state/nfl', '{"week":3,"season":"2026","season_type":"regular"}')
  t.replace('/league/L1', `
    {"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":2,
     "roster_positions":["QB","IDP_FLEX","IDP_FLEX","BN","BN","BN"],
     "scoring_settings":{"pass_yd":0.04,"idp_tkl":0,"idp_tkl_solo":2,"idp_tkl_ast":1,"idp_sack":5,
       "idp_tkl_loss":2,"idp_int":5,"idp_ff":3,"idp_fum_rec":5,"idp_def_td":10,"idp_qb_hit":0.5,"idp_pass_def":0},
     "settings":{"waiver_type":2,"waiver_budget":100,"waiver_day_of_week":2}}`)
  t.replace('/league/L1/rosters', `
    [{"roster_id":1,"owner_id":"u1","players":["qb1","${edmunds}","${downs}"],
      "starters":["qb1","${edmunds}","${downs}"],"settings":{"waiver_budget_used":20}},
     {"roster_id":2,"owner_id":"u2","players":["qb2","${curl}"],"starters":["qb2","${curl}"]}]`)
  t.replace('/players/nfl', `
    {"qb1":{"full_name":"Starter QB","position":"QB","team":"BUF","active":true},
     "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true},
     "${bolton}":{"full_name":"Nick Bolton","position":"LB","team":"KC","active":true},
     "${carter}":{"full_name":"Abdul Carter","position":"DE","team":"NYG","active":true},
     "${curl}":{"full_name":"Kam Curl","position":"DB","depth_chart_position":"SS","team":"LAR","active":true},
     "${nubin}":{"full_name":"Tyler Nubin","position":"DB","team":"NYG","active":true},
     "${newsome}":{"full_name":"Greg Newsome","position":"CB","team":"NYG","active":true},
     "${edmunds}":{"full_name":"Tremaine Edmunds","position":"LB","team":"NYG","active":true},
     "${downs}":{"full_name":"Caleb Downs","position":"DB","depth_chart_position":"FS","team":"DAL","active":true},
     "${landman}":{"full_name":"Nate Landman","position":"LB","team":"LAR","active":true,"injury_status":"Questionable"},
     "${johnson}":{"full_name":"Desjuan Johnson","position":"DT","team":"LAR","active":true}}`)
  onFixture(t, '/stats/nfl/2026/2', 'stats-2026-w2')
  return t
}

describe('IDPStreamScreenModel', () => {
  let storage: MemoryStreamStorage
  beforeEach(() => { storage = new MemoryStreamStorage() })

  async function model(t: StubTransport): Promise<IDPStreamScreenModel> {
    const m = new IDPStreamScreenModel(makeLoader(t), testStore(storage))
    await m.load('L1', 1)
    return m
  }

  const row = (m: IDPStreamScreenModel, id: string): IDPProjection | undefined =>
    (m.report?.ranked ?? []).find((p) => p.id === id) ?? (m.report?.incumbent?.id === id ? m.report?.incumbent : undefined)

  it("scores in the league's own IDP scoring", async () => {
    const m = await model(transport())
    expect(m.errorMessage).toBeUndefined()
    expect(m.leagueStartsKind).toBe(true)
    expect(m.scoring.solo).toBe(2)
    expect(m.scoring.ast).toBe(1)
    expect(m.scoring.qbHit).toBe(0.5)
    expect(m.unmodelledScoringKeys).toEqual(['idp_def_td', 'idp_fum_rec'])
  })

  it('free-agent defenders are projected with schedule lines', async () => {
    const m = await model(transport())
    const b = row(m, bolton)!
    expect(b).toBeDefined()
    expect(b.available).toBe(true)
    expect(b.position).toBe('LB')
    expect(b.opponent).toBe('@MIA')
    expect(Math.abs(b.snapShare - 1)).toBeLessThanOrEqual(0.01)
    expect(b.expPts).toBeGreaterThan(0)
    expect(b.pBeatIncumbent).toBeDefined()
    const label = m.bidLabel(b)
    expect(label === undefined ? undefined : label.startsWith('$'), 'FAAB league shows dollars').toBe(true)

    // KC is an 11.5-point road favorite: negative from the defense's side.
    const kc = m.teams.KC!
    expect(kc).toBeDefined()
    expect(kc.spreadDef).toBe(-11.5)
    expect(kc.total).toBe(46.5)
    expect(kc.linesSource).toBe('schedule')
    expect(m.teams.MIA?.spreadDef).toBe(11.5)
  })

  it('defenders listed by football position are in the pool', async () => {
    const m = await model(transport())
    // Sleeper lists him as DE, not DL — he used to have no position at all.
    const c = row(m, carter)!
    expect(c).toBeDefined()
    expect(c.position).toBe('EDGE')
    expect(c.platform).toBe('DL')
    expect(c.eQbHit).toBeGreaterThan(0)
    expect(row(m, newsome)?.position).toBe('CB')
    const n = row(m, nubin)!
    expect(n).toBeDefined()
    expect(n.position).toBe('S_BOX')
    expect(n.flags.some((f) => f.includes('alignment not listed'))).toBe(true)
  })

  it('rostered defenders are hidden until asked and Rams join across dialects', async () => {
    const m = await model(transport())
    expect(m.rows.some((r) => r.id === curl)).toBe(false)
    m.onlyAvailable = false
    const c = m.rows.find((r) => r.id === curl)!
    expect(c).toBeDefined()
    expect(c.available).toBe(false)
    expect(c.team, 'LAR is normalised so the Rams find their game').toBe('LA')
    expect(c.opponent).toBe('@DEN')
    expect(c.position).toBe('S_BOX')
    expect(row(m, landman)?.practice).toBe('Q')

    // One week of lines is under the defense table's sample floor, so no
    // matchup claim is made yet.
    const den = m.teams.DEN!
    expect(den).toBeDefined()
    expect(den.dvpSource).toBe('standard')
    expect(Object.keys(den.dvpPct).length).toBe(0)
    expect(m.sourceNotes.some((n) => n.includes('4 games'))).toBe(true)
  })

  it('default starter is the weaker of my IDP starters', async () => {
    const m = await model(transport())
    const incumbent = m.report?.incumbent
    expect(incumbent).toBeDefined()
    expect([edmunds, downs]).toContain(incumbent!.id)
    expect(m.incumbentIsDefault).toBe(true)
    const other = row(m, incumbent!.id === edmunds ? downs : edmunds)
    expect(other).toBeDefined()
    expect(incumbent!.expPts).toBeLessThanOrEqual(other!.expPts)
    expect(m.report?.ranked.some((p) => p.id === incumbent!.id) ?? true).toBe(false)

    await m.setIncumbent(other!.id)
    expect(m.report?.incumbent?.id).toBe(other!.id)
    expect(m.incumbentIsDefault).toBe(false)
  })

  it('any defender can be the starter to beat', async () => {
    const m = await model(transport())
    await m.setIncumbent(curl)
    expect(m.report?.incumbent?.id).toBe(curl)
    expect(m.incumbentOwnerLabel).toBe("rival's starter")
    expect(m.report?.ranked.some((p) => p.id === curl) ?? true).toBe(false)
    expect(m.report?.ranked[0]?.pBeatIncumbent).toBeDefined()

    // Someone below the snap floor is projected once chosen.
    expect(m.projection(johnson), 'rotational players are not streamed').toBeUndefined()
    await m.setIncumbent(johnson)
    expect(m.report?.incumbent?.id).toBe(johnson)
    expect(m.report?.incumbent?.position).toBe('IDL')
  })

  it('search finds defenders across rosters', async () => {
    const m = await model(transport())
    const results = m.searchPlayers('johnson')
    expect(results.map((r) => r.id)).toEqual([johnson])
    expect(results[0]?.projected).toBeUndefined()
    expect(m.searchPlayers('starter').some((r) => r.id === 'qb1'), 'only defenders').toBe(false)
    const browse = m.searchPlayers('')
    expect(browse.length).toBeGreaterThan(0)
    const projected = browse.map((r) => r.projected).filter((p): p is number => p !== undefined)
    expect(projected).toEqual([...projected].sort((a, b) => b - a))
  })

  it('search forgives typos, word order and matches teams', async () => {
    const m = await model(transport())
    expect(m.searchPlayers('Desjaun Jonson')[0]?.id, 'a typo in each word').toBe(johnson)
    expect(m.searchPlayers('bolten')[0]?.id).toBe(bolton)
    expect(m.searchPlayers('curl rams').map((r) => r.id), 'team name counts, any order').toEqual([curl])
    expect(m.searchPlayers('curl la').map((r) => r.id), 'team code counts').toEqual([curl])
    expect(m.searchPlayers('curl chiefs').length).toBe(0)
    // Every Giants defender, strongest projection first.
    const giants = m.searchPlayers('giants')
    expect(giants.some((r) => r.id === carter)).toBe(true)
    expect(giants.some((r) => r.id === bolton)).toBe(false)
  })

  it("recent games are scored in the league's settings", async () => {
    const m = await model(transport())
    const games = m.recentGames(bolton)
    const week2 = games[0]
    expect(week2).toBeDefined()
    expect(games.length, 'only week 2 is recorded').toBe(1)
    expect(week2!.week).toBe(2)
    expect(week2!.opponent).toBe('IND')
    expect(week2!.snapShare).toBeDefined()
    expect(Math.abs(week2!.snapShare! - 1)).toBeLessThanOrEqual(0.001)
    expect(week2!.tackles).toBe(13)
    // 6 solo × 2 + 7 assists × 1, plus whatever else he did that the league pays for.
    expect(week2!.points).toBeGreaterThanOrEqual(19)
    expect(m.recentGames('nobody').length).toBe(0)
  })

  it('compare keeps order, caps at four and projects anyone', async () => {
    const m = await model(transport())
    m.toggleCompare(bolton)
    m.toggleCompare(johnson)   // under the snap floor: projected on add
    m.toggleCompare(curl)
    expect(m.compareIDs).toEqual([bolton, johnson, curl])
    const comparison = m.comparison!
    expect(comparison).toBeDefined()
    expect(comparison.players.map((p) => p.id)).toEqual([bolton, johnson, curl])
    expect(comparison.headToHead[0]![0]).toBeUndefined()
    expect(Math.abs((comparison.headToHead[0]![1] ?? 0) + (comparison.headToHead[1]![0] ?? 0) - 1)).toBeLessThanOrEqual(1e-9)

    m.toggleCompare(carter)
    m.toggleCompare(nubin)
    expect(m.compareIDs.length).toBe(IDPStreamScreenModel.compareLimit)
    expect(m.compareIDs).not.toContain(nubin)
    expect(m.canAddToCompare).toBe(false)

    m.toggleCompare(johnson)
    expect(m.compareIDs).toEqual([bolton, curl, carter])
    expect(m.projection(johnson), 'forced inclusion ends with the comparison').toBeUndefined()
    m.clearCompare()
    expect(m.comparison).toBeUndefined()
  })

  it('team edits apply and persist', async () => {
    const t = transport()
    const m = await model(t)
    const before = row(m, bolton)!.expPts
    await m.setTeamOverride(idpTeamOverride({ spreadDef: 7 }), 'KC')
    expect(m.teams.KC?.spreadDef).toBe(7)
    expect(m.teams.KC?.linesSource).toBe('manual')
    expect(row(m, bolton)!.expPts, 'an underdog defends more plays').toBeGreaterThan(before)

    const reloaded = await model(t)
    expect(reloaded.teams.KC?.spreadDef).toBe(7)
    expect(reloaded.autoTeams.KC?.spreadDef).toBe(-11.5)

    await reloaded.setTeamOverride(undefined, 'KC')
    expect(reloaded.teams.KC?.spreadDef).toBe(-11.5)
  })

  it('imports the reference context file', async () => {
    const m = await model(transport())
    const file = `
      {"_comment":"week 3","teams":{
        "KC":{"opp":"@MIA","home":false,"spreadDef":-10.5,"total":46.5,"dvpPct":{"DL":17.0},"dvpGames":2,"oppSackEnv":1.25},
        "LAR":{"opp":"@DEN","home":false,"spreadDef":-2.5,"total":46.5,"dvpPct":{"LB":-28.2},"dvpGames":2,"oppSackEnv":1.0}},
       "players":{"_comment":"x","${nubin}":{"pos":"S_FREE"}}}`
    const counts = await m.importContext(file)
    expect(counts.teams).toBe(2)
    expect(counts.players).toBe(1)
    expect(m.teams.KC?.spreadDef).toBe(-10.5)
    expect(m.teams.KC?.oppSackEnv).toBe(1.25)
    expect(m.teams.KC?.linesSource).toBe('imported')
    expect(m.teams.LA?.dvpPct.LB, 'LAR keys land on LA').toBe(-28.2)
    expect(row(m, nubin)?.position).toBe('S_FREE')
  })

  it('first load each day is snapshotted and freezing adds another', async () => {
    const t = transport()
    const m = await model(t)
    expect(m.snapshots.length).toBe(1)
    expect(m.snapshots[0]?.pinned).toBe(false)

    await model(t)  // same day: no second auto snapshot
    await m.freezeSnapshot()
    expect(m.snapshots.length).toBe(2)
    const pinned = m.snapshots.find((s) => s.pinned)!
    expect(pinned).toBeDefined()
    expect(pinned.week).toBe(3)
    const snapshot = await m.loadSnapshot(pinned.id)
    expect(snapshot).toBeDefined()
    expect(snapshot!.report).toEqual(m.report)
    expect(snapshot!.candidates.length).toBeGreaterThan(0)
  })
})

describe('IDPContextAutofill', () => {
  it('missing lines fall back to neutral and are labelled', () => {
    const schedule = decodeSchedule(JSON.parse('{"byWeek":{"3":[{"home":"GB","away":"ATL"}]}}'))
    const teams = buildIDPContext(schedule, 3, EMPTY_DVP)
    const gb = teams.GB!
    expect(gb).toBeDefined()
    expect(gb.spreadDef).toBe(0)
    expect(gb.total).toBe(45)
    expect(gb.linesSource).toBe('standard')
    expect(gb.dvpSource).toBe('standard')
    expect(idpOpponentLabel(gb)).toBe('vs ATL')
    expect(teams.ATL ? idpOpponentLabel(teams.ATL) : undefined).toBe('@GB')
    expect(teams.KC, 'a team with no game is on bye').toBeUndefined()
  })

  /**
   * The IDP half of the table is keyed by the offense a defender faced, so
   * a defense facing the Rams reads the cell built from lines saying LAR.
   */
  it('matchup reads points the opposing offense allows', () => {
    const schedule = decodeSchedule(JSON.parse(`
      {"byWeek":{"3":[{"home":"DEN","away":"LA","spreadLine":2.5,"totalLine":45.5}]}}`))
    const lines = [facing(1, 'LB', 'LAR', 30), facing(1, 'LB', 'DEN', 10)]
    const table = computeDvP(lines, new Set(['LB', 'DL', 'DB'] as const), 1)
    const teams = buildIDPContext(schedule, 3, table)
    const den = teams.DEN!
    expect(den).toBeDefined()
    expect(den.opponent).toBe('LA')
    expect(den.dvpSource).toBe('sleeperDvP')
    // LAR allowed 30 against a league average of 20: +50%.
    expect(Math.abs(den.dvpPct.LB! - 50)).toBeLessThanOrEqual(1e-9)
    expect(den.dvpGames).toBe(1)
    expect(Math.abs(teams.LA!.dvpPct.LB! - -50)).toBeLessThanOrEqual(1e-9)
    expect(den.spreadDef, 'home favored by 2.5').toBe(-2.5)
  })
})
