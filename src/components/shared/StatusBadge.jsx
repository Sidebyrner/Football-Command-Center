import { getStatusColor, getStatusLabel } from '../../utils/playerHelpers'

export default function StatusBadge({ status, size = 'sm' }) {
  const color = getStatusColor(status)
  const label = getStatusLabel(status)
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm'

  return (
    <span className={`inline-flex items-center gap-1.5 ${textSize} font-medium text-[var(--color-text-muted)]`}>
      <span
        className="inline-block rounded-full"
        style={{ width: 7, height: 7, backgroundColor: color, flexShrink: 0 }}
      />
      {label}
    </span>
  )
}
