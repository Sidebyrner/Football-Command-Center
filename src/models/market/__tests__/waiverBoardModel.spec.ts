import { describe, expect, it } from 'vitest'
import { LeagueContextLoader } from '../../league/LeagueContextLoader'
import { WaiverBoardModel, waiverFactsIRFree, waiverRowValue } from '../WaiverBoardModel'
import { makeHarness, standardTransport, TestClock } from '../../../../tests/appHarness'
import type { StubTransport } from '../../../../tests/stubTransport'
import { fixtureText } from '../../../../tests/swiftFixtures'

const SMITH_NJIGBA = '9488'
const GIBBS = '9221'
/** A back with a week-3 projection and no recorded week-2 line. */
const PROJECTED_ONLY_BACK = '9509'

/**
 * `failInsights` stands in for Swift's `transport.fail("/projections/nfl")` and
 * `fail("/stats/nfl")`: Swift's failures win over every route, while the TS
 * stub's `fail` is an ordinary first-match route, so the failing routes are
 * put ahead of the fixture routes here.
 */
function transport({ injuries = {}, failInsights = false }: { injuries?: Record<string, string>; failInsights?: boolean } = {}): StubTransport {
  const t = standardTransport()
    .override('/state/nfl', '{"week":3,"season":"2026","season_type":"regular"}')
    .replace('/league/L1', `
            {"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":2,
             "roster_positions":["QB","RB","WR","WR","BN","BN","IR"],
             "scoring_settings":{"pass_yd":0.05,"pass_td":6,"rec_yd":0.1,"rec_td":6,"rush_yd":0.1,"rush_td":6},
             "settings":{"waiver_type":2,"waiver_budget":100,"waiver_day_of_week":2,"reserve_slots":1}}`)
    .replace('/league/L1/rosters', `
            [{"roster_id":1,"owner_id":"u1",
              "players":["qb1","rb1","wr1","wr2","wr_bench","ir_guy"],
              "starters":["qb1","rb1","wr1","wr2"],"reserve":["ir_guy"],
              "settings":{"waiver_budget_used":40,"waiver_position":1}},
             {"roster_id":2,"owner_id":"u2",
              "players":["qb2","rb2","wr3","wr4","${GIBBS}"],
              "starters":["qb2","rb2","wr3","wr4"]}]`)
  let players = `
            {"qb1":{"full_name":"Starter QB","position":"QB","team":"BUF","active":true},
             "rb1":{"full_name":"Starter Back","position":"RB","team":"DET","active":true},
             "wr1":{"full_name":"Receiver One","position":"WR","team":"MIN","active":true},
             "wr2":{"full_name":"Receiver Two","position":"WR","team":"DAL","active":true},
             "wr_bench":{"full_name":"Bench Receiver","position":"WR","team":"NE","active":true},
             "ir_guy":{"full_name":"Reserve Back","position":"RB","team":"KC","active":true,"injury_status":"IR"},
             "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true},
             "rb2":{"full_name":"Rival Back","position":"RB","team":"KC","active":true},
             "wr3":{"full_name":"Receiver Three","position":"WR","team":"NYJ","active":true},
             "wr4":{"full_name":"Receiver Four","position":"WR","team":"MIA","active":true},
             "${GIBBS}":{"full_name":"Jahmyr Gibbs","position":"RB","team":"DET","active":true},
             "${SMITH_NJIGBA}":{"full_name":"Jaxon Smith-Njigba","position":"WR","team":"SEA","active":true},
             "${PROJECTED_ONLY_BACK}":{"full_name":"Bijan Robinson","position":"RB","team":"ATL","active":true},
             "retired":{"full_name":"Retired Receiver","position":"WR","team":"SEA","active":false}}`
  for (const [id, tag] of Object.entries(injuries)) {
    players = players.split(`"${id}":{`).join(`"${id}":{"injury_status":"${tag}",`)
  }
  t.replace('/players/nfl', players)
  if (failInsights) t.fail('/projections/nfl').fail('/stats/nfl')
  return t
    .json('/projections/nfl/2026/3', fixtureText('FCApp', 'projections-2026-w3.json'))
    .json('/stats/nfl/2026/2', fixtureText('FCApp', 'stats-2026-w2.json'))
}

