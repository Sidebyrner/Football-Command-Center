/**
 * A section's heading inside a card — the local port of the Swift
 * `SectionHeader` (Theme/Components.swift): an optional icon in the hub's hue,
 * a title, an optional count, and a subtitle under it. The shared
 * `ScreenSection` wraps its content instead, which these cards don't want.
 *
 * `inButton` draws it with phrasing elements only, for a card that is itself
 * a button (a heading can't live inside one).
 */
import type { LucideIcon } from 'lucide-react'
import './team.css'

export function SectionHeader({ title, subtitle, icon: Icon, count, inButton = false }: {
  title: string
  subtitle?: string
  icon?: LucideIcon
  count?: number
  inButton?: boolean
}) {
  const Title = inButton ? 'span' : 'h3'
  const Sub = inButton ? 'span' : 'p'
  const Box = inButton ? 'span' : 'div'
  return (
    <Box className="bt-card-header">
      <Box className="bt-card-header-title">
        {Icon && <Icon size={17} strokeWidth={2.4} color="var(--hue-team)" aria-hidden />}
        <Title className="t-section">{title}</Title>
        {count !== undefined && <span className="count t-meta">{count}</span>}
      </Box>
      {subtitle && <Sub className={`t-meta muted${Icon ? ' bt-indented' : ''}`}>{subtitle}</Sub>}
    </Box>
  )
}
