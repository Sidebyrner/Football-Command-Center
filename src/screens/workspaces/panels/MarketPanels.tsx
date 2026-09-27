/**
 * The market panels — a port of FCApp `Workspaces/Panels/MarketPanels.swift`:
 * waiver targets, the six weekly streams, trade partners and the linked
 * Player Card, each drawn from the model its full screen uses.
 */
import { useEffect, useMemo, useState } from 'react'
import { CircleArrowRight, Hand } from 'lucide-react'
import { POSITIONS, type Position } from '@core/Position'
import { roundAwayFromZero } from '@core/rounding'
import type { StreamProjection } from '@core/Stream'
import { availabilityLabel, startAvailability, startBadge, UNAVAILABLE_TAGS, type LeagueContext } from '@models/league/LeagueContext'
import {
  injuryBadge, isWindowClosed, partnerFitID, tradeWindowLabel,
  type PartnerFit, type TradeWizardModel, type TradeWizardPrefill,
} from '@models/market/TradeWizardModel'
import {
  WAIVER_SORT_LABEL, WAIVER_SORT_UNIT, waiverRowValue, waiverSortIsPercent,
  type WaiverBoardModel, type WaiverRow,
} from '@models/market/WaiverBoardModel'
import type { StreamKindTypes } from '@models/streams/StreamKind'
import type { StreamScreenModel } from '@models/streams/StreamScreenModel'
import { LINK_GROUP_COLOR } from '@models/workspaces/PanelEnvironment'
import { linkGroupName, type LinkGroup } from '@models/workspaces/Workspace'
import { useApp, useModel } from '@ui/app/AppContext'
import { PlayerAvatar, positionColor } from '@ui/components/Player'
import { GradeChip } from '../../market/shared'
import { PlayerCardView } from '../../players/PlayerCardView'
import { StreamFormat } from '../../streams/format'
import { StreamRangeBar } from '../../streams/parts'
import { dstSpec } from '../../streams/DSTStream'
import { idpSpec } from '../../streams/IDPStream'
import { kSpec } from '../../streams/KStream'
import { qbSpec } from '../../streams/QBStream'
import { rbSpec } from '../../streams/RBStream'
import { wrSpec } from '../../streams/WRStream'
import '../../streams/streams.css'
import type { PanelProps } from './PanelEnv'
import { usePanelEnv } from './PanelEnv'
import { PanelFootnote, PanelGate, PanelMessage, PanelPlayerRow, PanelScroll, panelFormat } from './shared'
import './teamPanels.css'
import './marketPanels.css'

// MARK: - Waiver targets

/** Swift `WaiverTargetsPanel.badge`. */
function waiverBadge(tag: string): string | undefined {
  const upper = tag.toUpperCase()
  if (upper === 'QUESTIONABLE') return 'Q'
  if (upper === '') return undefined
  return Object.prototype.hasOwnProperty.call(UNAVAILABLE_TAGS, upper) ? UNAVAILABLE_TAGS[upper] : undefined
}

function waiverValue(model: WaiverBoardModel, row: WaiverRow): string {
  const value = waiverRowValue(row, model.sort)
  if (value === undefined) return '—'
  if (waiverSortIsPercent(model.sort)) return `${roundAwayFromZero(value * 100)}%`
  if (model.sort === 'trending') return `${Math.trunc(value)}`
  if (model.sort === 'projectedOverLine') return panelFormat.signed(value)
  return panelFormat.points(value)
}

const parsePosition = (raw: string | undefined): Position | undefined =>
  raw !== undefined && (POSITIONS as readonly string[]).includes(raw) ? (raw as Position) : undefined

/**
 * The Waiver Board's top rows, ranked the way the board is sorted. The
 * position filter is the panel's own, so the board is left alone.
 */
