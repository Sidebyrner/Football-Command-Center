/**
 * Decide — one slot, this week, a firm call. A port of FCApp
 * `Decide/DecideModel.swift` with its `DecideSlot` and `DecideSession`.
 * Derived on demand from what Sit/Start, the Waiver Board and Matchup have
 * already loaded, so it is never stale and never fetches anything itself.
 * Decide sets are ephemeral: nothing here is ever stored.
 */
import type { Position } from '@core/Position'
import { accepts } from '@core/RosterSlots'
import { playerPosition, type IndexedPlayer } from '@data/playerIndex'
import { EMPTY_STARTER_SLOT } from '@data/sleeperModels'
import { Observable } from '../Observable'
import { blocksStart, startAvailability, type LeagueContext } from '../league/LeagueContext'
import type { DiscoveryModel } from '../market/DiscoveryModel'
import type { WaiverBoardModel, WaiverRow } from '../market/WaiverBoardModel'
import {
  computeStartVerdict, matchupPosture, START_SIGNAL_LABEL, startBlocker, startOne,
  type MatchupPosture, type StartInput, type StartSignal, type StartSignals, type StartVerdict,
} from '../player/StartVerdict'
import { LinkBus } from '../workspaces/LinkBus'
import { playerLookupMatches } from '../workspaces/PlayerLookup'
import { projectedTotal, type MatchupModel } from './MatchupModel'
import { LINEUP_BASIS_LABEL, type SitStartModel } from './SitStartModel'

// MARK: - Slot

/** One lineup slot as a start decision: who could fill it and the call. */
export interface DecideSlot {
  index: number
  token: string
  eligible: ReadonlySet<Position>
  incumbentID?: string
  /** Incumbent first, then eligible bench players by projection. */
  candidateIDs: string[]
  verdict: StartVerdict
  isLocked: boolean
  /** Said when Sit/Start's active basis fills this slot differently. */
  sitStartNote?: string
}

/** Someone on your bench could take the slot. */
export const slotHasBenchOption = (s: DecideSlot) => s.candidateIDs.length >= 2
/** Can still change — worth opening even with nobody on the bench, to look at free agents. */
export const slotCanDecide = (s: DecideSlot) => !s.isLocked
/** A real contest the numbers don't settle on their own. */
export const slotIsCloseCall = (s: DecideSlot) => slotCanDecide(s) && slotHasBenchOption(s) && s.verdict.confidence !== 'clear'

export interface DecideSuggestion {
  id: string
  row: WaiverRow
  value: number
  reason: string
}

/** `StreamFormat.shortName`: last name, without a generational suffix. */
function shortName(name: string): string {
  const parts = name.split(' ').filter((p) => p.length > 0 && !['Jr.', 'Sr.', 'II', 'III', 'IV'].includes(p))
  return parts[parts.length - 1] ?? name
}

// MARK: - Model

export class DecideModel {
  /** The compare view's column limit. */
  static readonly columnLimit = LinkBus.compareLimit
  static readonly suggestionLimit = 3
  /** Free agents valued for suggestions, best first by the board's numbers. */
  static readonly poolLimit = 40

  constructor(
    private readonly sitStart: SitStartModel,
    private readonly waivers: WaiverBoardModel,
    private readonly matchup: MatchupModel,
    private readonly discovery: DiscoveryModel,
  ) {}

  get context(): LeagueContext | undefined { return this.sitStart.context }

  get posture(): MatchupPosture {
    const mine = this.matchup.mySide, theirs = this.matchup.opponentSide
    return matchupPosture(mine ? projectedTotal(mine) : undefined, theirs ? projectedTotal(theirs) : undefined)
  }

  // MARK: Signals

  /**
   * This week's numbers for a player, each exactly as Sit/Start values it.
   * Empty for a player who can't start — Sit/Start values nobody on bye or
   * ruled out.
   */
  signals(id: string): StartSignals {
    const context = this.context
    if (!context) return {}
    const out: StartSignals = {}
    const set = (s: StartSignal, v: number | undefined) => { if (v !== undefined) out[s] = v }
    const value = (b: Parameters<SitStartModel['value']>[1]) => this.sitStart.value(id, b, context)
    set('projected', value('projected'))
    set('commandCenter', value('commandCenter'))
    set('thisSeason', value('thisSeason') ?? value('seasonAverage'))
    set('form', value('form'))
    set('environment', value('environment'))
    set('floor', value('floor'))
    set('ceiling', value('ceiling'))
    if (Object.keys(out).length > 0) set('usage', this.discovery.row(id)?.expectedPoints)
    return out
  }

