import { beforeEach, describe, expect, it } from 'vitest'
import { DOME_HOME, K_BUCKETS, kMake } from '@core/streams/KStream'
import { standardTransport } from '../../../../tests/appHarness'
import { fixtureText } from '../../../../tests/swiftFixtures'
import { DSTStreamScreenModel } from '../DSTStreamKind'
import { KStreamScreenModel, kTeamOverride } from '../KStreamKind'
import { QBStreamKind, QBStreamScreenModel } from '../QBStreamKind'
import { RBStreamKind } from '../RBStreamKind'
import { SleeperTeamTotals } from '../SleeperTeamTotals'
import { streamCandidateID } from '../StreamKind'
import { MemoryStreamStorage } from '../StreamStore'
import { makeLoader, onFixture, testStore } from './streamHarness'
import type { LeagueContextLoader } from '../../league/LeagueContextLoader'

/**
 * Port of QBDSTKStreamScreenTests: QB, D/ST and K streams against the
 * recorded week-2 2026 Sleeper lines (served for weeks 1 and 2) and the 2026
 * schedule at week 3, under the real Whack-A-Mole scoring.
 */

const mahomes = '4046', ward = '12522'
const butker = '4227', aubrey = '11533', mcpherson = '7839'

function loader(): LeagueContextLoader {
  const t = standardTransport()
  t.override('/state/nfl', '{"week":3,"season":"2026","season_type":"regular"}')
  const scoring = fixtureText('FCApp', 'scoring-whack-a-mole.json')
  t.replace('/league/L1', `
    {"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":2,
     "roster_positions":["QB","SUPER_FLEX","K","DEF","BN","BN"],
     "scoring_settings":${scoring},
     "settings":{"waiver_type":2,"waiver_budget":100}}`)
  t.replace('/league/L1/rosters', `
    [{"roster_id":1,"owner_id":"u1","players":["${mahomes}","${ward}","${butker}","KC"],
      "starters":["${mahomes}","${ward}","${butker}","KC"]},
     {"roster_id":2,"owner_id":"u2","players":["${aubrey}","NE"],"starters":["0","0","${aubrey}","NE"]}]`)
  t.replace('/players/nfl', `
    {"${mahomes}":{"full_name":"Patrick Mahomes","position":"QB","team":"KC","active":true,"depth_chart_order":1},
     "${ward}":{"full_name":"Cam Ward","position":"QB","team":"TEN","active":true,"depth_chart_order":1},
     "${butker}":{"full_name":"Harrison Butker","position":"K","team":"KC","active":true},
     "${aubrey}":{"full_name":"Brandon Aubrey","position":"K","team":"DAL","active":true},
     "${mcpherson}":{"full_name":"Evan McPherson","position":"K","team":"CIN","active":true},
     "KC":{"position":"DEF","team":"KC","active":true},
     "NE":{"position":"DEF","team":"NE","active":true},
     "CAR":{"position":"DEF","team":"CAR","active":true},
     "MIN":{"position":"DEF","team":"MIN","active":true}}`)
  onFixture(t, '/stats/nfl/2026/1', 'stats-2026-w2')
  onFixture(t, '/stats/nfl/2026/2', 'stats-2026-w2')
  return makeLoader(t)
}

