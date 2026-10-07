/**
 * The verdict is a weighted blend, so it can be argued with — a port of FCApp
 * `CompareGutCheck.swift`. The best case for the player the call passed over,
 * built from what the blend leaves out — luck against his expected points, a
 * growing role, a hot stretch, a ceiling, the depth chart, the schedule — plus
 * what could go wrong with the pick. Rules only, every point shown with its
 * number.
 */
import { formatNumber } from '@core/numeric'
import { PRACTICE_LABEL } from '@core/InSeasonFiles'
import type { CompareLens } from './CompareLens'
import { injuryPenalty, type CompareVerdict } from './CompareVerdict'
import type { ComparisonPlayer, PlayerComparison } from './PlayerComparison'
import { postureVotingRangeSignal, type MatchupPosture, type StartVerdict } from './StartVerdict'

export type GutConfidence = 'clear' | 'lean' | 'coinFlip'
export const GUT_CONFIDENCE_LABEL: Readonly<Record<GutConfidence, string>> = {
  clear: 'Clear call', lean: 'Lean', coinFlip: 'Coin flip',
}

export interface GutPoint {
  text: string
  /** 0 is context only; 1 a real point; 2 a strong one. */
  strength: number
}

export interface CompareGutCheck {
  confidence: GutConfidence
  pickName: string
  alternativeName: string
  caseForAlternative: GutPoint[]
  risksForPick: GutPoint[]
  summary: string
}

export const GUT_THRESHOLDS = {
  unlucky: 2.0,
  overperforming: 3.0,
  roleShift: 0.10,
  hotStretch: 1.25,
  ceilingGap: 5.0,
  /** This week's floor or ceiling gap worth mentioning. */
  rangeGap: 3.0,
  scheduleGap: 0.08,
  coinFlipMargin: 0.05,
  leanMargin: 0.12,
  /** Milliseconds. */
  newsAge: 3 * 24 * 3600 * 1000,
} as const

const one = (v: number) => formatNumber(v, 1)
const two = (v: number) => formatNumber(v, 2)
// Swift's `.rounded()` — halves away from zero; shares are positive.
const percent = (v: number) => `${Math.round(v * 100)}%`
const byStrength = (a: GutPoint, b: GutPoint) => b.strength - a.strength

/** `undefined` when the verdict didn't weigh two players against each other. */
export function buildGutCheck(comparison: PlayerComparison, verdict: CompareVerdict, now: Date = new Date()): CompareGutCheck | undefined {
  const pick = comparison.players.find((p) => p.id === verdict.pickID)
  const alternative = comparison.players.find((p) => p.id === verdict.alternativeID)
  if (!pick || !alternative) return undefined
  return assessGutCheck(pick, alternative, verdict.margin, now)
}

export function assessGutCheck(
  pick: ComparisonPlayer, alternative: ComparisonPlayer, margin: number | undefined, now: Date = new Date(),
): CompareGutCheck {
  const { caseFor, risks, strength } = points(pick, alternative, 'restOfSeason', { kind: 'unknown' }, now)
  const m = margin ?? GUT_THRESHOLDS.leanMargin
  const confidence: GutConfidence =
    m < GUT_THRESHOLDS.coinFlipMargin || (strength >= 3 && m < GUT_THRESHOLDS.leanMargin) ? 'coinFlip'
    : m < GUT_THRESHOLDS.leanMargin || strength >= 2 ? 'lean'
    : 'clear'
  return finish(pick, alternative, confidence, caseFor, risks)
}

/**
 * The this-week start call argued with: the tally sets the confidence, and a
 * strong enough case against it takes it down one step.
 */
export function buildStartGutCheck(
  comparison: PlayerComparison, verdict: StartVerdict, posture: MatchupPosture, now: Date = new Date(),
): CompareGutCheck | undefined {
  const pick = comparison.players.find((p) => p.id === verdict.pickID)
  const alternative = comparison.players.find((p) => p.id === verdict.alternativeID)
  if (!pick || !alternative) return undefined
  const { caseFor, risks, strength } = points(pick, alternative, 'thisWeek', posture, now)
  let confidence = verdict.confidence
  if (strength >= 3) confidence = confidence === 'clear' ? 'lean' : 'coinFlip'
  return finish(pick, alternative, confidence, caseFor, risks)
}

