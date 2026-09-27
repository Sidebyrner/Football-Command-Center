import { describe, expect, it } from 'vitest'
import { RelayClient } from '@data/RelayClient'
import { InMemorySecretStore, type SecretStore } from '@data/secretStore'
import { LeagueContextLoader } from '../../league/LeagueContextLoader'
import type { LeagueContext } from '../../league/LeagueContext'
import {
  injuryBadge, isWindowClosed, lineupDelta, mustDrop, TradeWizardModel, tradeWindowFrom,
  type TradeGoal, type TradeWizardPrefill,
} from '../TradeWizardModel'
import { makeHarness, standardTransport, TestClock } from '../../../../tests/appHarness'
import { StubTransport } from '../../../../tests/stubTransport'
import { fixtureText } from '../../../../tests/swiftFixtures'

/**
 * Port of TradeDeskTests: the Trade Desk in a two-team superflex league on the
 * recorded week-2 2026 Sleeper lines. The user starts Cam Ward (8 points) at
 * SUPER_FLEX and has Kyren Williams on IR; the rival has Dak Prescott spare on
 * the bench and Brock Purdy on IR.
 */
const mahomes = '4046', ward = '12522', cook = '8138', bolton = '7648', kyren = '8150'
const allen = '4984', young = '9228', shough = '12545'
const goff = '3163', stafford = '421', gibbs = '9221', edmunds = '4968'
const prescott = '3294', hampton = '12507', purdy = '8183', lamar = '4881'

async function context(
  { myBench = [] as string[], theirBench = [] as string[], deadline = 11 as number | undefined } = {},
): Promise<LeagueContext> {
  const deadlineSetting = deadline !== undefined ? `,"trade_deadline":${deadline}` : ''
  const mine = [mahomes, ward, cook, bolton, kyren, ...myBench]
  const theirs = [goff, stafford, gibbs, edmunds, prescott, hampton, purdy, ...theirBench]
  const list = (ids: string[]) => ids.map((id) => `"${id}"`).join(',')
  const transport = standardTransport()
    .override('/state/nfl', String.raw`{"week":3,"season":"2026","season_type":"regular"}`)
    .replace('/league/L1', `
            {"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":2,
             "roster_positions":["QB","SUPER_FLEX","RB","LB","BN","BN","BN","IR"],
             "scoring_settings":{"pass_yd":0.04,"pass_td":4,"pass_int":-2,"rush_yd":0.1,"rush_td":6,"rush_fd":1,
               "rec_yd":0.1,"rec_td":6,"rec_fd":1,"idp_tkl_solo":2,"idp_tkl_ast":1,"idp_sack":5},
             "settings":{"waiver_type":2,"waiver_budget":100,"reserve_slots":1${deadlineSetting}}}
            `)
    .replace('/league/L1/rosters', `
            [{"roster_id":1,"owner_id":"u1","players":[${list(mine)}],
              "starters":[${list([mahomes, ward, cook, bolton])}],"reserve":["${kyren}"]},
             {"roster_id":2,"owner_id":"u2","players":[${list(theirs)}],
              "starters":[${list([goff, stafford, gibbs, edmunds])}],"reserve":["${purdy}"]}]
            `)
    .replace('/players/nfl', `
            {"${mahomes}":{"full_name":"Patrick Mahomes","position":"QB","team":"KC","active":true},
             "${ward}":{"full_name":"Cam Ward","position":"QB","team":"TEN","active":true},
             "${cook}":{"full_name":"James Cook","position":"RB","team":"BUF","active":true},
             "${bolton}":{"full_name":"Nick Bolton","position":"LB","team":"KC","active":true},
             "${kyren}":{"full_name":"Kyren Williams","position":"RB","team":"LAR","active":true,"injury_status":"IR"},
             "${allen}":{"full_name":"Josh Allen","position":"QB","team":"BUF","active":true},
             "${young}":{"full_name":"Bryce Young","position":"QB","team":"CAR","active":true},
             "${shough}":{"full_name":"Tyler Shough","position":"QB","team":"NO","active":true},
             "${goff}":{"full_name":"Jared Goff","position":"QB","team":"DET","active":true},
             "${stafford}":{"full_name":"Matthew Stafford","position":"QB","team":"LAR","active":true},
             "${gibbs}":{"full_name":"Jahmyr Gibbs","position":"RB","team":"DET","active":true},
             "${edmunds}":{"full_name":"Tremaine Edmunds","position":"LB","team":"NYG","active":true},
             "${prescott}":{"full_name":"Dak Prescott","position":"QB","team":"DAL","active":true},
             "${hampton}":{"full_name":"Omarion Hampton","position":"RB","team":"LAC","active":true},
             "${purdy}":{"full_name":"Brock Purdy","position":"QB","team":"SF","active":true},
             "${lamar}":{"full_name":"Lamar Jackson","position":"QB","team":"BAL","active":true}}
            `)
    .json('/stats/nfl/2026/2', fixtureText('FCApp', 'stats-2026-w2.json'))
  const harness = makeHarness(transport)
  const loader = new LeagueContextLoader(harness.sleeper, harness.staticData, TestClock.beforeKickoffs)
  return loader.load({ leagueID: 'L1', userRosterID: 1 })
}

