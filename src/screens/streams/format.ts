/**
 * Formatting and the small shared pieces every stream screen uses — ports of
 * `StreamFormat`, `PanelFormat.signed`, `StreamROSPills`, `pointsRows` and
 * the `StreamSourceBadge` label from FCApp's Stream views.
 */
import { formatNumber } from '@core/numeric'
import type { StreamROS, StreamROSProjection, StreamStatPoints } from '@core/Stream'
import { STREAM_CONTEXT_SOURCE_LABEL, type StreamContextSource } from '@models/streams/StreamKind'
import type { StreamCompareRow, StreamCompareSection, StreamPill } from './spec'

/** Swift's `x.rounded()`: halves away from zero. */
const roundAway = (x: number) => Math.sign(x) * Math.round(Math.abs(x))

export const StreamFormat = {
  one: (x: number) => formatNumber(x, 1),
  two: (x: number) => formatNumber(x, 2),
  three: (x: number) => formatNumber(x, 3),
  whole: (x: number) => `${roundAway(x) || 0}`,
  pct: (x: number) => `${roundAway(x * 100) || 0}%`,
  signed: (x: number, places = 1) => (x > 0 ? '+' : '') + formatNumber(x, places),
  /** Last name, without a generational suffix. */
  shortName(name: string): string {
    const parts = name.split(' ').filter((p) => p.length > 0 && !['Jr.', 'Sr.', 'II', 'III', 'IV'].includes(p))
    return parts[parts.length - 1] ?? name
  },
}

/** `PanelFormat.signed`: a plus on zero too. */
export const panelSigned = (x: number) => (x >= 0 ? '+' : '') + formatNumber(x, 1)

/** `x.formatted(.number.precision(.fractionLength(0...2)))`. */
export const num = (x: number) => formatNumber(x, 0, 2)

/** The rest-of-season pills every horizon stream adds to its rows. */
export function rosPills(ros: StreamROS): StreamPill[] {
  const out: StreamPill[] = [{ label: 'rest of season /g', value: StreamFormat.one(ros.perGame) }]
  out.push({ label: 'games left', value: `${ros.games}` })
  if (ros.byeWeek !== undefined) out.push({ label: 'bye', value: `W${ros.byeWeek}` })
  if (ros.playoffGames > 0) {
    out.push({
      label: 'playoff matchups',
      value: StreamFormat.signed(ros.playoffAvgDvp, 0) + '%',
      tint: ros.playoffAvgDvp >= 5 ? 'var(--start)' : ros.playoffAvgDvp <= -5 ? 'var(--sit)' : undefined,
    })
  }
  return out
}

const signedPct = (x: number) => StreamFormat.signed(x, 0) + '%'

/** The "Rest of season" compare section for QB, D/ST and K. */
export function rosCompareSection(players: readonly StreamROSProjection[]): StreamCompareSection {
  return {
    title: 'Rest of season',
    rows: [
      metric('Per game', players.map((p) => p.ros.perGame)),
      metric('Games left', players.map((p) => p.ros.games), StreamFormat.whole),
      metric('Avg matchup %', players.map((p) => p.ros.avgDvp), signedPct),
      metric('Playoff matchup %', players.map((p) => p.ros.playoffAvgDvp), signedPct),
      text('Bye', players.map((p) => (p.ros.byeWeek !== undefined ? `W${p.ros.byeWeek}` : '–'))),
      text('Softest ahead', players.map((p) => p.ros.easiest.slice(0, 2).join(', '))),
      text('Toughest ahead', players.map((p) => p.ros.hardest.slice(0, 2).join(', '))),
    ],
  }
}

/** One metric row per stat any compared player scores, in first-seen order. */
export function pointsRows(breakdowns: readonly (readonly StreamStatPoints[])[]): StreamCompareRow[] {
  const stats: string[] = []
  for (const breakdown of breakdowns) for (const part of breakdown) if (!stats.includes(part.stat)) stats.push(part.stat)
  return stats.map((stat) => metric(stat, breakdowns.map((b) => b.find((x) => x.stat === stat)?.points ?? 0)))
}

export const metric = (label: string, values: number[], format: (x: number) => string = StreamFormat.one): StreamCompareRow =>
  ({ kind: 'metric', label, values, format })
export const text = (label: string, values: string[]): StreamCompareRow => ({ kind: 'text', label, values })

/** "Auto", "No line" or who edited it — the badge on a context row. */
export function sourceBadge(sources: readonly StreamContextSource[]): { label: string; edited: boolean } {
  const edited = sources.find((s) => s === 'manual' || s === 'imported')
  const label = edited !== undefined ? STREAM_CONTEXT_SOURCE_LABEL[edited] : sources[0] === 'standard' ? 'No line' : 'Auto'
  return { label, edited: edited !== undefined }
}

/** "Wk 3 v IND" — the start of every recent-game detail. */
export const weekLabel = (g: { week: number; opponent?: string }) => `Wk ${g.week}` + (g.opponent !== undefined ? ` v ${g.opponent}` : '')

const dateTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })
const fullDateTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'short' })
const timeOnly = new Intl.DateTimeFormat('en-US', { timeStyle: 'short' })

/** `.formatted(date: .abbreviated, time: .shortened)`. */
export const formatDateTime = (ms: number) => dateTime.format(new Date(ms))
/** `.formatted(date: .complete, time: .shortened)`. */
export const formatFullDateTime = (ms: number) => fullDateTime.format(new Date(ms))
/** `.formatted(date: .omitted, time: .shortened)`. */
export const formatTime = (ms: number) => timeOnly.format(new Date(ms))
