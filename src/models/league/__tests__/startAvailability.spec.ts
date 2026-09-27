import { describe, expect, it } from 'vitest'
import { blocksStart, evaluateStart, startBadge, type StartAvailability } from '../LeagueContext'

const unavailable = (label: string): StartAvailability => ({ kind: 'unavailable', label })

/** Port of StartAvailabilityTests. */
describe('StartAvailability', () => {
  it('the most severe source wins', () => {
    expect(evaluateStart(undefined, undefined, false)).toEqual({ kind: 'clear' })
    expect(evaluateStart('Questionable', undefined, false)).toEqual({ kind: 'questionable' })
    // the official report downgraded him
    expect(evaluateStart('Questionable', 'Doubtful', false)).toEqual(unavailable('Doubtful'))
    expect(evaluateStart(undefined, 'Out', false)).toEqual(unavailable('Out'))
    expect(evaluateStart('IR', 'Questionable', false)).toEqual(unavailable('IR'))
    expect(evaluateStart(undefined, 'Questionable', false)).toEqual({ kind: 'questionable' })
    expect(evaluateStart(undefined, undefined, true)).toEqual(unavailable('On your IR'))
  })

  it('every do-not-start tag blocks', () => {
    for (const tag of ['Out', 'Doubtful', 'IR', 'PUP', 'PUP-R', 'NFI', 'Sus', 'NA', 'COV', 'DNR']) {
      expect(blocksStart(evaluateStart(tag, undefined, false)), tag).toBe(true)
    }
    expect(blocksStart(evaluateStart('Questionable', undefined, false))).toBe(false)
    expect(startBadge(evaluateStart('Doubtful', undefined, false))).toBe('Doubtful')
    expect(startBadge({ kind: 'questionable' })).toBe('Q')
  })
})
