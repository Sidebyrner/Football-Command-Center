import { describe, expect, it } from 'vitest'
import { IDP } from '@core/Position'
import { LeagueContextLoader } from '../../league/LeagueContextLoader'
import { PLANNING_MODES, planningModePurpose, type PlanningPlayer } from '../PlanningJobs'
import { PlanningModel } from '../PlanningModel'
import { makeHarness, standardTransport, TestClock } from '../../../../tests/appHarness'

/**
 * Port of PlanningJobsTests: Planning's three jobs against the real 2025 schedule.
 *
 * The user's two backs are LAR and SEA, both off in week 8, so week 8 is short at
 * RB. The rival's bench carries Bijan Robinson (ATL, plays week 8) and Jahmyr
 * Gibbs (DET, also off in week 8) — so a correct trade finder offers Bijan for
 * week 8 and never Gibbs. Christian McCaffrey is an unrostered back who plays.
 */
const Fixture = {
  rosters: String.raw`
        [{"roster_id":1,"owner_id":"u1",
          "players":["qb1","rb_la","rb_sea","wr1","wr2","te1","wr_flex","k1","PHI","lb1","dl1"],
          "starters":["qb1","rb_la","rb_sea","wr1","wr2","te1","wr_flex","k1","PHI","lb1","dl1"]},
         {"roster_id":2,"owner_id":"u2",
          "players":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2","9509","9221"],
          "starters":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"]}]
        `,

  players: String.raw`
        {"qb1":{"full_name":"Starter QB","position":"QB","team":"BUF","active":true},
         "rb_la":{"full_name":"Rams Back","position":"RB","team":"LAR","active":true},
         "rb_sea":{"full_name":"Seattle Back","position":"RB","team":"SEA","active":true},
         "wr1":{"full_name":"Receiver One","position":"WR","team":"MIN","active":true},
         "wr2":{"full_name":"Receiver Two","position":"WR","team":"DAL","active":true},
         "te1":{"full_name":"Tight End","position":"TE","team":"KC","active":true},
         "wr_flex":{"full_name":"Flex Receiver","position":"WR","team":"NE","active":true},
         "k1":{"full_name":"Kicker One","position":"K","team":"BAL","active":true},
         "PHI":{"position":"DEF","team":"PHI","active":true},
         "lb1":{"full_name":"Linebacker One","position":"LB","team":"CHI","active":true},
         "dl1":{"full_name":"Lineman One","position":"DL","team":"GB","active":true},
         "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true},
         "rb_buf":{"full_name":"Bills Back","position":"RB","team":"BUF","active":true},
         "rb_kc":{"full_name":"Chiefs Back","position":"RB","team":"KC","active":true},
         "wr3":{"full_name":"Receiver Three","position":"WR","team":"NYJ","active":true},
         "wr4":{"full_name":"Receiver Four","position":"WR","team":"MIA","active":true},
         "te2":{"full_name":"Tight End Two","position":"TE","team":"SF","active":true},
         "wr_flex2":{"full_name":"Flex Receiver Two","position":"WR","team":"CIN","active":true},
         "k2":{"full_name":"Kicker Two","position":"K","team":"NO","active":true},
         "DAL":{"position":"DEF","team":"DAL","active":true},
         "lb2":{"full_name":"Linebacker Two","position":"LB","team":"NE","active":true},
         "dl2":{"full_name":"Lineman Two","position":"DL","team":"TB","active":true},
         "9509":{"full_name":"Bijan Robinson","position":"RB","team":"ATL","active":true},
         "9221":{"full_name":"Jahmyr Gibbs","position":"RB","team":"DET","active":true},
         "4034":{"full_name":"Christian McCaffrey","position":"RB","team":"SF","active":true},
         "lb_fa":{"full_name":"Free Linebacker","position":"LB","team":"MIA","active":true},
         "SF":{"position":"DEF","team":"SF","active":true}}
        `,

  /** McCaffrey, a free-agent LB, the SF defense — and one rostered player, who must never be offered as a pickup. */
  trending: String.raw`
        [{"player_id":"4034","count":9000},{"player_id":"lb_fa","count":8000},
         {"player_id":"SF","count":7000},{"player_id":"rb_buf","count":6000}]
        `,
}

async function loaded(withSleeper = true): Promise<PlanningModel> {
  const transport = standardTransport()
    .override('/league/L1/rosters', Fixture.rosters)
    .override('/players/nfl', Fixture.players)
    .override('/trending/add', Fixture.trending)
  const { sleeper, staticData } = makeHarness(transport)

  const model = new PlanningModel(
    new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs),
    withSleeper ? sleeper : undefined,
  )
  await model.load('L1', 1, 2025)
  // Swift throws XCTSkip here; a failed load fails the test instead, so it can't pass silently.
  if (model.errorMessage) throw new Error(`load failed: ${model.errorMessage}`)
  return model
}

function onBye(model: PlanningModel, player: PlanningPlayer, week: number): boolean {
  return model.context?.byeCalendar.isOnBye(player.team, week) ?? false
}

function unwrap<T>(value: T | undefined): T {
  expect(value).toBeDefined()
  return value as T
}

