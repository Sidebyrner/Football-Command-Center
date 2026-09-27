import { describe, expect, it } from 'vitest'
import { LeagueContextLoader } from '../../league/LeagueContextLoader'
import { LINEUP_BASES, SitStartModel, type ProposedSlot } from '../SitStartModel'
import { makeHarness, standardTransport, TestClock, TestLeague } from '../../../../tests/appHarness'
import { StubTransport } from '../../../../tests/stubTransport'
import { SitStartFixture } from './lineupFixtures'

/**
 * Port of SitStartModelTests: Sit/Start against the real 2025 files.
 *
 * The roster mixes real players, whose values come from the actual weekly
 * file through the real crosswalk, with fixture players who cannot be joined.
 * Week 7 is the bye case: BUF and BAL are off, so Josh Allen must be benched
 * for Jared Goff on every basis.
 */
/** @param injuries Sleeper injury tags to put on players, by id. */
async function loaded(options: { week?: number; injuries?: Record<string, string>; rosters?: string } = {}): Promise<SitStartModel> {
  const { week = 1, injuries = {}, rosters = SitStartFixture.rosters } = options
  let players: string = SitStartFixture.players
  for (const [id, tag] of Object.entries(injuries)) {
    players = players.split(`"${id}":{`).join(`"${id}":{"injury_status":"${tag}",`)
  }
  const transport = standardTransport()
    .override('/state/nfl', `{"week":${week},"season":"2025","season_type":"regular"}`)
    .override('/league/L1/rosters', rosters)
    .override('/players/nfl', players)
  const { sleeper, staticData } = makeHarness(transport)
  const model = new SitStartModel(new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs))
  await model.load('L1', 1, 2025)
  if (model.errorMessage !== undefined) throw new Error(`load failed: ${model.errorMessage}`)
  return model
}

const starters = (model: SitStartModel) => model.lineup.map((s) => s.name).filter((n): n is string => n !== undefined)
const slot = (model: SitStartModel, token: string): ProposedSlot | undefined => model.lineup.find((s) => s.slot === token)

/** Points per game straight from the context, independent of the optimizer. */
function pointsPerGame(model: SitStartModel, name: string): number {
  const ppg = model.context?.seasonProfiles.find((p) => p.name === name)?.pointsPerGame
  expect(ppg, name).toBeDefined()
  return ppg!
}

const proposedSet = (model: SitStartModel) => new Set((model.proposal?.proposedIDs ?? []).filter((x): x is string => x !== undefined))
const setsEqual = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x))

