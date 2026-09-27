import { describe, expect, it } from 'vitest'
import { LeagueContextLoader } from '../../league/LeagueContextLoader'
import { InjuryCenterModel, InjurySeverity, injuredPlayerHeadline } from '../InjuryCenterModel'
import { DashboardModel } from '../../team/DashboardModel'
import { makeHarness, standardTransport, TestClock } from '../../../../tests/appHarness'
import type { StubTransport } from '../../../../tests/stubTransport'
import { fixtureText } from '../../../../tests/swiftFixtures'

const COLLINS = '7569'
const NACUA = '9493'
const HUTCHINSON = '10218'
const SMITH_NJIGBA = '9488'

function transport(): StubTransport {
  return standardTransport()
    .override('/state/nfl', '{"week":2,"season":"2026","season_type":"regular"}')
    .replace('/league/L1', `
            {"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":8,
             "roster_positions":["QB","RB","WR","WR","BN","BN","BN"],
             "scoring_settings":{"pass_yd":0.05,"pass_td":6,"rec_yd":0.1,"rec_td":6,"rush_yd":0.1,"rush_td":6},
             "settings":{"reserve_slots":2}}`)
    .replace('/league/L1/rosters', `
            [{"roster_id":1,"owner_id":"u1",
              "players":["qb1","rb1","${COLLINS}","wr_bench","wr_spare"],
              "starters":["qb1","rb1","${COLLINS}","wr_bench"]},
             {"roster_id":2,"owner_id":"u2",
              "players":["qb2","rb2","${NACUA}","wr_r2"],
              "starters":["qb2","rb2","${NACUA}","wr_r2"]}]`)
    .replace('/players/nfl', `
            {"qb1":{"full_name":"Starter QB","position":"QB","team":"BUF","active":true},
             "rb1":{"full_name":"Starter Back","position":"RB","team":"DET","active":true},
             "${COLLINS}":{"full_name":"Nico Collins","position":"WR","team":"HOU","active":true,
                                "injury_status":"Out","injury_body_part":"Hamstring"},
             "wr_bench":{"full_name":"Bench Receiver","position":"WR","team":"MIN","active":true},
             "wr_spare":{"full_name":"Spare Receiver","position":"WR","team":"DAL","active":true},
             "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true},
             "rb2":{"full_name":"Rival Back","position":"RB","team":"KC","active":true},
             "${NACUA}":{"full_name":"Puka Nacua","position":"WR","team":"LAR","active":true,
                              "injury_status":"Questionable","injury_body_part":"Hip"},
             "wr_r2":{"full_name":"Rival Receiver","position":"WR","team":"NYJ","active":true},
             "${HUTCHINSON}":{"full_name":"Xavier Hutchinson","position":"WR","team":"HOU","active":true},
             "${SMITH_NJIGBA}":{"full_name":"Jaxon Smith-Njigba","position":"WR","team":"SEA","active":true},
             "retired":{"full_name":"Retired Receiver","position":"WR","team":"SEA","active":false}}`)
    // Week 1 done, week 2 live: both answered from the recorded week-2 lines.
    .json('/stats/nfl/2026/1', fixtureText('FCApp', 'stats-2026-w2.json'))
    .json('/stats/nfl/2026/2', fixtureText('FCApp', 'stats-2026-w2.json'))
}

async function model(t: StubTransport): Promise<InjuryCenterModel> {
  const { sleeper, staticData } = makeHarness(t)
  const loader = new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs)
  const m = new InjuryCenterModel(loader, sleeper)
  await m.load({ leagueID: 'L1', userRosterID: 1 })
  return m
}

/**
 * Port of InjuryCenterModelTests: the Injury Center against real 2026 data —
 * the official week-2 injury report and depth charts shipped by the pipeline,
 * and recorded Sleeper stat lines. Nico Collins (HOU WR, Out, did not
 * practice, hamstring) is the user's starter; Xavier Hutchinson is the free
 * agent behind him on the depth chart; Puka Nacua (Questionable, DNP) starts
 * for the rival.
 */