function points(pick: ComparisonPlayer, alternative: ComparisonPlayer, lens: CompareLens, posture: MatchupPosture, now: Date) {
  // A stable sort keeps the signal order for equal strengths, as Swift's does here.
  const caseFor = caseForPlayer(alternative, pick, lens, posture, now).sort(byStrength).slice(0, 3)
  const risks = risksFor(pick, lens).sort(byStrength).slice(0, 2)
  const strength = [...caseFor, ...risks].reduce((s, p) => s + p.strength, 0)
  return { caseFor, risks, strength }
}

function finish(pick: ComparisonPlayer, alternative: ComparisonPlayer, confidence: GutConfidence,
  caseFor: GutPoint[], risks: GutPoint[]): CompareGutCheck {
  const hasCase = caseFor.some((p) => p.strength > 0)
  const summary =
    confidence === 'clear'
      ? hasCase
        ? `The numbers back ${pick.name}; the case for ${alternative.name} is real but thin.`
        : `Paper and gut agree — nothing here argues for ${alternative.name}.`
    : confidence === 'lean' ? `${pick.name} on paper, but ${alternative.name} has a case.`
    : `Close enough that the numbers can't settle it — go with your read on ${pick.name} vs ${alternative.name}.`
  return { confidence, pickName: pick.name, alternativeName: alternative.name, caseForAlternative: caseFor, risksForPick: risks, summary }
}

function caseForPlayer(player: ComparisonPlayer, pick: ComparisonPlayer, lens: CompareLens, posture: MatchupPosture, now: Date): GutPoint[] {
  const out: GutPoint[] = []
  const l = luck(player)
  if (l !== undefined && l >= GUT_THRESHOLDS.unlucky) {
    out.push({ text: `Scoring ${one(l)} pts/gm under his expected points — the volume says more is coming.`,
               strength: l >= GUT_THRESHOLDS.unlucky * 2 ? 2 : 1 })
  }
  const shift = snapShift(player)
  if (shift && shift.after - shift.before >= GUT_THRESHOLDS.roleShift) {
    out.push({ text: `Snap share up from ${percent(shift.before)} to ${percent(shift.after)} — his role is growing.`,
               strength: shift.after - shift.before >= GUT_THRESHOLDS.roleShift * 2 ? 2 : 1 })
  }
  const s = stretch(player)
  if (s && s.season > 0 && s.recent >= s.season * GUT_THRESHOLDS.hotStretch) {
    out.push({ text: `Averaging ${one(s.recent)} over his last 3, up from ${one(s.season)} on the season.`, strength: 1 })
  }
  if (lens === 'thisWeek') {
    out.push(...range(player, pick, posture))
  } else if (player.ceiling !== undefined && player.ceiling >= (pick.ceiling ?? 0) + GUT_THRESHOLDS.ceilingGap) {
    out.push({ text: `Best game ${one(player.ceiling)} vs ${one(pick.ceiling ?? 0)} — the higher ceiling.`, strength: 1 })
  }
  if (player.depthRank === 1 && pick.depthRank !== undefined && pick.depthRank > 1) {
    out.push({ text: `First on his depth chart; ${pick.name} is No. ${Math.trunc(pick.depthRank)}.`, strength: 1 })
  }
  const [mine, theirs] = [player.strengthOfSchedule, pick.strengthOfSchedule]
  const [mineP, theirsP] = [player.playoffMatchups, pick.playoffMatchups]
  if (lens === 'thisWeek') {
    // Next week's schedule says nothing about who starts this one.
  } else if (mine !== undefined && theirs !== undefined && mine - theirs >= GUT_THRESHOLDS.scheduleGap) {
    out.push({ text: `Softer schedule ahead (${two(mine)}× vs ${two(theirs)}×).`, strength: 1 })
  } else if (mineP !== undefined && theirsP !== undefined && mineP - theirsP >= GUT_THRESHOLDS.scheduleGap) {
    out.push({ text: `Softer playoff matchups (${two(mineP)}× vs ${two(theirsP)}×).`, strength: 1 })
  }
  const h = player.headline
  if (h?.published && h.title !== '' && now.getTime() - h.published.getTime() <= GUT_THRESHOLDS.newsAge) {
    out.push({ text: `Latest: ${h.title}`, strength: 0 })
  }
  return out
}

