// League-wide aggregates over the weekly game logs.
//
// Computed at RUNTIME, not baked into public/data. That is deliberate: a
// pre-baked defense-vs-position table is frozen to whatever scoring the script
// assumed (nflverse's PPR), and this app's leagues are frequently not PPR and
// often pay for first downs. A baked number would be wrong for the user's
// actual league and meaningless for kickers, whose nflverse fantasy points are
// literally 0. Scoring here, under the ACTIVE profile, means one source of
// truth and numbers denominated in the points you actually collect.
//
// Cost: one pass over ~6,600 rows, a few milliseconds. Not worth pre-baking.

import { scoreWeek } from './weeklyScoring.js'
import { decodeRow } from '../services/weeklyStatsService'

const DEFAULT_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K']

/**
 * Fantasy points allowed to each position by each NFL defense.
 *
 * Definition, which the UI states rather than buries: points allowed to
 * position P by defense D is the sum of the weekly points of EVERY player at P
 * who faced D, divided by the number of GAMES D played — not by player-weeks.
 * That is the standard volume-inclusive definition, and it is why a defense
 * that happens to face three-WR offenses looks softer to WRs.
 *
 * The games denominator is derived from distinct weeks in which some player
 * faced D, so byes are handled without needing a schedule file.
 *
 * @param {object} seasonFile loaded weekly/{season}.json
 * @param {object} profile active scoring profile
 * @param {{positions?: string[], weekRange?: [number, number], minGames?: number}} opts
 * @returns {{byDefense, leagueAvgByPos, positions, season, weeks, minGames, ranked}}
 */
export function defenseVsPosition(seasonFile, profile, opts = {}) {
  const positions = opts.positions ?? DEFAULT_POSITIONS
  const minGames = opts.minGames ?? 4
  const [wLo, wHi] = opts.weekRange ?? [-Infinity, Infinity]

  const empty = {
    byDefense: {}, leagueAvgByPos: {}, positions, ranked: {},
    season: seasonFile?._meta?.season ?? null, weeks: [], minGames,
  }
  if (!seasonFile?.players) return empty

  const { fields, meta, players } = seasonFile
  const posSet = new Set(positions)

  // defense -> position -> { totalPoints, playerWeeks }
  const acc = {}
  // defense -> Set(week) — the games denominator
  const weeksByDefense = {}
  const weeksSeen = new Set()

  for (const [gsisId, tuples] of Object.entries(players)) {
    const position = meta?.[gsisId]?.p
    if (!posSet.has(position)) continue

    for (const t of tuples) {
      const row = decodeRow(fields, t)
      if (row.week < wLo || row.week > wHi) continue
      const def = row.opp
      if (!def) continue

      weeksSeen.add(row.week)
      ;(weeksByDefense[def] ??= new Set()).add(row.week)

      const { points } = scoreWeek(row, profile, position)
      if (points == null) continue

      const bucket = ((acc[def] ??= {})[position] ??= { totalPoints: 0, playerWeeks: 0 })
      bucket.totalPoints += points
      bucket.playerWeeks += 1
    }
  }

  // Per-game rates
  const byDefense = {}
  for (const [def, byPos] of Object.entries(acc)) {
    const games = weeksByDefense[def]?.size ?? 0
    byDefense[def] = {}
    for (const pos of positions) {
      const b = byPos[pos]
      if (!b) {
        byDefense[def][pos] = { games, playerWeeks: 0, totalPoints: 0, perGame: null, rank: null, vsLeagueAvg: null }
        continue
      }
      byDefense[def][pos] = {
        games,
        playerWeeks: b.playerWeeks,
        totalPoints: Math.round(b.totalPoints * 10) / 10,
        perGame: games > 0 ? Math.round((b.totalPoints / games) * 10) / 10 : null,
        rank: null,
        vsLeagueAvg: null,
      }
    }
  }

  // League averages and ranks. A defense under the sample-size floor is left
  // UNRANKED (rank stays null) rather than being given a rank the data can't
  // support — the UI mutes those cells instead of implying a read.
  const leagueAvgByPos = {}
  const ranked = {}
  for (const pos of positions) {
    const eligible = Object.entries(byDefense)
      .filter(([, v]) => v[pos].perGame != null && v[pos].games >= minGames)
      .sort((a, b) => b[1][pos].perGame - a[1][pos].perGame) // most allowed first = softest

    if (eligible.length) {
      const mean = eligible.reduce((s, [, v]) => s + v[pos].perGame, 0) / eligible.length
      leagueAvgByPos[pos] = Math.round(mean * 10) / 10
      eligible.forEach(([def], i) => {
        byDefense[def][pos].rank = i + 1
        byDefense[def][pos].vsLeagueAvg = Math.round((byDefense[def][pos].perGame - mean) * 10) / 10
      })
    } else {
      leagueAvgByPos[pos] = null
    }
    ranked[pos] = eligible.map(([def]) => def)
  }

  return {
    byDefense,
    leagueAvgByPos,
    positions,
    ranked,
    season: seasonFile._meta?.season ?? null,
    weeks: [...weeksSeen].sort((a, b) => a - b),
    minGames,
    defenseCount: Object.keys(byDefense).length,
  }
}

/**
 * Where the startable and replacement lines sit at each position, in this
 * league's points. Answers "is 11 points good for a TE here?" — which depends
 * entirely on league size and starting requirements, so it cannot be a
 * constant.
 *
 * startLine      = the weekly score of the last player you'd start leaguewide
 * replacementLine = the next man up, i.e. what a waiver pickup is worth
 */
export function positionBaselines(seasonFile, profile, { starterCountsByPos, teamCount } = {}) {
  const out = {}
  if (!seasonFile?.players || !starterCountsByPos || !teamCount) return out

  const { fields, meta, players } = seasonFile
  const byPosWeek = {} // pos -> week -> number[]

  for (const [gsisId, tuples] of Object.entries(players)) {
    const position = meta?.[gsisId]?.p
    if (!position) continue
    for (const t of tuples) {
      const row = decodeRow(fields, t)
      const { points } = scoreWeek(row, profile, position)
      if (points == null) continue
      ;((byPosWeek[position] ??= {})[row.week] ??= []).push(points)
    }
  }

  for (const [pos, weeks] of Object.entries(byPosWeek)) {
    const starters = Math.round((starterCountsByPos[pos] ?? 0) * teamCount)
    if (!starters) continue
    const perWeek = {}
    const startVals = []
    const replVals = []
    for (const [wk, vals] of Object.entries(weeks)) {
      const desc = [...vals].sort((a, b) => b - a)
      const start = desc[starters - 1] ?? desc[desc.length - 1] ?? null
      const repl = desc[starters] ?? null
      perWeek[wk] = { startLine: start, replacementLine: repl }
      if (start != null) startVals.push(start)
      if (repl != null) replVals.push(repl)
    }
    const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null)
    out[pos] = { byWeek: perWeek, startLine: avg(startVals), replacementLine: avg(replVals), starters }
  }

  return out
}
