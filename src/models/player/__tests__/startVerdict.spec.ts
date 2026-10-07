import { describe, expect, it } from 'vitest'
import type { Position } from '@core/Position'
import {
  computeStartVerdict, matchupPosture, posture, START_SIGNALS, startPickIsFreeAgent,
  type StartInput, type StartSignal,
} from '@models/player/StartVerdict'

/** Port of StartVerdictTests.swift — same inputs, same strings. */
describe('StartVerdict', () => {
  const capitalized = (id: string) => id.charAt(0).toUpperCase() + id.slice(1)
  /** Every point signal at one value, so a test can move just the ones it cares about. */
  const player = (
    id: string, value: number,
    o: { position?: Position; incumbent?: boolean; freeAgent?: boolean } = {},
    overrides: Partial<Record<StartSignal, number | undefined>> = {},
  ): StartInput => {
    const signals: Partial<Record<StartSignal, number>> = {}
    for (const signal of START_SIGNALS) if (signal !== 'environment') signals[signal] = value
    signals.environment = 22
    for (const [signal, v] of Object.entries(overrides) as [StartSignal, number | undefined][]) {
      if (v === undefined) delete signals[signal]
      else signals[signal] = v
    }
    return {
      id, name: capitalized(id), position: o.position ?? 'WR', isFreeAgent: o.freeAgent ?? false,
      isIncumbent: o.incumbent ?? false, signals,
    }
  }

  it('the player who wins the most head-to-heads starts', () => {
    const verdict = computeStartVerdict(
      [player('waddle', 10, { incumbent: true }), player('pittman', 13), player('addison', 8)],
      posture.close(2), 'WR2',
    )
    expect(verdict.ranked.map((r) => r.id)).toEqual(['pittman', 'waddle', 'addison'])
    expect(verdict.headline).toBe('Start Pittman over Waddle')
    expect(verdict.alternativeID, 'the incumbent is the one passed over').toBe('waddle')
    expect(verdict.confidence).toBe('clear')
    expect(verdict.edgeLine, "environment is level, so it doesn't count").toBe('Beats Waddle on 5 of 6 signals.')
    expect(verdict.votingSignals.length, 'a close matchup leaves floor and ceiling as context').toBe(6)
  })

  it("out, bye, locked and rival players can't start", () => {
    const out = { ...player('out', 30), availability: { kind: 'unavailable', label: 'Out' } as const }
    const bye = { ...player('bye', 30), onBye: true }
    const locked = { ...player('locked', 30), isLocked: true }
    const rival = { ...player('rival', 30), rivalManager: 'Sam' }
    const verdict = computeStartVerdict([out, bye, locked, rival, player('ok', 5)], posture.unknown, 'WR1')
    expect(verdict.ranked.map((r) => r.id)).toEqual(['ok'])
    expect(verdict.blocked.map((b) => b.reason)).toEqual(['Out', 'On bye', 'Game has started', "On Sam's roster"])
    expect(verdict.headline).toBe('Start Ok at WR1')
  })

  it('nobody eligible', () => {
    const out = { ...player('out', 30), availability: { kind: 'unavailable', label: 'IR' } as const }
    const verdict = computeStartVerdict([out], posture.unknown)
    expect(verdict.pickID).toBeUndefined()
    expect(verdict.headline).toBe('Nobody here can start this week')
  })

  it('a dead heat goes to the projection', () => {
    const verdict = computeStartVerdict(
      [player('a', 10, {}, { projected: 10.2 }), player('b', 10, {}, { projected: 10.4 })],
      posture.close(0), 'FLEX',
    )
    expect(verdict.pickID, 'inside every tie band, the higher projection breaks the tie').toBe('b')
    expect(verdict.confidence).toBe('coinFlip')
  })

  it('posture decides whether floor or ceiling counts', () => {
    // Even on everything but range: steady has the floor, boom the ceiling.
    const steady = player('steady', 10, {}, { floor: 8, ceiling: 12 })
    const boom = player('boom', 10, {}, { floor: 3, ceiling: 20 })
    const ahead = computeStartVerdict([steady, boom], posture.favourite(14))
    expect(ahead.pickID).toBe('steady')
    expect(ahead.postureLine).toBe("You're projected +14.0, so Floor counts — protect the lead.")
    const behind = computeStartVerdict([steady, boom], posture.underdog(-10))
    expect(behind.pickID).toBe('boom')
    expect(behind.votingSignals).toContain('ceiling')
    expect(behind.votingSignals).not.toContain('floor')
  })

  it('posture thresholds', () => {
    expect(matchupPosture(120, 112)).toEqual(posture.favourite(8))
    expect(matchupPosture(100, 107.9).kind, 'inside the margin is close').toBe('close')
    expect(matchupPosture(undefined, 100)).toEqual(posture.unknown)
  })

  it('thin data caps at lean', () => {
    const sparse = { commandCenter: undefined, thisSeason: undefined, form: undefined, usage: undefined, environment: undefined }
    // Projected and floor are all there is: a big gap, but two signals.
    const verdict = computeStartVerdict([player('a', 20, {}, sparse), player('b', 5, {}, sparse)], posture.favourite(10))
    expect(verdict.thinData).toBe(true)
    expect(verdict.confidence).toBe('lean')
  })

  it('a questionable player who missed practice caps at lean', () => {
    const hurt: StartInput = { ...player('hurt', 20), availability: { kind: 'questionable' }, practice: 'DNP' }
    const verdict = computeStartVerdict([hurt, player('backup', 8)], posture.close(0))
    expect(verdict.pickID, 'Questionable is ranked on his full value, as in Sit/Start').toBe('hurt')
    expect(verdict.confidence).toBe('lean')
  })

  it('the contingency names a later pivot', () => {
    const sunday = 1_791_000_000 * 1000
    const hurt: StartInput = { ...player('hurt', 20), availability: { kind: 'questionable' }, kickoff: sunday }
    const late: StartInput = { ...player('late', 9), kickoff: sunday + 3 * 3600 * 1000 }
    const verdict = computeStartVerdict([hurt, late], posture.close(0))
    expect(verdict.contingency).toBe(
      "Hurt is questionable. Inactives come out about 90 minutes before his kickoff — if he's out, swap to Late, who plays later.")
  })

  it('the contingency warns when there is no pivot', () => {
    const sunday = 1_791_000_000 * 1000
    const hurt: StartInput = { ...player('hurt', 20), availability: { kind: 'questionable' }, kickoff: sunday + 7 * 3600 * 1000 }
    const early: StartInput = { ...player('early', 9), kickoff: sunday }
    const verdict = computeStartVerdict([hurt, early], posture.close(0))
    expect(verdict.contingency).toBe(
      "Hurt is questionable and there's no later pivot — Early doesn't play after him. If you can't wait on him, start Early.")
  })

  it('a free agent who wins is an add and start', () => {
    const verdict = computeStartVerdict(
      [player('starter', 8, { incumbent: true }), player('dell', 14, { freeAgent: true })], posture.close(0), 'WR2',
    )
    expect(verdict.headline).toBe('Add Dell, start over Starter')
    expect(startPickIsFreeAgent(verdict)).toBe(true)
    expect(verdict.notes[0]).toBe('Check Dell can be added before his kickoff — he may still be on waivers.')
  })

  it('a flex mixes positions and says so', () => {
    const verdict = computeStartVerdict(
      [player('rb', 12, { position: 'RB', incumbent: true }), player('wr', 11, { position: 'WR' }), player('te', 9, { position: 'TE' })],
      posture.close(0), 'FLEX',
    )
    expect(verdict.headline).toBe('Keep Rb in at FLEX')
    expect(verdict.alternativeID, 'the incumbent won, so the runner-up is the alternative').toBe('wr')
    expect(verdict.notes.some((n) => n.startsWith('Mixed positions'))).toBe(true)
  })

  it('an empty slot', () => {
    const verdict = computeStartVerdict([player('a', 12), player('b', 6)], posture.close(0), 'TE')
    expect(verdict.headline).toBe('Start A at TE')
  })

  it('outside a lineup names the runner-up', () => {
    const verdict = computeStartVerdict([player('a', 12), player('b', 6)], posture.unknown)
    expect(verdict.headline).toBe('Start A over B')
  })

  it('signal leaders', () => {
    const verdict = computeStartVerdict([player('a', 12, {}, { usage: 4 }), player('b', 6)], posture.unknown)
    expect(verdict.signalLeaders.projected).toBe('a')
    expect(verdict.signalLeaders.usage).toBe('b')
    expect(verdict.signalLeaders.environment, 'level values have no leader').toBeUndefined()
    expect(verdict.ranked[0]!.topOn).toEqual(['projected', 'commandCenter', 'thisSeason', 'form'])
  })
})
