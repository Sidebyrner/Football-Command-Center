import { describe, expect, it } from 'vitest'
import { demoServices } from '../../../tests/renderScreen'
import { injuriesStatus, lineupBadgeCount, matchupStatus, sitStartStatus } from './LineupHubHeader'

describe('Lineup hub header', () => {
  it('words each card as the phone does', () => {
    expect(sitStartStatus(0)).toEqual({ text: 'Lineup set', tone: 'good' })
    expect(sitStartStatus(1).text).toBe('1 swap')
    expect(sitStartStatus(3)).toEqual({ text: '3 swaps', tone: 'caution' })
    expect(matchupStatus(86.7, 54.18, true, undefined)).toEqual({ text: '86.7–54.2', tone: 'good', isLive: true })
    expect(matchupStatus(0, 0, false, undefined).text).toBe('This week')
    expect(injuriesStatus(2, 1)).toEqual({ text: '2 out', tone: 'bad' })
    expect(injuriesStatus(0, 1)).toEqual({ text: '1 Q', tone: 'caution' })
    expect(injuriesStatus(0, 0)).toEqual({ text: 'All clear', tone: 'good' })
  })

  it('counts the tab badge', async () => {
    const s = await demoServices()
    expect(lineupBadgeCount(s.sitStart, s.injuries)).toBe(s.sitStart.starts.length)
  })
})
