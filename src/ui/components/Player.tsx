/**
 * Player pieces shared by every screen — ports of `PlayerAvatar`, `TeamLogo`,
 * `PositionChip`, `StatPill` and `SlidingPicker`, plus a name button that
 * opens the Player Card.
 */
import { useState, type CSSProperties, type ReactNode } from 'react'
import type { Position } from '@core/Position'
import type { LeagueContext } from '@models/league/LeagueContext'
import { useApp } from '@ui/app/AppContext'
import { StatValue } from './Screen'

const POSITION_VAR: Record<Position, string> = {
  QB: '--pos-qb', RB: '--pos-rb', WR: '--pos-wr', TE: '--pos-te', K: '--pos-k', DEF: '--pos-def', LB: '--pos-lb', DL: '--pos-dl', DB: '--pos-db',
}

/** A position's colour as a CSS value. */
export const positionColor = (p: Position | undefined) => (p ? `var(${POSITION_VAR[p]})` : 'var(--text-3)')

/** Where Sleeper hosts headshots and team logos — the images the Sleeper app shows. */
export const sleeperHeadshot = (id: string) => `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`
export const sleeperTeamLogo = (code: string) => `https://sleepercdn.com/images/team_logos/nfl/${code === 'LA' ? 'lar' : code.toLowerCase()}.png`

/** A headshot, falling back to initials on the position colour; a defense shows its logo. */
export function PlayerAvatar({ sleeperID, name, position, size = 32 }: { sleeperID?: string; name?: string; position?: Position; size?: number }) {
  const [failed, setFailed] = useState(false)
  const url = !sleeperID || sleeperID === '0' ? undefined : position === 'DEF' ? sleeperTeamLogo(sleeperID) : sleeperHeadshot(sleeperID)
  const initials = name ? name.split(' ').slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() : (position ?? '?')
  const color = positionColor(position)
  return (
    <span className="avatar" aria-hidden style={{ width: size, height: size, background: `color-mix(in srgb, ${color} 22%, transparent)`, color, fontSize: size * 0.36 } as CSSProperties}>
      {url && !failed ? <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} /> : initials}
    </span>
  )
}

/** An NFL team logo. */
export function TeamLogo({ code, size = 20 }: { code?: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  if (!code || failed) return null
  return <img className="team-logo" src={sleeperTeamLogo(code)} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} />
}

/** "RB" in the position's colour. */
export function PositionChip({ position, label }: { position?: Position; label?: string }) {
  const color = positionColor(position)
  return (
    <span className="position-chip t-micro" style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}>
      {label ?? position ?? '?'}
    </span>
  )
}

/** A small labelled number. */
export function StatPill({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return <StatValue value={value} label={label} tint={tint} />
}

/** A player's name that opens their Player Card. */
export function PlayerName({ id, name, context, children }: { id: string; name?: string; context: LeagueContext; children?: ReactNode }) {
  const { openPlayerCard } = useApp()
  return (
    <button type="button" className="player-name" onClick={() => openPlayerCard(id, context)}>
      {children ?? name ?? context.playerName(id) ?? id}
    </button>
  )
}

/** A segmented control: one choice from a few, the selection sliding between them. */
export function SlidingPicker<T extends string>({ options, value, onChange, label, ariaLabel }: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  label: (v: T) => string
  ariaLabel: string
}) {
  return (
    <div className="sliding-picker" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={o === value} className={o === value ? 'on' : ''} onClick={() => onChange(o)}>
          {label(o)}
        </button>
      ))}
    </div>
  )
}
