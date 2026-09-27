/**
 * One panel on the grid: a title bar (what it is, its link colour, its
 * options, a way into the full screen) over the panel's content — a port of
 * FCApp `PanelHost.swift`, with `LinkSwatch` and `PanelOptionsMenu`. It hands
 * the panel its environment (`PanelEnvProvider`) as PanelHost's
 * `.environment` calls do.
 */
import { memo, useEffect, useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { ArrowDownRight, CircleSlash, CircleX, GripHorizontal, Move, SlidersHorizontal, SquareArrowOutUpRight } from 'lucide-react'
import { screenTitle } from '@models/navigation/screens'
import { DISCOVERY_SORTS, discoverySortLabel, discoverySortStorageKey } from '@models/market/DiscoveryModel'
import { METRIC, PLAYER_METRICS, type PlayerMetric } from '@models/player/PlayerMetrics'
import { metricStoredAs } from '@models/player/TrendComparison'
import type { LinkBus } from '@models/workspaces/LinkBus'
import { LINK_GROUP_COLOR, NO_PANEL_COMPARE, type PanelCompareAction } from '@models/workspaces/PanelEnvironment'
import { panelConsumesLink, panelFullScreen, panelPublishesLink, panelSystemImage, panelTitle } from '@models/workspaces/PanelKind'
import {
  LINK_GROUPS, linkGroupName, type LinkGroup, type PanelKind, type PanelPlacement, type PanelSettings,
} from '@models/workspaces/Workspace'
import { useApp } from '@ui/app/AppContext'
import { PanelBody, defaultRows } from './panels/PanelBody'
import { PanelEnvProvider, type PanelEnv } from './panels/PanelEnv'
import { Menu, MenuDivider, MenuItem, MenuSection } from './WorkspaceUI'
import { symbolIcon } from './symbols'
import type { DragMode } from './gridDrag'

export interface PanelActions {
  select: () => void
  remove: () => void
  setLinkGroup: (group: LinkGroup | undefined) => void
  setSettings: (settings: PanelSettings) => void
  /** A pointer went down on the title bar (move) or the corner (resize). */
  beginDrag: (mode: DragMode, event: PointerEvent<HTMLElement>) => void
  /** dx, dy, dw, dh in cells. */
  nudge: (dx: number, dy: number, dw: number, dh: number) => void
}

/** A Metric panel is titled by its metric. */
export function panelHostTitle(placement: PanelPlacement): string {
  if (placement.kind === 'metric') {
    const raw = placement.settings.extra.metric
    if (raw && (PLAYER_METRICS as readonly string[]).includes(raw)) return METRIC[raw as PlayerMetric].label
  }
  return panelTitle(placement.kind)
}

/** The link colour's compare list, for every row in this panel. */
function compareAction(bus: LinkBus, group: LinkGroup | undefined): PanelCompareAction {
  if (group === undefined) return NO_PANEL_COMPARE
  return {
    group,
    isComparing: (id) => bus.isComparing(id, group),
    canAdd: () => bus.canAddToCompare(group),
    toggle: (id) => bus.publish(bus.isComparing(id, group)
      ? { kind: 'removeCompare', playerID: id } : { kind: 'addCompare', playerID: id }, group),
  }
}

export const PanelHost = memo(function PanelHost({ placement, editing, isSelected, actions }: {
  placement: PanelPlacement
  editing: boolean
  isSelected: boolean
  /** Keep this stable across renders, so a drag elsewhere doesn't redraw every panel. */
  actions: PanelActions
}) {
  const { services, openScreen } = useApp()
  const kind = placement.kind
  const group = placement.linkGroup
  const title = panelHostTitle(placement)
  const Icon = symbolIcon(panelSystemImage(kind))
  const full = panelFullScreen(kind)
  const tint = group !== undefined ? LINK_GROUP_COLOR[group] : undefined

  const env = useMemo<PanelEnv>(() => ({
    inWorkspacePanel: true,
    linkGroup: group,
    linkPublish: { group, handler: (change) => { if (group !== undefined) services.linkBus.publish(change, group) } },
    compare: compareAction(services.linkBus, group),
    settingsUpdate: { settings: placement.settings, apply: actions.setSettings },
    inline: false,
  }), [group, services.linkBus, placement.settings, actions.setSettings])

  // Unlocked, the content is inert so a drag always means "move".
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!body.current) return
    if (editing) body.current.setAttribute('inert', '')
    else body.current.removeAttribute('inert')
  }, [editing])

  const border = isSelected ? 'var(--accent)' : tint ? `color-mix(in srgb, ${tint} 45%, transparent)` : undefined

  function onTitleKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!editing || e.target !== e.currentTarget) return
    const step: Record<string, [number, number, number, number]> = e.shiftKey
      ? { ArrowLeft: [0, 0, -1, 0], ArrowRight: [0, 0, 1, 0], ArrowUp: [0, 0, 0, -1], ArrowDown: [0, 0, 0, 1] }
      : { ArrowLeft: [-1, 0, 0, 0], ArrowRight: [1, 0, 0, 0], ArrowUp: [0, -1, 0, 0], ArrowDown: [0, 1, 0, 0] }
    const move = step[e.key]
    if (move) { e.preventDefault(); actions.nudge(...move); return }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); actions.remove(); return }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); actions.select() }
  }

  return (
    <section
      className={`ws-panel${editing ? ' ws-panel-editing' : ''}${isSelected ? ' ws-panel-selected' : ''}`}
      style={border ? { borderColor: border } : undefined}
      aria-label={panelTitle(kind)}
      data-panel={kind}
    >
      <div
        className="ws-panel-title"
        tabIndex={editing ? 0 : undefined}
        role={editing ? 'button' : undefined}
        aria-roledescription={editing ? 'movable panel' : undefined}
        aria-label={editing ? `${title} — arrow keys move, Shift and arrow keys resize` : undefined}
        aria-pressed={editing ? isSelected : undefined}
        onPointerDown={(e) => {
          if (!editing || e.button !== 0 || (e.target as HTMLElement).closest('button')) return
          actions.beginDrag('move', e)
        }}
        onClick={(e) => { if (editing && !(e.target as HTMLElement).closest('button')) actions.select() }}
        onFocus={(e) => { if (editing && e.target === e.currentTarget) actions.select() }}
        onKeyDown={onTitleKey}
      >
        {editing && <GripHorizontal size={14} className="ws-grip" aria-hidden />}
        <Icon size={16} className="ws-panel-icon" style={{ color: tint ?? 'var(--text-2)' }} aria-hidden />
        <span className="ws-panel-name">{title}</span>
        <span className="ws-spacer" />
        {(panelPublishesLink(kind) || panelConsumesLink(kind)) && (
          <LinkSwatch group={group} onChange={actions.setLinkGroup} />
        )}
        {editing ? (
          <>
            <ArrangeMenu title={panelTitle(kind)} nudge={actions.nudge} remove={actions.remove} />
            <button type="button" className="ws-icon-button" title="Remove panel" aria-label={`Remove ${panelTitle(kind)}`}
              onClick={actions.remove}>
              <CircleX size={17} aria-hidden />
            </button>
          </>
        ) : (
          <>
            <PanelOptionsMenu kind={kind} settings={placement.settings} onChange={actions.setSettings} />
            {full && (
              <button type="button" className="ws-icon-button" title={`Open ${screenTitle[full]}`} aria-label={`Open ${screenTitle[full]}`}
                onClick={() => openScreen(full)}>
                <SquareArrowOutUpRight size={16} aria-hidden />
              </button>
            )}
          </>
        )}
      </div>
      <div ref={body} className="ws-panel-body" aria-hidden={editing || undefined}>
        <PanelEnvProvider value={env}>
          <PanelBody kind={kind} settings={placement.settings} />
        </PanelEnvProvider>
      </div>
      {editing && (
        <div className="ws-resize" title="Drag to resize" aria-hidden
          onPointerDown={(e) => { if (e.button === 0) actions.beginDrag('resize', e) }}>
          <ArrowDownRight size={12} strokeWidth={3} />
        </div>
      )}
    </section>
  )
})