/**
 * This week's range against the pick's. A range the tally already counted is
 * context; one it left out is a real point.
 */
function range(player: ComparisonPlayer, pick: ComparisonPlayer, posture: MatchupPosture): GutPoint[] {
  const out: GutPoint[] = []
  const counted = postureVotingRangeSignal(posture)
  const strength = counted === undefined ? 1 : 0
  const [mineC, theirsC] = [player.values.ceilingThisWeek, pick.values.ceilingThisWeek]
  if (mineC !== undefined && theirsC !== undefined && mineC - theirsC >= GUT_THRESHOLDS.rangeGap) {
    out.push({ text: `Bigger ceiling this week (${one(mineC)} vs ${one(theirsC)}).`, strength })
  }
  const [mineF, theirsF] = [player.values.floorThisWeek, pick.values.floorThisWeek]
  if (mineF !== undefined && theirsF !== undefined && mineF - theirsF >= GUT_THRESHOLDS.rangeGap) {
    out.push({ text: `Safer floor this week (${one(mineF)} vs ${one(theirsF)}).`, strength })
  }
  return out
}

function risksFor(pick: ComparisonPlayer, lens: CompareLens): GutPoint[] {
  const out: GutPoint[] = []
  // This week a Questionable player is ranked on his full value, as in
  // Sit/Start; what his practice week says is the real risk.
  if (lens === 'thisWeek' && pick.practice !== undefined && pick.practice !== 'FULL') {
    out.push({ text: `${pick.name}: ${PRACTICE_LABEL[pick.practice].toLowerCase()} in the latest practice report.`,
               strength: pick.practice === 'DNP' ? 2 : 1 })
  }
  const penalty = injuryPenalty(pick.injuryDesignation)
  if (lens === 'thisWeek') {
    // Covered above, or by the "can't start" list.
  } else if (pick.injuryDesignation !== undefined && penalty > 0) {
    out.push({ text: `${pick.name} is listed ${pick.injuryDesignation}.`, strength: penalty >= 0.25 ? 2 : 1 })
  } else if (pick.practice !== undefined && pick.practice !== 'FULL') {
    out.push({ text: `${pick.name}: ${PRACTICE_LABEL[pick.practice].toLowerCase()} in practice.`, strength: 1 })
  }
  const l = luck(pick)
  if (l !== undefined && -l >= GUT_THRESHOLDS.overperforming) {
    out.push({ text: `${pick.name} is scoring ${one(-l)} pts/gm over his expected points — some of that may not last.`, strength: 1 })
  }
  const shift = snapShift(pick)
  if (shift && shift.before - shift.after >= GUT_THRESHOLDS.roleShift) {
    out.push({ text: `${pick.name}'s snap share is down from ${percent(shift.before)} to ${percent(shift.after)}.`, strength: 1 })
  }
  return out
}

const mean = (xs: readonly number[]) => xs.reduce((s, v) => s + v, 0) / xs.length

/** Expected minus actual per game over the window — positive is unlucky. */
export function luck(player: ComparisonPlayer): number | undefined {
  const weeks = player.log.filter((w) => w.points !== undefined && w.expectedPoints !== undefined)
  if (weeks.length >= 2) {
    return weeks.reduce((s, w) => s + w.expectedPoints! - w.points!, 0) / weeks.length
  }
  const expected = player.values.expectedPointsLast4
  const actual = player.values.pointsPerGame
  return expected !== undefined && actual !== undefined ? expected - actual : undefined
}

/** Mean snap share of the earlier window against the latest two games. */
export function snapShift(player: ComparisonPlayer): { before: number; after: number } | undefined {
  const shares = [...player.log].sort((a, b) => a.week - b.week).map((w) => w.snapShare).filter((v): v is number => v !== undefined)
  if (shares.length < 3) return undefined
  return { before: mean(shares.slice(0, -2)), after: mean(shares.slice(-2)) }
}

/** The last three games' average against the season's. */
export function stretch(player: ComparisonPlayer): { recent: number; season: number } | undefined {
  const points = [...player.log].sort((a, b) => a.week - b.week).map((w) => w.points).filter((v): v is number => v !== undefined)
  const season = player.values.pointsPerGame
  if (points.length < 3 || season === undefined) return undefined
  return { recent: mean(points.slice(-3)), season }
}