describe('QBDSTKStreamScreen', () => {
  let storage: MemoryStreamStorage
  beforeEach(() => { storage = new MemoryStreamStorage() })

  // MARK: QB

  it("QB stream projects under the league's passing scoring", async () => {
    const m = new QBStreamScreenModel(loader(), testStore(storage))
    await m.load('L1', 1)
    expect(m.errorMessage).toBeUndefined()
    expect(m.scoring.incompletion).toBe(-1)
    expect(m.scoring.interception + m.scoring.pickSixExtra).toBe(-15)
    const p = m.projection(mahomes)!
    expect(p).toBeDefined()
    expect(p.expAtt).toBeGreaterThan(20)
    expect(p.ros.games, 'the rest of 2026 from the schedule').toBeGreaterThan(10)
    const kc = SleeperTeamTotals.schedule(m.context!.schedule, 'KC')
    let bye: number | undefined
    for (let w = 4; w <= 18; w++) if (!kc.has(w)) { bye = w; break }
    expect(p.ros.byeWeek, "KC's bye from the schedule").toBe(bye)
    expect(QBStreamKind.usesHorizon).toBe(true)
    expect(RBStreamKind.usesHorizon).toBe(false)
  })

  it('the horizon moves the ranking', async () => {
    const m = new QBStreamScreenModel(loader(), testStore(storage))
    await m.load('L1', 1)
    m.horizon = 'week'
    const week = m.projection(mahomes)!
    expect(week).toBeDefined()
    expect(Math.abs(week.utility - (week.expPts - 0.2 * week.sdIfPlays))).toBeLessThanOrEqual(1e-9)
    m.horizon = 'ros'
    const ros = m.projection(mahomes)!
    expect(ros).toBeDefined()
    expect(Math.abs(ros.expPts - week.expPts), "this week's projection doesn't move").toBeLessThanOrEqual(1e-9)
    expect(ros.utility, 'the ranking value does').not.toBe(week.utility)
  })

  it('the opposing pass defense comes from quarterbacks it faced', async () => {
    const m = new QBStreamScreenModel(loader(), testStore(storage))
    await m.load('L1', 1)
    const withRates = Object.values(m.teams).filter((t) => t.oppCompAllowed !== undefined)
    expect(withRates.length).toBeGreaterThan(0)
    for (const team of withRates) {
      expect(team.oppCompAllowed!).toBeGreaterThanOrEqual(0)
      expect(team.oppCompAllowed!).toBeLessThanOrEqual(1)
      expect(team.oppSackRate ?? 0).toBeGreaterThanOrEqual(0)
      expect(team.oppSackRate ?? 0).toBeLessThanOrEqual(1)
    }
  })

  // MARK: D/ST

  it("defenses project from their own lines and the league's tiers", async () => {
    const m = new DSTStreamScreenModel(loader(), testStore(storage))
    await m.load('L1', 1)
    expect(m.errorMessage).toBeUndefined()
    expect(m.scoring.pointsAllowed[0]?.points).toBe(15)
    expect(m.scoring.interception).toBe(8)
    const ne = m.candidates.find((c) => streamCandidateID(c) === 'NE')!
    expect(ne).toBeDefined()
    expect(ne.sacks, '4 sacks in each of the two served weeks').toBe(8)
    expect(ne.games).toBe(2)
    expect(ne.paTotal).toBe(6)
    expect(m.incumbentID, 'my starting defense is the one to beat').toBe('KC')
    const projection = m.projection('NE')!
    expect(projection).toBeDefined()
    expect(projection.flags).not.toContain('scoring = Sleeper defaults (placeholder)')
    expect(m.unmodelledScoringKeys, 'named on screen, not dropped').toContain('def_3_and_out')
  })

  // MARK: K

  it('kickers bucket their kicks and read the stadium', async () => {
    const m = new KStreamScreenModel(loader(), testStore(storage))
    await m.load('L1', 1)
    expect(m.errorMessage).toBeUndefined()
    expect(kMake(m.scoring, '50_59'), 'fgm (6) plus the 50–59 value (12)').toBe(18)
    const mc = m.candidates.find((c) => streamCandidateID(c) === mcpherson)!
    expect(mc).toBeDefined()
    expect(mc.fga['50_59'], 'two 50-yarders in each served week').toBe(4)
    expect(mc.fgm['50_59']).toBe(4)
    const b = m.candidates.find((c) => streamCandidateID(c) === butker)!
    expect(b).toBeDefined()
    expect(Object.values(b.fga).reduce((s, v) => s + (v ?? 0), 0)).toBe(10)
    const misses = K_BUCKETS.reduce((s, k) => s + (b.fga[k] ?? 0) - (b.fgm[k] ?? 0), 0)
    expect(misses, 'one miss in each served week').toBe(2)
    for (const team of Object.values(m.teams)) {
      const site = team.home === true ? team.team : team.opponent
      expect(team.venue === 'dome', team.team).toBe(DOME_HOME.has(site))
      expect(team.altitude).toBe(site === 'DEN')
    }
    expect(m.projection(mcpherson)?.expPts).toBeGreaterThan(0)
  })

  it('weather edits move the kicking projection', async (ctx) => {
    const m = new KStreamScreenModel(loader(), testStore(storage))
    await m.load('L1', 1)
    const before = m.projection(mcpherson)!
    expect(before).toBeDefined()
    const team = m.teams.CIN
    if (!team || team.venue === 'dome') { ctx.skip(); return } // "CIN indoors this week"
    await m.setTeamOverride(kTeamOverride({ windMph: 25, precipPct: 80 }), 'CIN')
    const after = m.projection(mcpherson)!
    expect(after).toBeDefined()
    expect(after.e50pAtt, 'wind moves long attempts shorter').toBeLessThan(before.e50pAtt)
    expect(after.expPts).toBeLessThan(before.expPts)
    expect(m.teams.CIN?.weatherSource).toBe('manual')
  })
})
