/**
 * Small pieces the Market screens share — local ports of `InjuryBadge`,
 * `WeekChips`, `GradeChip`, `PanelFormat`, `StreamFormat.shortName` and
 * `Palette.delta`, plus the web's stand-ins for `.searchable`, a `Toggle`
 * switch and a picker `Menu`. Kept in this folder so the shared UI stays
 * untouched; candidates to move into `src/ui` later.
 */
import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { Copy, IdCard, MoreHorizontal, Repeat, Search, XCircle } from 'lucide-react'
import { formatNumber } from '@core/numeric'
import { roundAwayFromZero } from '@core/rounding'
import { UNAVAILABLE_TAGS, type LeagueContext } from '@models/league/LeagueContext'
import type { WaiverSort } from '@models/market/WaiverBoardModel'
import type { Observable } from '@models/Observable'
import { useApp } from '@ui/app/AppContext'

// MARK: - Formatting

/** `PanelFormat.points`: one decimal, or a dash. */
export const points = (value: number | undefined): string => (value === undefined ? '—' : formatNumber(value, 1))

/** `PanelFormat.signed`: a plus on zero and above. */
export const signed = (value: number): string => (value >= 0 ? '+' : '') + formatNumber(value, 1)

/** `StreamFormat.shortName`: last name, without a generational suffix. */
export function shortName(name: string): string {
  const parts = name.split(' ').filter((p) => p !== '' && !['Jr.', 'Sr.', 'II', 'III', 'IV'].includes(p))
  return parts[parts.length - 1] ?? name
}

const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
/** `.number.notation(.compactName)`: 1.2K. */
export const compact = (value: number): string => compactFormat.format(value)

/** `.percent.precision(.fractionLength(0))`. */
export const percent0 = (value: number): string => `${formatNumber(value * 100, 0)}%`

/** The Waiver Board's value text for a column (`WaiverBoardView.valueText`). */
export function waiverValueText(value: number, sort: WaiverSort): string {
  if (sort === 'snapShare' || sort === 'targetShare') return percent0(value)
  if (sort === 'trending') return compact(value)
  if (sort === 'projectedOverLine') return (value >= 0 ? '+' : '') + formatNumber(value, 1)
  return formatNumber(value, 1)
}

/** Discover's value text (`DiscoverView.value`): whole percents, raw add counts. */
export function discoverValueText(value: number, sort: WaiverSort): string {
  if (sort === 'snapShare' || sort === 'targetShare') return `${Math.trunc(roundAwayFromZero(value * 100))}%`
  if (sort === 'trending') return `${Math.trunc(value)}`
  if (sort === 'projectedOverLine') return signed(value)
  return points(value)
}

/** `WaiverTargetsPanel.badge`: a Sleeper injury tag as a short badge. */
export function tagBadge(tag: string): string | undefined {
  const upper = tag.toUpperCase()
  if (upper === 'QUESTIONABLE') return 'Q'
  if (upper === '') return undefined
  return Object.prototype.hasOwnProperty.call(UNAVAILABLE_TAGS, upper) ? UNAVAILABLE_TAGS[upper] : undefined
}

/** `Palette.delta`: green up, red down, grey near zero. */
export function deltaColor(value: number | undefined): string {
  if (value === undefined) return 'var(--text-2)'
  if (value > 0.05) return 'var(--start)'
  if (value < -0.05) return 'var(--sit)'
  return 'var(--text-2)'
}

// MARK: - Pieces

/** "Q" in amber, anything worse in red. */
export function InjuryBadge({ label }: { label: string }) {
  const tint = label === 'Q' ? 'var(--caution)' : 'var(--sit)'
  return (
    <span
      className="mk-badge t-micro"
      style={{ color: tint, background: `color-mix(in srgb, ${tint} 15%, transparent)` }}
      aria-label={label === 'Q' ? 'Questionable' : label}
      title={label === 'Q' ? 'Questionable' : label}
    >
      {label}
    </span>
  )
}

/** Up to six "W9" chips, then "+N". */
export function WeekChips({ weeks, prefix }: { weeks: readonly number[]; prefix?: string }) {
  return (
    <span className="mk-weeks">
      {prefix && <span className="t-meta muted">{prefix}</span>}
      {weeks.slice(0, 6).map((w) => <span key={w} className="mk-week">W{w}</span>)}
      {weeks.length > 6 && <span className="t-meta muted">+{weeks.length - 6}</span>}
    </span>
  )
}