async function desk(
  { myBench = [], theirBench = [], relay, secrets = new InMemorySecretStore(), prefill }:
  { myBench?: string[]; theirBench?: string[]; relay?: RelayClient; secrets?: SecretStore; prefill?: TradeWizardPrefill } = {},
): Promise<TradeWizardModel> {
  return new TradeWizardModel(await context({ myBench, theirBench }), { relay, secrets, prefill })
}

function flexUpgrade(model: TradeWizardModel): TradeGoal {
  const goal = model.goals.find((g) => g.upgradeOverID === ward)
  expect(goal).toBeDefined()
  return goal!
}

function firstPartner(model: TradeWizardModel) {
  const fit = model.partners[0]
  expect(fit).toBeDefined()
  return fit!
}

function unwrap<T>(value: T | undefined): T {
  expect(value).toBeDefined()
  return value!
}

describe('TradeDesk', () => {
  // MARK: - Values

  it('values are this season\'s and cover IDP', async () => {
    const model = await desk()
    expect(model.primaryBasis).toBe('thisSeason')
    expect(model.basis).toBe('thisSeason')
    expect(model.label('thisSeason')).toBe('2026 pts/gm')
    expect(model.hint('thisSeason').includes('week 2 —')).toBe(true)
    expect(model.value(bolton, 'thisSeason'), "a linebacker is valued from Sleeper's lines").toBeDefined()
    expect(model.value(bolton, 'production')).toBeUndefined()
    // 183 passing yards, 7 rushing, two rushing TDs and a rushing first down.
    const expected = 7.32 + 0.7 + 12 + 1
    expect(Math.abs(unwrap(model.value(ward, 'thisSeason')) - expected)).toBeLessThanOrEqual(0.01)
    expect(model.availableBases).toContain('thisSeason')
  })

  it('a weak superflex quarterback becomes an upgrade goal', async () => {
    const model = await desk()
    const goal = flexUpgrade(model)
    expect(goal.title.includes('flex QB')).toBe(true)
    expect(goal.positions.has('QB')).toBe(true)
    model.chooseGoal(goal)
    const partner = firstPartner(model)
    expect(partner.theirOffer.some((p) => p.id === prescott)).toBe(true)
    expect(partner.theirOffer.some((p) => p.id === purdy), 'an IR player is not an offer').toBe(false)
  })

  it('the quarterback start line counts superflex demand', async () => {
    const model = await desk()
    // Both teams start a QB in SUPER_FLEX: four QBs start, not two, so the
    // line is the fourth-best quarterback — Mahomes (29.98), behind Allen,
    // Prescott and Purdy. A dedicated-only count would put it at Prescott.
    expect(Math.abs(unwrap(model.value(mahomes, 'overStartLine')) - 0)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(unwrap(model.value(prescott, 'overStartLine')) - (31.76 - 29.98))).toBeLessThanOrEqual(0.01)
    expect(unwrap(model.value(goff, 'overStartLine'))).toBeLessThan(0)
  })

  // MARK: - IR

  it('IR players are marked and never spare', async () => {
    const model = await desk()
    model.chooseGoal(flexUpgrade(model))
    model.choosePartner(firstPartner(model))
    const purdyRow = unwrap(model.theirPlayers.find((p) => p.id === purdy))
    expect(purdyRow.isReserve).toBe(true)
    expect(purdyRow.isSurplus).toBe(false)
    expect(model.theirPlayers[model.theirPlayers.length - 1]?.id, 'IR sorts last').toBe(purdy)
    const kyrenRow = unwrap(model.yourPlayers.find((p) => p.id === kyren))
    expect(kyrenRow.isReserve).toBe(true)
    expect(injuryBadge(kyrenRow)).toBe('On your IR')
    expect(model.sending.has(kyren)).toBe(false)
  })

  // MARK: - Deal math

  it('both teams\' lineups and grades move', async () => {
    const model = await desk()
    model.chooseGoal(flexUpgrade(model))
    model.choosePartner(firstPartner(model))
    model.toggleSending(ward)
    if (!model.receiving.has(prescott)) model.toggleReceiving(prescott)
    const effects = model.effects
    expect(unwrap(lineupDelta(effects.you)), 'Prescott for Ward improves your lineup').toBeGreaterThan(0)
    expect(lineupDelta(effects.them)).toBeDefined()
    expect(effects.you.gradeBefore?.letter).toBeDefined()
    expect(effects.you.gradeAfter?.letter).toBeDefined()
    expect(model.grades.size).toBe(2)
    expect(model.partners[0]?.grade).toBeDefined()
  })

  it('roster room is checked on both sides', async () => {
    // You: 7 active. Taking two for one needs a drop.
    const full = await desk({ myBench: [allen, young, shough] })
    full.chooseGoal(flexUpgrade(full))
    full.choosePartner(firstPartner(full))
    for (const id of [...full.sending]) full.toggleSending(id)
    full.toggleSending(ward)
    for (const id of [prescott, hampton]) if (!full.receiving.has(id)) full.toggleReceiving(id)
    expect(mustDrop(full.effects.you)).toBe(1)
    expect(full.effects.warnings).toContain("You receive 1 more player than you send — you'd need to drop 1")

    // Them: 7 active. Sending two for one makes them drop.
    const theirsFull = await desk({ theirBench: [lamar] })
    theirsFull.chooseGoal(flexUpgrade(theirsFull))
    theirsFull.choosePartner(firstPartner(theirsFull))
    for (const id of [...theirsFull.receiving]) if (id !== prescott) theirsFull.toggleReceiving(id)
    if (!theirsFull.receiving.has(prescott)) theirsFull.toggleReceiving(prescott)
    for (const id of [...theirsFull.sending]) theirsFull.toggleSending(id)
    theirsFull.toggleSending(ward)
    theirsFull.toggleSending(cook)
    expect(mustDrop(theirsFull.effects.them)).toBe(1)
    expect(theirsFull.effects.warnings.some((w) => w.startsWith('rival would need to drop 1'))).toBe(true)
  })

  // MARK: - Pitch

  it('the pitch keeps your reasons to yourself', async () => {
    const model = await desk()
    model.chooseGoal(flexUpgrade(model))
    model.choosePartner(firstPartner(model))
    for (const id of [...model.sending]) model.toggleSending(id)
    model.toggleSending(ward)
    expect(model.pitchFacts.some((f) => f.includes(' my ') || f.startsWith('Fixes my') || f.startsWith('Narrows my'))).toBe(false)
    expect(model.pitchFacts.some((f) => f.includes('Cam Ward is averaging') && f.includes('this season'))).toBe(true)
  })

  // MARK: - Navigation

  it('going back keeps the deal', async () => {
    const model = await desk()
    const goal = flexUpgrade(model)
    model.chooseGoal(goal)
    const partner = firstPartner(model)
    model.choosePartner(partner)
    model.toggleSending(cook)
    const deal = [new Set(model.sending), new Set(model.receiving)] as const
    model.back()
    model.back()
    expect(model.step).toBe('goal')
    model.chooseGoal(goal)
    model.choosePartner(partner)
    expect(model.step).toBe('deal')
    expect(model.sending).toEqual(deal[0])
    expect(model.receiving).toEqual(deal[1])
  })

  // MARK: - Finding and prefill

  it('search finds rival players only', async () => {
    const model = await desk()
    const results = model.search('dak prescot')
    expect(results[0]?.player.id).toBe(prescott)
    expect(results[0]?.rival.manager).toBe('rival')
    expect(model.search('mahomes').length === 0, 'your own players are not trade targets').toBe(true)

    model.target(unwrap(results[0]))
    expect(model.step).toBe('deal')
    expect(model.receiving).toEqual(new Set([prescott]))
    expect(model.partner?.rival.rosterID).toBe(2)
  })

  it('prefill explains what it could not do', async () => {
    const gone = await desk({ prefill: { positions: new Set(['QB']), rivalRosterID: 2, theirPlayerID: 'traded-away' } })
    expect(gone.partner?.rival.rosterID).toBe(2)
    expect(gone.prefillNote?.includes("no longer on rival's roster") ?? false).toBe(true)

    const missing = await desk({ prefill: { rivalRosterID: 99 } })
    expect(missing.prefillNote).toBe("That team couldn't be found in your league.")
  })

  it('offering your player keeps him on the send side', async () => {
    const model = await desk({ prefill: { myPlayerID: cook } })
    expect(model.prefillNote?.includes('James Cook is set to go out') ?? false).toBe(true)
    model.chooseGoal(flexUpgrade(model))
    model.choosePartner(firstPartner(model))
    expect(model.sending).toEqual(new Set([cook]))
  })

  // MARK: - Polish

  async function polished(status: number, token: string | undefined): Promise<TradeWizardModel> {
    const transport = new StubTransport().json('/api/ai/trade-pitch', String.raw`{"error":"x"}`, status)
    const relay = new RelayClient('https://relay.example.test', transport)
    const model = await desk({ relay, secrets: token !== undefined ? new InMemorySecretStore(token) : new InMemorySecretStore() })
    model.chooseGoal(flexUpgrade(model))
    model.choosePartner(firstPartner(model))
    await model.polishPitch()
    return model
  }

  it('polish failures say what to fix', async () => {
    const refused = await polished(401, 'bad')
    expect(refused.polishError).toBe('Your relay turned down the token. Check it in Settings.')
    const broken = await polished(500, 'good')
    expect(broken.polishError).toBe('Your relay hit an error (500). The pitch above still works.')
    expect(broken.isPolishing).toBe(false)

    // Editing the deal clears the old error.
    broken.toggleSending(cook)
    expect(broken.polishError).toBeUndefined()
  })

  // MARK: - Deadline and bases

  it('deadline edges', () => {
    expect(tradeWindowFrom(0, 3)).toEqual({ kind: 'noDeadline' })
    expect(tradeWindowFrom(99, 3)).toEqual({ kind: 'noDeadline' })
    expect(tradeWindowFrom(11, 11)).toEqual({ kind: 'open', deadlineWeek: 11, weeksLeft: 0 })
    expect(isWindowClosed(tradeWindowFrom(11, 12))).toBe(true)
  })

  it('rest of season is built on prepare', async () => {
    const model = await desk()
    expect(model.restOfSeasonReady).toBe(false)
    await model.prepare()
    expect(model.restOfSeasonReady).toBe(true)
    model.basis = 'restOfSeason'
    expect(model.hint('restOfSeason').includes('regressed')).toBe(true)
  })
})
