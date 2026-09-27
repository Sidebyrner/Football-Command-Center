/**
 * Matchup — "this week, both sides" (§7.2). A port of FCApp `MatchupModel`,
 * with its `SeasonLine`, `MatchupRow`, `LineupEnvironment`, `ComparisonBasis`,
 * `SlotLeader`, `PairedSlot` and `MatchupSide`.
 */
import { computeDvPFromWeekly, EMPTY_DVP, type DefenseCell, type DefenseVsPositionTable } from '@core/DefenseVsPosition'
import { formatFixed } from '@core/numeric'
import { hasWeeklyProductionData, type Position } from '@core/Position'
import { lineupEnvironment, weekLines } from '@core/Schedule'
import type { SeasonProfile } from '@core/SeasonProfile'
import { played, scoreLine } from '@data/insightsModels'
import { playerNflverseTeam, playerPosition } from '@data/playerIndex'
import { EMPTY_STARTER_SLOT, type SleeperMatchup } from '@data/sleeperModels'
import type { SleeperService } from '@data/SleeperService'
import { Observable } from '../Observable'
import { isDegraded } from '../league/Freshness'
import { statLines } from '../league/InSeasonData'
import type { LeagueContext, LeagueTeam } from '../league/LeagueContext'
import type { LeagueContextLoader } from '../league/LeagueContextLoader'
import { DefenseLookup, type DefenseSource } from '../player/DefenseLookup'

// MARK: - Rows

/** A player's season, as the matchup row shows it. */
export interface SeasonLine {
  games: number
  pointsPerGame: number
  /** Last-4 form. A different basis from the season number, not a better one. */
  formPointsPerGame?: number
  floor?: number
  ceiling?: number
}

/** One starting slot on one side of the matchup. */
export interface MatchupRow {
  index: number
  /** The slot's own token — `QB`, `FLEX`, `IDP_FLEX`. */
  slot: string
  /** `undefined` when Sleeper has the slot unset. */
  playerID?: string
  name?: string
  position?: Position
  nflTeam?: string
  /** This week's opponent in nflverse spelling; `undefined` on bye or unknown. */
  opponent?: string
  isHome?: boolean
  onBye: boolean
  /** Points so far this week, per Sleeper. `undefined` before kickoff or unreported — not zero. */
  livePoints?: number
  /** `undefined` for DEF and IDP and for anyone the crosswalk cannot join. Never a zero line. */
  season?: SeasonLine
  /** The opponent defense against this player's position. */
  defense?: DefenseCell
  /** This player's NFL team's implied total, from recorded lines. */
  impliedTotal?: number
  /** His game has kicked off, so his slot can no longer change. Swift default `false`. */
  isLocked?: boolean
  /** His game may be in progress right now. Swift default `false`. */
  isLive?: boolean
  /** His game's kickoff this week (epoch ms); `undefined` on bye. */
  kickoff?: number
  /** Rotowire's projection via Sleeper under the league's rules. */
  projected?: number
  /** This season from Sleeper's own lines. The only production number DEF and IDP have. */
  thisSeason?: SeasonLine
  /** Which source the defense cell came from. */
  defenseSource?: DefenseSource
}

export const rowIsEmptySlot = (r: MatchupRow) => r.playerID === undefined
export const rowIsLocked = (r: MatchupRow) => r.isLocked ?? false
export const rowIsLive = (r: MatchupRow) => r.isLive ?? false

/**
 * Positions with no production data at all say so rather than showing a
 * blank that reads like "scored nothing" (§3.2).
 */
export const rowHasProductionData = (r: MatchupRow) => (r.position !== undefined ? hasWeeklyProductionData(r.position) : false)

/** Plain-words read of the defense matchup, always naming its basis. */
export function defenseSummary(r: MatchupRow): string | undefined {
  const rank = r.defense?.rank
  const delta = r.defense?.vsLeagueAverage
  if (!r.defense || rank === undefined || delta === undefined || r.opponent === undefined || r.position === undefined) return undefined
  const direction = delta >= 0 ? 'more' : 'fewer'
  return `${r.opponent} ranks #${rank} softest vs ${r.position} · `
    + `${formatFixed(Math.abs(delta), 1)} ${direction} pts/gm than average`
}

