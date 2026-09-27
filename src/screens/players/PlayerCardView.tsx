/** Placeholder until the Player Card screen is ported. */
import type { PlayerCardModel } from '@models/player/PlayerCardModel'

export function PlayerCardView({ model }: { model: PlayerCardModel }) {
  return (
    <div className="card">
      <h2 className="t-title">{model.name}</h2>
    </div>
  )
}
