import { getPositionColor } from '../../utils/playerHelpers'

export default function PlayerAvatar({ playerId, position, size = 40 }) {
  const color = getPositionColor(position)

  return (
    <div
      className="rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
      style={{
        width: size,
        height: size,
        backgroundColor: `${color}22`,
        border: `1.5px solid ${color}55`,
        color,
      }}
    >
      {position || '?'}
    </div>
  )
}
