/**
 * The league-specific reads a screen needs, in Sleeper's shapes — a port of
 * FCData `LeagueDataSource`.
 *
 * Every screen was built on Sleeper's types, and they are good enough shapes
 * whichever platform hosts the league, so a second provider translates *into*
 * them. Everything league-independent (the player pool, projections, live
 * scores, news) stays on `SleeperService`: public, no account needed.
 */
import type { Fetched } from './fetched'
import type { SleeperService } from './SleeperService'
import type {
  SleeperDraft, SleeperDraftPick, SleeperLeague, SleeperLeagueMember, SleeperMatchup, SleeperRoster, SleeperTransaction,
} from './sleeperModels'

export type LeagueProvider = 'sleeper' | 'espn'
export const LEAGUE_PROVIDERS: readonly LeagueProvider[] = ['sleeper', 'espn']

export function providerLabel(provider: LeagueProvider): string {
  return provider === 'espn' ? 'ESPN' : 'Sleeper'
}

export interface LeagueDataSource {
  league(id: string, force?: boolean): Promise<Fetched<SleeperLeague>>
  rosters(leagueID: string, force?: boolean): Promise<Fetched<SleeperRoster[]>>
  members(leagueID: string, force?: boolean): Promise<Fetched<SleeperLeagueMember[]>>
  matchups(leagueID: string, week: number, force?: boolean): Promise<Fetched<SleeperMatchup[]>>
  completedMatchups(leagueID: string, week: number): Promise<Fetched<SleeperMatchup[]>>
  transactions(leagueID: string, week: number, force?: boolean): Promise<Fetched<SleeperTransaction[]>>
  drafts(leagueID: string, force?: boolean): Promise<Fetched<SleeperDraft[]>>
  draftPicks(draftID: string): Promise<Fetched<SleeperDraftPick[]>>
}

/** `SleeperService` already has every method; this only names the fact. */
export const asLeagueSource = (sleeper: SleeperService): LeagueDataSource => sleeper

/**
 * A source whose backing provider can change while the app runs. Every model
 * holds one from launch; switching provider in Settings swaps what is behind
 * it rather than rebuilding every screen model.
 */
export class SwitchableLeagueSource implements LeagueDataSource {
  constructor(private backing: LeagueDataSource) {}

  get current(): LeagueDataSource { return this.backing }
  use(source: LeagueDataSource): void { this.backing = source }

  league(id: string, force?: boolean) { return this.backing.league(id, force) }
  rosters(leagueID: string, force?: boolean) { return this.backing.rosters(leagueID, force) }
  members(leagueID: string, force?: boolean) { return this.backing.members(leagueID, force) }
  matchups(leagueID: string, week: number, force?: boolean) { return this.backing.matchups(leagueID, week, force) }
  completedMatchups(leagueID: string, week: number) { return this.backing.completedMatchups(leagueID, week) }
  transactions(leagueID: string, week: number, force?: boolean) { return this.backing.transactions(leagueID, week, force) }
  drafts(leagueID: string, force?: boolean) { return this.backing.drafts(leagueID, force) }
  draftPicks(draftID: string) { return this.backing.draftPicks(draftID) }
}