async function model(t: StubTransport): Promise<WaiverBoardModel> {
  const { sleeper, staticData } = makeHarness(t)
  const loader = new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs)
  const m = new WaiverBoardModel(loader, undefined)
  await m.load({ leagueID: 'L1', userRosterID: 1 })
  return m
}

/**
 * Port of WaiverBoardModelTests: the Waiver Board against recorded 2026
 * Sleeper payloads — week-3 projections and week-2 stat lines. Jaxon
 * Smith-Njigba is a free agent with both; the user's bench holds a receiver
 * with neither.
 */
describe('WaiverBoardModel', () => {
  it('free agents rank on projection over the projected start line', async () => {
    const m = await model(transport())
    expect(m.errorMessage).toBeUndefined()
    expect(m.sort).toBe('projectedOverLine')

    const jsn = m.rows.find((r) => r.id === SMITH_NJIGBA)
    expect(jsn).toBeDefined()
    expect(jsn!.availability).toEqual({ kind: 'freeAgent' })
    expect(jsn!.projected).toBeDefined()
    expect(jsn!.projectedOverLine).toBeDefined()
    expect(jsn!.sleeperPointsPerGame).toBeDefined()
    expect(Math.abs(jsn!.sleeperPointsPerGame! - 33.5)).toBeLessThanOrEqual(0.01)
    expect(jsn!.snapShare).toBeDefined()
    expect(Math.abs(jsn!.snapShare! - 47.0 / 70.0)).toBeLessThanOrEqual(0.001)
    expect(jsn!.redZoneTouches).toBe(3)
    expect(jsn!.targetShare, 'team targets are summed from every Sleeper line that week').toBeDefined()

    // The projected start line for WR is the 2nd-best projected receiver in
    // a two-team league starting two — and JSN is above it or on it.
    const line = m.projectedLines.WR
    expect(line).toBeDefined()
    expect(line!.starters).toBe(4)
    expect(Math.abs(jsn!.projectedOverLine! - (jsn!.projected! - line!.startLine))).toBeLessThanOrEqual(0.001)

    // Sorted descending with the unvalued at the bottom.
    const values = m.rows.map((r) => waiverRowValue(r, 'projectedOverLine'))
    const valued = values.filter((v): v is number => v !== undefined)
    expect(valued).toEqual([...valued].sort((a, b) => b - a))
    const firstNil = values.findIndex((v) => v === undefined)
    if (firstNil >= 0) {
      expect(values.slice(firstNil).every((v) => v === undefined)).toBe(true)
    }
    expect(m.rows.some((r) => r.id === 'retired')).toBe(false)
    expect(m.rows.some((r) => r.id === 'wr1'), 'your own players are never on the board').toBe(false)
  })

  it('rival benches are hidden until asked', async () => {
    const m = await model(transport())
    expect(m.rows.some((r) => r.id === GIBBS)).toBe(false)
    m.includeRivalBenches = true
    const gibbs = m.rows.find((r) => r.id === GIBBS)
    expect(gibbs).toBeDefined()
    expect(gibbs!.availability).toEqual({ kind: 'rivalBench', rosterID: 2, manager: 'rival' })
  })

  it('position filter, search and sort switch', async () => {
    const m = await model(transport())
    m.positionFilter = 'RB'
    expect(m.rows.map((r) => r.id)).toEqual([PROJECTED_ONLY_BACK])

    m.positionFilter = undefined
    m.query = 'njigba'
    expect(m.rows.map((r) => r.id)).toEqual([SMITH_NJIGBA])

    m.query = ''
    m.sort = 'snapShare'
    const first = m.rows[0]
    expect(first).toBeDefined()
    expect(first!.snapShare).toBeDefined()
    expect(first!.id).toBe(SMITH_NJIGBA)
    expect(m.unvaluedCount, 'the projected-only back has no snap share yet and ranks last').toBe(1)
  })

  it('league facts strip reads live settings', async () => {
    const m = await model(transport())
    const facts = m.facts
    expect(facts).toBeDefined()
    expect(facts!.system).toEqual({ kind: 'faab', budget: 100 })
    expect(facts!.faabRemaining).toBe(60)
    expect(facts!.waiverPosition).toBe(1)
    expect(facts!.processingDay).toBe('Tuesday')
    expect(facts!.irSlots).toBe(1)
    expect(facts!.irUsed).toBe(1)
    expect(waiverFactsIRFree(facts!)).toBe(0)
  })

  /**
   * The bench is the drop list: starters and IR players never appear, an
   * IR-tagged player is marked eligible, and the weakest projection is first.
   */
  it('drop candidates are the bench, weakest first', async () => {
    const m = await model(transport())
    expect(m.dropCandidates.map((d) => d.id)).toEqual(['wr_bench'])
    expect(m.dropCandidates.some((d) => d.id === 'ir_guy')).toBe(false)
    expect(m.dropCandidates.some((d) => d.id === 'wr1')).toBe(false)
  })

  /**
   * Adding a projected receiver for an unprojected bench receiver: the
   * lineup gains exactly what the optimizer seats.
   */
  it('pair effect measures the lineup on the projection', async () => {
    const m = await model(transport())
    const jsn = m.rows.find((r) => r.id === SMITH_NJIGBA)
    const drop = m.dropCandidates[0]
    expect(jsn).toBeDefined()
    expect(drop).toBeDefined()
    const effect = m.pairEffect(jsn!, drop!)
    expect(effect.note).toBeUndefined()
    expect(effect.before, 'nobody currently rostered has a projection in the fixture').toBe(0)
    expect(effect.after).toBeDefined()
    expect(jsn!.projected).toBeDefined()
    expect(Math.abs(effect.after! - jsn!.projected!)).toBeLessThanOrEqual(0.11)
    expect(effect.delta).toBeDefined()
    expect(Math.abs(effect.delta! - jsn!.projected!)).toBeLessThanOrEqual(0.11)
    expect(effect.basisLabel.includes('Rotowire')).toBe(true)
  })

  /**
   * An Out free agent can't be in this week's lineup, so adding him gains
   * nothing now — and the effect says why.
   */
  it('adding an Out player gains nothing this week', async () => {
    const m = await model(transport({ injuries: { [SMITH_NJIGBA]: 'Out' } }))
    const jsn = m.rows.find((r) => r.id === SMITH_NJIGBA)
    const drop = m.dropCandidates[0]
    expect(jsn).toBeDefined()
    expect(drop).toBeDefined()
    const effect = m.pairEffect(jsn!, drop!)
    expect(effect.delta).toBe(0)
    expect(effect.note?.includes('Out') ?? false).toBe(true)
  })

  /**
   * With no projections reachable the board still lists what it can measure
   * and the pair effect says why it has no number.
   */
  it('without projections the board degrades and says so', async () => {
    const m = await model(transport({ failInsights: true }))
    expect(m.errorMessage).toBeUndefined()
    expect(Object.keys(m.projectedLines)).toEqual([])
    expect(m.sourceNotes.some((n) => n.includes('Unavailable'))).toBe(true)
    // The default column has nobody to rank, so the board moves to the
    // first one that does rather than showing a list of dashes.
    expect(m.sort).not.toBe('projectedOverLine')
    const first = m.rows[0]
    expect(first === undefined ? undefined : waiverRowValue(first, m.sort)).toBeDefined()
  })
})
