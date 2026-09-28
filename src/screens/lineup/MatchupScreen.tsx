/**
 * Matchup — "this week, both sides" (§7.2). The port of `MatchupView`.
 *
 * Head-to-head by default: both lineups paired slot by slot, so nobody has to
 * flip between teams to see who is winning where. You and Opponent show one
 * team in full detail. The phone swipes between the three; here the picker
 * switches them. The phone's slot sheet opens in place, under the slot.
 */
import { providerLabel } from '@data/LeagueDataSource'
import { useState, type CSSProperties } from 'react'
import { Clock, Lock, TriangleAlert, Users } from 'lucide-react'
import { formatFixed } from '@core/numeric'
import { relativeAge } from '@models/league/Freshness'
import type { LeagueContext } from '@models/league/LeagueContext'
import {
  averageTeamTotal, COMPARISON_BASIS_LABEL, defenseSummary, emptySlots, leftToPlay, MATCHUP_MODE_LABEL, MatchupModel,
  myShare, rowHasProductionData, rowIsEmptySlot, rowIsLive, rowIsLocked, startersOnBye,
  type MatchupRow, type MatchupSide, type PairedSlot, type SeasonLine, type SlotLeader,
} from '@models/lineup/MatchupModel'
import { useApp, useModel } from '@ui/app/AppContext'
import { AboutThisData } from '@ui/components/Screen'
import { PlayerName, PositionChip, SlidingPicker } from '@ui/components/Player'
import { CoverageNote, FreshnessBanner, InlineErrorBanner, LoadingPlaceholder } from '@ui/components/State'
import { LineupHubHeader } from './LineupHubHeader'
import { kickoffTime, LiveBadge, LiveDot } from './LiveIndicators'
import { LoadFailure, RefreshButton, useLeagueNow } from './shared'
import './lineup.css'

const HUE = 'var(--hue-lineup)'
const one = (v: number) => formatFixed(v, 1)

export function MatchupScreen() {
  const { services } = useApp()
  const model = useModel(services.matchup)
  const context = model.context
  const refresh = () => { void model.refresh() }

  // The lineups are built after the league context arrives; until they land,
  // show the placeholder rather than an empty layout that reads as broken.
  const ready = context !== undefined && (model.mySide !== undefined || !model.isLoading)

  return (
    <>
      <LineupHubHeader current="matchup" />
      {ready && context ? (
        <>
          <div className="lineup-stack" style={{ gap: 10 }}>
            <Scoreboard model={model} onRefresh={refresh} />
            <SlidingPicker
              options={model.availableModes}
              value={model.mode}
              onChange={(mode) => { model.mode = mode }}
              label={(mode) => MATCHUP_MODE_LABEL[mode]}
              ariaLabel="Matchup view"
            />
          </div>
          <div className="lineup-stack" style={{ gap: 14 }}>
            {model.errorMessage && <InlineErrorBanner message={model.errorMessage} />}
            {model.noOpponentReason && <CoverageNote text={model.noOpponentReason} />}
            {model.mode === 'headToHead' && <HeadToHead model={model} context={context} />}
            {model.mode === 'mine' && model.mySide && <Individual side={model.mySide} context={context} />}
            {model.mode === 'opponent' && model.opponentSide && <Individual side={model.opponentSide} context={context} />}
          </div>
          <AboutThisData>
            <FreshnessBanner provenance={context.provenance} />
            {context.statsSeasonNote && <CoverageNote text={context.statsSeasonNote} />}
            <CoverageNote text={MatchupModel.linesNote} />
            <CoverageNote text={MatchupModel.defenseNote} />
          </AboutThisData>
        </>
      ) : model.isLoading || model.errorMessage === undefined ? (
        <LoadingPlaceholder label="Loading matchup…" />
      ) : (
        <LoadFailure title="Could not load the matchup" message={model.errorMessage} onRetry={refresh} />
      )}
    </>
  )
}

// MARK: - Scoreboard