export function WaiverTargetsPanel({ settings, rows }: PanelProps) {
  const { services } = useApp()
  const model = useModel(services.waivers)
  const position = parsePosition(settings.positionFilter)
  const filtered = position !== undefined ? model.rows.filter((r) => r.position === position) : model.rows
  const shown = filtered.slice(0, rows)
  const context = model.context
  return (
    <PanelGate hasContext={context !== undefined} isLoading={model.isLoading} error={model.errorMessage}>
      {shown.length === 0 ? (
        <PanelMessage style="empty" text="Nobody matches on the Waiver Board right now." />
      ) : (
        <PanelScroll>
          <div className="tp-rows">
            {shown.map((row) => (
              <PanelPlayerRow
                key={row.id}
                playerID={row.id} name={row.name} position={row.position}
                detail={[row.position, row.team, row.opponent].filter((x): x is string => x !== undefined).join(' · ')}
                badge={row.injuryTag !== undefined ? waiverBadge(row.injuryTag) : undefined}
                chip={row.availability.kind === 'freeAgent' ? undefined : availabilityLabel(row.availability)}
                context={context}
                trailing={
                  <span className="mp-value">
                    <span className="tp-caption tp-strong tp-num">{waiverValue(model, row)}</span>
                    <span className="tp-caption2" style={{ color: 'var(--text-3)' }}>{WAIVER_SORT_UNIT[model.sort]}</span>
                  </span>
                }
              />
            ))}
          </div>
          <PanelFootnote text={`Ranked by ${WAIVER_SORT_LABEL[model.sort].toLowerCase()}${position !== undefined ? ` · ${position} only` : ''}.`} />
        </PanelScroll>
      )}
    </PanelGate>
  )
}

// MARK: - Streams

/** A stream's top rows against the starter it would replace. */
function StreamPanel<K extends StreamKindTypes>({ model: source, title, rows }: { model: StreamScreenModel<K>; title: string; rows: number }) {
  const model = useModel(source)
  const context = model.context
  const shown = model.rows.slice(0, rows)
  const incumbent = model.report?.incumbent
  const top = Math.max(0, ...shown.map((r) => r.ceilingP75)) * 1.05
  return (
    <PanelGate hasContext={context !== undefined} isLoading={model.isLoading} error={model.errorMessage}>
      {shown.length === 0 ? (
        <PanelMessage style="empty" text={`No ${model.kind.playerNoun}s to stream yet this week.`} />
      ) : (
        <PanelScroll>
          {incumbent && (
            <div className="mp-to-beat">
              <span className="tp-caption2 tp-bold muted">To beat</span>
              <span className="tp-caption tp-strong tp-ellipsis tp-grow">{incumbent.name}</span>
              <span className="tp-caption tp-num">{StreamFormat.one(incumbent.expPts)}</span>
            </div>
          )}
          {shown.map((row, index) => (
            <StreamRow key={row.id} row={row} index={index} context={context} top={top} />
          ))}
          <PanelFootnote text={`Using the ${title} screen's filters and risk mode.`} />
        </PanelScroll>
      )}
    </PanelGate>
  )
}

function streamInjuryBadge(row: StreamProjection, context: LeagueContext | undefined): string | undefined {
  if (row.playerID !== undefined && context) {
    const badge = startBadge(startAvailability(row.playerID, context))
    if (badge !== undefined) return badge
  }
  switch (row.practice) {
    case 'Q': return 'Q'
    case 'D': return 'Doubtful'
    case 'OUT': return 'Out'
    case 'IR': return 'IR'
    default: return undefined
  }
}

function StreamRow({ row, index, context, top }: { row: StreamProjection; index: number; context?: LeagueContext; top: number }) {
  return (
    <div className="mp-stream-row" role="group" aria-label={`${index + 1}. ${row.name}, ${StreamFormat.one(row.expPts)} expected points`}>
      <PanelPlayerRow
        playerID={row.playerID} name={row.name} position={row.platform}
        detail={`${row.roleLabel} · ${row.team} ${row.opponent}`}
        badge={streamInjuryBadge(row, context)} context={context}
        trailing={
          <span className="mp-value">
            <span className="tp-caption tp-bold tp-num">{StreamFormat.one(row.expPts)}</span>
            {row.expGain !== undefined && (
              <span className="tp-caption2 tp-num" style={{ color: row.expGain >= 0 ? 'var(--start)' : 'var(--sit)' }}>
                {panelFormat.signed(row.expGain)}
              </span>
            )}
          </span>
        }
      />
      <div className="mp-range">
        <StreamRangeBar floor={row.floorP25} expected={row.expPts} ceiling={row.ceilingP75} scaleMax={top} tint={positionColor(row.platform)} />
      </div>
    </div>
  )
}