/**
 * Swift's VoiceOver actions on an unlocked panel, as a menu — the way to
 * move and resize without dragging.
 */
function ArrangeMenu({ title, nudge, remove }: { title: string; nudge: PanelActions['nudge']; remove: () => void }) {
  const items: [string, [number, number, number, number]][] = [
    ['Move left', [-1, 0, 0, 0]], ['Move right', [1, 0, 0, 0]], ['Move up', [0, -1, 0, 0]], ['Move down', [0, 1, 0, 0]],
    ['Wider', [0, 0, 1, 0]], ['Narrower', [0, 0, -1, 0]], ['Taller', [0, 0, 0, 1]], ['Shorter', [0, 0, 0, -1]],
  ]
  return (
    <Menu title={`Arrange ${title}`} label={<Move size={15} aria-hidden />}>
      {(close) => (
        <>
          {items.map(([label, d]) => (
            <MenuItem key={label} onSelect={() => { nudge(...d) }}>{label}</MenuItem>
          ))}
          <MenuDivider />
          <MenuItem destructive onSelect={() => { close(); remove() }}>Remove</MenuItem>
        </>
      )}
    </Menu>
  )
}

/**
 * The link colour, like a trading desk's grouping block: panels of one colour
 * follow the same player. Always visible, even when the layout is locked.
 */
