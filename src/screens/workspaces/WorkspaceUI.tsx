/**
 * Small pieces the workspace views share: a popover menu (SwiftUI `Menu`), a
 * modal dialog, and the rename prompt and delete confirmation built on it.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import './workspaces.css'

// Layout effects warn during server rendering (the render specs); menus are closed there anyway.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * A button that opens a list of actions. The list floats above everything
 * (a panel clips its content), closes on a pick, a click outside or Escape,
 * and takes keyboard focus while open.
 */
export function Menu({ label, title, className, align = 'end', children, disabled, triggerStyle }: {
  /** The trigger's content. */
  label: ReactNode
  /** Accessible name and tooltip. */
  title: string
  className?: string
  align?: 'start' | 'end'
  disabled?: boolean
  triggerStyle?: CSSProperties
  /** The items; call `close` after an action. */
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<CSSProperties>({})
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }

  useIsoLayoutEffect(() => {
    if (!open || !trigger.current) return
    const r = trigger.current.getBoundingClientRect()
    const top = Math.min(r.bottom + 4, window.innerHeight - 80)
    setPos(align === 'end'
      ? { top, right: Math.max(window.innerWidth - r.right, 8) }
      : { top, left: Math.max(r.left, 8) })
    const first = list.current?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')
    first?.focus()
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close() }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(list.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])]
        if (items.length === 0) return
        e.preventDefault()
        const at = items.indexOf(document.activeElement as HTMLElement)
        const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length
        items[next]?.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  return (
    <>
      <button ref={trigger} type="button" className={className ?? 'ws-icon-button'} style={triggerStyle}
        aria-label={title} title={title} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        disabled={disabled}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}>
        {label}
      </button>
      {open && createPortal(
        <div className="fcc ws-menu-layer" data-theme={themeOf(trigger.current)} style={accentOf(trigger.current)}>
          <div className="ws-menu-scrim" onPointerDown={(e) => { e.preventDefault(); close() }} />
          <div ref={list} id={id} className="ws-menu card" role="menu" aria-label={title} style={pos}>
            {children(close)}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

/** The accent the shell sets inline, carried into the portal. */
function accentOf(el: HTMLElement | null): CSSProperties | undefined {
  const accent = el ? getComputedStyle(el).getPropertyValue('--accent').trim() : ''
  return accent ? ({ '--accent': accent } as CSSProperties) : undefined
}

/** The theme of the shell a portal leaves, so the menu matches it. */
function themeOf(el: HTMLElement | null): string | undefined {
  return el?.closest<HTMLElement>('[data-theme]')?.dataset.theme
}

export function MenuItem({ icon, children, onSelect, destructive, disabled, checked, title }: {
  icon?: ReactNode
  children: ReactNode
  onSelect: () => void
  destructive?: boolean
  disabled?: boolean
  /** A choice in a picker: shows a tick when chosen. */
  checked?: boolean
  title?: string
}) {
  const radio = checked !== undefined
  return (
    <button type="button" role={radio ? 'menuitemradio' : 'menuitem'} aria-checked={radio ? checked : undefined}
      className={`ws-menu-item t-body${destructive ? ' ws-destructive' : ''}`} disabled={disabled} title={title}
      onClick={onSelect}>
      {radio ? <span className="ws-menu-tick" aria-hidden>{checked ? <Check size={15} /> : null}</span> : null}
      {icon ? <span className="ws-menu-icon" aria-hidden>{icon}</span> : null}
      <span className="ws-menu-label">{children}</span>
    </button>
  )
}

export function MenuSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} className="ws-menu-section">
      {title && <div className="t-micro muted ws-menu-heading">{title}</div>}
      {children}
    </div>
  )
}

export const MenuDivider = () => <div className="ws-menu-divider" role="separator" />

/** A modal dialog: focus moves in on open and back on close; Escape and the backdrop cancel. */
export function Dialog({ title, onClose, children, footer, wide }: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const titleID = useId()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('input, [data-autofocus]')
    ;(first ?? ref.current)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      previous?.focus?.()
    }
    // Once per open.
  }, [])
  return (
    <div className="ws-dialog-backdrop" onClick={onClose}>
      <div ref={ref} className={`ws-dialog card${wide ? ' ws-dialog-wide' : ''}`} role="dialog" aria-modal="true"
        aria-labelledby={titleID} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h2 id={titleID} className="t-section ws-dialog-title">{title}</h2>
        <div className="ws-dialog-body">{children}</div>
        {footer && <div className="ws-dialog-footer">{footer}</div>}
      </div>
    </div>
  )
}

/** Swift's rename alert: a name field, Cancel and Rename. */
export function RenameDialog({ initial, onRename, onClose }: { initial: string; onRename: (name: string) => void; onClose: () => void }) {
  const [text, setText] = useState(initial)
  const submit = () => { onRename(text); onClose() }
  return (
    <Dialog title="Rename workspace" onClose={onClose}
      footer={<>
        <button type="button" className="button" onClick={onClose}>Cancel</button>
        <button type="button" className="button primary" onClick={submit}>Rename</button>
      </>}>
      <input className="ws-text-field t-body" aria-label="Name" placeholder="Name" value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        onFocus={(e) => e.currentTarget.select()} />
    </Dialog>
  )
}

/** Swift's delete confirmation. */
export function DeleteWorkspaceDialog({ name, onDelete, onClose }: { name: string; onDelete: () => void; onClose: () => void }) {
  return (
    <Dialog title={`Delete “${name}”?`} onClose={onClose}
      footer={<>
        <button type="button" className="button" onClick={onClose} data-autofocus>Cancel</button>
        <button type="button" className="button ws-button-destructive" onClick={() => { onClose(); onDelete() }}>Delete workspace</button>
      </>}>
      <p className="t-body muted ws-dialog-message">Its layout is removed. The screens and your league data aren't affected.</p>
    </Dialog>
  )
}
