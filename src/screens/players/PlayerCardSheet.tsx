/**
 * The Player Card, as a sheet over whatever screen opened it — the port of
 * `PlayerCardSheet`. Closes with Escape, the close button or a tap outside.
 */
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useApp, useModel } from '@ui/app/AppContext'
import type { PlayerCardModel } from '@models/player/PlayerCardModel'
import { PlayerCardView } from './PlayerCardView'
import './sheet.css'

export function PlayerCardSheet() {
  const { playerCard, closePlayerCard } = useApp()
  useEffect(() => {
    if (!playerCard) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePlayerCard() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playerCard, closePlayerCard])
  if (!playerCard) return null
  return (
    <div className="sheet-scrim" onClick={closePlayerCard}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Player card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="icon-button sheet-close" onClick={closePlayerCard} aria-label="Close"><X size={18} /></button>
        <LoadedCard model={playerCard} />
      </div>
    </div>
  )
}

function LoadedCard({ model }: { model: PlayerCardModel }) {
  const card = useModel(model)
  useEffect(() => { void card.load() }, [card])
  return <PlayerCardView model={card} />
}
