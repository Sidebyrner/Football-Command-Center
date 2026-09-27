import { describe, expect, it } from 'vitest'
import { RelayClient } from '@data/RelayClient'
import { InMemorySecretStore, type SecretStore } from '@data/secretStore'
import { LeagueContextLoader } from '../../league/LeagueContextLoader'
import type { LeagueContext } from '../../league/LeagueContext'
import {
  TradeWizardModel, tradeWindowFrom, tradeWindowLabel, isWindowClosed,
  type TradeGoal, type TradeWizardPrefill,
} from '../TradeWizardModel'
import { makeHarness, standardTransport, TestClock, TestLeague } from '../../../../tests/appHarness'
import { StubTransport } from '../../../../tests/stubTransport'

/**
 * Port of TradeWizardTests: the trade wizard against the real 2025 schedule.
 *
 * The user's backs are LAR and SEA, both off in week 8, and their TE (KC) and a
 * WR (DAL) are off in week 10. They carry a spare receiver (IND). The rival's
 * bench holds Bijan Robinson (ATL, plays week 8) and Jahmyr Gibbs (DET, off in
 * week 8). Without Bijan the rival can't fill their flex in week 10, when their
 * KC back and CIN receiver are both off.
 */

/** `PlanningJobsTests.Fixture.players`, verbatim. */
const planningPlayers = String.raw`
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
        `

const Fixture = {
  rosters: String.raw`
        [{"roster_id":1,"owner_id":"u1",
          "players":["qb1","rb_la","rb_sea","wr1","wr2","te1","wr_flex","k1","PHI","lb1","dl1","wr_spare"],
          "starters":["qb1","rb_la","rb_sea","wr1","wr2","te1","wr_flex","k1","PHI","lb1","dl1"]},
         {"roster_id":2,"owner_id":"u2",
          "players":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2","9509","9221"],
          "starters":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"]}]
        `,

  get players(): string {
    return planningPlayers.replaceAll(
      String.raw`"SF":{"position":"DEF","team":"SF","active":true}}`,
      String.raw`"SF":{"position":"DEF","team":"SF","active":true},"wr_spare":{"full_name":"Spare Receiver","position":"WR","team":"IND","active":true}}`,
    )
  },

  league(deadline: number): string {
    return TestLeague.leagueJSON().replaceAll(`"total_rosters":12,`, `"total_rosters":12,"settings":{"trade_deadline":${deadline}},`)
  },
}

async function context(
  { deadline = 11, state = TestLeague.nflState as string, injuries = {} as Record<string, string> } = {},
): Promise<LeagueContext> {
  let players = Fixture.players
  for (const [id, tag] of Object.entries(injuries)) {
    players = players.replaceAll(`"${id}":{`, `"${id}":{"injury_status":"${tag}",`)
  }
  const transport = standardTransport()
    .override('/league/L1/rosters', Fixture.rosters)
    .override('/players/nfl', players)
    .replace('/league/L1', Fixture.league(deadline))
    .replace('/state/nfl', state)
  const harness = makeHarness(transport)
  const loader = new LeagueContextLoader(harness.sleeper, harness.staticData, TestClock.beforeKickoffs)
  return loader.load({ leagueID: 'L1', userRosterID: 1, season: 2025 })
}

async function wizard(
  { deadline = 11, relay, secrets = new InMemorySecretStore(), prefill }:
  { deadline?: number; relay?: RelayClient; secrets?: SecretStore; prefill?: TradeWizardPrefill } = {},
): Promise<TradeWizardModel> {
  return new TradeWizardModel(await context({ deadline }), { relay, secrets, prefill })
}

const isOnly = (goal: TradeGoal, position: string) => goal.positions.size === 1 && goal.positions.has(position as never)

function rbWeek8(model: TradeWizardModel): TradeGoal {
  const goal = model.goals.find((g) => isOnly(g, 'RB') && g.weeks.length === 1 && g.weeks[0] === 8)
  expect(goal).toBeDefined()
  return goal!
}

function firstPartner(model: TradeWizardModel) {
  const fit = model.partners[0]
  expect(fit).toBeDefined()
  return fit!
}