export function QBStreamPanel({ rows }: PanelProps) {
  return <StreamPanel model={useApp().services.qbStream} title={qbSpec.title} rows={rows} />
}
export function RBStreamPanel({ rows }: PanelProps) {
  return <StreamPanel model={useApp().services.rbStream} title={rbSpec.title} rows={rows} />
}
export function WRStreamPanel({ rows }: PanelProps) {
  return <StreamPanel model={useApp().services.wrStream} title={wrSpec.title} rows={rows} />
}
export function KStreamPanel({ rows }: PanelProps) {
  return <StreamPanel model={useApp().services.kStream} title={kSpec.title} rows={rows} />
}
export function DSTStreamPanel({ rows }: PanelProps) {
  return <StreamPanel model={useApp().services.dstStream} title={dstSpec.title} rows={rows} />
}
export function IDPStreamPanel({ rows }: PanelProps) {
  return <StreamPanel model={useApp().services.idpStream} title={idpSpec.title} rows={rows} />
}

// MARK: - Trade partners

/**
 * Teams whose spare players fit your need, from the Trade Desk. Linked, it
 * follows a clicked player ("Trade for…") or team (picked out in the list).
 */
export function TradePartnersPanel({ rows }: PanelProps) {
  const { services } = useApp()
  const screen = useModel(services.trades)
  if (screen.desk) return <TradePartnersPanelContent desk={screen.desk} rows={rows} key={identity(screen.desk)} />
  if (screen.errorMessage !== undefined && !screen.isLoading) return <PanelMessage style="error" text={screen.errorMessage} />
  return <PanelMessage style="loading" text="Loading…" />
}

/** A fresh desk starts the panel's own goal choice over, as SwiftUI's `@State` does for a new `@ObservedObject`. */
const deskIDs = new WeakMap<TradeWizardModel, number>()
let nextDeskID = 0
function identity(desk: TradeWizardModel): number {
  let id = deskIDs.get(desk)
  if (id === undefined) { id = nextDeskID++; deskIDs.set(desk, id) }
  return id
}

function TradePartnersPanelContent({ desk: source, rows }: { desk: TradeWizardModel; rows: number }) {
  const desk = useModel(source)
  const { services, openScreen } = useApp()
  const bus = useModel(services.linkBus)
  const { linkGroup, linkPublish } = usePanelEnv()
  /** The panel's own choice of need, so browsing here never moves the Trades screen. */
  const [goalID, setGoalID] = useState<string>()
  const linked = bus.selection(linkGroup)
  const goal = desk.goals.find((g) => g.id === goalID) ?? desk.goals[0]
  const fits = useMemo(
    () => (goal ? desk.previewPartners(goal) : []),
    // Swift's `.task(id: "\(goal?.id ?? "-")|\(desk.goals.count)")`.
    [goal?.id ?? '-', desk.goals.length, desk],
  )

  if (isWindowClosed(desk.window)) {
    return (
      <PanelScroll>
        <PanelMessage style="empty" text={tradeWindowLabel(desk.window) ?? 'The trade deadline has passed.'} />
      </PanelScroll>
    )
  }
  const windowLabel = tradeWindowLabel(desk.window)
  return (
    <PanelScroll>
      {linked?.playerID !== undefined && <LinkedPlayer desk={desk} playerID={linked.playerID} />}
      {desk.goals.length === 0 ? (
        <span className="tp-caption muted">No clear needs on your roster — search any player from the Trades screen.</span>
      ) : (
        <>
          <div className="mp-goals">
            {desk.goals.slice(0, 6).map((option) => {
              const selected = option.id === goal?.id
              return (
                <button
                  key={option.id} type="button" title={option.detail} aria-pressed={selected}
                  className={`mp-goal tp-caption2${selected ? ' mp-goal-selected' : ''}`}
                  onClick={() => setGoalID(option.id)}
                >
                  {option.title}
                </button>
              )
            })}
          </div>
          {fits.length === 0 ? (
            <span className="tp-caption muted">No team has a spare player that fits.</span>
          ) : (
            fits.slice(0, rows).map((fit) => (
              <PartnerRow
                key={partnerFitID(fit)} fit={fit} desk={desk}
                highlighted={linked?.rosterID === fit.rival.rosterID} linkGroup={linkGroup}
                onPick={() => linkPublish.handler({ kind: 'team', rosterID: fit.rival.rosterID })}
                onOpen={() => {
                  if (goal) desk.chooseGoal(goal)
                  desk.choosePartner(fit)
                  openScreen('trades')
                }}
              />
            ))
          )}
        </>
      )}
      {windowLabel !== undefined && <PanelFootnote text={windowLabel + '.'} />}
    </PanelScroll>
  )
}