  input(id: string, incumbentID: string | undefined): StartInput {
    const context = this.context
    if (!context) return { id, name: id, signals: {} }
    const availability = context.availabilityOf(id)
    const rival = availability.kind === 'rivalBench' || availability.kind === 'rivalStarter' ? availability.manager : undefined
    const team = context.nflTeam(id)
    return {
      id, name: context.playerName(id) ?? id, position: context.position(id),
      isFreeAgent: availability.kind === 'freeAgent', rivalManager: rival,
      isIncumbent: id === incumbentID, availability: startAvailability(id, context),
      onBye: team !== undefined ? context.byeCalendar.isOnBye(team, context.currentWeek) : false,
      isLocked: context.isLocked(id), practice: context.practiceReport(id)?.practice,
      kickoff: context.kickoffs.kickoff(team, context.currentWeek),
      signals: this.signals(id),
    }
  }

  verdict(ids: readonly string[], incumbentID: string | undefined, slot: string | undefined): StartVerdict {
    return computeStartVerdict(ids.map((id) => this.input(id, incumbentID)), this.posture, slot)
  }

  // MARK: Slots

  slots(): DecideSlot[] {
    const context = this.context
    const team = context?.userTeam
    if (!context || !team) return []
    const starters = team.rawStarters
    const startingSet = new Set(starters.filter((s) => s !== EMPTY_STARTER_SLOT))
    const reserve = new Set(team.reserveIDs)
    const bench = team.roster.map((e) => e.id).filter((id) => !startingSet.has(id) && !reserve.has(id))
    const posture = this.posture
    const projections = new Map(bench.map((id) => [id, this.projection(id)]))
    const byProjection = (a: string, b: string) => {
      const pa = projections.get(a)!, pb = projections.get(b)!
      return pa === pb ? 0 : pa > pb ? -1 : 1
    }

    return context.template.starters.map((slot, index) => {
      const raw = index < starters.length ? starters[index] : undefined
      const incumbent = raw === EMPTY_STARTER_SLOT ? undefined : raw
      const others = bench
        .filter((id) => accepts(slot, context.position(id)) && !context.isLocked(id))
        .sort(byProjection)
      const ids = [...(incumbent !== undefined ? [incumbent] : []), ...others]
      const inputs = ids.map((id) => this.input(id, incumbent))
      const verdict = computeStartVerdict(inputs, posture, slot.token)
      return {
        index, token: slot.token, eligible: slot.eligible, incumbentID: incumbent,
        candidateIDs: ids, verdict, isLocked: incumbent !== undefined ? context.isLocked(incumbent) : false,
        sitStartNote: this.sitStartNote(index, verdict.pickID, new Set(ids), context),
      }
    })
  }

  slot(index: number): DecideSlot | undefined {
    return this.slots().find((s) => s.index === index)
  }

  /** Close calls first, then other contests, then slots with nobody on the bench, then locked slots. */
  orderedSlots(): DecideSlot[] {
    const all = this.slots()
    return [
      ...all.filter(slotIsCloseCall),
      ...all.filter((s) => slotCanDecide(s) && slotHasBenchOption(s) && !slotIsCloseCall(s)),
      ...all.filter((s) => slotCanDecide(s) && !slotHasBenchOption(s)),
      ...all.filter((s) => !slotCanDecide(s)),
    ]
  }

  /**
   * Bench players each slot, on its own, would start — when one is the pick
   * in more than one slot. He can only fill one; Sit/Start sets the whole
   * lineup at once.
   */
  static sharedPicks(slots: readonly DecideSlot[]): Map<string, string[]> {
    const out = new Map<string, string[]>()
    for (const slot of slots) {
      if (!slotCanDecide(slot)) continue
      const pick = slot.verdict.pickID
      if (pick === undefined || pick === slot.incumbentID) continue
      out.set(pick, [...(out.get(pick) ?? []), slot.token])
    }
    for (const [id, tokens] of [...out]) if (tokens.length <= 1) out.delete(id)
    return out
  }

  private sitStartNote(index: number, pickID: string | undefined, candidates: Set<string>, context: LeagueContext): string | undefined {
    const theirs = this.sitStart.lineup[index]?.playerID
    if (theirs === undefined || theirs === pickID || !candidates.has(theirs)) return undefined
    return `Sit/Start by ${LINEUP_BASIS_LABEL[this.sitStart.basis]} starts ${context.playerName(theirs) ?? theirs} here.`
  }

  private projection(id: string): number {
    const values = this.signals(id)
    return values.projected ?? values.commandCenter ?? -Infinity
  }

  // MARK: Free agents

