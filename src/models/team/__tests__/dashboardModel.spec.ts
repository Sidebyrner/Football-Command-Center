import { describe, expect, it } from 'vitest'
import { RelayClient } from '@data/RelayClient'
import { draftSurplus, LineupAlertKind, sortStandings, standingsRecord, type StandingsRow } from '../DashboardModel'
import { dashboardTransport, TestLeague } from '../../../../tests/appHarness'
import { StubTransport } from '../../../../tests/stubTransport'
import { loadedDashboard, makeDashboard } from './dashboardHarness'

/**
 * Port of DashboardModelTests: the Dashboard against the real 2025 schedule and
 * weekly files. The fixture's current week is 7, where the shipped schedule
 * puts BAL and BUF on bye — so the user's BUF quarterback and BAL kicker are
 * guaranteed zeroes. Weeks 1 and 2 are completed history; week 7 is live and
 * must never be graded.
 */
describe('DashboardModel', () => {
  // MARK: - Alerts

  it('a bye starter is flagged first', async () => {
    const model = await loadedDashboard()
    expect(model.alerts.length).toBeGreaterThan(0)
    expect(model.alerts[0]?.kind).toBe(LineupAlertKind.onBye)
    expect(model.alerts[0]?.detail.includes('scores 0')).toBe(true)
  })

  it('the bye alert names the right players', async () => {
    const model = await loadedDashboard()
    const names = new Set(model.alerts.filter((a) => a.kind === LineupAlertKind.onBye).map((a) => a.playerName).filter((n) => n !== undefined))
    expect(names.has('Starter QB'), 'the BUF quarterback is on bye').toBe(true)
    expect(names.has('Kicker One'), 'the BAL kicker is on bye').toBe(true)
    expect(names.has('Tight End'), 'the KC tight end is not').toBe(false)
  })

  it('unset slots are counted from the raw starters array', async () => {
    const model = await loadedDashboard()
    const empty = model.alerts.find((a) => a.kind === LineupAlertKind.emptySlot)
    expect(empty).toBeDefined()
    expect(empty!.detail.includes('1 starter slot'), `got: ${empty!.detail}`).toBe(true)
  })

  it("an injured starter is flagged with Sleeper's own tag", async () => {
    const model = await loadedDashboard()
    const injured = model.alerts.find((a) => a.kind === LineupAlertKind.injured)
    expect(injured).toBeDefined()
    expect(injured!.playerName).toBe('Receiver One')
    expect(injured!.detail).toBe('Questionable')
  })

  it('healthy starters produce no alert', async () => {
    const model = await loadedDashboard()
    expect(model.alerts.some((a) => a.playerName === 'Receiver Two')).toBe(false)
  })

  // MARK: - Standings

  it('standings sort by record then points for', async () => {
    const model = await loadedDashboard()
    expect(model.standings.length).toBe(2)
    expect(model.standings[0]?.rosterID).toBe(2)
    expect(standingsRecord(model.standings[0]!)).toBe('2-0')
    expect(model.standings.some((r) => r.isUser)).toBe(true)
  })

  it('standings rank by win percentage, so losses count', () => {
    const row = (rosterID: number, wins: number, losses: number, ties: number, pointsFor: number): StandingsRow =>
      ({ rosterID, manager: `M${rosterID}`, isUser: false, wins, losses, ties, pointsFor, pointsAgainst: 0 })
    const sorted = sortStandings([row(1, 1, 3, 0, 500), row(2, 1, 0, 0, 100), row(3, 2, 2, 0, 300), row(4, 1, 1, 0, 400), row(5, 1, 1, 1, 50)])
    // 1-0 is 1.000; 2-2, 1-1 and 1-1-1 all sit at .500, so more wins, then points for.
    expect(sorted.map((r) => r.rosterID)).toEqual([2, 3, 4, 5, 1])
  })

  /** Sleeper splits points either side of the decimal point. */
  it('standings recombine split points', async () => {
    const model = await loadedDashboard()
    const mine = model.standings.find((r) => r.isUser)
    expect(mine).toBeDefined()
    expect(Math.abs(mine!.pointsFor - 210.55)).toBeLessThanOrEqual(0.001)
  })

  // MARK: - Bench points

  it('the live week is never graded', async () => {
    const model = await loadedDashboard()
    expect(model.benchWeeks.some((w) => w.week === 7)).toBe(false)
    expect(model.benchWeeks.map((w) => w.week)).toEqual([1, 2])
  })

  it('points left on the bench come from the optimizer', async () => {
    const model = await loadedDashboard()
    const week1 = model.benchWeeks.find((w) => w.week === 1)
    expect(week1).toBeDefined()
    expect(week1!.actual).toBeCloseTo(76, 3)
    expect(week1!.left).toBeCloseTo(25, 3)
    expect(week1!.best).toBeCloseTo(week1!.actual + week1!.left, 3)
    expect(week1!.shouldHaveStarted.some((p) => p.name === 'Bench Hero')).toBe(true)
  })

  it('a player with no reported score is never proposed', async () => {
    const model = await loadedDashboard()
    expect(model.benchWeeks.some((w) => w.shouldHaveStarted.some((p) => p.name === 'No Score Guy'))).toBe(false)
  })

  it('a clean week leaves nothing on the bench', async () => {
    const model = await loadedDashboard()
    const week2 = model.benchWeeks.find((w) => w.week === 2)
    expect(week2).toBeDefined()
    expect(week2!.left).toBeCloseTo(0, 3)
  })

  it('total left is the sum across weeks', async () => {
    const model = await loadedDashboard()
    expect(model.totalLeftOnBench).toBeCloseTo(model.benchWeeks.reduce((s, w) => s + w.left, 0), 3)
  })

  // MARK: - Trend

  it('trend ranks against the field actually played', async () => {
    const model = await loadedDashboard()
    const week1 = model.trend.find((p) => p.week === 1)
    expect(week1).toBeDefined()
    expect(week1!.teamCount).toBe(2)
    expect(week1!.mine ?? 0).toBeCloseTo(76, 3)
    expect(week1!.leagueAverage ?? 0).toBeCloseTo(85.5, 3)
    expect(week1!.rank, 'the rival outscored the user in week 1').toBe(2)
  })

  it('trend follows the weeks that loaded', async () => {
    const model = await loadedDashboard()
    expect(model.trend.map((p) => p.week)).toEqual([1, 2])
    const week2 = model.trend.find((p) => p.week === 2)
    expect(week2).toBeDefined()
    expect(week2!.rank, 'the user outscored the rival in week 2').toBe(1)
  })

  // MARK: - Draft value

  it('draft picks are graded against realised value at that slot', async () => {
    const model = await loadedDashboard()
    expect(model.draftUnavailable).toBeUndefined()
    expect(model.draftResults.length).toBe(2)
    const surpluses = model.draftResults.map(draftSurplus)
    expect(surpluses, 'best value first').toEqual([...surpluses].sort((a, b) => b - a))
  })

  it("only the user's own picks are graded", async () => {
    const model = await loadedDashboard()
    const names = model.draftResults.map((r) => r.name)
    expect(names).toContain('Bench Hero')
    expect(names).not.toContain('Rival Pick')
    expect(names).not.toContain('Rival QB')
  })

  it('a missing draft says why rather than showing nothing', async () => {
    const transport = dashboardTransport().override('/league/L1/drafts', '[]')
    const model = makeDashboard(transport)
    await model.load('L1', 1, 2025)
    expect(model.draftUnavailable).toBeDefined()
    expect(model.draftResults).toEqual([])
  })

  // MARK: - Transactions

  it('recent transactions are named, not just ids', async () => {
    const model = await loadedDashboard()
    const move = model.transactions[0]
    expect(move).toBeDefined()
    expect(move!.manager).toBe('Byrne Notice')
    expect(move!.addedNames).toEqual(['Bench Hero'])
    expect(move!.droppedNames).toEqual(['No Score Guy'])
  })

  // MARK: - Relay

  /** No relay means the news section simply never appears. */
  it('news is absent without a relay', async () => {
    const model = await loadedDashboard()
    expect(model.news).toEqual([])
  })

  it("news is filtered to the user's roster", async () => {
    const relayTransport = new StubTransport().json('api/news', `
        {"feed":"rotoworld","items":[
          {"title":"Starter QB questionable for Sunday","body":null,"url":null,
           "publishedAt":"2026-09-12T10:00:00Z","sourceId":"1"},
          {"title":"Someone you do not roster signs an extension","body":null,
           "url":null,"publishedAt":"2026-09-12T11:00:00Z","sourceId":"2"}]}`)
    const relay = new RelayClient('https://relay.example.test', relayTransport)

    const model = await loadedDashboard({ relay })

    expect(model.news.length).toBe(1)
    expect(model.news[0]?.title.includes('Starter QB')).toBe(true)
  })

  it('an unreachable relay leaves the rest of the screen intact', async () => {
    const relayTransport = new StubTransport().fail('api/news')
    const relay = new RelayClient('https://relay.example.test', relayTransport)

    const model = await loadedDashboard({ relay })

    expect(model.news).toEqual([])
    expect(model.alerts.length, 'the rest of the dashboard still rendered').toBeGreaterThan(0)
    expect(model.standings.length).toBeGreaterThan(0)
  })

  // MARK: - Failure

  it('a failed load names what failed', async () => {
    const transport = new StubTransport().json('/state/nfl', TestLeague.dashboardState).fail('/league/L1')
    const model = makeDashboard(transport)
    await model.load('L1', 1, 2025)
    expect(model.errorMessage).toBeDefined()
    expect(model.alerts).toEqual([])
  })

  /** A single failed week must not cost the weeks either side of it. */
  it('one missing week does not lose the others', async () => {
    const transport = dashboardTransport().fail('/matchups/2')
    const model = makeDashboard(transport)
    await model.load('L1', 1, 2025)
    expect(model.benchWeeks.map((w) => w.week)).toEqual([1])
    expect(model.trend.length).toBeGreaterThan(0)
    expect(model.alerts.length).toBeGreaterThan(0)
  })
})