describe('InjuryCenterModel', () => {
  it('roster joins Sleeper tag with the official report', async () => {
    const m = await model(transport())
    expect(m.errorMessage).toBeUndefined()

    const collins = m.roster.find((p) => p.id === COLLINS)
    expect(collins).toBeDefined()
    expect(collins!.isStarter).toBe(true)
    expect(collins!.slotToken).toBe('WR')
    expect(collins!.severity).toBe(InjurySeverity.out)
    expect(collins!.report?.designation).toBe('Out')
    expect(collins!.report?.practice).toBe('DNP')
    expect(injuredPlayerHeadline(collins!)).toBe('Out · Hamstring · Did not practice')
    expect(collins!.isLocked).toBe(false)
    expect(collins!.kickoff, 'HOU plays in week 2 of the shipped 2026 schedule').toBeDefined()
    // Only players with a signal appear.
    expect(m.roster.some((p) => p.id === 'wr_bench')).toBe(false)
  })

  it('who benefits names the depth chart behind the injured player', async () => {
    const m = await model(transport())

    const opening = m.openings.find((o) => o.id === COLLINS)
    expect(opening).toBeDefined()
    expect(opening!.availability).toEqual({ kind: 'mine' })
    expect(opening!.severity).toBe(InjurySeverity.out)
    const hutchinson = opening!.beneficiaries.find((b) => b.sleeperID === HUTCHINSON)
    expect(hutchinson).toBeDefined()
    expect(hutchinson!.depthBehind).toBe(1)
    expect(hutchinson!.availability).toEqual({ kind: 'freeAgent' })
    expect(hutchinson!.lastSnapShare).toBeDefined()
    expect(Math.abs(hutchinson!.lastSnapShare! - 0.81)).toBeLessThanOrEqual(0.001)
    expect(hutchinson!.lastExpectedPoints).toBeDefined()

    // The rival's questionable starter is an opening too, listed after mine.
    const nacua = m.openings.find((o) => o.id === NACUA)
    expect(nacua).toBeDefined()
    expect(nacua!.severity).toBe(InjurySeverity.questionableNoPractice)
    const collinsIndex = m.openings.findIndex((o) => o.id === COLLINS)
    const nacuaIndex = m.openings.findIndex((o) => o.id === NACUA)
    expect(collinsIndex).toBeGreaterThanOrEqual(0)
    expect(nacuaIndex).toBeGreaterThanOrEqual(0)
    expect(collinsIndex).toBeLessThan(nacuaIndex)
  })

  it('rival injuries flag your surplus', async () => {
    const m = await model(transport())
    const nacua = m.rivalInjuries.find((r) => r.id === NACUA)
    expect(nacua).toBeDefined()
    expect(nacua!.manager).toBe('rival')
    expect(nacua!.youHaveSurplus, 'three receivers for two WR slots is a spare').toBe(true)
    expect(nacua!.headline.startsWith('Questionable')).toBe(true)
  })

  /**
   * The Replacement Finder on the season basis: a free agent with a real
   * stat line ranks, the injured player himself never appears, and the
   * lineup gain is computed against the lineup without him.
   */
  it('replacement candidates are ranked and exclude the injured player', async () => {
    const m = await model(transport())
    m.basis = 'sleeperPointsPerGame'
    const collins = m.roster.find((p) => p.id === COLLINS)
    expect(collins).toBeDefined()

    const candidates = m.candidates(collins!)
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.some((c) => c.id === COLLINS)).toBe(false)
    expect(candidates.some((c) => c.id === 'retired')).toBe(false)
    expect(candidates.every((c) => c.position === 'WR')).toBe(true)
    const values = candidates.map((c) => c.value ?? 0)
    expect(values).toEqual([...values].sort((a, b) => b - a))

    const jsn = candidates.find((c) => c.id === SMITH_NJIGBA)
    expect(jsn).toBeDefined()
    expect(jsn!.availability).toEqual({ kind: 'freeAgent' })
    expect(jsn!.value).toBeDefined()
    expect(Math.abs(jsn!.value! - 33.5)).toBeLessThanOrEqual(0.01)
    expect(jsn!.lineupGain).toBeDefined()
    expect(Math.abs(jsn!.lineupGain! - 33.5), 'nobody else on the roster has a valued line, so he is the whole gain').toBeLessThanOrEqual(0.1)
  })

  /**
   * A Doubtful receiver on the bench can't fill the hole either, so a
   * healthy free agent's gain is his whole value — not what he adds over a
   * player who won't play.
   */
  it('an injured bench player is not counted as cover', async () => {
    const t = transport()
      .replace('/league/L1', `
            {"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":8,
             "roster_positions":["QB","RB","WR","BN","BN","BN"],
             "scoring_settings":{"pass_yd":0.05,"pass_td":6,"rec_yd":0.1,"rec_td":6,"rush_yd":0.1,"rush_td":6},
             "settings":{"reserve_slots":2}}`)
      .replace('/league/L1/rosters', `
            [{"roster_id":1,"owner_id":"u1","players":["qb1","rb1","${COLLINS}","${SMITH_NJIGBA}"],
              "starters":["qb1","rb1","${COLLINS}"]},
             {"roster_id":2,"owner_id":"u2","players":["qb2"],"starters":["qb2"]}]`)
      .replace('/players/nfl', `
            {"qb1":{"full_name":"Starter QB","position":"QB","team":"BUF","active":true},
             "rb1":{"full_name":"Starter Back","position":"RB","team":"DET","active":true},
             "${COLLINS}":{"full_name":"Nico Collins","position":"WR","team":"HOU","active":true,"injury_status":"Out"},
             "${SMITH_NJIGBA}":{"full_name":"Jaxon Smith-Njigba","position":"WR","team":"SEA","active":true,"injury_status":"Doubtful"},
             "2133":{"full_name":"Davante Adams","position":"WR","team":"LAR","active":true},
             "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true}}`)
    const m = await model(t)
    m.basis = 'sleeperPointsPerGame'
    const collins = m.roster.find((p) => p.id === COLLINS)
    expect(collins).toBeDefined()
    const candidates = m.candidates(collins!)
    expect(candidates.some((c) => c.id === SMITH_NJIGBA), 'a Doubtful player is not a replacement').toBe(false)
    const adams = candidates.find((c) => c.id === '2133')
    expect(adams).toBeDefined()
    expect(adams!.lineupGain).toBeDefined()
    expect(adams!.value).toBeDefined()
    expect(Math.abs(adams!.lineupGain! - adams!.value!), 'Smith-Njigba is Doubtful, so the WR slot is empty without Adams').toBeLessThanOrEqual(0.1)
  })

  /**
   * No projections were scripted, so the projected basis values nobody —
   * and says so with an empty list rather than a list of zeroes.
   */
  it('an unavailable basis yields no candidates rather than zeroes', async () => {
    const m = await model(transport())
    m.basis = 'projected'
    const collins = m.roster.find((p) => p.id === COLLINS)
    expect(collins).toBeDefined()
    expect(m.candidates(collins!)).toEqual([])
    expect(m.sourceNotes.some((n) => n.includes('Unavailable') && n.includes('projections'))).toBe(true)
  })

  /** My Team's alert now carries the report detail, not just the tag. */
  it('dashboard alert carries practice detail', async () => {
    const { sleeper, staticData } = makeHarness(transport())
    const loader = new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs)
    const dashboard = new DashboardModel(loader, sleeper, undefined)
    await dashboard.load('L1', 1)
    const alert = dashboard.alerts.find((a) => a.playerID === COLLINS)
    expect(alert).toBeDefined()
    expect(alert!.detail).toBe('Out · Hamstring · Did not practice')
  })
})
