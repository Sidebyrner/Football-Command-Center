import { describe, expect, it } from 'vitest'
import { thisWeekStatus } from '../DashboardThisWeek'
import type { DashboardModel } from '../DashboardModel'
import { dashboardTransport, TestLeague } from '../../../../tests/appHarness'
import { loadedDashboard, makeDashboard } from './dashboardHarness'

/**
 * Port of DashboardFunctionalTests: the "this week" card and waiver targets,
 * against week 7 of the real 2025 schedule — where BUF and BAL are off, so the
 * user (whose only QB is on BUF and only kicker on BAL) genuinely can't fill
 * QB or K this week.
 */
function players(): string {
  const base = TestLeague.dashboardPlayers.trim().slice(0, -1)
  return base + `
        ,"fa_qb":{"full_name":"Free QB","position":"QB","team":"NYG","active":true},
         "fa_qb_bye":{"full_name":"Bills Backup","position":"QB","team":"BUF","active":true},
         "fa_wr":{"full_name":"Free Receiver","position":"WR","team":"NYG","active":true},
         "retired":{"full_name":"Retired QB","position":"QB","team":"NYG","active":false}}`
}

/**
 * Popularity order: the rostered player and the retired one must drop out,
 * and the one who fills a hole this week must come first.
 */
const TRENDING = `
    [{"player_id":"fa_wr","count":9000},{"player_id":"rb_buf","count":8500},
     {"player_id":"fa_qb_bye","count":8000},{"player_id":"retired","count":7500},
     {"player_id":"fa_qb","count":7000}]`

function loaded(matchups?: string, trending: string | undefined = TRENDING): Promise<DashboardModel> {
  return loadedDashboard({
    configure: (t) => {
      t.override('/players/nfl', players())
      if (trending !== undefined) t.override('/trending/add', trending)
      if (matchups !== undefined) t.override('/matchups/7', matchups)
    },
  })
}

describe('Dashboard functional', () => {
  // MARK: - This week

  it('this week shows both scores and who leads', async () => {
    const model = await loaded(`
        [{"roster_id":1,"matchup_id":1,"points":50.5,"starters":["qb1","PHI"]},
         {"roster_id":2,"matchup_id":1,"points":40.0,"starters":["qb2","DAL"]}]`)
    const week = model.thisWeek
    expect(week).toBeDefined()
    expect(week!.week).toBe(7)
    expect(week!.myManager).toBe('Byrne Notice')
    expect(week!.opponentManager).toBe('rival')
    expect(thisWeekStatus(week!)).toBe('Leading rival by 10.5')
  })

  it('a no-opponent week says so', async () => {
    const model = await loaded(`
        [{"roster_id":1,"matchup_id":null,"points":0,"starters":["qb1"]}]`)
    const week = model.thisWeek
    expect(week).toBeDefined()
    expect(week!.opponentManager).toBeUndefined()
    expect(thisWeekStatus(week!)).toBe('No opponent this week')
  })

  /** Before kickoff both sides are on zero, which is "not started", not a tie. */
  it('zero-zero is not started rather than tied', async () => {
    const model = await loaded(`
        [{"roster_id":1,"matchup_id":1,"points":0,"starters":[]},
         {"roster_id":2,"matchup_id":1,"points":0,"starters":[]}]`)
    expect(model.thisWeek && thisWeekStatus(model.thisWeek)).toBe('vs rival — not started')
  })

  /** No matchups from Sleeper yet: no card, and nothing else breaks. */
  it('no matchups means no card but the rest loads', async () => {
    const model = await loaded()
    expect(model.thisWeek).toBeUndefined()
    expect(model.alerts.length).toBeGreaterThan(0)
  })

  // MARK: - Waiver targets

  it('rostered and inactive players are never targets', async () => {
    const model = await loaded()
    const names = model.waiverTargets.map((t) => t.name)
    expect(names.includes('Bills Back'), 'rostered').toBe(false)
    expect(names.includes('Retired QB'), 'inactive').toBe(false)
  })

  /**
   * The user can't field a QB in week 7. A free QB who plays fills that hole
   * and is listed first despite being the least popular; a free QB whose own
   * team is off does not fill it.
   */
  it('a player who fills a hole this week is flagged and first', async () => {
    const model = await loaded()
    const first = model.waiverTargets[0]
    expect(first).toBeDefined()
    expect(first!.name).toBe('Free QB')
    expect(first!.fillsNeedThisWeek).toBe(true)

    const backup = model.waiverTargets.find((t) => t.name === 'Bills Backup')
    expect(backup).toBeDefined()
    expect(backup!.fillsNeedThisWeek, 'BUF is on bye in week 7').toBe(false)

    const receiver = model.waiverTargets.find((t) => t.name === 'Free Receiver')
    expect(receiver).toBeDefined()
    expect(receiver!.fillsNeedThisWeek, 'WR is not short this week').toBe(false)
  })

  it('trending that fails to load is reported, not hidden', async () => {
    const transport = dashboardTransport().fail('/trending/add')
    const model = makeDashboard(transport)
    await model.load('L1', 1, 2025)
    expect(model.waiverTargetsUnavailable).toBe(true)
    expect(model.waiverTargets).toEqual([])
    expect(model.standings.length, 'the rest of the dashboard still loads').toBeGreaterThan(0)
  })
})
