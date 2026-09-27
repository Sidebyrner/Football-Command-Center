/**
 * The Trade Desk as a screen — a port of FCApp `TradeDeskScreenModel`: loads
 * the league through the shared loader and holds the desk, rebuilt when a
 * "Trade for…" request arrives from elsewhere so the deal always starts from
 * current rosters.
 */
import { RelayClient } from '@data/RelayClient'
import { FetchTransport } from '@data/transport'
import { Observable } from '../Observable'
import { isDegraded } from '../league/Freshness'
import type { LeagueContext } from '../league/LeagueContext'
import type { LeagueContextLoader } from '../league/LeagueContextLoader'
import { TradeWizardModel, type TradeWizardPrefill } from './TradeWizardModel'

/** Swift's `String(describing: error)`, as near as JS gets. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message || error.name : String(error)
}

export class TradeDeskScreenModel extends Observable {
  desk?: TradeWizardModel
  isLoading = false
  errorMessage?: string
  refreshCount = 0

  relayBaseURL?: string
  private lastRequest?: { leagueID: string; rosterID: number; season?: number }

  constructor(private readonly loader: LeagueContextLoader) {
    super()
  }

  get context(): LeagueContext | undefined { return this.desk?.context }

  async load(leagueID: string, userRosterID: number, season?: number, force = false): Promise<void> {
    this.lastRequest = { leagueID, rosterID: userRosterID, season }
    await this.build(undefined, force)
  }

  async refresh(): Promise<void> {
    await this.build(undefined, true)
    const context = this.context
    if (this.errorMessage === undefined && context && !isDegraded(context.provenance)) {
      this.refreshCount += 1
      this.changed()
    }
  }

  /** Starts a fresh deal pointed at a need, a team or a player. */
  async open(prefill: TradeWizardPrefill | undefined): Promise<void> {
    await this.build(prefill, false)
  }

  /** Starts over on the current rosters. */
  async startOver(): Promise<void> {
    await this.build(undefined, false)
  }

  private async build(prefill: TradeWizardPrefill | undefined, force: boolean): Promise<void> {
    const request = this.lastRequest
    if (!request) return
    this.isLoading = true
    this.errorMessage = undefined
    this.changed()
    try {
      const context = await this.loader.load({
        leagueID: request.leagueID, userRosterID: request.rosterID, season: request.season, force,
      })
      // Local inference on a home GPU takes seconds, not milliseconds.
      const relay = this.relayBaseURL !== undefined ? new RelayClient(this.relayBaseURL, new FetchTransport(90_000)) : undefined
      const desk = new TradeWizardModel(context, { relay, prefill })
      this.desk = desk
      this.changed()
      await desk.prepare()
    } catch (error) {
      this.errorMessage = describeError(error)
    } finally {
      this.isLoading = false
      this.changed()
    }
  }
}
