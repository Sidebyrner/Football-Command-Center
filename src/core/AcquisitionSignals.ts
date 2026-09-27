/**
 * Named, separately reported reasons a player is worth acquiring — a port of
 * FCCore `AcquisitionSignals`. Four signals, never averaged into one.
 */
import type { Baselines } from './Baselines'
import { roundHalfUp } from './rounding'
import { FORM_WEEKS, type SeasonProfile } from './SeasonProfile'

export type AcquisitionSignal = 'startable' | 'above-replacement' | 'opportunity' | 'form'

export const SIGNAL_LABEL: Readonly<Record<AcquisitionSignal, string>> = {
  startable: 'Startable production',
  'above-replacement': 'Above replacement',
  opportunity: 'Opportunity ahead of production',
  form: 'Heating up',
}

export interface SignalHit {
  signal: AcquisitionSignal
  label: string
  /** Plain-language statement of the fact, shown verbatim. */
  detail: string
}

export interface AcquisitionCandidate {
  player: SeasonProfile
  signals: SignalHit[]
  /** Points per game above this position's start line. */
  valueOverStartLine: number
}

export const OPPORTUNITY_TARGET_SHARE = 0.2
export const FORM_MULTIPLIER = 1.25

/** One decimal, for the `detail` strings only. */
const display = (v: number) => roundHalfUp(v, 1).toFixed(1)

export function acquisitionSignals(player: SeasonProfile, baselines: Baselines, formWeeks = FORM_WEEKS): SignalHit[] {
  const baseline = baselines[player.position]
  if (!baseline) return []
  const out: SignalHit[] = []
  const perGame = display(player.pointsPerGame)
  const hit = (signal: AcquisitionSignal, detail: string) => out.push({ signal, label: SIGNAL_LABEL[signal], detail })
  if (player.pointsPerGame >= baseline.startLine) {
    hit('startable', `${perGame} pts/gm vs a ${display(baseline.startLine)} start line`)
  } else if (baseline.replacementLine !== undefined && player.pointsPerGame >= baseline.replacementLine) {
    hit('above-replacement', `${perGame} pts/gm vs ${display(baseline.replacementLine)} replacement`)
  }
  const share = player.recentTargetShare
  if (share !== undefined && share >= OPPORTUNITY_TARGET_SHARE && player.pointsPerGame < baseline.startLine) {
    hit('opportunity', `${Math.trunc(roundHalfUp(share * 100, 0))}% target share, still under the start line`)
  }
  const form = player.formPointsPerGame
  if (form !== undefined && player.games >= formWeeks && form > player.pointsPerGame * FORM_MULTIPLIER) {
    hit('form', `${display(form)} over the last ${formWeeks} vs ${perGame} on the season`)
  }
  return out
}

/** Rank on this, never raw points — a raw sort just lists quarterbacks. */
export function valueOverStartLine(player: SeasonProfile, baselines: Baselines): number | undefined {
  const b = baselines[player.position]
  return b ? player.pointsPerGame - b.startLine : undefined
}

export function acquisitionBoard(players: readonly SeasonProfile[], baselines: Baselines, formWeeks = FORM_WEEKS): AcquisitionCandidate[] {
  const out: AcquisitionCandidate[] = []
  for (const player of players) {
    const signals = acquisitionSignals(player, baselines, formWeeks)
    const value = valueOverStartLine(player, baselines)
    if (signals.length && value !== undefined) out.push({ player, signals, valueOverStartLine: value })
  }
  return out.sort((a, b) =>
    a.valueOverStartLine === b.valueOverStartLine
      ? (a.player.gsisID < b.player.gsisID ? -1 : a.player.gsisID > b.player.gsisID ? 1 : 0)
      : b.valueOverStartLine - a.valueOverStartLine)
}