/** A league-relative letter grade, coloured by band. */
export function GradeChip({ letter }: { letter: string }) {
  const first = letter[0]
  const tint = first === 'A' ? 'var(--start)' : first === 'B' ? '#818cf8' : first === 'C' ? 'var(--caution)' : 'var(--sit)'
  return (
    <span className="mk-grade" style={{ color: tint, background: `color-mix(in srgb, ${tint} 16%, transparent)` }} aria-label={`Team grade ${letter}`}>
      {letter}
    </span>
  )
}

/** The web's `.searchable`: a labelled search box with a clear button. */
export function SearchField({ value, onChange, placeholder, label }: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label?: string
}) {
  return (
    <div className="mk-search" role="search">
      <Search size={16} aria-hidden className="muted" />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
      {value !== '' && (
        <button type="button" className="mk-icon-button" aria-label="Clear search" onClick={() => onChange('')}>
          <XCircle size={16} aria-hidden />
        </button>
      )}
    </div>
  )
}

/** A `Toggle` in switch style. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={`mk-switch t-meta${disabled ? ' disabled' : ''}`}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="mk-switch-track" aria-hidden><span className="mk-switch-thumb" /></span>
      <span>{label}</span>
    </label>
  )
}

/** A picker `Menu` as a native select, labelled for screen readers. */
export function SelectMenu<T extends string>({ value, options, label, onChange, ariaLabel, disabled, icon }: {
  value: T
  options: readonly T[]
  label: (option: T) => string
  onChange: (option: T) => void
  ariaLabel: string
  disabled?: boolean
  icon?: ReactNode
}) {
  return (
    <label className={`mk-select${disabled ? ' disabled' : ''}`}>
      {icon}
      <select value={value} aria-label={ariaLabel} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o} value={o}>{label(o)}</option>)}
      </select>
    </label>
  )
}

/** Re-renders when any of several models changes (for lists of Player Cards). */
export function useModels(models: readonly Observable[]): void {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const offs = models.map((m) => m.subscribe(bump))
    return () => { for (const off of offs) off() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models.length, ...models])
}

// MARK: - Player menu

/**
 * The web's `playerCardMenu` context menu: a "…" button with Open Player
 * Card, "Trade for…" on a rival's player or "Offer in trade" on your own,
 * and Copy name.
 */
export function PlayerMenu({ playerID, context, name }: { playerID: string; context: LeagueContext; name?: string }) {
  const { openPlayerCard, openTrade } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  const display = name ?? context.playerName(playerID) ?? playerID
  const availability = context.availabilityOf(playerID)
  const position = context.position(playerID)
  const act = (f: () => void) => () => { setOpen(false); f() }
  return (
    <div className="mk-menu" ref={ref}>
      <button type="button" className="mk-icon-button" aria-haspopup="menu" aria-expanded={open}
        aria-label={`More for ${display}`} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}>
        <MoreHorizontal size={17} aria-hidden />
      </button>
      {open && (
        <div className="mk-menu-list card" role="menu">
          <button type="button" role="menuitem" onClick={act(() => openPlayerCard(playerID, context))}>
            <IdCard size={15} aria-hidden /> Open Player Card
          </button>
          {(availability.kind === 'rivalStarter' || availability.kind === 'rivalBench') && (
            <button type="button" role="menuitem" onClick={act(() => openTrade({
              positions: position ? new Set([position]) : undefined, rivalRosterID: availability.rosterID, theirPlayerID: playerID,
            }))}>
              <Repeat size={15} aria-hidden /> Trade for…
            </button>
          )}
          {availability.kind === 'mine' && (
            <button type="button" role="menuitem" onClick={act(() => openTrade({ myPlayerID: playerID }))}>
              <Repeat size={15} aria-hidden /> Offer in trade
            </button>
          )}
          <button type="button" role="menuitem" onClick={act(() => { void navigator.clipboard?.writeText(display) })}>
            <Copy size={15} aria-hidden /> Copy name
          </button>
        </div>
      )}
    </div>
  )
}

/** `SectionHeader`: a title and an optional subtitle inside a card. */
export function SectionHeader({ title, subtitle, icon }: { title: string; subtitle?: string; icon?: ReactNode }) {
  return (
    <div className="mk-section-header">
      <h3 className="t-section mk-inline">{icon}{title}</h3>
      {subtitle && <p className="t-meta muted">{subtitle}</p>}
    </div>
  )
}
