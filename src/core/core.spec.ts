import { describe, expect, it } from 'vitest'
import { positionFromDynastyProcess, positionFromSleeper, hasWeeklyProductionData } from '@core/Position'
import { abbreviationForOddsName, nflverseTeam, teamName } from '@core/NFLTeams'

describe('Position dialects', () => {
  it('reads Sleeper codes, including football positions for IDP', () => {
    expect(positionFromSleeper('DST')).toBe('DEF')
    expect(positionFromSleeper('CB')).toBe('DB')
    expect(positionFromSleeper('NT')).toBe('DL')
    expect(positionFromSleeper('OLB')).toBe('LB')
    expect(positionFromSleeper('rb')).toBe('RB')
    expect(positionFromSleeper('P')).toBeUndefined()
  })

  it('reads dynastyprocess codes, with no DEF', () => {
    expect(positionFromDynastyProcess('PK')).toBe('K')
    expect(positionFromDynastyProcess('S')).toBe('DB')
    expect(positionFromDynastyProcess('DT')).toBe('DL')
    expect(positionFromDynastyProcess('PN')).toBeUndefined()
    expect(positionFromDynastyProcess('XX')).toBeUndefined()
  })

  it('knows which positions the weekly file covers', () => {
    expect(hasWeeklyProductionData('TE')).toBe(true)
    expect(hasWeeklyProductionData('DEF')).toBe(false)
    expect(hasWeeklyProductionData('LB')).toBe(false)
  })
})

describe('NFLTeams', () => {
  it('crosses between names and both abbreviation dialects', () => {
    expect(abbreviationForOddsName('Los Angeles Rams')).toBe('LAR')
    expect(teamName('LAR')).toBe('Los Angeles Rams')
    expect(teamName('LA')).toBe('Los Angeles Rams')
    expect(nflverseTeam('LAR')).toBe('LA')
    expect(nflverseTeam('KC')).toBe('KC')
    expect(teamName('XYZ')).toBeUndefined()
  })
})
