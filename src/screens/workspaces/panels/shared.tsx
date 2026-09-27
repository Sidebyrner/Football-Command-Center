/**
 * Shared panel pieces — ports of `PanelScroll`, `PanelMessage`, `PanelGate`,
 * `PanelFootnote`, `PanelPlayerRow`, `InjuryBadge`, `PanelFormat`,
 * `LinkedCardGate`, `LinkedEmptyState` and `PanelPlayerHeader`.
 */
import { useEffect, type MouseEvent, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Hand, Loader2 } from 'lucide-react'
import type { Position } from '@core/Position'
import { formatNumber } from '@core/numeric'
import type { LeagueContext } from '@models/league/LeagueContext'
import { availabilityLabel, startAvailability, startBadge } from '@models/league/LeagueContext'
import type { PlayerCardModel } from '@models/player/PlayerCardModel'
import { LINK_GROUP_COLOR, panelPlayerTapHelp, panelPlayerTapOutcome } from '@models/workspaces/PanelEnvironment'
import { linkGroupName, type LinkGroup } from '@models/workspaces/Workspace'
import { useApp, useModel } from '@ui/app/AppContext'
import { PlayerAvatar, PositionChip } from '@ui/components/Player'
import { usePanelEnv } from './PanelEnv'
import './panels.css'

/** Scrolling content with the panel's standard inset. */
export function PanelScroll({ children }: { children: ReactNode }) {
  const { inline } = usePanelEnv()
  return <div className={inline ? 'panel-stack inline' : 'panel-scroll'}><div className="panel-stack">{children}</div></div>
}

/** Loading, failed, or nothing to show — sized for a panel. */
export function PanelMessage({ style, text }: { style: 'loading' | 'error' | 'empty'; text: string }) {
  const Icon = style === 'loading' ? Loader2 : style === 'error' ? AlertTriangle : CheckCircle2
  return (
    <div className="panel-message" role={style === 'error' ? 'alert' : 'status'}>
      <Icon size={18} className={style === 'loading' ? 'spin' : ''} color={style === 'error' ? 'var(--caution)' : 'var(--text-3)'} aria-hidden />
      <span className="t-caption muted">{text}</span>
    </div>
  )
}

/** Nothing until the model has a context. */
export function PanelGate({ hasContext, isLoading, error, children }: { hasContext: boolean; isLoading: boolean; error?: string; children: ReactNode }) {
  if (hasContext) return <>{children}</>
  if (error && !isLoading) return <PanelMessage style="error" text={error} />
  return <PanelMessage style="loading" text="Loading…" />
}

/** A small caption under a panel's rows. */
export function PanelFootnote({ text }: { text: string }) {
  return <p className="panel-footnote t-caption">{text}</p>
}

/** "Q" in caution, anything else in sit. */
export function InjuryBadge({ label }: { label: string }) {
  const tint = label === 'Q' ? 'var(--caution)' : 'var(--sit)'
  return (
    <span className="injury-badge t-caption" style={{ color: tint, background: `color-mix(in srgb, ${tint} 15%, transparent)` }}
      aria-label={label === 'Q' ? 'Questionable' : label}>{label}</span>
  )
}

export const panelFormat = {
  points: (v: number | undefined) => (v === undefined ? '—' : formatNumber(v, 1)),
  signed: (v: number) => (v >= 0 ? '+' : '') + formatNumber(v, 1),
}

/**
 * A compact player line. Clicking it follows the panel's link, ⌘/Ctrl-click
 * toggles compare, and an unlinked panel opens the Player Card.
 */