/** The lineup-level implied scoring environment. */
export interface LineupEnvironment {
  total?: number
  teamCount: number
  /** NFL teams with no recorded line — named, not counted as zero. */
  missingTeams: string[]
}

/**
 * The average implied total of the NFL teams in the lineup, over the teams
 * that *have* a line.
 */
export function averageTeamTotal(e: LineupEnvironment): number | undefined {
  const counted = e.teamCount - e.missingTeams.length
  if (e.total === undefined || counted <= 0) return undefined
  return e.total / counted
}

/**
 * Which number the head-to-head bars compare. One basis for the whole
 * matchup, always named, never mixed row by row.
 */
export type ComparisonBasis = 'livePoints' | 'seasonAverage'

export const COMPARISON_BASIS_LABEL: Readonly<Record<ComparisonBasis, string>> = {
  livePoints: 'Comparing live points',
  seasonAverage: 'No games yet — comparing season pts/gm',
}

/** Who is ahead in one slot. `undecided`: one or both sides has no number on this basis yet. */
export type SlotLeader = 'mine' | 'theirs' | 'even' | 'undecided'

/** One starting slot with both players side by side. */
export interface PairedSlot {
  index: number
  slot: string
  mine?: MatchupRow
  theirs?: MatchupRow
  myValue?: number
  theirValue?: number
  leader: SlotLeader
}

/** My share of the slot's combined value, 0…1, for the comparison bar. */
export function myShare(p: PairedSlot): number | undefined {
  if (p.myValue === undefined || p.theirValue === undefined || !(p.myValue + p.theirValue > 0)) return undefined
  return Math.max(0, p.myValue) / (Math.max(0, p.myValue) + Math.max(0, p.theirValue))
}

/** One side of the matchup. */
export interface MatchupSide {
  rosterID: number
  manager: string
  isUser: boolean
  livePoints?: number
  rows: MatchupRow[]
  environment: LineupEnvironment
}

export const emptySlots = (s: MatchupSide) => s.rows.filter(rowIsEmptySlot).length
export const startersOnBye = (s: MatchupSide) => s.rows.filter((r) => r.onBye).length
/** Starters whose game hasn't kicked off yet. Empty slots and byes don't count. */
export const leftToPlay = (s: MatchupSide) => s.rows.filter((r) => !rowIsEmptySlot(r) && !r.onBye && !rowIsLocked(r)).length
/** Whether any of this side's starters may be playing right now. */
export const hasLiveGame = (s: MatchupSide) => s.rows.some(rowIsLive)

// MARK: - Mode

/** Head-to-head shows both lineups slot by slot; the other two show one team in full detail. */
export type MatchupMode = 'headToHead' | 'mine' | 'opponent'

/** Swift `Mode.allCases`, in order. */
export const MATCHUP_MODES: readonly MatchupMode[] = ['headToHead', 'mine', 'opponent']

/** Swift `Mode.rawValue` — the segment labels. */
export const MATCHUP_MODE_LABEL: Readonly<Record<MatchupMode, string>> = {
  headToHead: 'Head-to-head',
  mine: 'You',
  opponent: 'Opponent',
}

export interface BuiltMatchup {
  mine?: MatchupSide
  opponent?: MatchupSide
  noOpponentReason?: string
}