describe('TradeWizard', () => {
  // MARK: - Goals

  it('goals come from your short weeks', async () => {
    const model = await wizard()
    const rb = rbWeek8(model)
    expect(rb.title).toBe('RB depth for week 8')
    expect(model.goals.some((g) => isOnly(g, 'TE') && g.weeks.includes(10))).toBe(true)
    expect(model.step).toBe('goal')

    // Soonest week first, upgrades last.
    const firstWeeks = model.goals.filter((g) => g.weeks.length > 0).map((g) => Math.min(...g.weeks))
    expect(firstWeeks).toEqual([...firstWeeks].sort((a, b) => a - b))
    const firstUpgrade = model.goals.findIndex((g) => g.weeks.length === 0)
    if (firstUpgrade >= 0) {
      expect(model.goals.slice(firstUpgrade).every((g) => g.weeks.length === 0)).toBe(true)
    }
  })

  // MARK: - Partners

  it('partners offer spare players who play the goal weeks', async () => {
    const model = await wizard()
    model.chooseGoal(rbWeek8(model))

    expect(model.step).toBe('partner')
    const fit = firstPartner(model)
    expect(fit.rival.rosterID).toBe(2)
    expect(fit.theirOffer.map((p) => p.id), "Gibbs is off in week 8 and starters aren't spare").toEqual(['9509'])
    expect(fit.facts).toContain('Has 1 spare RB who plays week 8')
  })

  // MARK: - Deal effects

  it('their back narrows your week eight', async () => {
    const model = await wizard()
    model.chooseGoal(rbWeek8(model))
    model.choosePartner(firstPartner(model))
    expect(model.receiving).toEqual(new Set(['9509']))

    model.toggleSending('wr_spare')
    const week8 = model.effects.yourWeeks.find((w) => w.week === 8)
    expect(week8).toBeDefined()
    expect(week8!.before).toBe(2)
    expect(week8!.after).toBe(1)
    expect(model.effects.yourGains).toContain('Narrows my week 8 shortfall from 2 to 1')
    expect(model.canApproach).toBe(true)
  })

  /**
   * Your spare receiver fills the flex Bijan leaves behind, so the deal as
   * proposed opens no hole for them. Taking Bijan for nothing does.
   */
  it('the deal warns when it breaks their lineup', async () => {
    const model = await wizard()
    model.chooseGoal(rbWeek8(model))
    model.choosePartner(firstPartner(model))

    expect(model.effects.warnings.some((w) => w.startsWith('Leaves rival short') && w.includes('week 10'))).toBe(true)
    expect(model.effects.warnings.some((w) => w.startsWith('You receive 1 more player'))).toBe(true)
    expect(model.canApproach, 'Nothing is being sent').toBe(false)

    model.toggleSending('wr_spare')
    expect(model.effects.warnings.some((w) => w.startsWith('Leaves rival short'))).toBe(false)
    expect(model.effects.theirWeeks.every((w) => w.after <= w.before)).toBe(true)
  })

  /**
   * Matching never suggests an Out player, but the manager can still trade
   * for one on purpose — and then he adds nothing to this week's lineup, and
   * is warned about.
   */
  it('an Out player you receive adds nothing this week', async () => {
    const lineupAfter = async (injuries: Record<string, string>) => {
      const model = new TradeWizardModel(await context({ injuries }), { secrets: new InMemorySecretStore() })
      const bijan = model.search('Bijan Robinson')[0]
      expect(bijan).toBeDefined()
      model.target(bijan!)
      if (!model.sending.has('wr_spare')) model.toggleSending('wr_spare')
      return model
    }
    const matched = new TradeWizardModel(await context({ injuries: { '9509': 'Out' } }), { secrets: new InMemorySecretStore() })
    matched.chooseGoal(rbWeek8(matched))
    expect(matched.partners.some((f) => f.theirOffer.some((p) => p.id === '9509')), 'an Out player is never a suggested target').toBe(false)
    const healthy = await lineupAfter({})
    const hurt = await lineupAfter({ '9509': 'Out' })
    expect(healthy.receiving).toEqual(new Set(['9509']))
    expect(hurt.receiving).toEqual(new Set(['9509']))
    expect(hurt.effects.warnings.some((w) => w.includes('Bijan Robinson is listed Out'))).toBe(true)
    const withHim = healthy.effects.you.lineupAfter
    expect(withHim).toBeDefined()
    expect(hurt.effects.you.lineupAfter ?? 0, 'an Out Bijan is not counted in this week\'s lineup').toBeLessThan(withHim!)
  })

  // MARK: - Pitch

  it('the pitch is only the deal\'s facts', async () => {
    const model = await wizard()
    model.chooseGoal(rbWeek8(model))
    model.choosePartner(firstPartner(model))
    model.toggleSending('wr_spare')
    model.advanceToApproach()

    expect(model.step).toBe('approach')
    expect(model.pitchFacts[0]).toBe("I'd send Spare Receiver (WR) for Bijan Robinson (RB).")
    expect(model.pitch).toBe(['Hey rival — trade idea.', ...model.pitchFacts, 'Open to it?'].join(' '))
    expect(model.pitch.includes('Gibbs')).toBe(false)
  })

  it('polish uses the relay with the stored token', async () => {
    const transport = new StubTransport().json('/api/ai/trade-pitch', String.raw`{"pitch":"  Polished pitch  "}`)
    const relay = new RelayClient('https://relay.example.test', transport)
    const model = await wizard({ relay, secrets: new InMemorySecretStore('secret') })
    model.chooseGoal(rbWeek8(model))
    model.choosePartner(firstPartner(model))
    model.toggleSending('wr_spare')

    await model.polishPitch()
    expect(model.polishedPitch).toBe('Polished pitch')
    expect(model.polishError).toBeUndefined()
  })

  it('polish without a token says where to add one', async () => {
    const transport = new StubTransport().json('/api/ai/trade-pitch', String.raw`{"error":"no"}`, 401)
    const relay = new RelayClient('https://relay.example.test', transport)
    const model = await wizard({ relay })
    model.chooseGoal(rbWeek8(model))
    model.choosePartner(firstPartner(model))
    model.toggleSending('wr_spare')

    await model.polishPitch()
    expect(model.polishedPitch).toBeUndefined()
    expect(model.polishError).toBe('Add your relay token in Settings to use your AI.')
  })

  // MARK: - Prefill and deadline

  it('prefill from a trade target opens on the deal', async () => {
    const model = await wizard({ prefill: { positions: new Set(['RB']), weeks: [8], rivalRosterID: 2, theirPlayerID: '9509' } })
    expect(model.step).toBe('deal')
    expect(model.receiving).toEqual(new Set(['9509']))
  })

  it('deadline window', () => {
    expect(tradeWindowFrom(undefined, 7)).toEqual({ kind: 'noDeadline' })
    expect(tradeWindowFrom(11, 7)).toEqual({ kind: 'open', deadlineWeek: 11, weeksLeft: 4 })
    expect(tradeWindowLabel(tradeWindowFrom(11, 7))).toBe('4 weeks until the trade deadline (week 11)')
    expect(tradeWindowLabel(tradeWindowFrom(7, 7))).toBe('Trade deadline is this week (week 7)')
    expect(isWindowClosed(tradeWindowFrom(6, 7))).toBe(true)
  })

  it('a closed window blocks the approach', async () => {
    const ctx = await context({ deadline: 6, state: TestLeague.dashboardState })
    const model = new TradeWizardModel(ctx, { secrets: new InMemorySecretStore() })
    expect(isWindowClosed(model.window)).toBe(true)
    const goal = model.goals[0]
    if (goal) {
      model.chooseGoal(goal)
      const partner = model.partners[0]
      if (partner) {
        model.choosePartner(partner)
        model.toggleSending('wr_spare')
      }
    }
    expect(model.canApproach).toBe(false)
    model.advanceToApproach()
    expect(model.step).not.toBe('approach')
  })

  it('a zero deadline means none', async () => {
    const model = await wizard({ deadline: 0 })
    expect(model.window).toEqual({ kind: 'noDeadline' })
  })
})