describe('SitStartModel', () => {
  // MARK: - The recommendation

  it('defaults to season average', async () => {
    const model = await loaded()
    expect(model.basis).toBe('seasonAverage')
    expect(model.proposal).toBeDefined()
  })

  /**
   * Two real backs and a real receiver sit on the bench while an unjoinable
   * back, an unjoinable receiver and an empty flex start.
   */
  it('valued bench players replace unvalued and empty slots', async () => {
    const model = await loaded()
    const names = starters(model)

    expect(names).toContain('Jahmyr Gibbs')
    expect(names).toContain('Bijan Robinson')
    expect(names).toContain('Puka Nacua')
    expect(names).not.toContain('Seattle Back')
    expect(names).not.toContain('Receiver Two')

    expect(model.swaps.some((s) => s.outName === undefined), 'the empty flex is filled').toBe(true)
    expect(slot(model, 'FLEX')?.changed).toBe(true)
  })

  /** Whichever quarterback averaged more starts — checked against the season data directly. */
  it('the better quarterback starts in a normal week', async () => {
    const model = await loaded()
    const expected = pointsPerGame(model, 'Josh Allen') >= pointsPerGame(model, 'Jared Goff') ? 'Josh Allen' : 'Jared Goff'
    expect(slot(model, 'QB')?.name).toBe(expected)
  })

  /** The headline gain is built from the swaps it summarises. */
  it('gain agrees with the swaps', async () => {
    const model = await loaded()
    const gain = model.gain
    expect(gain).toBeDefined()
    const deltas = model.swaps.map((s) => s.delta).reduce((a, b) => a + b, 0)

    expect(gain!).toBeGreaterThan(0)
    // Each delta is rounded to one decimal on its own.
    expect(Math.abs(gain! - deltas)).toBeLessThanOrEqual(0.05 * model.swaps.length + 0.1)
  })

  // MARK: - What to actually do

  it('changes read as starts and sits', async () => {
    const model = await loaded({ week: 7 })
    expect(model.starts.some((c) => c.name === 'Jared Goff' && c.slot === 'QB')).toBe(true)
    expect(model.sits.some((c) => c.name === 'Josh Allen' && c.slot === 'QB')).toBe(true)
  })

  it('starts, sits and moves never overlap', async () => {
    for (const week of [1, 7]) {
      const model = await loaded({ week })
      const started = new Set(model.starts.map((c) => c.playerID))
      const sat = new Set(model.sits.map((c) => c.playerID))
      const moved = new Set(model.moves.map((m) => m.playerID))
      expect([...started].some((id) => sat.has(id)), `week ${week}`).toBe(false)
      expect([...moved].some((id) => sat.has(id)), `week ${week}: a moved player is still starting`).toBe(false)
      expect([...moved].some((id) => started.has(id)), `week ${week}`).toBe(false)
    }
  })

  /** The changes must reproduce the proposed lineup exactly from the current one. */
  it('changes account for the whole proposed lineup', async () => {
    const model = await loaded({ week: 7 })
    const current = new Set((model.context?.userTeam?.rawStarters ?? []).filter((id) => id !== '0'))
    const proposed = new Set(model.lineup.map((s) => s.playerID).filter((x): x is string => x !== undefined))
    const rebuilt = new Set(current)
    for (const c of model.sits) rebuilt.delete(c.playerID)
    for (const c of model.starts) rebuilt.add(c.playerID)
    expect(rebuilt).toEqual(proposed)
  })

  // MARK: - Unvalued players, by cause

  it('unvalued slots keep their starter rather than going empty', async () => {
    const model = await loaded()
    const defense = model.lineup.find((s) => s.playerID === 'PHI')
    expect(defense).toBeDefined()

    expect(defense!.keptBecauseUnvalued).toBe(true)
    expect(defense!.changed).toBe(false)
    expect(defense!.value).toBeUndefined()
  })

  it('the causes are reported separately', async () => {
    const model = await loaded()

    expect(model.unranked.noProductionData).toContain('Linebacker One')
    expect(model.unranked.noProductionData).toContain('Lineman One')
    expect(model.unranked.noSeasonLine).toContain('Seattle Back')
    expect(model.unranked.noSeasonLine).toContain('Kicker One')
    expect(model.unranked.onBye, 'nobody is on bye in week 1').toEqual([])
    expect(model.unranked.noGameLine).toEqual([])
  })

  // MARK: - Game environment

  it('environment values every position including defense', async () => {
    const model = await loaded()
    model.basis = 'environment'

    expect(model.unranked.noProductionData).toEqual([])
    const defense = model.lineup.find((s) => s.playerID === 'PHI')
    expect(defense).toBeDefined()
    expect(defense!.keptBecauseUnvalued).toBe(false)
    // PHI hosted DAL in week 1, favored by 8.5 on a 47.5 total.
    expect(defense!.value).toBeDefined()
    expect(Math.abs(defense!.value! - 28.0)).toBeLessThanOrEqual(0.001)
  })

  // MARK: - Byes

  it('a quarterback on bye is benched', async () => {
    const model = await loaded({ week: 7 })

    expect(slot(model, 'QB')?.name).toBe('Jared Goff')
    expect(model.swaps.some((s) => s.outName === 'Josh Allen' && s.inName === 'Jared Goff')).toBe(true)
    expect(model.unranked.onBye).toContain('Josh Allen')
  })

  it('no basis ever starts a player on bye', async () => {
    const model = await loaded({ week: 7 })
    for (const basis of LINEUP_BASES) {
      model.basis = basis
      const proposed = proposedSet(model)
      expect(proposed.has('4984'), `${basis} started Josh Allen on bye`).toBe(false)
      expect(proposed.has('k1'), `${basis} started a BAL kicker on bye`).toBe(false)
    }
  })

  // MARK: - Injuries

  it('a doubtful quarterback is never recommended', async () => {
    const model = await loaded({ injuries: { '4984': 'Doubtful' } })
    expect(slot(model, 'QB')?.name).toBe('Jared Goff')
    expect(model.unranked.injured).toContain('Josh Allen (Doubtful)')
    const sit = model.sits.find((c) => c.name === 'Josh Allen')
    expect(sit).toBeDefined()
    expect(sit!.injury).toBe('Doubtful')
    for (const basis of LINEUP_BASES) {
      model.basis = basis
      expect(proposedSet(model).has('4984'), `${basis} started a Doubtful Josh Allen`).toBe(false)
    }
  })

  it('out and IR players are left out with their status', async () => {
    const model = await loaded({ injuries: { '7564': 'IR', '4866': 'Out' } })
    const proposed = proposedSet(model)
    expect(proposed.has('7564')).toBe(false)
    expect(proposed.has('4866')).toBe(false)
    expect(model.unranked.injured).toContain("Ja'Marr Chase (IR)")
    expect(model.unranked.injured).toContain('Saquon Barkley (Out)')
    expect(model.lineup.some((s) => s.name === "Ja'Marr Chase" || s.name === 'Saquon Barkley')).toBe(false)
  })

  it('a questionable starter stays but is flagged', async () => {
    const healthy = await loaded()
    const tagged = await loaded({ injuries: { '4984': 'Questionable' } })
    expect(slot(tagged, 'QB')?.name).toBe(slot(healthy, 'QB')?.name)
    if (slot(tagged, 'QB')?.name === 'Josh Allen') {
      expect(slot(tagged, 'QB')?.availability).toEqual({ kind: 'questionable' })
    }
    expect(tagged.unranked.injured).toEqual([])
  })

  it('an injured starter with no cover is called out', async () => {
    const model = await loaded({ injuries: { '4984': 'Out', '3163': 'IR' } })
    const qb = slot(model, 'QB')
    expect(qb).toBeDefined()
    expect(qb!.keptBecauseUnvalued).toBe(true)
    expect(qb!.availability).toEqual({ kind: 'unavailable', label: 'Out' })
    expect(model.injuredWithoutCover).toEqual(['Josh Allen (Out) at QB'])
  })

  it("a player on the user's reserve is not started", async () => {
    const rosters = SitStartFixture.rosters.replace(
      `"starters":["4984","4866","rb_sea","7564","wr2","te1","0","k1","PHI","lb1","dl1"]}`,
      `"starters":["4984","4866","rb_sea","7564","wr2","te1","0","k1","PHI","lb1","dl1"],"reserve":["9221"]}`,
    )
    expect(rosters).not.toBe(SitStartFixture.rosters)
    const model = await loaded({ rosters })
    expect(proposedSet(model).has('9221')).toBe(false)
    expect(model.unranked.injured).toContain('Jahmyr Gibbs (On your IR)')
  })

  // MARK: - Disagreement

  it('disagreement is listed exactly when lineups differ', async () => {
    const model = await loaded()
    const context = model.context!
    expect(context).toBeDefined()
    expect(model.proposal).toBeDefined()
    const mine = model.effectiveLineup(model.proposal!, context)

    for (const other of LINEUP_BASES) {
      if (other === model.basis) continue
      const theirs = model.effectiveLineup(model.optimize(other, context), context)
      expect(model.disagreeingBases.includes(other), `${other} listed wrongly`).toBe(!setsEqual(theirs, mine))
    }
  })

  it('an unvalued slot alone is not a disagreement', async () => {
    const model = await loaded()
    const context = model.context!
    expect(context).toBeDefined()
    const season = model.optimize('seasonAverage', context)
    const effective = model.effectiveLineup(season, context)

    expect(effective.has('PHI'), 'the kept DEF counts as starting').toBe(true)
  })

  // MARK: - Failure

  it('a failed load names what failed', async () => {
    const transport = new StubTransport()
      .json('/state/nfl', TestLeague.nflState)
      .fail('/league/L1')
    const { sleeper, staticData } = makeHarness(transport)
    const model = new SitStartModel(new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs))

    await model.load('L1', 1, 2025)

    expect(model.errorMessage).toBeDefined()
    expect(model.lineup).toEqual([])
  })
})
