/**
 * My Team's season pieces — a port of `MyTeam/SeasonSections.swift`
 * (`ResultsStrip`, `UpcomingOpponentsCard`, `ByeStripCard`), plus
 * `StartTradeCard` from PlanningView.swift, which the Season zoom shows.
 */
import { ChevronRight, WandSparkles } from 'lucide-react'
import { formatFixed } from '@core/numeric'
import type { ByeStripWeek, UpcomingOpponent, WeekOutcome, WeekResult } from '@models/team/MyTeamModel'
import { SectionHeader } from './SectionHeader'
import './team.css'

const outcomeColor = (o: WeekOutcome) => (o === 'W' ? 'var(--start)' : o === 'L' ? 'var(--sit)' : 'var(--text-2)')

/** A W/L chip per completed week. */
export function ResultsStrip({ results }: { results: WeekResult[] }) {
  return (
    <div className="card bt-stack-8">
      <SectionHeader title="Your season" subtitle="Every completed week, with the score." />
      <div className="bt-h-scroll bt-results-strip">
        {results.map((r) => (
          <div
            key={r.week}
            className="bt-result-chip"
            role="img"
            aria-label={`Week ${r.week}: ${r.outcome === 'W' ? 'won' : r.outcome === 'L' ? 'lost' : 'tied'} ${Math.trunc(r.myPoints)} to ${Math.trunc(r.opponentPoints)} against ${r.opponentManager}`}
          >
            <span className="t-micro muted" aria-hidden>W{r.week}</span>
            <span className="bt-result-letter" style={{ background: outcomeColor(r.outcome) }} aria-hidden>{r.outcome}</span>
            <span className="bt-t-micro-num muted" aria-hidden>{formatFixed(r.myPoints, 0)}–{formatFixed(r.opponentPoints, 0)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Shortfall({ who, count }: { who: string; count: number }) {
  const color = count === 0 ? 'var(--text-2)' : count >= 2 ? 'var(--sit)' : 'var(--caution)'
  return (
    <span className="t-meta" style={{ color, fontWeight: count === 0 ? 400 : 600 }}>
      {count === 0 ? `${who}: full lineup` : `${who}: ${count} short`}
    </span>
  )
}

/** The next few opponents, and whether byes hurt either side that week. */
export function UpcomingOpponentsCard({ upcoming }: { upcoming: UpcomingOpponent[] }) {
  return (
    <div className="card bt-stack-10">
      <SectionHeader title="Coming up" subtitle="Your next opponents, and who has a bye problem that week." />
      {upcoming.map((game) => (
        <div key={game.week} className="bt-upcoming-row">
          <span className="t-meta muted bt-num" style={{ fontWeight: 700, width: 30 }}>W{game.week}</span>
          <span className="bt-grow bt-stack-2">
            <span className="t-body bt-truncate" style={{ fontWeight: 600 }}>{game.manager}</span>
            {game.record && <span className="t-meta muted">{game.record}</span>}
          </span>
          <span className="bt-stack-2 bt-align-end">
            <Shortfall who="You" count={game.yourShortfall} />
            <Shortfall who="Them" count={game.theirShortfall} />
          </span>
        </div>
      ))}
    </div>
  )
}

const byeColor = (shortfall: number) =>
  shortfall === 0 ? 'color-mix(in srgb, var(--start) 35%, transparent)' : shortfall === 1 ? 'var(--caution)' : 'var(--sit)'

/**
 * The rest of your season at a glance: your shortfall each week, over how much
 * of the league is short too. Clicking opens Planning.
 */
export function ByeStripCard({ weeks, onOpen }: { weeks: ByeStripWeek[]; onOpen: () => void }) {
  const problemWeeks = weeks.filter((w) => w.yourShortfall > 0).length
  return (
    <button type="button" className="card bt-pressable bt-stack-10" onClick={onOpen}>
      <span className="bt-row-between">
        <SectionHeader
          inButton
          title="Bye weeks ahead"
          subtitle={problemWeeks === 0
            ? 'No problem weeks left.'
            : `${problemWeeks} week${problemWeeks === 1 ? '' : 's'} you can't field a full lineup.`}
        />
        <ChevronRight size={16} color="var(--text-3)" aria-hidden />
      </span>
      <span className="bt-h-scroll bt-bye-strip">
        {weeks.map((week) => (
          <span
            key={week.week}
            className="bt-bye-week"
            role="img"
            aria-label={`Week ${week.week}: ${week.yourShortfall === 0 ? 'full lineup' : `${week.yourShortfall} short`}, ${week.teamsShort} of ${week.teamCount} teams short`}
          >
            <span className="bt-bye-square" style={{ background: byeColor(week.yourShortfall) }} aria-hidden>
              {week.yourShortfall > 0 ? week.yourShortfall : ''}
            </span>
            <span className="bt-bye-share" aria-hidden>
              <span style={{ width: Math.max(2, (22 * week.teamsShort) / Math.max(1, week.teamCount)) }} />
            </span>
            <span className="bt-t-micro-num muted" aria-hidden>{week.week}</span>
          </span>
        ))}
      </span>
      <span className="bt-t-micro-num faint">Squares are your shortfall; the bar under each is how much of the league is short that week.</span>
    </button>
  )
}

/** The way into the trade wizard. */
export function StartTradeCard({ onStart }: { onStart: () => void }) {
  return (
    <button type="button" className="card bt-pressable bt-start-trade" onClick={onStart}>
      <span className="bt-start-trade-icon" aria-hidden><WandSparkles size={22} /></span>
      <span className="bt-grow bt-stack-2">
        <span className="t-section">Start a trade</span>
        <span className="t-meta muted">Pick a need, find who can fill it, build the deal, write the pitch.</span>
      </span>
      <ChevronRight size={16} color="var(--text-3)" aria-hidden />
    </button>
  )
}
