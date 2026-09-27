import { describe, expect, it } from 'vitest'
import { LineupAlertKind } from '../DashboardModel'
import { isAllClear, streak, type WeekOutcome, type WeekResult } from '../MyTeamModel'
import { TestClock, TestLeague } from '../../../../tests/appHarness'
import { loadedDashboard } from './dashboardHarness'

/**
 * Port of MyTeamModelTests: the My Team hub's model, on the week 7 dashboard
 * fixture — the user's QB (BUF) and kicker (BAL) are on bye, the flex is
 * empty, and the MIN receiver is Questionable. Weeks 1 and 2 are completed
 * history (lost 76–95, won 88–70).
 */
describe('My Team model', () => {
  // MARK: - Readiness

  it('readiness counts each slot once', async () => {
    const model = await loadedDashboard()
    const r = model.readiness
    expect(r).toBeDefined()
    expect(r!.slots).toBe(11)
    expect(r!.problems, 'two byes and the empty flex').toBe(3)
    expect(r!.caution, 'the Questionable receiver').toBe(1)
    expect(r!.ready).toBe(7)
    expect(r!.settled).toBe(0)
    expect(r!.ready + r!.caution + r!.problems + r!.settled).toBe(r!.slots)
    expect(isAllClear(r!)).toBe(false)
  })

  /** The ring and the alerts are built from the same rules: every flagged slot is exactly one alert. */
  it('readiness agrees with the alerts', async () => {
    for (const clock of [TestClock.beforeKickoffs, TestClock.week7MidSunday]) {
      const model = await loadedDashboard({ now: clock })
      const r = model.readiness
      expect(r).toBeDefined()
      const emptySlots = model.context?.userTeam?.rawStarters.filter((id) => id === '0').length ?? 0
      const flagged = model.alerts.filter((a) => a.kind !== LineupAlertKind.emptySlot).length
        + (model.alerts.some((a) => a.kind === LineupAlertKind.emptySlot) ? emptySlots : 0)
      expect(r!.caution + r!.problems).toBe(flagged)
    }
  })

  /** Mid-Sunday the MIN receiver's game has started: settled, not a caution. */
  it('locked starters count as settled', async () => {
    const model = await loadedDashboard({ now: TestClock.week7MidSunday })
    const r = model.readiness
    expect(r).toBeDefined()
    expect(r!.settled, 'LAR (London), MIN, KC, PHI and CHI have kicked off').toBe(5)
    expect(r!.caution).toBe(0)
    expect(r!.problems, 'byes and an empty slot are still fixable').toBe(3)
  })

  it('an Out tag is a problem, not a caution', async () => {
    const model = await loadedDashboard({
      configure: (t) => {
        const players = TestLeague.dashboardPlayers.replace(
          '"wr2":{"full_name":"Receiver Two","position":"WR","team":"DAL","active":true}',
          '"wr2":{"full_name":"Receiver Two","position":"WR","team":"DAL","injury_status":"Out","active":true}',
        )
        expect(players, 'fixture precondition: the replacement applied').not.toBe(TestLeague.dashboardPlayers)
        t.override('/players/nfl', players)
      },
    })
    const r = model.readiness
    expect(r).toBeDefined()
    expect(r!.problems).toBe(4)
    expect(r!.caution).toBe(1)
  })

  // MARK: - Results, streak, place

  it('results come from completed matchups', async () => {
    const model = await loadedDashboard()
    expect(model.results.map((r) => r.week)).toEqual([1, 2])
    expect(model.results[0]?.outcome).toBe('L')
    expect(model.results[0]?.opponentManager).toBe('rival')
    expect(model.results.at(-1)?.outcome).toBe('W')
    expect(model.streak).toBe('W1')
  })

  it('streak counts the current run', () => {
    const outcomes: WeekOutcome[] = ['L', 'W', 'W', 'W']
    const results: WeekResult[] = outcomes.map((outcome, i) => ({
      week: i + 1, myPoints: 1, opponentPoints: 0, opponentManager: 'x', outcome,
    }))
    expect(streak(results)).toBe('W3')
    expect(streak([])).toBeUndefined()
  })

  it('standings place', async () => {
    const model = await loadedDashboard()
    expect(model.place?.rank).toBe(2)
    expect(model.place?.of).toBe(2)
  })

  // MARK: - Upcoming and the bye strip

  /**
   * Week 8 pairs the user with the rival. In week 8 LAR and SEA are off, so the
   * user is short at RB; the rival isn't short at all.
   */
  it('upcoming opponents flag shortfalls on both sides', async () => {
    const model = await loadedDashboard({
      configure: (t) => {
        t.override('/matchups/8', `
            [{"roster_id":1,"matchup_id":3,"points":0},{"roster_id":2,"matchup_id":3,"points":0}]`)
      },
    })
    const week8 = model.upcoming.find((u) => u.week === 8)
    expect(week8).toBeDefined()
    expect(week8!.manager).toBe('rival')
    expect(week8!.record).toBe('2-0')
    expect(week8!.yourShortfall).toBeGreaterThanOrEqual(2)
    expect(week8!.theirShortfall).toBe(0)
  })

  it('bye strip covers remaining weeks', async () => {
    const model = await loadedDashboard()
    const context = model.context
    expect(context).toBeDefined()
    expect(model.byeStrip.map((w) => w.week)).toEqual(context!.remainingWeeks)
    const week8 = model.byeStrip.find((w) => w.week === 8)
    expect(week8).toBeDefined()
    expect(week8!.yourShortfall).toBeGreaterThanOrEqual(2)
    expect(week8!.teamsShort).toBeGreaterThanOrEqual(1)
    expect(week8!.teamCount).toBe(2)
  })

  // MARK: - Provenance for the pillar chips

  /** Sleeper data here comes live from the stub; the nflverse files are bundled. */
  it('Sleeper and static provenance are separate', async () => {
    const model = await loadedDashboard()
    const context = model.context
    expect(context).toBeDefined()
    expect(context!.sleeperProvenance).toEqual({ kind: 'live' })
    expect(context!.staticProvenance).toEqual({ kind: 'bundled' })
  })
})
