import { describe, expect, it } from 'vitest'
import type { TeamGameLine } from '@core/Schedule'
import { LeagueContextLoader } from '@models/league/LeagueContextLoader'
import {
  discoveryColumn, discoveryName, discoverySortFromStorageKey, DiscoveryModel,
} from '@models/market/DiscoveryModel'
import { buildPlayerSchedule, scheduleByeWeek, weekHasLine } from '@models/market/PlayerSchedule'
import { WaiverBoardModel, waiverRowValue } from '@models/market/WaiverBoardModel'
import { makeHarness, TestClock } from '../../../../tests/appHarness'
import { WorkspaceFixture as F } from '../../../../tests/workspaceFixture'

/**
 * Stands in for Swift's `WorkspaceFixture.services()`: the Discovery and
 * Waiver Board models AppServices builds, sharing one loader and the Sleeper
 * service, loaded for league L1, roster 1.
 */
async function services() {
  const { sleeper, staticData } = makeHarness(F.transport())
  const loader = new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs)
  const discovery = new DiscoveryModel(loader, sleeper)
  const waivers = new WaiverBoardModel(loader, sleeper)
  await Promise.all([
    discovery.load({ leagueID: 'L1', userRosterID: 1 }),
    waivers.load({ leagueID: 'L1', userRosterID: 1 }),
  ])
  expect(discovery.errorMessage).toBeUndefined()
  return { discovery, waivers }
}

const compareNames = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Port of DiscoveryModelTests (DiscoveryTests.swift). */
describe('DiscoveryModel', () => {
  it('every free agent is listed even with no data, but the board still hides them', async () => {
    const { discovery, waivers } = await services()
    expect(discovery.allRows.some((r) => r.id === F.unknown), 'no-data free agent listed').toBe(true)
    expect(discovery.visible.some((r) => r.id === F.henderson)).toBe(true)
    expect(waivers.rows.some((r) => r.id === F.unknown), 'the Waiver Board is unchanged').toBe(false)
    expect(discovery.allRows.some((r) => r.id === F.cook), "my players aren't acquirable").toBe(false)
    expect(discovery.allRows.some((r) => r.id === F.gibbs), "rival starters aren't either").toBe(false)
  })

  it('rows without the sorted number sink to the bottom', async () => {
    const { discovery } = await services()
    discovery.sort = discoveryColumn('projected')
    const values = discovery.visible.map((r) => waiverRowValue(r, 'projected'))
    const index = values.findIndex((v) => v === undefined)
    const firstNil = index < 0 ? values.length : index
    expect(values.slice(firstNil).every((v) => v === undefined), 'nothing valued after the first blank').toBe(true)
    const valued = values.slice(0, firstNil) as number[]
    expect(valued).toEqual([...valued].sort((a, b) => b - a))
    expect(discovery.unvaluedCount).toBeGreaterThan(0)

    discovery.sort = discoveryName
    const names = discovery.visible.map((r) => r.name)
    expect(names).toEqual([...names].sort(compareNames))
    expect(discovery.unvaluedCount).toBe(0)
  })

  it('search forgives typos and matches teams', async () => {
    const { discovery } = await services()
    discovery.query = 'hendersn'
    expect(discovery.visible[0]?.id).toBe(F.henderson)
    discovery.query = 'deep sleper'
    expect(discovery.visible.map((r) => r.id)).toEqual([F.unknown])
    discovery.query = 'zzzz'
    expect(discovery.visible).toEqual([])
  })

  it('bench toggle and position filter', async () => {
    const { discovery } = await services()
    expect(discovery.visible.some((r) => r.id === F.hampton), 'rival bench hidden by default').toBe(false)
    discovery.includeRivalBenches = true
    expect(discovery.visible.some((r) => r.id === F.hampton)).toBe(true)
    discovery.positionFilter = 'QB'
    expect(discovery.visible.every((r) => r.position === 'QB')).toBe(true)
    expect(discovery.filterablePositions.includes('LB'), 'IDP positions the league starts are filterable').toBe(true)
  })

  it('a panel can sort and filter without moving the shared list', async () => {
    const { discovery } = await services()
    const shared = discovery.visible
    const names = discovery.rows('RB', discoveryName)
    expect(names.every((r) => r.position === 'RB')).toBe(true)
    expect(names.map((r) => r.name)).toEqual(names.map((r) => r.name).sort(compareNames))
    expect(discovery.visible).toEqual(shared)
    expect(discoverySortFromStorageKey('name')).toEqual(discoveryName)
    expect(discoverySortFromStorageKey('snapShare')).toEqual(discoveryColumn('snapShare'))
    expect(discoverySortFromStorageKey('nonsense')).toBeUndefined()
  })

  it('any player has a row for compare, including mine', async () => {
    const { discovery } = await services()
    expect(discovery.row(F.cook)?.availability.kind).toBe('mine')
    expect(discovery.row('not-a-player')).toBeUndefined()
  })
})