export function PanelPlayerRow({ playerID, name, position, detail, badge, chip, trailing, context }: {
  playerID?: string
  name: string
  position?: Position
  detail?: string
  badge?: string
  chip?: string
  trailing?: ReactNode
  /** The league, for opening the Player Card; rows without one don't open it. */
  context?: LeagueContext
}) {
  const env = usePanelEnv()
  const { openPlayerCard } = useApp()
  const onClick = (e: MouseEvent) => {
    if (!playerID) return
    switch (panelPlayerTapOutcome(env.linkPublish, env.compare, context !== undefined, e.metaKey || e.ctrlKey)) {
      case 'toggleCompare': env.compare.toggle(playerID); break
      case 'publish': env.linkPublish.handler({ kind: 'player', playerID }); break
      case 'openCard': if (context) openPlayerCard(playerID, context); break
      case 'none': break
    }
  }
  const comparing = playerID !== undefined && env.compare.isComparing(playerID)
  const content = (
    <>
      <PlayerAvatar sleeperID={playerID} name={name} position={position} size={26} />
      <span className="panel-row-main">
        <span className="panel-row-name">
          <span className="t-meta" style={{ fontWeight: 600 }}>{name}</span>
          {badge && <InjuryBadge label={badge} />}
          {chip && <span className="t-caption muted" style={{ fontWeight: 600 }}>{chip}</span>}
          {comparing && <span className="compare-dot" style={{ background: env.compare.group ? LINK_GROUP_COLOR[env.compare.group] : 'var(--accent)' }} aria-label="In compare" />}
        </span>
        {detail && <span className="t-caption muted panel-row-detail">{detail}</span>}
      </span>
      {trailing}
    </>
  )
  if (!playerID) return <div className="panel-row">{content}</div>
  return (
    <button type="button" className="panel-row" onClick={onClick} title={panelPlayerTapHelp(env.linkPublish, env.compare)}>
      {content}
    </button>
  )
}

/** "Click a player in any blue panel" — until the link group has a player. */
export function LinkedEmptyState({ group }: { group: LinkGroup }) {
  return (
    <div className="panel-message">
      <Hand size={22} color={LINK_GROUP_COLOR[group]} aria-hidden />
      <span className="t-meta" style={{ fontWeight: 600 }}>{`Click a player in any ${linkGroupName(group).toLowerCase()} panel`}</span>
      <span className="t-caption muted">This panel follows your clicks.</span>
    </div>
  )
}

/**
 * Resolves the panel's linked player to his cached Player Card model and loads
 * it — shared by every panel that follows a player.
 */
export function LinkedCardGate({ children }: { children: (card: PlayerCardModel, context: LeagueContext) => ReactNode }) {
  const { services } = useApp()
  const { linkGroup } = usePanelEnv()
  const dashboard = useModel(services.dashboard)
  const bus = useModel(services.linkBus)
  const playerID = bus.selection(linkGroup)?.playerID
  const context = dashboard.context
  const card = linkGroup !== undefined && playerID && context ? services.playerCard(playerID, context) : undefined
  useEffect(() => { if (card) void card.load() }, [card])
  if (linkGroup === undefined) return <PanelMessage style="empty" text="Pick a link colour on this panel, then click a player in a panel of the same colour." />
  if (card && context) return <LinkedCard card={card} context={context} key={playerID}>{children}</LinkedCard>
  if (!context) return <PanelMessage style="loading" text="Loading…" />
  return <LinkedEmptyState group={linkGroup} />
}

function LinkedCard({ card, context, children }: { card: PlayerCardModel; context: LeagueContext; children: (card: PlayerCardModel, context: LeagueContext) => ReactNode }) {
  useModel(card)
  return <>{children(card, context)}</>
}

/** Avatar, name, position and team — the line every detail panel opens with. */
export function PanelPlayerHeader({ card, detail }: { card: PlayerCardModel; detail?: string }) {
  const { inline } = usePanelEnv()
  useModel(card)
  if (inline) return null
  const badge = startBadge(startAvailability(card.id, card.context))
  const subtitle = [card.team, card.status?.opponent !== undefined ? `vs ${card.status.opponent} this week` : undefined, card.status ? availabilityLabel(card.status.availability) : undefined]
    .filter((x): x is string => !!x).join(' · ')
  return (
    <div className="panel-player-header">
      <PlayerAvatar sleeperID={card.id} name={card.name} position={card.position} size={30} />
      <div style={{ minWidth: 0 }}>
        <div className="panel-row-name">
          <span className="t-body" style={{ fontWeight: 600 }}>{card.name}</span>
          <PositionChip position={card.position} />
          {badge && <InjuryBadge label={badge} />}
        </div>
        <div className="t-caption muted panel-row-detail">{detail ?? subtitle}</div>
      </div>
    </div>
  )
}
