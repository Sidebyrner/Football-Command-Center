// Team Grades — value-surplus + roster-construction scoring, shared between
// draft mode (TeamGradesPanel, graded against the live draft) and season mode
// (TradeAnalyzer, graded against current real rosters). Pure functions only —
// no React, no Sleeper imports; callers supply already-fetched data.
//
// Value metric: this app already scores every player 0-100 via evaluateDraft
// (percentile against real cohorts — see usePlayerScores). Rather than invent
// a second valuation model, that .score is used everywhere a points-based
// model would use points. "Lineup Score" is therefore an average, not a sum —
// percentile scores don't add up meaningfully the way fantasy points do.

import { assignPicksToSlots } from './rosterSlots'

const VALUE_WEIGHT = 0.65
const CONSTRUCTION_WEIGHT = 0.35

const GRADE_BANDS = [
  [90, 'A+'], [80, 'A'], [70, 'B+'], [60, 'B'],
  [50, 'C+'], [40, 'C'], [30, 'D'], [0, 'F'],
]

// No blue in the app's semantic palette (--color-start/caution/sit), so
// B-tier gets one dedicated color rather than colliding with an existing
// meaning. Shared between TeamGradesPanel and TradeAnalyzer via TeamGradeRow.
export const GRADE_COLOR = {
  'A+': 'var(--color-start)', A: 'var(--color-start)',
  'B+': '#818cf8', B: '#818cf8',
  'C+': 'var(--color-caution)', C: 'var(--color-caution)',
  D: 'var(--color-sit)', F: 'var(--color-sit)',
}

export function scoreToGrade(score) {
  if (score == null) return null
  for (const [min, grade] of GRADE_BANDS) {
    if (score >= min) return grade
  }
  return 'F'
}

/**
 * All evaluable player scores, sorted descending — the "if every pick landed
 * in perfect value order" reference list used to grade individual picks in
 * draft mode.
 */
export function buildRankedScores(playersById, scores) {
  return Object.keys(playersById)
    .map((id) => scores[id])
    .filter((s) => s?.available)
    .map((s) => s.score)
    .sort((a, b) => b - a)
}

export function expectedScoreAtPick(pickNo, rankedScores) {
  if (!rankedScores?.length || pickNo == null) return null
  const idx = Math.min(pickNo - 1, rankedScores.length - 1)
  return rankedScores[Math.max(idx, 0)]
}

/**
 * @param {string[]} playerIds - this team's players, any order
 * @param {object} ctx
 * @param {Record<string, object>} ctx.scores - evaluateDraft results, keyed by player id
 * @param {Record<string, {id, position, name}>} ctx.playersById
 * @param {{starters, benchCount}} ctx.slotTemplate - from parseRosterPositions
 * @param {Record<string, number>} [ctx.pickNos] - player id -> Sleeper pick_no.
 *   Present in draft mode, omitted in season mode.
 * @param {number[]} [ctx.rankedScores] - required when pickNos is supplied
 */
export function computeTeamStats(playerIds, ctx) {
  const { scores, playersById, slotTemplate, pickNos, rankedScores } = ctx
  const { slots, bench, overflow } = assignPicksToSlots(playerIds, slotTemplate, playersById)

  const startersFilled = slots.filter((s) => s.filled).length
  const totalStarterSlots = slots.length
  const picksMade = playerIds.length

  const scoredPicks = playerIds.map((id) => scores[id]).filter((s) => s?.available)

  const lineupScores = slots
    .filter((s) => s.filled && scores[s.filled.id]?.available)
    .map((s) => scores[s.filled.id].score)
  const lineupScore = lineupScores.length
    ? lineupScores.reduce((a, b) => a + b, 0) / lineupScores.length
    : null

  let avgSurplus = null
  if (pickNos) {
    // Draft mode: value = how much better each pick was than the player who
    // "should" have been there at that pick number, averaged across picks
    // that have both a pick number and a usable score.
    const surpluses = playerIds
      .map((id) => {
        const s = scores[id]
        const pickNo = pickNos[id]
        if (!s?.available || pickNo == null) return null
        const expected = expectedScoreAtPick(pickNo, rankedScores)
        return expected == null ? null : s.score - expected
      })
      .filter((v) => v != null)
    avgSurplus = surpluses.length ? surpluses.reduce((a, b) => a + b, 0) / surpluses.length : null
  } else {
    // Season mode: no pick to grade against — value is the average score
    // across the whole roster, bench included (bench depth is real value).
    avgSurplus = scoredPicks.length
      ? scoredPicks.reduce((sum, s) => sum + s.score, 0) / scoredPicks.length
      : null
  }

  const neededPositions = slots.filter((s) => s.type === 'starter' && !s.filled).map((s) => s.pos)
  const openFlexEligible = [...new Set(
    slots.filter((s) => s.type === 'flex' && !s.filled).flatMap((s) => s.eligible ?? [])
  )]

  const benchByPosition = {}
  for (const p of bench) benchByPosition[p.position] = (benchByPosition[p.position] ?? 0) + 1

  return {
    playerIds, slots, bench, overflow,
    startersFilled, totalStarterSlots, picksMade,
    lineupScore, avgSurplus,
    neededPositions, openFlexEligible, benchByPosition,
  }
}

