/**
 * The top of My Team — a port of `MyTeam/TeamHeroHeader.swift`: your team,
 * where it stands, who's in the lineup, and the three sources the app draws
 * on, each saying how fresh it is.
 */
import { useState, type CSSProperties } from 'react'
import { ArrowDownRight, ArrowUpRight, Newspaper, SquareUser, TrendingUp, UsersRound, type LucideIcon } from 'lucide-react'
import { formatFixed } from '@core/numeric'
import { weekLines } from '@core/Schedule'
import { provenanceAge } from '@data/fetched'
import { EMPTY_STARTER_SLOT } from '@data/sleeperModels'
import { freshnessExplanation, freshnessLabel, isDegraded, relativeAge } from '@models/league/Freshness'
import type { LeagueContext } from '@models/league/LeagueContext'
import { standingsRecord, type DashboardModel } from '@models/team/DashboardModel'
import { PlayerAvatar } from '@ui/components/Player'
import { LiveBadge } from '../board/LiveIndicators'
import { ordinal } from '../board/format'
import './team.css'

type Pillar = 'Vegas' | 'News' | 'Sleeper'
const PILLARS: readonly Pillar[] = ['Vegas', 'News', 'Sleeper']
const pillarIcon: Record<Pillar, LucideIcon> = { Vegas: TrendingUp, News: Newspaper, Sleeper: UsersRound }

export function TeamHeroHeader({ model, context }: { model: DashboardModel; context: LeagueContext }) {
  const [explained, setExplained] = useState<Pillar>()
  const tint = 'var(--hue-team)'
  const mine = model.standings.find((r) => r.isUser)
  const starterIDs = (context.userTeam?.rawStarters ?? []).filter((id) => id !== EMPTY_STARTER_SLOT)

  const chipText = (pillar: Pillar): string => {
    switch (pillar) {
      case 'Vegas': {
        const lines = Object.values(weekLines(context.schedule, context.currentWeek)).filter((l) => l.impliedTotal !== undefined)
        return lines.length === 0 ? 'No lines' : `Lines wk ${context.currentWeek}`
      }
      case 'News':
        return model.hasRelay ? 'Relay on' : 'Not connected'
      case 'Sleeper': {
        const p = context.sleeperProvenance
        if (p.kind === 'live') return 'Synced'
        if (p.kind === 'staleCache') return 'Offline'
        const age = provenanceAge(p)
        return age === undefined ? 'Synced' : relativeAge(age).replace(' ago', '')
      }
    }
  }

  const chipColor = (pillar: Pillar): string => {
    switch (pillar) {
      case 'Sleeper': return isDegraded(context.sleeperProvenance) ? 'var(--caution)' : 'var(--text)'
      case 'News': return model.hasRelay ? 'var(--text)' : 'var(--text-2)'
      case 'Vegas': return 'var(--text)'
    }
  }

  const explanation = (pillar: Pillar): string => {
    switch (pillar) {
      case 'Vegas': {
        const label = freshnessLabel(context.staticProvenance)
        const source = label ? ` (${label.toLowerCase()})` : ''
        return `Implied team totals from Vegas's recorded closing lines in the schedule file${source} — not live odds.`
      }
      case 'News':
        return model.hasRelay
          ? 'News comes through your relay. Team briefings written on your own machine appear here.'
          : 'Connect your relay in Settings to get news and team briefings written on your own machine.'
      case 'Sleeper':
        return (freshnessExplanation(context.sleeperProvenance) ?? 'Live from Sleeper just now.')
          + ' Your league, rosters, lineup and injury tags come straight from Sleeper.'
    }
  }

  const streakWin = model.streak?.startsWith('W') ?? false
  const streakColor = streakWin ? 'var(--start)' : 'var(--sit)'

  return (
    <section className="hero bt-team-hero" style={{ '--hue': tint } as CSSProperties} aria-label="Your team">
      <div className="bt-team-hero-top">
        <div className="bt-stack-2 bt-grow" style={{ minWidth: 0 }}>
          <div className="hero-overline t-micro bt-truncate">
            <SquareUser size={14} strokeWidth={2.5} aria-hidden />
            <span className="bt-truncate">Team · {context.userTeam?.manager ?? 'My Team'}</span>
          </div>
          <div className="bt-team-hero-record">
            {mine && <span className="t-display">{standingsRecord(mine)}</span>}
            {model.place && (
              <span className="t-section" style={{ color: tint }}>{ordinal(model.place.rank)} of {model.place.of}</span>
            )}
            {model.streak && (
              <span className="bt-streak t-meta" style={{ color: streakColor, background: `color-mix(in srgb, ${streakColor} 14%, transparent)` }}>
                {streakWin ? <ArrowUpRight size={12} aria-hidden /> : <ArrowDownRight size={12} aria-hidden />}
                {model.streak}
              </span>
            )}
          </div>
        </div>
        <div className="bt-stack-4 bt-align-end">
          <div className="bt-row-6">
            <span className="t-micro muted">Week {context.currentWeek}</span>
            {starterIDs.some((id) => context.isLive(id)) && <LiveBadge />}
          </div>
          {mine && <span className="t-meta muted bt-num">{formatFixed(mine.pointsFor, 1)} pts for</span>}
        </div>
      </div>

      <div className="bt-starter-strip" role="img" aria-label={`${starterIDs.length} starters`}>
        {starterIDs.slice(0, 11).map((id) => (
          <span key={id} className="bt-starter-avatar" aria-hidden>
            <PlayerAvatar sleeperID={id} name={context.playerName(id)} position={context.position(id)} size={34} />
            {context.isLive(id) && <span className="bt-starter-live" />}
          </span>
        ))}
      </div>

      <div className="bt-pillars">
        {PILLARS.map((pillar) => {
          const Icon = pillarIcon[pillar]
          const on = explained === pillar
          return (
            <button
              key={pillar}
              type="button"
              className={`bt-pillar bt-t-micro-num${on ? ' bt-on' : ''}`}
              style={{ color: chipColor(pillar) }}
              aria-pressed={on}
              aria-label={`${pillar}: ${chipText(pillar)}`}
              onClick={() => setExplained(on ? undefined : pillar)}
            >
              <Icon size={12} aria-hidden />
              <span className="bt-truncate">{chipText(pillar)}</span>
            </button>
          )
        })}
      </div>
      {explained && <p className="t-meta muted bt-pillar-explanation">{explanation(explained)}</p>}
    </section>
  )
}

