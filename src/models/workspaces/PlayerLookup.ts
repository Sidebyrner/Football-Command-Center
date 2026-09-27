/**
 * Forgiving player search across every active player in the pool — a port of
 * FCApp `PlayerLookup.swift`.
 */
import { fuzzyScore } from '@core/FuzzyNameMatch'
import { activePlayers, playerPosition, type IndexedPlayer } from '@data/playerIndex'
import type { LeagueContext } from '../league/LeagueContext'

/** Swift's `.whitespaces`: spaces and tabs, not newlines. */
const trimWhitespaces = (text: string) => text.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, '')

/** The best fuzzy matches on name or team, skipping `excluding`. */
export function playerLookupMatches(
  needle: string,
  context: Pick<LeagueContext, 'players'>,
  excluding: readonly string[] = [],
  limit = 6,
): IndexedPlayer[] {
  const query = trimWhitespaces(needle)
  if (!query) return []
  const skip = new Set(excluding)
  const scored: { player: IndexedPlayer; score: number }[] = []
  for (const player of activePlayers(context.players)) {
    if (playerPosition(player) === undefined || skip.has(player.id)) continue
    const extra = player.team !== undefined ? [player.team] : []
    const score = fuzzyScore(query, player.name, extra)
    if (score !== undefined) scored.push({ player, score })
  }
  scored.sort((a, b) =>
    a.score === b.score
      ? (a.player.name < b.player.name ? -1 : a.player.name > b.player.name ? 1 : 0)
      : b.score - a.score)
  return scored.slice(0, limit).map((s) => s.player)
}