  /**
   * Up to three free agents who play this week and beat the weakest
   * startable candidate on the same measure — projected, else Command
   * Center. Each comes with the reason.
   */
  suggestions(slot: DecideSlot, excluding: ReadonlySet<string> = new Set()): DecideSuggestion[] {
    const context = this.context
    if (!context) return []
    const measure = (id: string): [StartSignal, number] | undefined => {
      const projected = this.sitStart.value(id, 'projected', context)
      if (projected !== undefined) return ['projected', projected]
      const cc = this.sitStart.value(id, 'commandCenter', context)
      return cc !== undefined ? ['commandCenter', cc] : undefined
    }
    const startable = slot.candidateIDs.filter((id) => startBlocker(this.input(id, slot.incumbentID)) === undefined)
    let weakest: [string, [StartSignal, number]] | undefined
    for (const id of startable) {
      const m = measure(id)
      if (m && (weakest === undefined || m[1] < weakest[1][1])) weakest = [id, m]
    }
    const skip = new Set([...excluding, ...slot.candidateIDs])
    const boardValue = (r: WaiverRow) => r.projected ?? r.sleeperPointsPerGame ?? -1
    // Only the likeliest few dozen are worth valuing; the long tail of the
    // pool never beats a rostered player.
    const pool = this.waivers.freeAgents(slot.eligible)
      .filter((r) => r.playsThisWeek && !r.isLocked && !skip.has(r.id))
      .filter((r) => !blocksStart(startAvailability(r.id, context)))
      .sort((a, b) => boardValue(b) - boardValue(a))
      .slice(0, DecideModel.poolLimit)
    const out: DecideSuggestion[] = []
    for (const row of pool) {
      const m = measure(row.id)
      if (!m) continue
      const [signal, value] = m
      if (weakest) {
        if (!(value > weakest[1][1])) continue
        const name = context.playerName(weakest[0]) ?? weakest[0]
        out.push({ id: row.id, row, value, reason: `Beats ${shortName(name)} on ${START_SIGNAL_LABEL[signal]} this week` })
      } else {
        out.push({ id: row.id, row, value, reason: `${START_SIGNAL_LABEL[signal]} ${startOne(value)} this week` })
      }
    }
    return out
      .sort((a, b) => (a.value !== b.value ? b.value - a.value : a.row.name < b.row.name ? -1 : a.row.name > b.row.name ? 1 : 0))
      .slice(0, DecideModel.suggestionLimit)
  }

  /** Free agents at the slot's positions matching a search. */
  searchFreeAgents(query: string, slot: DecideSlot, excluding: readonly string[]): IndexedPlayer[] {
    const context = this.context
    if (!context) return []
    return playerLookupMatches(query, context, excluding, 40)
      .filter((player) => {
        const position = context.position(player.id) ?? playerPosition(player)
        return context.availabilityOf(player.id).kind === 'freeAgent' && position !== undefined && slot.eligible.has(position)
      })
      .slice(0, 6)
  }

  // MARK: Sessions

  /** A short-lived compare set for one slot. Never touches the compare list or any store. */
  session(slot: DecideSlot): DecideSession {
    const hasSuggestion = this.suggestions(slot).length > 0
    const room = hasSuggestion ? DecideModel.columnLimit - 1 : DecideModel.columnLimit
    return new DecideSession(slot, slot.candidateIDs.slice(0, room))
  }
}

// MARK: - Session

/** The players in one Decide dialog. Lives as long as the dialog; nothing is saved. */
export class DecideSession extends Observable {
  private idsValue: string[]

  constructor(readonly slot: DecideSlot, ids: readonly string[]) {
    super()
    this.idsValue = [...ids]
  }

  get ids(): readonly string[] { return this.idsValue }

  get isFull(): boolean { return this.idsValue.length >= DecideModel.columnLimit }

  /** The incumbent stays: the call is always against him. */
  canRemoveFromCompare(id: string): boolean { return id !== this.slot.incumbentID }

  removeFromCompare(id: string): void {
    if (!this.canRemoveFromCompare(id)) return
    this.idsValue = this.idsValue.filter((x) => x !== id)
    this.changed()
  }

  /** Adds a player; when full, `replacing` names the column to give up. */
  add(id: string, replacing?: string): void {
    if (this.idsValue.includes(id)) return
    if (replacing !== undefined && this.canRemoveFromCompare(replacing)) {
      this.idsValue = this.idsValue.filter((x) => x !== replacing)
    }
    if (this.isFull) { this.changed(); return }
    this.idsValue = [...this.idsValue, id]
    this.changed()
  }
}
