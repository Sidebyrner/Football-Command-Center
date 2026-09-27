import { describe, expect, it } from 'vitest'
import type { GameStatus, SleeperGameScore } from '@data/gameScore'
import { LeagueContextLoader } from '@models/league/LeagueContextLoader'
import { MatchupModel, type MatchupRow } from '@models/lineup/MatchupModel'
import { gameClock, GameDayModel, pairGames } from '../GameDayModel'
import { anyGameLive, IDLE_CAP_MS, MINIMUM_MS, nextDelay } from '../LivePoller'
import { makeHarness, TestClock } from '../../../../tests/appHarness'
import { WorkspaceFixture } from '../../../../tests/workspaceFixture'

/**
 * Port of GameDayTests: the week's games with their live state, which of your
 * (and your opponent's) starters play in each, and when the shared poller wakes.
 */

/**
 * The slice of Swift `WorkspaceFixture.services()` these tests read: one
 * shared loader on the before-kickoffs clock, with Matchup and Game Day loaded
 * for roster 1 (as `AppServices.loadIfConfigured` does).
 */
async function services() {
  const { sleeper, staticData } = makeHarness(WorkspaceFixture.transport())
  const loader = new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs)
  const matchup = new MatchupModel(loader, sleeper)
  const gameDay = new GameDayModel(loader, sleeper)
  await Promise.all([matchup.load('L1', 1), gameDay.load('L1', 1)])
  return { matchup, gameDay }
}

function score(fields: Partial<SleeperGameScore> & Pick<SleeperGameScore, 'gameID' | 'status' | 'home' | 'away'>): SleeperGameScore {
  return { week: 3, isRedZone: false, spread: {}, winChance: {}, ...fields }
}

const rank = (s: GameStatus) => (s === 'inProgress' ? 0 : s === 'pregame' ? 1 : 2)

function row(team: string): MatchupRow {
  return { index: 0, slot: 'RB', playerID: `p${team}`, name: team, position: 'RB', nflTeam: team, onBye: false } as MatchupRow
}

describe('Game day', () => {
  it('loads the week’s games', async () => {
    const { gameDay: model } = await services()
    expect(model.games.length).toBe(4)
    expect(model.unavailable).toBe(false)
    expect(model.anyLive).toBe(true)
    const live = model.games.find((g) => g.status === 'inProgress')
    expect(live).toBeDefined()
    expect(gameClock(live!)).toBe('Q3 7:42')
    expect(live!.isRedZone).toBe(true)
    expect(live!.possession).toBe('DET')
  })

  it('games pair with starters from both sides, live first', async () => {
    const s = await services()
    const mine = s.matchup.mySide?.rows ?? []
    const theirs = s.matchup.opponentSide?.rows ?? []
    const paired = pairGames(s.gameDay.games, mine, theirs)
    expect(paired.map((p) => p.game.away + '@' + p.game.home)).toEqual(['DET@LAR', 'NYG@KC', 'MIA@BUF'])
    expect(paired[0]!.mine.map((r) => r.name).filter((n) => n !== undefined), 'Sleeper’s LAR finds the rows’ LA').toEqual(['Kyren Williams'])
    expect(paired[0]!.theirs.map((r) => r.name).filter((n) => n !== undefined)).toEqual(['Jared Goff', 'Matthew Stafford', 'Jahmyr Gibbs'])
    expect(paired[0]?.game.status, 'live games lead').toBe('inProgress')
    expect(paired.some((p) => p.game.home === 'GB'), 'a game with none of either side’s starters is left out').toBe(false)
    const statuses = paired.map((p) => p.game.status)
    expect(statuses).toEqual([...statuses].sort((a, b) => rank(a) - rank(b)))
  })

  it('Sleeper’s LAR joins the rows’ LA', () => {
    const game = score({ gameID: 'g', status: 'inProgress', home: 'LAR', away: 'DET' })
    const rams = row('LA'), lions = row('DET'), other = row('KC')
    const paired = pairGames([game], [rams, other], [lions])
    expect(paired[0]?.mine.map((r) => r.nflTeam)).toEqual(['LA'])
    expect(paired[0]?.theirs.map((r) => r.nflTeam)).toEqual(['DET'])
  })

  it('clock labels', () => {
    const game = (status: GameStatus, q?: string, n?: number, t?: string) =>
      score({ gameID: 'g', status, startTime: 1_790_528_400_000, home: 'A', away: 'B', quarter: q, quarterNumber: n, timeRemaining: t })
    expect(gameClock(game('inProgress', '2', 2, '0:31'))).toBe('Q2 0:31')
    expect(gameClock(game('inProgress', 'HT', 2))).toBe('Half')
    expect(gameClock(game('inProgress', 'OT', 5, '9:12'))).toBe('OT 9:12')
    expect(gameClock(game('complete', 'F', 4))).toBe('Final')
    expect(gameClock(game('complete', 'F', 5))).toBe('Final/OT')
    expect(gameClock(game('pregame'))).not.toBe('')
  })

  // MARK: - Poller

  const kickoff = 1_790_528_400_000
  const final = (start: number) => score({ gameID: 'f', status: 'complete', startTime: start, home: 'A', away: 'B' })

  it('polls every minute during a game', () => {
    const now = kickoff + 90 * 60_000
    expect(anyGameLive([kickoff], [], now)).toBe(true)
    expect(nextDelay([kickoff], [], now)).toBe(60_000)
  })

  it('sleeps until kickoff, capped at fifteen minutes', () => {
    expect(nextDelay([kickoff], [], kickoff - 600_000)).toBe(600_000)
    expect(nextDelay([kickoff], [], kickoff - 3 * 3_600_000), 'overnight').toBe(IDLE_CAP_MS)
    expect(nextDelay([kickoff], [], kickoff - 5_000), 'a kickoff seconds away doesn’t spin').toBe(MINIMUM_MS)
    expect(nextDelay([], [], kickoff), 'no games left this week').toBe(IDLE_CAP_MS)
  })

  it('stops once every game in the window is final', () => {
    const now = kickoff + 3.5 * 3_600_000
    expect(anyGameLive([kickoff], [final(kickoff)], now)).toBe(false)
    expect(anyGameLive([kickoff], [], kickoff + 5 * 3_600_000), 'past the four-hour window').toBe(false)
    const flexed = score({ gameID: 'x', status: 'inProgress', home: 'A', away: 'B' })
    expect(anyGameLive([], [flexed], now), 'Sleeper saying in progress wins').toBe(true)
  })
})
