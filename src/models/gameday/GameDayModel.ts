/**
 * This week's NFL games with their live state — score, quarter, clock, who has
 * the ball — from Sleeper's scores route. A port of FCApp `GameDayModel`,
 * `GameWithPlayers` and `GameDay`. The Board's games tile and live matchup
 * read it; the shared live poller ticks it during games.
 */
import { NFLVERSE_ALIASES } from '@core/NFLTeams'
import type { GameStatus, SleeperGameScore } from '@data/gameScore'
import type { SleeperService } from '@data/SleeperService'
import type { LeagueContext } from '@models/league/LeagueContext'
import type { LeagueContextLoader } from '@models/league/LeagueContextLoader'
import { kickoffLabel } from '@models/league/GameDayWindow'
import type { MatchupRow } from '@models/lineup/MatchupModel'
import { Observable } from '../Observable'
import { anyGameLive } from './LivePoller'

export class GameDayModel extends Observable {
  context?: LeagueContext
  games: SleeperGameScore[] = []
  isLoading = false
  /** Set when the scores route fails; the tiles fall back to matchup points. */
  unavailable = false
  /** Epoch ms, on the context's clock. */
  lastUpdate?: number

  /** Said wherever these numbers are shown. */
  static readonly source = 'Sleeper scores (undocumented)'

  private lastRequest?: { leagueID: string; rosterID: number }

  constructor(private readonly loader: LeagueContextLoader, private readonly sleeper: SleeperService) {
    super()
  }

  async load(leagueID: string, userRosterID: number, force = false): Promise<void> {
    this.lastRequest = { leagueID, rosterID: userRosterID }
    this.isLoading = true
    this.changed()
    try {
      let context: LeagueContext
      try {
        context = await this.loader.load({ leagueID, userRosterID, force })
      } catch {
        return
      }
      this.context = context
      this.changed()
      await this.fetch(context, force)
    } finally {
      this.isLoading = false
      this.changed()
    }
  }

  /** Re-reads the scores while any game this week may be on. Returns whether it polled. */
  async tick(): Promise<boolean> {
    const context = this.context
    if (!context || !anyGameLive(context.kickoffs.lockWindows(context.currentWeek), this.games, context.now())) return false
    await this.fetch(context, true)
    return true
  }

  private async fetch(context: LeagueContext, force: boolean): Promise<void> {
    try {
      const fetched = await this.sleeper.scores(context.scheduleSeason, context.currentWeek, force)
      if (!deepEqual(this.games, fetched.value)) this.games = fetched.value
      this.unavailable = false
      this.lastUpdate = context.now()
    } catch {
      this.unavailable = this.games.length === 0
    }
    this.changed()
  }

  get anyLive(): boolean {
    return this.games.some((g) => g.status === 'inProgress')
  }
}

/** One NFL game and the fantasy starters in it, from both sides of the matchup. */
export interface GameWithPlayers {
  /** `game.gameID`. */
  id: string
  game: SleeperGameScore
  mine: MatchupRow[]
  theirs: MatchupRow[]
}

function statusRank(s: GameStatus): number {
  switch (s) {
    case 'inProgress': return 0
    case 'pregame': return 1
    case 'complete': return 2
  }
}

/** Live games first, then the next kickoffs, then finals (latest first). Swift's `GameWithPlayers.order`, as a bool "a before b". */
export function gameWithPlayersOrder(a: GameWithPlayers, b: GameWithPlayers): boolean {
  const ra = statusRank(a.game.status)
  const rb = statusRank(b.game.status)
  if (ra !== rb) return ra < rb
  const ka = a.game.startTime ?? Infinity
  const kb = b.game.startTime ?? Infinity
  if (ka !== kb) return ra === 2 ? ka > kb : ka < kb
  return a.game.gameID < b.game.gameID
}

/**
 * The games your starters or your opponent's play in, each with those
 * players. Team codes are joined in nflverse spelling (Sleeper's `LAR` is `LA`
 * on the rows). (`GameDay.pair`.)
 */
export function pairGames(games: SleeperGameScore[], mine: MatchupRow[], theirs: MatchupRow[]): GameWithPlayers[] {
  const code = (team: string) => NFLVERSE_ALIASES[team] ?? team
  const rows = (list: MatchupRow[], game: SleeperGameScore) => {
    const teams = [code(game.home), code(game.away)]
    return list.filter((row) => (row.nflTeam !== undefined ? teams.includes(code(row.nflTeam)) : false))
  }
  return games
    .map((game): GameWithPlayers => ({ id: game.gameID, game, mine: rows(mine, game), theirs: rows(theirs, game) }))
    .filter((g) => g.mine.length > 0 || g.theirs.length > 0)
    .sort((a, b) => (gameWithPlayersOrder(a, b) ? -1 : gameWithPlayersOrder(b, a) ? 1 : 0))
}

/** Swift `Int(String)`: optional sign, ASCII digits. */
const isSwiftInt = (s: string) => /^[+-]?[0-9]+$/.test(s)

/**
 * "Q3 7:42", "Half", "Final", "Final/OT" or the kickoff time. `now` is kept
 * for parity with Swift's signature; the kickoff label doesn't use it.
 * (`GameDay.clock`.)
 */
export function gameClock(game: SleeperGameScore, _now: number = Date.now()): string {
  switch (game.status) {
    case 'complete':
      return (game.quarterNumber ?? 4) > 4 || game.quarter === 'OT' ? 'Final/OT' : 'Final'
    case 'inProgress': {
      if (game.quarter === 'HT' || game.quarter?.toLowerCase() === 'half') return 'Half'
      const q = game.quarter !== undefined ? (isSwiftInt(game.quarter) ? `Q${game.quarter}` : game.quarter) : ''
      return [q, game.timeRemaining ?? ''].filter((s) => s !== '').join(' ')
    }
    case 'pregame':
      if (game.startTime === undefined) return 'Scheduled'
      return kickoffLabel(game.startTime)
  }
}

/** Swift's synthesised `Equatable` on `[SleeperGameScore]`: structural, dictionary order ignored. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const ak = Object.keys(ao).filter((k) => ao[k] !== undefined)
  const bk = Object.keys(bo).filter((k) => bo[k] !== undefined)
  return ak.length === bk.length && ak.every((k) => deepEqual(ao[k], bo[k]))
}
