import { describe, expect, it } from 'vitest'
import { LeagueContextLoader } from '../../league/LeagueContextLoader'
import { DiscoveryModel } from '../../market/DiscoveryModel'
import { WaiverBoardModel } from '../../market/WaiverBoardModel'
import { LinkBus } from '../../workspaces/LinkBus'
import { DecideModel, DecideSession, slotHasBenchOption, type DecideSlot } from '../DecideModel'
import { MatchupModel } from '../MatchupModel'
import { SitStartModel } from '../SitStartModel'
import { makeHarness, standardTransport, TestClock } from '../../../../tests/appHarness'
import { SitStartFixture } from './lineupFixtures'

/**
 * Port of DecideModelTests: Decide against the Sit/Start fixture league — real
 * 2025 players through the real crosswalk, with unjoinable fixture players
 * beside them.
 *
 * Starters: QB Allen, RB Barkley, RB Seattle Back, WR Chase, WR Receiver Two,
 * TE, an empty FLEX, K, DEF, two IDP. Bench: Goff, Gibbs, Robinson, Nacua.
 */

/** Nacua off the roster, so he's a free agent. */
const rostersWithNacuaFree = SitStartFixture.rosters.split('"9493",').join('')

async function loaded(options: { rosters?: string; injuries?: Record<string, string> } = {}) {
  const { rosters = SitStartFixture.rosters, injuries = {} } = options
  let players: string = SitStartFixture.players
  for (const [id, tag] of Object.entries(injuries)) {
    players = players.split(`"${id}":{`).join(`"${id}":{"injury_status":"${tag}",`)
  }
  const transport = standardTransport()
    .override('/state/nfl', '{"week":1,"season":"2025","season_type":"regular"}')
    .override('/league/L1/rosters', rosters)
    .override('/players/nfl', players)
  const { sleeper, staticData } = makeHarness(transport)
  const loader = new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs)
  const sitStart = new SitStartModel(loader)
  const waivers = new WaiverBoardModel(loader)
  const matchup = new MatchupModel(loader, sleeper)
  const discovery = new DiscoveryModel(loader)
  const request = { leagueID: 'L1', userRosterID: 1, season: 2025 }
  await sitStart.load('L1', 1, 2025)
  await waivers.load(request)
  await matchup.load('L1', 1, 2025)
  await discovery.load(request)
  if (sitStart.errorMessage !== undefined) throw new Error(`load failed: ${sitStart.errorMessage}`)
  return { decide: new DecideModel(sitStart, waivers, matchup, discovery), sitStart }
}

function slot(decide: DecideModel, index: number): DecideSlot {
  const found = decide.slot(index)
  expect(found, `no slot ${index}`).toBeDefined()
  return found!
}

describe('DecideModel', () => {
  it('a dedicated slot offers only that position', async () => {
    const { decide } = await loaded()
    const rb = slot(decide, 1)
    expect(rb.token).toBe('RB')
    expect(rb.incumbentID).toBe('4866')
    expect(rb.candidateIDs[0], 'the incumbent leads').toBe('4866')
    expect(new Set(rb.candidateIDs)).toEqual(new Set(['4866', '9221', '9509']))
    expect(slotHasBenchOption(rb)).toBe(true)
  })

  it('the flex offers every eligible position and no other starter', async () => {
    const { decide } = await loaded()
    const flex = slot(decide, 6)
    expect(flex.token).toBe('FLEX')
    expect(flex.incumbentID, "the fixture's flex is empty").toBeUndefined()
    expect(new Set(flex.candidateIDs), 'bench RBs and WRs; starters elsewhere stay put').toEqual(new Set(['9221', '9509', '9493']))
    expect(flex.verdict.headline.endsWith('at FLEX'), flex.verdict.headline).toBe(true)
  })

  it('candidates are valued exactly as Sit/Start values them', async () => {
    const { decide, sitStart } = await loaded()
    const context = sitStart.context!
    const signals = decide.signals('9509')
    expect(signals.commandCenter).toBe(sitStart.value('9509', 'commandCenter', context))
    expect(signals.form).toBe(sitStart.value('9509', 'form', context))
    expect(signals.environment).toBe(sitStart.value('9509', 'environment', context))
  })

  it("a player who is out has no signals and can't start", async () => {
    const { decide } = await loaded({ injuries: { '9509': 'Out' } })
    expect(decide.signals('9509')).toEqual({})
    const rb = slot(decide, 1)
    expect(rb.verdict.blocked.map((b) => b.id)).toEqual(['9509'])
    expect(rb.verdict.ranked.some((r) => r.id === '9509')).toBe(false)
  })

  it('the hopper only offers free agents who beat the weakest option', async () => {
    const { decide, sitStart } = await loaded({ rosters: rostersWithNacuaFree })
    const context = sitStart.context!
    const wr = slot(decide, 3)
    expect(wr.candidateIDs, 'Nacua is no longer on the bench').toEqual(['7564'])
    const suggestions = decide.suggestions(wr)
    const nacua = suggestions.find((s) => s.id === '9493')
    expect(nacua).toBeDefined()
    const chase = sitStart.value('7564', 'projected', context) ?? sitStart.value('7564', 'commandCenter', context)
    expect(chase).toBeDefined()
    expect(nacua!.value).toBeGreaterThan(chase!)
    expect(suggestions.every((s) => s.value > chase!)).toBe(true)
    expect(nacua!.reason.startsWith('Beats Chase on'), nacua!.reason).toBe(true)
    expect(decide.suggestions(slot(decide, 1)), 'a WR is never offered for an RB slot').toEqual([])
  })

  it("the hopper skips free agents who can't play", async () => {
    const { decide } = await loaded({ rosters: rostersWithNacuaFree, injuries: { '9493': 'Out' } })
    expect(decide.suggestions(slot(decide, 3)).some((s) => s.id === '9493')).toBe(false)
  })

  it('a session never touches the compare list', async () => {
    const { decide } = await loaded({ rosters: rostersWithNacuaFree })
    const linkBus = new LinkBus()
    const session = decide.session(slot(decide, 1))
    expect(session.ids.length).toBe(3)
    session.add('9493')
    expect(session.ids.length).toBe(4)
    session.removeFromCompare('4866')
    expect(session.ids, "the incumbent can't be removed").toContain('4866')
    session.removeFromCompare('9221')
    expect(session.ids).not.toContain('9221')
    expect(linkBus.compareList(1)).toEqual([])
  })

  it('a session leaves room for a suggested free agent', async () => {
    const { decide } = await loaded({ rosters: rostersWithNacuaFree })
    const session = decide.session(slot(decide, 3))
    expect(session.ids).toEqual(['7564'])
    expect(session.isFull).toBe(false)
  })

  it('a full session replaces the named column', async () => {
    const { decide } = await loaded()
    const session = new DecideSession(slot(decide, 1), ['4866', '9221', '9509', 'x'])
    expect(session.isFull).toBe(true)
    session.add('y')
    expect(session.ids, 'full, and nothing named to replace').not.toContain('y')
    session.add('y', 'x')
    expect(session.ids).toEqual(['4866', '9221', '9509', 'y'])
  })

  it('a bench player picked in two slots is called out', async () => {
    const { decide } = await loaded()
    // Robinson out-values Barkley, Seattle Back and the empty flex alike.
    expect(DecideModel.sharedPicks(decide.slots()).get('9509')).toEqual(['RB', 'RB', 'FLEX'])
  })
})
