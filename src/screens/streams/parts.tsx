/**
 * Local building blocks for the stream screens: an in-page sheet (SwiftUI's
 * `.sheet` + `NavigationStack` toolbar), a menu button (`Menu` and
 * `.contextMenu`), form controls (`Stepper`, `Slider`, `Picker`,
 * `TextField`), and the stream-only visuals (`StreamPillGrid`,
 * `StreamStatTile`, `StreamRangeBar`, `InjuryBadge`). Nothing in `src/ui`
 * covers these yet.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Minus, Plus, X, type LucideIcon } from 'lucide-react'
import { StatPill } from '@ui/components/Player'
import { StreamFormat } from './format'
import type { StreamPill } from './spec'

// MARK: - Sheet

export interface SheetAction {
  label: string
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
  primary?: boolean
  icon?: LucideIcon
}

/**
 * A modal panel over the screen with a title bar: leading and trailing
 * actions like a sheet's toolbar. Escape and a tap outside close it.
 */
export function Sheet(props: {
  title: string
  onClose: () => void
  leading?: SheetAction[]
  trailing?: SheetAction[]
  wide?: boolean
  children: ReactNode
}) {
  const { title, onClose, leading = [], trailing = [], wide, children } = props
  const ref = useRef<HTMLDivElement>(null)
  const titleID = useId()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.focus()
    return () => previous?.focus?.()
  }, [])
  return (
    <div
      className="stream-sheet-scrim"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        className={`stream-sheet${wide ? ' stream-sheet-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleID}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="stream-sheet-bar">
          <div className="stream-sheet-actions">
            {leading.map((a) => <SheetButton key={a.label} action={a} />)}
          </div>
          <h2 id={titleID} className="t-section stream-sheet-title">{title}</h2>
          <div className="stream-sheet-actions end">
            {trailing.map((a) => <SheetButton key={a.label} action={a} />)}
            {trailing.length === 0 && (
              <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} aria-hidden /></button>
            )}
          </div>
        </header>
        <div className="stream-sheet-body">{children}</div>
      </div>
    </div>
  )
}

function SheetButton({ action }: { action: SheetAction }) {
  const Icon = action.icon
  const cls = ['stream-bar-button', action.primary ? 'primary' : '', action.destructive ? 'destructive' : ''].filter(Boolean).join(' ')
  return (
    <button type="button" className={cls} onClick={action.onClick} disabled={action.disabled}>
      {Icon && <Icon size={16} aria-hidden />}
      {action.label}
    </button>
  )
}

// MARK: - Menu

export type MenuEntry =
  | { kind: 'item'; label: string; onSelect: () => void; disabled?: boolean; icon?: LucideIcon; destructive?: boolean }
  | { kind: 'heading'; label: string }
  | { kind: 'divider' }

/** A button that opens a list of actions — SwiftUI's `Menu` and context menus. */
export function MenuButton(props: {
  label: ReactNode
  ariaLabel?: string
  entries: MenuEntry[]
  className?: string
  disabled?: boolean
  align?: 'start' | 'end'
}) {
  const { label, ariaLabel, entries, className = 'stream-small-button', disabled, align = 'end' } = props
  const [open, setOpen] = useState(false)
  const menuID = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const close = () => { setOpen(false); buttonRef.current?.focus() }
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [open])
  return (
    <span className="stream-menu-wrap">
      <button
        ref={buttonRef}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuID : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <>
          <div className="stream-menu-scrim" onClick={() => setOpen(false)} aria-hidden />
          <div
            id={menuID}
            role="menu"
            className={`card stream-menu ${align}`}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }}
            ref={menuRef}
          >
            {entries.map((entry, i) => {
              if (entry.kind === 'divider') return <hr key={`d${i}`} className="stream-menu-divider" />
              if (entry.kind === 'heading') return <div key={`h${i}`} className="t-micro muted stream-menu-heading">{entry.label}</div>
              const Icon = entry.icon
              return (
                <button
                  key={`${i}-${entry.label}`}
                  type="button"
                  role="menuitem"
                  className={`menu-item${entry.destructive ? ' destructive' : ''}`}
                  disabled={entry.disabled}
                  onClick={() => { setOpen(false); entry.onSelect() }}
                >
                  {Icon && <Icon size={16} aria-hidden />}
                  <span>{entry.label}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </span>
  )
}

// MARK: - Forms

/** A grouped form section: header, rows, footer. */
export function FormSection({ header, footer, children }: { header?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="stream-form-section">
      {header !== undefined && <h3 className="t-meta muted stream-form-header">{header}</h3>}
      <div className="card stream-form-rows">{children}</div>
      {footer !== undefined && <p className="t-meta muted stream-form-footer">{footer}</p>}
    </section>
  )
}

/** Rounds away floating-point drift to the step's precision. */
function snap(value: number, step: number): number {
  const places = Math.max(0, (String(step).split('.')[1] ?? '').length)
  return Number(value.toFixed(places + 2))
}

/** A label that shows the value, with − and + buttons: SwiftUI's `Stepper`. */
export function Stepper(props: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; disabled?: boolean }) {
  const { label, value, onChange, min, max, step = 1, disabled } = props
  const set = (v: number) => onChange(snap(Math.min(max, Math.max(min, v)), step))
  return (
    <div className={`stream-form-row stepper${disabled ? ' disabled' : ''}`} role="group" aria-label={label}>
      <span className="t-body" aria-live="polite">{label}</span>
      <span className="stepper-buttons">
        <button type="button" aria-label="Decrease" disabled={disabled || value <= min} onClick={() => set(value - step)}><Minus size={16} aria-hidden /></button>
        <button type="button" aria-label="Increase" disabled={disabled || value >= max} onClick={() => set(value + step)}><Plus size={16} aria-hidden /></button>
      </span>
    </div>
  )
}

/** A range input with its label and end labels: SwiftUI's `Slider`. */
export function Slider(props: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; minLabel?: string; maxLabel?: string }) {
  const { label, value, onChange, min, max, step, minLabel, maxLabel } = props
  return (
    <label className="stream-form-row slider">
      <span className="stream-vh">{label}</span>
      {minLabel !== undefined && <span className="t-meta muted" aria-hidden>{minLabel}</span>}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(snap(Number(e.target.value), step))} />
      {maxLabel !== undefined && <span className="t-meta muted" aria-hidden>{maxLabel}</span>}
    </label>
  )
}

/** A labelled select: SwiftUI's `Picker` in a form. */
export function Picker<T extends string>(props: { label: string; value: T; options: readonly T[]; optionLabel: (v: T) => string; onChange: (v: T) => void }) {
  const { label, value, options, optionLabel, onChange } = props
  return (
    <label className="stream-form-row picker">
      <span className="t-body">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o} value={o}>{optionLabel(o)}</option>)}
      </select>
    </label>
  )
}

/** A growing text field: `TextField(axis: .vertical)`. */
export function NotesField({ value, onChange, placeholder = 'Why' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="stream-form-row notes">
      <span className="stream-vh">Notes</span>
      <textarea rows={2} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

/** A full-width destructive button row. */
export function DestructiveRow({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="stream-form-row stream-destructive-row" onClick={onClick}>{label}</button>
}

// MARK: - Stream visuals

/** Stat pills that wrap as whole pills onto further rows instead of squeezing into one. */
export function StreamPillGrid({ pills, minimumWidth = 56 }: { pills: StreamPill[]; minimumWidth?: number }) {
  return (
    <div className="stream-pill-grid" style={{ '--min': `${minimumWidth}px` } as CSSProperties}>
      {pills.map((p) => <StatPill key={p.label} label={p.label} value={p.value} tint={p.tint} />)}
    </div>
  )
}

/** A stat with room: the number large, its label under it, on a tile. */
export function StreamStatTile({ value, label, tint }: { value: string; label: string; tint?: string }) {
  return (
    <div className="stream-tile">
      <div className="stream-tile-value" style={tint ? { color: tint } : undefined}>{value}</div>
      <div className="t-meta muted">{label}</div>
    </div>
  )
}

/**
 * Floor to ceiling with a dot at the estimate, labelled underneath. Rows
 * share `scaleMax`, so a wider or further-right bar really is a bigger range.
 */
export function StreamRangeBar({ floor, expected, ceiling, scaleMax = 0, tint = 'var(--accent)' }: {
  floor: number; expected: number; ceiling: number; scaleMax?: number; tint?: string
}) {
  const top = Math.max(scaleMax, ceiling, 1)
  const x = (v: number) => Math.min(Math.max(v / top, 0), 1) * 100
  const one = StreamFormat.one
  return (
    <span className="range-bar" role="img" aria-label={`Floor ${one(floor)}, estimate ${one(expected)}, ceiling ${one(ceiling)}`} style={{ '--tint': tint } as CSSProperties}>
      <span className="range-track" aria-hidden>
        <span className="range-rail" />
        <span className="range-span" style={{ left: `${x(floor)}%`, width: `max(${x(ceiling) - x(floor)}%, 6px)` }} />
        <span className="range-dot" style={{ left: `clamp(0px, calc(${x(expected)}% - 7px), calc(100% - 14px))` }} />
      </span>
      <span className="range-labels" aria-hidden>
        <span><b>{one(floor)}</b> <span className="muted">floor</span></span>
        <span><b>{one(ceiling)}</b> <span className="muted">ceiling</span></span>
      </span>
    </span>
  )
}

/** "Q", "Out", "Doubtful", "IR" — caution for questionable, sit for the rest. */
export function InjuryBadge({ label }: { label: string }) {
  const tint = label === 'Q' ? 'var(--caution)' : 'var(--sit)'
  return (
    <span className="injury-badge" style={{ color: tint, background: `color-mix(in srgb, ${tint} 15%, transparent)` }} aria-label={label === 'Q' ? 'Questionable' : label}>
      {label}
    </span>
  )
}

/** SwiftUI's `ContentUnavailableView`. */
export function Unavailable({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="card empty-state">
      <Icon size={28} color="var(--text-3)" aria-hidden />
      <div className="t-title">{title}</div>
      <div className="t-body muted">{description}</div>
    </div>
  )
}