/** Port of PlayerScheduleTests (DiscoveryTests.swift). */
describe('PlayerSchedule', () => {
  async function schedule(id: string = F.henderson, liveLines = new Map<number, Record<string, TeamGameLine>>()) {
    const { discovery } = await services()
    const context = discovery.context!
    expect(context).toBeDefined()
    const defense = discovery.defense
    return { schedule: buildPlayerSchedule(id, context, defense, liveLines), context, defense }
  }

  it('the rest of the season with recorded lines where they exist', async () => {
    const { schedule: s, context } = await schedule()
    expect(s.team).toBe('NE')
    expect(s.weeks.map((w) => w.week)).toEqual(context.remainingWeeks)
    expect(s.weeks[0]?.week).toBe(3)
    const week3 = s.weeks[0]!
    expect(week3.opponent).toBeDefined()
    expect(weekHasLine(week3), 'the fixture records lines for weeks 1–4').toBe(true)
    expect(week3.lineSource).toBe('recordedClosing')
    expect(week3.impliedTotal).toBeDefined()
    expect(s.coveredWeeks.length).toBeGreaterThan(0)
    expect(s.coveredWeeks.every((w) => w <= 4), 'no lines past week 4 in the fixture').toBe(true)
    const later = s.weeks.find((w) => w.week > 4 && !w.isBye)!
    expect(later).toBeDefined()
    expect(later.opponent, 'the opponent is known even without a line').toBeDefined()
    expect(weekHasLine(later)).toBe(false)
    expect(later.lineSource).toBeUndefined()
  })

  it('the bye week is marked', async () => {
    const { schedule: s, context } = await schedule()
    const bye = context.remainingWeeks.find((w) => context.byeCalendar.isOnBye('NE', w))!
    expect(bye).toBeDefined()
    const week = s.weeks.find((w) => w.week === bye)!
    expect(week.isBye).toBe(true)
    expect(week.opponent).toBeUndefined()
    expect(scheduleByeWeek(s)).toBe(bye)
  })

  it('strength of schedule is mean allowed over league average', async () => {
    const { schedule: s, defense } = await schedule()
    const allowed = s.weeks.map((w) => w.defensePerGame).filter((x): x is number => x !== undefined)
    expect(s.strengthOfScheduleGames).toBe(allowed.length)
    const average = defense.leagueAverage('RB')
    if (average !== undefined && average > 0 && allowed.length > 0) {
      const expected = allowed.reduce((a, b) => a + b, 0) / allowed.length / average
      expect(Math.abs(s.strengthOfSchedule! - expected)).toBeLessThanOrEqual(1e-9)
    } else {
      expect(s.strengthOfSchedule).toBeUndefined()
    }
  })

  it('live lines replace recorded ones', async () => {
    const live: TeamGameLine = { team: 'NE', opponent: 'ZZZ', isHome: true, spread: -7, total: 44, impliedTotal: 25.5 }
    const { schedule: s } = await schedule(F.henderson, new Map([[3, { NE: live }]]))
    const week3 = s.weeks[0]!
    expect(week3.opponent).toBe('ZZZ')
    expect(week3.spread).toBe(-7)
    expect(week3.lineSource).toBe('live')
  })
})
