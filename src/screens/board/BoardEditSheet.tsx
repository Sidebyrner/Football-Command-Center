/**
 * Show, hide and reorder the Board's tiles — a port of `BoardEditSheet`
 * (Board/BoardView.swift). The phone's sheet becomes a modal dialog; its drag
 * handles become drag-and-drop plus Move up / Move down buttons, so reordering
 * also works from the keyboard.
 */
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react'
import { BoardLayout, boardTileBlurb, boardTileTitle, type BoardTile } from '@models/team/BoardTile'
import { boardTileIcon } from './BoardTiles'
import './board.css'

const copy = (l: BoardLayout) => new BoardLayout([...l.order], new Set(l.hidden))

export function BoardEditSheet({ layout, onSave, onClose }: {
  layout: BoardLayout
  onSave: (layout: BoardLayout) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(() => copy(layout))
  const [dragging, setDragging] = useState<BoardTile>()
  const dialogRef = useRef<HTMLDivElement>(null)

  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // Focus moves into the dialog on open and back to the Edit button on close; Escape cancels.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [])

  const update = (change: (d: BoardLayout) => void) => {
    const next = copy(draft)
    change(next)
    setDraft(next)
  }

  const setShown = (tile: BoardTile, shown: boolean) => update((d) => { if (shown) d.hidden.delete(tile); else d.hidden.add(tile) })

  const move = (tile: BoardTile, to: number) => update((d) => {
    const from = d.order.indexOf(tile)
    if (from < 0 || to < 0 || to >= d.order.length) return
    d.order.splice(from, 1)
    d.order.splice(to, 0, tile)
  })

  const onDragOver = (e: DragEvent, over: BoardTile) => {
    if (dragging === undefined || dragging === over) return
    e.preventDefault()
    move(dragging, draft.order.indexOf(over))
  }

  return (
    <div className="bt-sheet-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="bt-board-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-sheet-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="bt-sheet-bar">
          <button type="button" className="bt-text-button" onClick={onClose}>Cancel</button>
          <h2 id="board-sheet-title" className="t-section">Board tiles</h2>
          <button type="button" className="bt-text-button bt-strong" onClick={() => { onSave(draft); onClose() }}>Done</button>
        </header>

        <div className="bt-sheet-scroll">
          <ul className="card bt-tile-list">
            {draft.order.map((tile, index) => {
              const Icon = boardTileIcon[tile]
              const shown = !draft.hidden.has(tile)
              const id = `board-toggle-${tile}`
              return (
                <li
                  key={tile}
                  className={`bt-tile-list-row${dragging === tile ? ' bt-dragging' : ''}`}
                  draggable
                  onDragStart={(e) => { setDragging(tile); e.dataTransfer.effectAllowed = 'move' }}
                  onDragOver={(e) => onDragOver(e, tile)}
                  onDragEnd={() => setDragging(undefined)}
                  onDrop={(e) => { e.preventDefault(); setDragging(undefined) }}
                >
                  <GripVertical size={16} color="var(--text-3)" aria-hidden className="bt-grip" />
                  <Icon size={18} color="var(--accent)" aria-hidden style={{ flex: 'none' }} />
                  <label htmlFor={id} className="bt-grow bt-stack-1 bt-tile-list-label">
                    <span className="t-body">{boardTileTitle[tile]}</span>
                    <span className="t-meta muted">{boardTileBlurb[tile]}</span>
                  </label>
                  <span className="bt-move-buttons">
                    <button type="button" className="bt-icon-mini" aria-label={`Move ${boardTileTitle[tile]} up`} disabled={index === 0} onClick={() => move(tile, index - 1)}>
                      <ChevronUp size={15} aria-hidden />
                    </button>
                    <button type="button" className="bt-icon-mini" aria-label={`Move ${boardTileTitle[tile]} down`} disabled={index === draft.order.length - 1} onClick={() => move(tile, index + 1)}>
                      <ChevronDown size={15} aria-hidden />
                    </button>
                  </span>
                  <input
                    id={id}
                    type="checkbox"
                    role="switch"
                    className="bt-switch"
                    checked={shown}
                    onChange={(e) => setShown(tile, e.target.checked)}
                  />
                </li>
              )
            })}
          </ul>
          <p className="t-meta muted bt-sheet-footer">Drag to reorder. Hidden tiles stay here to switch back on.</p>
          <div className="card bt-tile-list-reset">
            <button type="button" className="bt-text-button" disabled={draft.equals(BoardLayout.standard)} onClick={() => setDraft(BoardLayout.standard)}>
              Reset to default
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