export function LinkSwatch({ group, onChange }: { group: LinkGroup | undefined; onChange: (group: LinkGroup | undefined) => void }) {
  const help = group !== undefined
    ? `Linked: ${linkGroupName(group)}. Panels of the same colour follow one player.`
    : 'Not linked. Pick a colour to make this panel follow, or drive, other panels.'
  return (
    <Menu
      title={group !== undefined ? `Link colour ${linkGroupName(group)}` : 'Not linked'}
      className="ws-swatch-button"
      label={<span className={`ws-swatch${group === undefined ? ' ws-swatch-none' : ''}`} title={help}
        style={group !== undefined ? { background: LINK_GROUP_COLOR[group] } : undefined} />}
    >
      {(close) => (
        <>
          <MenuSection title="Link colour">
            {LINK_GROUPS.map((option) => (
              <MenuItem key={option} checked={option === group}
                icon={<span className="ws-swatch" style={{ background: LINK_GROUP_COLOR[option] }} />}
                onSelect={() => { onChange(option); close() }}>
                {linkGroupName(option)}
              </MenuItem>
            ))}
          </MenuSection>
          <MenuItem checked={group === undefined} icon={<CircleSlash size={14} />} onSelect={() => { onChange(undefined); close() }}>
            Not linked
          </MenuItem>
        </>
      )}
    </Menu>
  )
}

// MARK: - Options

export function panelRowChoices(kind: PanelKind): number[] | undefined {
  switch (kind) {
    case 'injuries': case 'waiverTargets': case 'idpStream': case 'wrStream': case 'rbStream': case 'qbStream':
    case 'dstStream': case 'kStream': case 'news': case 'standings': case 'tradePartners':
      return [3, 5, 8, 12]
    case 'discovery': return [8, 12, 20, 40]
    case 'gameLog': case 'trendChart': case 'compare': case 'metric': return [4, 6, 8, 12]
    case 'playerNews': return [3, 5, 8]
    default: return undefined
  }
}

function rowsLabel(kind: PanelKind): string {
  switch (kind) {
    case 'gameLog': case 'trendChart': case 'compare': case 'metric': return 'Last games'
    default: return 'Rows'
  }
}

export function panelPositionChoices(kind: PanelKind): string[] | undefined {
  switch (kind) {
    case 'waiverTargets': return ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
    case 'discovery': return ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'LB', 'DL', 'DB']
    default: return undefined
  }
}

const copy = (s: PanelSettings): PanelSettings => ({ ...s, extra: { ...s.extra } })

/**
 * Per-panel options: how many rows, and a position filter where it helps.
 * They live on the panel, never on the shared model, so the full screen is
 * unaffected.
 */
export function PanelOptionsMenu({ kind, settings, onChange }: { kind: PanelKind; settings: PanelSettings; onChange: (s: PanelSettings) => void }) {
  const rowChoices = panelRowChoices(kind)
  const positionChoices = panelPositionChoices(kind)
  const metricChoices = kind === 'trendChart' ? PLAYER_METRICS : undefined
  const sortChoices = kind === 'discovery' ? DISCOVERY_SORTS : undefined
  if (!rowChoices && !positionChoices && !metricChoices && !sortChoices) return null
  const label = rowsLabel(kind)
  const set = (change: (next: PanelSettings) => void) => { const next = copy(settings); change(next); onChange(next) }
  const metric = metricStoredAs(settings.extra.metric) ?? 'fantasyPoints'
  const sort = settings.extra.sort ?? ''
  const rows = settings.topN ?? defaultRows(kind)
  const position = settings.positionFilter ?? ''
  return (
    <Menu title={`${panelTitle(kind)} options`} label={<SlidersHorizontal size={16} aria-hidden />}>
      {() => (
        <>
          {metricChoices && (
            <MenuSection title="Chart">
              {metricChoices.map((m) => (
                <MenuItem key={m} checked={m === metric} onSelect={() => set((n) => { n.extra.metric = m })}>{METRIC[m].label}</MenuItem>
              ))}
            </MenuSection>
          )}
          {sortChoices && (
            <MenuSection title="Sort">
              <MenuItem checked={sort === ''} onSelect={() => set((n) => { delete n.extra.sort })}>Follow the list</MenuItem>
              {sortChoices.map((s) => {
                const key = discoverySortStorageKey(s)
                return <MenuItem key={key} checked={sort === key} onSelect={() => set((n) => { n.extra.sort = key })}>{discoverySortLabel(s)}</MenuItem>
              })}
            </MenuSection>
          )}
          {rowChoices && (
            <MenuSection title={label}>
              {rowChoices.map((n) => (
                <MenuItem key={n} checked={n === rows} onSelect={() => set((next) => { next.topN = n })}>
                  {label === 'Rows' ? `${n} rows` : `Last ${n}`}
                </MenuItem>
              ))}
            </MenuSection>
          )}
          {positionChoices && (
            <MenuSection title="Position">
              <MenuItem checked={position === ''} onSelect={() => set((n) => { delete n.positionFilter })}>All positions</MenuItem>
              {positionChoices.map((p) => (
                <MenuItem key={p} checked={p === position} onSelect={() => set((n) => { n.positionFilter = p })}>{p}</MenuItem>
              ))}
            </MenuSection>
          )}
        </>
      )}
    </Menu>
  )
}
