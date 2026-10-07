/**
 * The Lineup tab's header — the port of `LineupHubHeader.swift`: its four
 * sections (Sit/Start, Decide, Matchup, Injuries) as status cards that are also the
 * section switcher, so each section's state is visible from the others.
 * `lineupBadgeCount` is `LineupTabBadge.count`, for whoever draws the tab badge.
 */
import type { LucideIcon } from 'lucide-react'
import { ArrowLeftRight, BriefcaseMedical, Scale, Users } from 'lucide-react'
import { formatNumber } from '@core/numeric'
import { kickoffLabel } from '@models/league/GameDayWindow'
import { blocksStart, startAvailability } from '@models/league/LeagueContext'
import type { InjuryCenterModel } from '@models/market/InjuryCenterModel'
import { slotIsCloseCall } from '@models/lineup/DecideModel'
import { hasLiveGame, type MatchupModel } from '@models/lineup/MatchupModel'
import type { SitStartModel } from '@models/lineup/SitStartModel'
import type { Screen } from '@models/navigation/screens'
import { useApp, useModel } from '@ui/app/AppContext'
import { LiveDot } from './LiveIndicators'
import './lineup.css'

// MARK: - What each card says (Swift `LineupStatus`)

export type LineupTone = 'good' | 'caution' | 'bad' | 'neutral'

export interface LineupStatusCard {
  text: string
  tone: LineupTone
  isLive?: boolean
}

export function sitStartStatus(swaps: number): LineupStatusCard {
  return swaps === 0 ? { text: 'Lineup set', tone: 'good' } : { text: `${swaps} swap${swaps === 1 ? '' : 's'}`, tone: 'caution' }
}

export function decideStatus(closeCalls: number): LineupStatusCard {
  return closeCalls === 0 ? { text: 'All clear', tone: 'good' } : { text: `${closeCalls} close`, tone: 'caution' }
}

export function matchupStatus(mine: number | undefined, theirs: number | undefined, live: boolean, nextKickoff: number | undefined): LineupStatusCard {
  if (mine !== undefined && theirs !== undefined && (mine + theirs > 0 || live)) {
    const tone: LineupTone = mine > theirs ? 'good' : mine < theirs ? 'bad' : 'neutral'
    return { text: `${formatNumber(mine, 1)}–${formatNumber(theirs, 1)}`, tone, isLive: live }
  }
  if (nextKickoff !== undefined) return { text: kickoffLabel(nextKickoff), tone: 'neutral' }
  return { text: 'This week', tone: 'neutral' }
}

export function injuriesStatus(out: number, questionable: number): LineupStatusCard {
  if (out > 0) return { text: `${out} out`, tone: 'bad' }
  if (questionable > 0) return { text: `${questionable} Q`, tone: 'caution' }
  return { text: 'All clear', tone: 'good' }
}

function matchupCard(matchup: MatchupModel): LineupStatusCard {
  const mine = matchup.mySide, theirs = matchup.opponentSide
  const now = matchup.context?.now() ?? Date.now()
  const upcoming = (mine?.rows ?? []).map((r) => r.kickoff).filter((k): k is number => k !== undefined && k > now)
  const next = upcoming.length > 0 ? Math.min(...upcoming) : undefined
  const live = (mine ? hasLiveGame(mine) : false) || (theirs ? hasLiveGame(theirs) : false)
  return matchupStatus(mine?.livePoints, theirs?.livePoints, live, next)
}

function injuryCard(injuries: InjuryCenterModel): LineupStatusCard {
  const context = injuries.context
  if (!context) return { text: '…', tone: 'neutral' }
  const starters = injuries.roster.filter((p) => p.isStarter)
  const out = starters.filter((p) => blocksStart(startAvailability(p.id, context))).length
  const q = starters.filter((p) => startAvailability(p.id, context).kind === 'questionable').length
  return injuriesStatus(out, q)
}

/** `LineupTabBadge`: starters the recommended lineup would change, plus starters injury rules out. */
export function lineupBadgeCount(sitStart: SitStartModel, injuries: InjuryCenterModel): number {
  const context = injuries.context
  const blocked = context
    ? injuries.roster.filter((p) => p.isStarter && blocksStart(startAvailability(p.id, context))).length
    : 0
  return sitStart.starts.length + blocked
}

// MARK: - The header

const toneColor: Record<LineupTone, string> = {
  good: 'var(--start)', caution: 'var(--caution)', bad: 'var(--sit)', neutral: 'var(--text)',
}

export function LineupHubHeader({ current }: { current: Screen }) {
  const { services, openScreen } = useApp()
  const sitStart = useModel(services.sitStart)
  const matchup = useModel(services.matchup)
  const injuries = useModel(services.injuries)
  // Decide is derived from Sit/Start, Matchup and the Waiver Board; Sit/Start and Matchup are observed above.
  useModel(services.waivers)
  const closeCalls = services.decide.slots().filter(slotIsCloseCall).length

  return (
    <nav className="lineup-hub" aria-label="Lineup sections">
      <HubCard screen="sitStart" current={current} title="Sit/Start" icon={ArrowLeftRight}
        status={sitStartStatus(sitStart.starts.length)} open={openScreen} />
      <HubCard screen="decide" current={current} title="Decide" icon={Scale}
        status={decideStatus(closeCalls)} open={openScreen} />
      <HubCard screen="matchup" current={current} title="Matchup" icon={Users}
        status={matchupCard(matchup)} open={openScreen} />
      <HubCard screen="injuries" current={current} title="Injuries" icon={BriefcaseMedical}
        status={injuryCard(injuries)} open={openScreen} />
    </nav>
  )
}

function HubCard(props: {
  screen: Screen
  current: Screen
  title: string
  icon: LucideIcon
  status: LineupStatusCard
  open: (screen: Screen) => void
}) {
  const { screen, current, title, icon: Icon, status, open } = props
  const selected = screen === current
  return (
    <button
      type="button"
      className={`lineup-hub-card${selected ? ' selected' : ''}`}
      aria-current={selected ? 'page' : undefined}
      onClick={() => open(screen)}
    >
      <span className="lineup-hub-title">
        <Icon size={12} strokeWidth={2.5} aria-hidden />
        <span className="lineup-hub-name">{title}</span>
        {status.isLive && <LiveDot size={6} />}
      </span>
      <span className="lineup-hub-status" style={{ color: toneColor[status.tone] }}>{status.text}</span>
    </button>
  )
}