function Scoreboard({ model, onRefresh }: { model: MatchupModel; onRefresh: () => void }) {
  const mine = model.mySide
  if (!mine) return null
  const opponent = model.opponentSide
  return (
    <section className="hero scoreboard" style={{ '--hue': HUE } as CSSProperties} aria-label="Scoreboard">
      <div className="scoreboard-overline t-micro">
        <Users size={14} strokeWidth={2.5} aria-hidden />
        <span>{model.week !== undefined ? `Lineup · Matchup · Week ${model.week}` : 'Lineup · Matchup'}</span>
        <span style={{ flex: 1 }} />
        {model.anyGameLive && <LiveBadge />}
        <RefreshButton onRefresh={onRefresh} busy={model.isLoading} />
      </div>
      <div className="scoreboard-teams">
        <TeamScore side={mine} trailing={false} />
        <span className="vs">vs</span>
        {opponent ? (
          <TeamScore side={opponent} trailing />
        ) : (
          <span className="t-body muted" style={{ flex: 1, textAlign: 'right' }}>No opponent</span>
        )}
      </div>
      {opponent && <ScoreShareBar mine={mine.livePoints ?? 0} theirs={opponent.livePoints ?? 0} />}
    </section>
  )
}

function TeamScore({ side, trailing }: { side: MatchupSide; trailing: boolean }) {
  const left = leftToPlay(side)
  const average = averageTeamTotal(side.environment)
  return (
    <div className={`team-score${trailing ? ' trailing' : ''}`}>
      <span className="manager">{side.manager}</span>
      <span className="t-display">{side.livePoints === undefined ? '—' : one(side.livePoints)}</span>
      <span className="t-meta" style={{ fontWeight: 600, color: left > 0 ? 'var(--text)' : 'var(--text-2)' }}>{`${left} left to play`}</span>
      {average !== undefined && <span className="t-micro muted" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>{`teams avg ${one(average)} pts`}</span>}
    </div>
  )
}

/** Whole-matchup share of points. */
function ScoreShareBar({ mine, theirs }: { mine: number; theirs: number }) {
  const total = Math.max(mine, 0) + Math.max(theirs, 0)
  const share = total > 0 ? Math.max(mine, 0) / total : 0.5
  return (
    <div className="score-share" aria-hidden>
      <span className="score-share-fill" style={{ flexBasis: `${share * 100}%` }} />
      <span className="score-share-rest" />
    </div>
  )
}

// MARK: - Head-to-head