/** Swift's `String(describing: error)`, as near as JS gets. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message || error.name : String(error)
}

// MARK: - The model

export class MatchupModel extends Observable {
  context?: LeagueContext
  mySide?: MatchupSide
  opponentSide?: MatchupSide
  /**
   * Said out loud when there is no opponent this week — a bye week in the
   * fantasy schedule, or a season that has finished.
   */
  noOpponentReason?: string
  week?: number
  isLoading = false
  errorMessage?: string

  private modeValue: MatchupMode = 'headToHead'
  get mode(): MatchupMode { return this.modeValue }
  set mode(value: MatchupMode) {
    this.modeValue = value
    this.changed()
  }

  /** Both lineups paired by slot, for head-to-head. */
  pairedSlots: PairedSlot[] = []
  comparisonBasis: ComparisonBasis = 'seasonAverage'

  /** Bumped by each successful pull-to-refresh. */
  refreshCount = 0

  /** When live scores were last refreshed (epoch ms), for "updated 40s ago". */
  lastLiveUpdate?: number

  /**
   * The defense table for the loaded context. It can't change during a game,
   * so live refreshes reuse it.
   */
  private defenseTable?: DefenseVsPositionTable
  private defenseLookup?: DefenseLookup
  /** How many times the table has been computed — for tests. */
  defenseTableBuilds = 0

  private lastRequest?: { leagueID: string; rosterID: number; season?: number }

  constructor(private readonly loader: LeagueContextLoader, private readonly sleeper: SleeperService) {
    super()
  }

  /** The single team shown in an individual mode; `undefined` in head-to-head. */
  get visibleSide(): MatchupSide | undefined {
    switch (this.mode) {
      case 'headToHead': return undefined
      case 'mine': return this.mySide
      case 'opponent': return this.opponentSide
    }
  }

  /** The modes that make sense right now: no Opponent page when there is no opponent this week. */
  get availableModes(): MatchupMode[] {
    return this.opponentSide === undefined ? ['headToHead', 'mine'] : [...MATCHUP_MODES]
  }

  /** Recorded lines never move during the week, and the UI owes the user that fact (§3.2). */
  static readonly linesNote = 'Implied totals come from recorded closing lines, not live odds.'

  static readonly defenseNote = 'Defense ranks are points allowed per game to the position, '
    + 'counting every player who faced them — so a defense that sees three-receiver sets looks softer to receivers. '
    + "Offensive positions rank from the nflverse stats season; DEF and IDP rank from Sleeper's stat lines this season, once a defense has four games."

  /** Re-reads everything that can change during a week. Wired to pull-to-refresh. */
  async refresh(): Promise<void> {
    const request = this.lastRequest
    if (!request) return
    await this.load(request.leagueID, request.rosterID, request.season, true)
    if (this.errorMessage === undefined && this.context && !isDegraded(this.context.provenance)) {
      this.refreshCount += 1
      this.changed()
    }
  }

  async load(leagueID: string, userRosterID: number, season?: number, force = false): Promise<void> {
    this.lastRequest = { leagueID, rosterID: userRosterID, season }
    this.isLoading = true
    this.errorMessage = undefined
    this.changed()

    try {
      const context = await this.loader.load({ leagueID, userRosterID, season, force })
      this.context = context
      this.week = context.currentWeek

      const matchups = await this.sleeper.matchups(leagueID, context.currentWeek, force)
      const lookup = DefenseLookup.build(context)
      this.defenseTable = lookup.nflverse
      this.defenseLookup = lookup
      this.defenseTableBuilds += 1
      this.apply(MatchupModel.build(context, matchups.value, lookup.nflverse, lookup))
      this.lastLiveUpdate = undefined
    } catch (error) {
      this.errorMessage = describeError(error)
    } finally {
      this.isLoading = false
      this.changed()
    }
  }

  // MARK: - Live updates

  private apply(built: BuiltMatchup): void {
    this.mySide = built.mine
    this.opponentSide = built.opponent
    this.noOpponentReason = built.noOpponentReason
    const paired = MatchupModel.pair(built.mine, built.opponent)
    this.comparisonBasis = paired.basis
    this.pairedSlots = paired.slots
    if (this.opponentSide === undefined && this.modeValue === 'opponent') this.modeValue = 'mine'
    this.changed()
  }

  /** Whether any starter on either side may be playing right now, on the clock at this moment. */
  get anyGameLive(): boolean {
    const context = this.context
    if (!context) return false
    const rows = [...(this.mySide?.rows ?? []), ...(this.opponentSide?.rows ?? [])]
    return rows.some((r) => r.playerID !== undefined && context.isLive(r.playerID))
  }

  /**
   * One live refresh: re-reads this week's matchups and rebuilds both sides,
   * but only while a game involving either lineup may be in progress.
   * Returns whether it polled.
   */
  async liveTick(): Promise<boolean> {
    const context = this.context
    const request = this.lastRequest
    if (!context || !request || !this.anyGameLive) return false
    let matchups: SleeperMatchup[]
    try {
      matchups = (await this.sleeper.matchups(request.leagueID, context.currentWeek, true)).value
    } catch {
      return false
    }
    // Swift passes only the nflverse table here, not the full lookup.
    const built = MatchupModel.build(context, matchups, this.defenseTable)
    this.apply(built)
    this.lastLiveUpdate = context.now()
    this.changed()
    return true
  }

  // MARK: - Pairing

  /**
   * Pairs both lineups by slot index. The basis is chosen once for the whole
   * matchup: live points as soon as anyone has a live number, otherwise season
   * points per game. A player yet to play has no live value, so his slot is
   * undecided rather than a zero-point loss.
   */
  static pair(mine: MatchupSide | undefined, theirs: MatchupSide | undefined): { basis: ComparisonBasis; slots: PairedSlot[] } {
    const allRows = [...(mine?.rows ?? []), ...(theirs?.rows ?? [])]
    const basis: ComparisonBasis = allRows.some((r) => r.livePoints !== undefined) ? 'livePoints' : 'seasonAverage'

    const value = (row: MatchupRow | undefined): number | undefined => {
      if (!row || rowIsEmptySlot(row)) return undefined
      // A starter on bye is a certain zero on either basis.
      if (row.onBye) return 0
      switch (basis) {
        case 'livePoints': return row.livePoints
        case 'seasonAverage': return row.season?.pointsPerGame
      }
    }
    // An empty slot is a certain zero, so it loses to any real player who isn't on bye.
    const fielded = (row: MatchupRow | undefined) => !!row && !rowIsEmptySlot(row) && !row.onBye

    const count = Math.max(mine?.rows.length ?? 0, theirs?.rows.length ?? 0)
    const slots: PairedSlot[] = []
    for (let index = 0; index < count; index++) {
      const left = mine && index < mine.rows.length ? mine.rows[index] : undefined
      const right = theirs && index < theirs.rows.length ? theirs.rows[index] : undefined
      const myValue = value(left)
      const theirValue = value(right)

      let leader: SlotLeader
      if (left && rowIsEmptySlot(left) && fielded(right)) {
        leader = 'theirs'
      } else if (right && rowIsEmptySlot(right) && fielded(left)) {
        leader = 'mine'
      } else if (myValue !== undefined && theirValue !== undefined) {
        leader = Math.abs(myValue - theirValue) < 0.05 ? 'even' : myValue > theirValue ? 'mine' : 'theirs'
      } else {
        leader = 'undecided'
      }

      slots.push({
        index,
        slot: left?.slot ?? right?.slot ?? '—',
        mine: left,
        theirs: right,
        myValue,
        theirValue,
        leader,
      })
    }
    return { basis, slots }
  }

  // MARK: - Building

  static build(
    context: LeagueContext,
    matchups: readonly SleeperMatchup[],
    table?: DefenseVsPositionTable,
    lookupIn?: DefenseLookup,
  ): BuiltMatchup {
    const lines = weekLines(context.schedule, context.currentWeek)
    const lookup = lookupIn ?? new DefenseLookup(
      table ?? computeDvPFromWeekly(context.weekly, context.scoring.profile),
      EMPTY_DVP,
      context.statsSeason,
      context.scheduleSeason,
    )
    const profilesByGSIS = new Map<string, SeasonProfile>()
    for (const p of context.seasonProfiles) if (!profilesByGSIS.has(p.gsisID)) profilesByGSIS.set(p.gsisID, p)
    const gsisBySleeper = context.gsisIDsBySleeper

    const side = (team: LeagueTeam, matchup: SleeperMatchup | undefined): MatchupSide => {
      // The matchup's own starters are what is actually locked in for the week;
      // the roster's are the fallback before Sleeper has a matchup.
      const starters = matchup?.starters ?? team.rawStarters
      const rows = starters.map((rawID, index): MatchupRow => {
        const slot = index < context.template.starters.length ? context.template.starters[index]!.token : '—'
        if (rawID === EMPTY_STARTER_SLOT || rawID === '') {
          return { index, slot, onBye: false, isLocked: false, isLive: false }
        }

        const player = context.players.players[rawID]
        const position = player ? playerPosition(player) : undefined
        // A team defense's id *is* its team (§3.1).
        const nflTeam = (player && playerNflverseTeam(player)) ?? player?.team ?? (position === 'DEF' ? rawID : undefined)
        const line = nflTeam === undefined ? undefined : lines[nflTeam]
        const onBye = nflTeam === undefined ? false : context.byeCalendar.isOnBye(nflTeam, context.currentWeek)

        const gsis = gsisBySleeper.get(rawID)
        const profile = gsis === undefined ? undefined : profilesByGSIS.get(gsis)
        const season: SeasonLine | undefined = profile && {
          games: profile.games,
          pointsPerGame: profile.pointsPerGame,
          formPointsPerGame: profile.formPointsPerGame,
          floor: profile.floor,
          ceiling: profile.ceiling,
        }

        const playedLines = statLines(context.inSeason, rawID).filter(played)
        const ppg = context.sleeperPointsPerGame(rawID)
        let thisSeason: SeasonLine | undefined
        if (ppg !== undefined) {
          const scoring = context.league.scoringSettings ?? {}
          const recent = playedLines.slice(-4).map((l) => scoreLine(l, scoring).points)
          thisSeason = {
            games: playedLines.length,
            pointsPerGame: ppg,
            formPointsPerGame: recent.length === 0 ? undefined : recent.reduce((s, v) => s + v, 0) / recent.length,
            floor: undefined,
            ceiling: undefined,
          }
        }

        return {
          index,
          slot,
          playerID: rawID,
          name: player?.name ?? rawID,
          position,
          nflTeam,
          opponent: line?.opponent,
          isHome: line?.isHome,
          onBye,
          livePoints: matchup?.playersPoints?.[rawID],
          season,
          defense: lookup.cell(line?.opponent, position),
          impliedTotal: line?.impliedTotal,
          isLocked: context.isLocked(rawID),
          isLive: context.isLive(rawID),
          kickoff: context.kickoffs.kickoff(nflTeam, context.currentWeek),
          projected: context.projectedPoints(rawID),
          thisSeason,
          defenseSource: lookup.source(position),
        }
      })

      const environment = lineupEnvironment(rows.filter((r) => !rowIsEmptySlot(r)).map((r) => r.nflTeam), lines)

      return {
        rosterID: team.rosterID,
        manager: team.manager,
        isUser: team.isUser,
        livePoints: matchup?.points,
        rows,
        environment: { total: environment.total, teamCount: environment.teamCount, missingTeams: environment.missing },
      }
    }

    const userTeam = context.userTeam
    if (!userTeam) return { noOpponentReason: 'Your roster is not in this league any more.' }

    const myMatchup = matchups.find((m) => m.rosterID === userTeam.rosterID)
    const mine = side(userTeam, myMatchup)

    const matchupID = myMatchup?.matchupID
    if (matchupID === undefined) {
      return { mine, noOpponentReason: `No opponent scheduled in week ${context.currentWeek} — a fantasy bye, or the season is over.` }
    }

    const opponentMatchup = matchups.find((m) => m.matchupID === matchupID && m.rosterID !== userTeam.rosterID)
    const opponentTeam = opponentMatchup && context.teams.find((t) => t.rosterID === opponentMatchup.rosterID)
    if (!opponentMatchup || !opponentTeam) {
      return { mine, noOpponentReason: `Sleeper has not paired an opponent for week ${context.currentWeek} yet.` }
    }

    return { mine, opponent: side(opponentTeam, opponentMatchup), noOpponentReason: undefined }
  }
}