/** "Trade for…" or "Offer…" for whoever is selected in a linked panel. */
function LinkedPlayer({ desk, playerID }: { desk: TradeWizardModel; playerID: string }) {
  const { openTrade } = useApp()
  const context = desk.context
  const name = context.playerName(playerID)
  if (name === undefined) return null
  const availability = context.availabilityOf(playerID)
  let prefill: TradeWizardPrefill | undefined
  switch (availability.kind) {
    case 'rivalBench': case 'rivalStarter': {
      const position = context.position(playerID)
      prefill = { rivalRosterID: availability.rosterID, theirPlayerID: playerID }
      if (position !== undefined) prefill.positions = new Set([position])
      break
    }
    case 'mine': prefill = { myPlayerID: playerID }; break
    default: prefill = undefined
  }
  if (!prefill) return null
  const chosen = prefill
  return (
    <button type="button" className="mp-linked" onClick={() => openTrade(chosen)}>
      <PlayerAvatar sleeperID={playerID} name={name} position={context.position(playerID)} size={26} />
      <span className="tp-rows tp-grow">
        <span className="tp-caption tp-strong">{availability.kind === 'mine' ? `Offer ${name}` : `Trade for ${name}`}</span>
        <span className="tp-caption2 muted">{availabilityLabel(availability)}</span>
      </span>
      <CircleArrowRight size={18} color="var(--accent)" aria-hidden />
    </button>
  )
}

function PartnerRow({ fit, desk, highlighted, linkGroup, onPick, onOpen }: {
  fit: PartnerFit; desk: TradeWizardModel; highlighted: boolean; linkGroup?: LinkGroup; onPick: () => void; onOpen: () => void
}) {
  const tint = linkGroup !== undefined ? LINK_GROUP_COLOR[linkGroup] : 'var(--accent)'
  return (
    <div
      className="mp-partner" onClick={onPick}
      style={highlighted ? { background: `color-mix(in srgb, ${tint} 14%, transparent)` } : undefined}
    >
      <div className="mp-partner-head">
        <span className="tp-caption tp-strong tp-ellipsis">{fit.rival.manager}</span>
        {fit.grade?.letter !== undefined && <GradeChip letter={fit.grade.letter} />}
        <span className="tp-grow" />
        <button type="button" className="mp-link-button tp-caption2" onClick={(e) => { e.stopPropagation(); onOpen() }}>Open deal</button>
      </div>
      {fit.theirOffer.slice(0, 2).map((player) => (
        <div key={player.id} onClick={(e) => e.stopPropagation()}>
          <PanelPlayerRow
            playerID={player.id} name={player.name} position={player.position}
            detail={player.team} badge={injuryBadge(player)} context={desk.context}
            trailing={<span className="tp-caption tp-num">{panelFormat.points(desk.value(player.id, desk.basis))}</span>}
          />
        </div>
      ))}
    </div>
  )
}

// MARK: - Player card

/**
 * Everything on one player, following whoever was clicked in a panel of the
 * same link colour.
 */
export function PlayerCardPanel(_: PanelProps) {
  const { services } = useApp()
  const { linkGroup } = usePanelEnv()
  const dashboard = useModel(services.dashboard)
  const bus = useModel(services.linkBus)
  if (linkGroup === undefined) {
    return <PanelMessage style="empty" text="Pick a link colour on this panel, then click a player in a panel of the same colour." />
  }
  const id = bus.selection(linkGroup)?.playerID
  const context = dashboard.context
  if (id !== undefined && context) return <LinkedPlayerCard key={id} id={id} context={context} />
  if (!context) return <PanelMessage style="loading" text="Loading…" />
  return (
    <div className="panel-message">
      <Hand size={22} color={LINK_GROUP_COLOR[linkGroup]} aria-hidden />
      <span className="tp-caption tp-strong">{`Click a player in any ${linkGroupName(linkGroup).toLowerCase()} panel`}</span>
      <span className="tp-caption2 muted">This card follows your clicks.</span>
    </div>
  )
}

function LinkedPlayerCard({ id, context }: { id: string; context: LeagueContext }) {
  const { services } = useApp()
  const model = services.playerCard(id, context)
  useEffect(() => { void model.load() }, [model])
  return <div className="mp-card"><PlayerCardView model={model} /></div>
}