function HeadToHead({ model, context }: { model: MatchupModel; context: LeagueContext }) {
  const now = useLeagueNow(context, 15_000)
  const [open, setOpen] = useState<number>()
  const hasOpponent = model.opponentSide !== undefined
  const ahead = model.pairedSlots.filter((p) => p.leader === 'mine').length
  return (
    <div className="lineup-stack" style={{ gap: 'var(--space-s)' }}>
      <div className="h2h-head">
        <div>
          <div className="t-meta muted">{COMPARISON_BASIS_LABEL[model.comparisonBasis]}</div>
          {model.lastLiveUpdate !== undefined && (
            <div className="t-meta tertiary" style={{ fontSize: '0.6875rem' }}>{`Updated ${relativeAge((now - model.lastLiveUpdate) / 1000)}`}</div>
          )}
        </div>
        {hasOpponent && (
          <span className="t-meta muted" style={{ fontWeight: 600 }}>{`Ahead in ${ahead} of ${model.pairedSlots.length}`}</span>
        )}
      </div>
      {model.pairedSlots.map((pair) => {
        const expanded = open === pair.index
        return (
          <div key={pair.index} className="card pair">
            <button
              type="button"
              className="pair-button"
              aria-expanded={expanded}
              aria-controls={`matchup-slot-${pair.index}`}
              onClick={() => setOpen(expanded ? undefined : pair.index)}
            >
              <PairedSlotRow pair={pair} hasOpponent={hasOpponent} provider={providerLabel(context.provider)} />
            </button>
            {expanded && (
              <div id={`matchup-slot-${pair.index}`} className="pair-detail">
                <SlotDetailPlayer row={pair.mine} manager={model.mySide?.manager ?? 'You'} context={context} />
                {model.opponentSide && (
                  <SlotDetailPlayer row={pair.theirs} manager={model.opponentSide.manager ?? 'Opponent'} context={context} />
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Both players in one slot, with a bar showing who is ahead. */
function PairedSlotRow({ pair, hasOpponent, provider = 'Sleeper' }: { pair: PairedSlot; hasOpponent: boolean; provider?: string }) {
  return (
    <>
      <span className="pair-line">
        <PairSide row={pair.mine} value={pair.myValue} trailing={false} leading={pair.leader === 'mine'} provider={provider} />
        <span className="pair-slot">{pair.slot}</span>
        {hasOpponent
          ? <PairSide row={pair.theirs} value={pair.theirValue} trailing leading={pair.leader === 'theirs'} provider={provider} />
          : <span style={{ flex: 1 }} />}
      </span>
      {hasOpponent && <SlotShareBar share={myShare(pair)} leader={pair.leader} />}
    </>
  )
}

function PairSide({ row, value, trailing, leading, provider = 'Sleeper' }: { row?: MatchupRow; value?: number; trailing: boolean; leading: boolean; provider?: string }) {
  if (!row || rowIsEmptySlot(row)) {
    return (
      <span className={`pair-side${trailing ? ' trailing' : ''}`}>
        <span className="t-body" style={{ color: 'var(--caution)' }}>Empty</span>
        <span className="t-meta muted" style={{ fontSize: '0.6875rem' }}>set on {provider}</span>
      </span>
    )
  }
  const valueText = <PairValue value={value} leading={leading} row={row} />
  return (
    <span className={`pair-side${trailing ? ' trailing' : ''}`}>
      <span className="pair-name-line">
        {trailing && valueText}
        <span className={`pair-name${leading ? ' leading' : ''}`}>{row.name ?? 'Unknown'}</span>
        {!trailing && valueText}
      </span>
      <span className="pair-sub" style={{ color: row.onBye ? 'var(--sit)' : 'var(--text-2)' }}>
        {rowIsLive(row) ? <LiveDot size={5} /> : rowIsLocked(row) ? <Lock size={8} role="img" aria-label="Locked" /> : null}
        <span>{pairSubtitle(row)}</span>
      </span>
    </span>
  )
}

function PairValue({ value, leading, row }: { value?: number; leading: boolean; row: MatchupRow }) {
  if (value !== undefined) {
    return <span className="pair-value" style={{ color: leading ? 'var(--accent)' : 'var(--text-2)' }}>{one(value)}</span>
  }
  if (row.kickoff !== undefined && !rowIsLocked(row)) {
    // Not played yet: say when, rather than a dash that reads as missing.
    return <span className="pair-kickoff"><Clock size={10} aria-hidden />{kickoffTime(row.kickoff)}</span>
  }
  return <span className="pair-value muted">–</span>
}

function pairSubtitle(row: MatchupRow): string {
  if (row.onBye) return `${row.nflTeam ?? ''} bye`
  const position = row.position ?? ''
  if (row.opponent === undefined) return position
  return `${position} ${row.isHome === true ? 'vs' : '@'} ${row.opponent}`
}

/** Split bar for one slot: my share on the left in the accent colour. */
function SlotShareBar({ share, leader }: { share?: number; leader: SlotLeader }) {
  return (
    <span className="slot-share" aria-hidden>
      {share !== undefined && (
        <span className="share-fill" style={{ width: `${share * 100}%`, opacity: leader === 'theirs' ? 0.45 : 0.9 }} />
      )}
    </span>
  )
}

/** One side of a slot, in full — the phone's `SlotDetailSheet`. */
function SlotDetailPlayer({ row, manager, context }: { row?: MatchupRow; manager: string; context: LeagueContext }) {
  return (
    <div className="detail-card">
      <div className="pair-detail-head">
        <span className="t-micro muted">{manager.toUpperCase()}</span>
        {row?.livePoints !== undefined && <span className="t-meta" style={{ fontWeight: 600 }}>{`${one(row.livePoints)} pts`}</span>}
      </div>
      {row && !rowIsEmptySlot(row)
        ? <PlayerDetail row={row} context={context} />
        : <span className="t-body" style={{ color: 'var(--caution)' }}>Empty — set this slot on {providerLabel(context.provider)}</span>}
    </div>
  )
}

// MARK: - Individual

function Individual({ side, context }: { side: MatchupSide; context: LeagueContext }) {
  const empty = emptySlots(side)
  const bye = startersOnBye(side)
  const missing = side.environment.missingTeams
  const problems = [
    empty > 0 ? `${empty} empty slot${empty === 1 ? '' : 's'}` : undefined,
    bye > 0 ? `${bye} starter${bye === 1 ? '' : 's'} on bye` : undefined,
    missing.length === 0 ? undefined : `no line for ${missing.join(', ')}`,
  ].filter((p): p is string => p !== undefined)

  return (
    <div className="lineup-stack" style={{ gap: 10 }}>
      {problems.length > 0 && (
        <div className="side-problems">
          <TriangleAlert size={14} aria-hidden /> <span>{problems.join(' · ')}</span>
        </div>
      )}
      {side.rows.map((row) => (
        <div key={row.index} className="card matchup-row">
          <span className="slot-token">{row.slot}</span>
          {rowIsEmptySlot(row) ? (
            <span className="t-body" style={{ flex: 1, color: 'var(--caution)' }}>Empty — set this slot on {providerLabel(context.provider)}</span>
          ) : (
            <>
              <div style={{ flex: 1, minWidth: 0 }}><PlayerDetail row={row} context={context} /></div>
              <span className="points">{row.livePoints === undefined ? '—' : one(row.livePoints)}</span>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

/** Everything known about one player this week. */
function PlayerDetail({ row, context }: { row: MatchupRow; context: LeagueContext }) {
  const summary = defenseSummary(row)
  const delta = row.defense?.vsLeagueAverage
  const defenseColour = delta === undefined ? 'var(--text-2)' : delta >= 0 ? 'var(--start)' : 'var(--sit)'
  return (
    <div className="player-detail">
      <div className="player-detail-head">
        <span className="t-body">
          {row.playerID !== undefined
            ? <PlayerName id={row.playerID} name={row.name ?? 'Unknown'} context={context} />
            : (row.name ?? 'Unknown')}
        </span>
        <PositionChip position={row.position} />
        {rowIsLive(row) ? <LiveDot /> : rowIsLocked(row) ? <Lock size={11} className="muted" role="img" aria-label="Locked" /> : null}
      </div>
      <span className="t-meta" style={{ color: row.onBye ? 'var(--sit)' : 'var(--text-2)' }}>{gameLine(row)}</span>
      {row.projected !== undefined && (
        <span className="t-meta" style={{ fontWeight: 600, color: 'var(--accent)' }}>{`proj ${one(row.projected)} this week`}</span>
      )}
      {row.thisSeason && <span className="t-meta muted">{thisSeasonText(row.thisSeason)}</span>}
      {row.season ? (
        <span className="t-meta muted">{seasonText(row.season)}</span>
      ) : row.thisSeason === undefined && !rowHasProductionData(row) ? (
        <span className="t-meta tertiary">{`No production data for ${row.position ?? 'this position'}`}</span>
      ) : row.thisSeason === undefined ? (
        <span className="t-meta tertiary">No season line</span>
      ) : null}
      {summary && <span className="t-meta" style={{ color: defenseColour }}>{summary}</span>}
    </div>
  )
}

function gameLine(row: MatchupRow): string {
  if (row.onBye) return `${row.nflTeam ?? ''} on bye — scores 0`
  if (row.opponent === undefined) return row.nflTeam ?? ''
  const venue = row.isHome === true ? 'vs' : '@'
  const implied = row.impliedTotal === undefined ? '' : ` · team total ${one(row.impliedTotal)}`
  return `${row.nflTeam ?? ''} ${venue} ${row.opponent}${implied}`
}

function thisSeasonText(line: SeasonLine): string {
  const parts = [`this season ${one(line.pointsPerGame)}/gm`]
  if (line.formPointsPerGame !== undefined && line.games > 4) parts.push(`last 4 ${one(line.formPointsPerGame)}`)
  parts.push(`${line.games} gm · Sleeper`)
  return parts.join(' · ')
}

function seasonText(season: SeasonLine): string {
  const parts = [`${one(season.pointsPerGame)}/gm`]
  if (season.formPointsPerGame !== undefined) parts.push(`last 4 ${one(season.formPointsPerGame)}`)
  if (season.floor !== undefined && season.ceiling !== undefined) parts.push(`${one(season.floor)}–${one(season.ceiling)}`)
  parts.push(`${season.games} gm`)
  return parts.join(' · ')
}
