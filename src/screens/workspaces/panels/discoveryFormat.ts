/**
 * Pure helpers for the Discovery panels — the private functions of FCApp
 * `DiscoveryPanels.swift`, plus `WaiverTargetsPanel.badge` (MarketPanels.swift)
 * and the relative date Swift's `.relative(presentation: .named)` gives.
 */
import { formatNumber } from '@core/numeric'
import { PRACTICE_PHRASE } from '@core/InSeasonFiles'
import { heightLabel, type IndexedPlayer } from '@data/playerIndex'
import { UNAVAILABLE_TAGS } from '@models/league/LeagueContext'
import {
  discoverySortLabel, type DiscoverySort,
} from '@models/market/DiscoveryModel'
import { PlayerSchedule, type PlayerSchedule as Schedule } from '@models/market/PlayerSchedule'
import { waiverRowValue, waiverSortIsPercent, type WaiverRow, type WaiverSort } from '@models/market/WaiverBoardModel'
import type { PlayerStatus } from '@models/player/PlayerCardModel'
import { defenseSourceLabel } from '@models/player/DefenseLookup'

const points = (v: number | undefined) => (v === undefined ? '—' : formatNumber(v, 1))
const signed = (v: number) => (v >= 0 ? '+' : '') + formatNumber(v, 1)

/** `WaiverTargetsPanel.badge`: "Q" for questionable, the short label for the tags that block a start. */
export function waiverBadge(tag: string | undefined): string | undefined {
  if (tag === undefined) return undefined
  const upper = tag.toUpperCase()
  if (upper === 'QUESTIONABLE') return 'Q'
  if (upper === '') return undefined
  return Object.hasOwn(UNAVAILABLE_TAGS, upper) ? UNAVAILABLE_TAGS[upper] : undefined
}

/** A Discovery cell under a column sort. */
export function formatDiscoveryValue(value: number | undefined, column: WaiverSort): string {
  if (value === undefined) return '—'
  if (waiverSortIsPercent(column)) return `${Math.round(value * 100)}%`
  if (column === 'trending') return `${Math.trunc(value)}`
  if (column === 'projectedOverLine') return signed(value)
  return points(value)
}

/** "25 of 180 shown · 12 without this number · ranked by projected this week." */
export function discoveryFootnote(shown: number, all: readonly WaiverRow[], sort: DiscoverySort, canCompare: boolean): string {
  const parts = [`${shown} of ${all.length} shown`]
  if (sort.kind === 'column') {
    const blank = all.filter((r) => waiverRowValue(r, sort.column) === undefined).length
    if (blank > 0) parts.push(`${blank} without this number`)
  }
  parts.push(`ranked by ${discoverySortLabel(sort).toLowerCase()}`)
  if (canCompare) parts.push('⌘-click to compare')
  return parts.join(' · ') + '.'
}

export function ordinal(n: number): string {
  const ones = n % 10, tens = n % 100
  const suffix = ones === 1 && tens !== 11 ? 'st' : ones === 2 && tens !== 12 ? 'nd' : ones === 3 && tens !== 13 ? 'rd' : 'th'
  return `${n}${suffix}`
}

/** "Age 27 · 5th yr · Ohio State · 6'1" · 215 lb · #11". */
export function bioLine(player: IndexedPlayer | undefined): string | undefined {
  if (!player) return undefined
  const parts: string[] = []
  if (player.age !== undefined) parts.push(`Age ${player.age}`)
  if (player.yearsExperience !== undefined) parts.push(player.yearsExperience === 0 ? 'Rookie' : `${ordinal(player.yearsExperience + 1)} yr`)
  if (player.college !== undefined) parts.push(player.college)
  const height = heightLabel(player)
  if (height !== undefined) parts.push(height)
  if (player.weightPounds !== undefined) parts.push(`${player.weightPounds} lb`)
  if (player.jerseyNumber !== undefined) parts.push(`#${player.jerseyNumber}`)
  return parts.length === 0 ? undefined : parts.join(' · ')
}

/** The Profile panel's injury line — "None" when nothing's reported. */
export function profileInjuryText(status: PlayerStatus): string {
  const parts: string[] = []
  if (status.report?.designation !== undefined) parts.push(status.report.designation)
  else if (status.sleeperTag !== undefined) parts.push(status.sleeperTag)
  const injury = status.report?.injury ?? status.bodyPart
  if (injury !== undefined) parts.push(injury)
  if (status.report?.practice !== undefined) parts.push(PRACTICE_PHRASE[status.report.practice])
  return parts.length === 0 ? 'None' : parts.join(' · ')
}

const relativeFormat = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })

/** Swift `.relative(presentation: .named)`: "yesterday", "3 hours ago". */
export function relativeDate(date: Date, now = Date.now()): string {
  const seconds = (date.getTime() - now) / 1000
  const abs = Math.abs(seconds)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60],
  ]
  for (const [unit, size] of units) if (abs >= size) return relativeFormat.format(Math.round(seconds / size), unit)
  return relativeFormat.format(Math.round(seconds), 'second')
}

export function scheduleFootnote(schedule: Schedule): string {
  const parts: string[] = []
  const last = schedule.coveredWeeks[schedule.coveredWeeks.length - 1]
  if (last !== undefined) {
    const final = schedule.weeks[schedule.weeks.length - 1]?.week ?? last
    parts.push(last >= final ? PlayerSchedule.linesLabel : `${PlayerSchedule.linesLabel} through week ${last}; later weeks have no line yet`)
  } else {
    parts.push('No recorded lines for his remaining games yet')
  }
  parts.push(`Def rank: 1 is the softest vs ${schedule.position ?? 'his position'}`)
  if (schedule.defenseSource) parts.push(defenseSourceLabel(schedule.defenseSource))
  return parts.join('. ') + '.'
}

export const GAME_LOG_FOOTNOTE = "Points in your scoring from Sleeper's lines; projections Rotowire via Sleeper; xFP ffopportunity."