/**
 * @param {Array<{id, name, playerIds, pickNos?}>} teamsInput
 * @param {object} ctx - same shape computeTeamStats expects, minus playerIds/pickNos
 */
export function computeAllTeamGrades(teamsInput, ctx) {
  const rankedScores = ctx.rankedScores ?? buildRankedScores(ctx.playersById, ctx.scores)
  const stats = teamsInput.map((t) => ({
    id: t.id,
    name: t.name,
    isMe: !!t.isMe,
    ...computeTeamStats(t.playerIds, { ...ctx, rankedScores, pickNos: t.pickNos }),
  }))

  const graded = stats.filter((t) => t.picksMade > 0 && t.avgSurplus != null)
  const surplusValues = graded.map((t) => t.avgSurplus)
  const minS = surplusValues.length ? Math.min(...surplusValues) : 0
  const maxS = surplusValues.length ? Math.max(...surplusValues) : 0

  for (const t of stats) {
    if (t.picksMade === 0 || t.avgSurplus == null) {
      t.valueScore = null; t.constructionScore = null; t.score = null; t.grade = null
      continue
    }
    const normValue = maxS > minS ? ((t.avgSurplus - minS) / (maxS - minS)) * 100 : 50
    const constructionScore = t.totalStarterSlots > 0
      ? (t.startersFilled / Math.min(t.picksMade, t.totalStarterSlots)) * 100
      : 0
    const composite = normValue * VALUE_WEIGHT + constructionScore * CONSTRUCTION_WEIGHT
    t.valueScore = Math.round(normValue)
    t.constructionScore = Math.round(constructionScore)
    t.score = Math.round(composite)
    t.grade = scoreToGrade(composite)
  }

  return stats
}

/**
 * Heuristic trade matcher: a candidate team is a fit if they're thin at a
 * position you have bench surplus in, and you're thin at a position they
 * have bench surplus in.
 */
export function findTradeOpportunities(myTeam, otherTeams, { minBenchSurplus = 2 } = {}) {
  if (!myTeam) return []
  const myNeeds = new Set([...myTeam.neededPositions, ...myTeam.openFlexEligible])
  const myBenchSurplus = new Set(
    Object.entries(myTeam.benchByPosition).filter(([, n]) => n >= minBenchSurplus).map(([pos]) => pos)
  )

  const results = []
  for (const team of otherTeams) {
    if (team.id === myTeam.id || team.picksMade === 0) continue
    const theyNeed = new Set([...team.neededPositions, ...team.openFlexEligible])
    const theyBenchSurplus = new Set(
      Object.entries(team.benchByPosition).filter(([, n]) => n >= minBenchSurplus).map(([pos]) => pos)
    )

    const iCanOffer = [...myBenchSurplus].filter((pos) => theyNeed.has(pos))
    const theyCanOffer = [...theyBenchSurplus].filter((pos) => myNeeds.has(pos))

    if (iCanOffer.length && theyCanOffer.length) {
      results.push({ team, give: iCanOffer, get: theyCanOffer })
    }
  }
  return results
}