describe('Planning jobs', () => {
  // MARK: - Modes

  it('opens on byes and every mode states its purpose', async () => {
    const model = await loaded()
    expect(model.mode).toBe('byes')
    for (const mode of PLANNING_MODES) {
      expect(planningModePurpose(mode).length === 0).toBe(false)
    }
  })

  // MARK: - Byes

  it('week eight needs running backs', async () => {
    const model = await loaded()
    expect(model.neededPositions(8)).toEqual(new Set(['RB']))
  })

  /** Week 5 takes out both IDP starters (CHI and GB), leaving the two IDP_FLEX slots empty. */
  it('a short flex group needs its eligible positions', async () => {
    const model = await loaded()
    const needed = model.neededPositions(5)
    expect(['LB', 'DL', 'DB'].every((p) => needed.has(p as 'LB'))).toBe(true)
  })

  /** Pickups for a week are free agents at a needed position who play that week. */
  it('pickups are free agents at needed positions who play that week', async () => {
    const model = await loaded()
    const pickups = model.pickups(8)

    expect(pickups.length === 0).toBe(false)
    for (const player of pickups) {
      expect(player.position, `${player.name} is not at a needed position`).toBe('RB')
      expect(onBye(model, player, 8), `${player.name} is on bye in week 8`).toBe(false)
      expect(player.availability, `${player.name} can't be picked up`).toEqual({ kind: 'freeAgent' })
    }
    // Bijan plays in week 8 but sits on a rival's bench: a trade, not a pickup.
    expect(pickups.some((p) => p.name === 'Bijan Robinson')).toBe(false)
    expect(pickups.some((p) => p.name === 'Christian McCaffrey')).toBe(true)
    expect(pickups.some((p) => p.name === 'Jahmyr Gibbs'), 'DET is on bye in week 8').toBe(false)
  })

  /** No production data exists for IDP, so the only pickups there come from trending adds — popularity only. */
  it('IDP pickups come only from trending and are popularity only', async () => {
    const model = await loaded()
    const idp = model.pickups(5).filter((p) => IDP.has(p.position))

    expect(idp.some((p) => p.name === 'Free Linebacker')).toBe(true)
    expect(idp.every((p) => p.popularityOnly && p.pointsPerGame === undefined)).toBe(true)
  })

  // MARK: - Trades

  it('the rival with spare backs is a trade target for week eight', async () => {
    const model = await loaded()
    const target = unwrap(model.tradeTargets.find((t) => t.rival.rosterID === 2))
    expect(target.weeksCovered).toContain(8)

    const bijan = unwrap(target.candidates.find((c) => c.name === 'Bijan Robinson'))
    expect(bijan.coversWeeks).toContain(8)
  })

  /** Gibbs is on the rival's bench but DET is off in week 8, so he can't fix week 8. */
  it('a bench player on bye does not cover that week', async () => {
    const model = await loaded()
    const target = unwrap(model.tradeTargets.find((t) => t.rival.rosterID === 2))
    const gibbs = target.candidates.find((c) => c.name === 'Jahmyr Gibbs')
    expect(gibbs?.coversWeeks.includes(8) ?? false).toBe(false)
  })

  /** Only bench players are offered: taking a starter would break the rival's own lineup. */
  it('only bench players are offered', async () => {
    const model = await loaded()
    const starters = new Set(model.context?.teams.find((t) => t.rosterID === 2)?.starterIDs ?? [])
    for (const target of model.tradeTargets) {
      expect(target.candidates.every((c) => !starters.has(c.id))).toBe(true)
    }
  })

  /** The rival is short in week 10 themselves (four starters off), so they are no help that week. */
  it('a rival short that week covers nothing that week', async () => {
    const model = await loaded()
    expect(model.cell(2, 10)?.isShort ?? false, 'fixture precondition').toBe(true)
    const target = model.tradeTargets.find((t) => t.rival.rosterID === 2)
    expect(target?.weeksCovered.includes(10) ?? false).toBe(false)
  })

  // MARK: - Waivers

  /** Every waiver fill is a free agent who genuinely covers each week it claims. */
  it('waiver fills genuinely cover the weeks they claim', async () => {
    const model = await loaded()
    expect(model.waiverFills.length === 0).toBe(false)
    for (const player of model.waiverFills) {
      expect(player.availability).toEqual({ kind: 'freeAgent' })
      expect(player.coversWeeks.length === 0).toBe(false)
      for (const week of player.coversWeeks) {
        expect(model.neededPositions(week).has(player.position)).toBe(true)
        expect(onBye(model, player, week), `${player.name} is on bye in ${week}`).toBe(false)
      }
    }
  })

  it('trending excludes rostered players and is popularity only', async () => {
    const model = await loaded()
    const names = model.waiverTrending.map((p) => p.name)

    expect(names.includes('Bills Back'), 'rostered players are not pickups').toBe(false)
    expect(model.waiverTrending.every((p) => p.popularityOnly)).toBe(true)
    expect(model.trendingUnavailable).toBe(false)
  })

  /** The PHI defense is off in week 9, so a trending defense that plays covers it. */
  it('a trending defense covers the week your defense is off', async () => {
    const model = await loaded()
    const sf = unwrap(model.waiverTrending.find((p) => p.id === 'SF'))
    expect(sf.position).toBe('DEF')
    expect(sf.coversWeeks).toContain(9)
  })

  /** Without the Sleeper service the planner still works on production data and says trending is unavailable. */
  it('without trending the planner still works and says so', async () => {
    const model = await loaded(false)
    expect(model.trendingUnavailable).toBe(true)
    expect(model.waiverTrending.length === 0).toBe(true)
    expect(model.waiverFills.length === 0).toBe(false)
  })
})
