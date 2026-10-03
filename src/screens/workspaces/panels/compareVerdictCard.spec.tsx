import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { buildGutCheck } from '@models/player/CompareGutCheck'
import { computeVerdict, verdictInputs, type VerdictLeague } from '@models/player/CompareVerdict'
import { PlayerComparison, type ComparisonPlayer } from '@models/player/PlayerComparison'
import { VerdictView } from './compareVerdictCard'

describe('Compare verdict card', () => {
  const league: VerdictLeague = { waivers: { kind: 'reverseStandings' }, teamCount: 8, currentWeek: 4, playoffStartWeek: 15 }
  const player = (name: string, ros: number, o: Partial<ComparisonPlayer>): ComparisonPlayer => ({
    id: name.toLowerCase(), name, seriesIndex: 0, log: [],
    values: { restOfSeason: ros, projectedThisWeek: ros, expectedPointsLast4: ros }, ...o,
  })

  it('a rostered player against a free agent reads Keep, tags YOURS, and shows the gut check', () => {
    const comparison = new PlayerComparison([
      player('Alpha', 14, { availability: { kind: 'mine' } }),
      player('Bravo', 9, { availability: { kind: 'freeAgent' }, ceiling: 30 }),
    ], 4, [])
    const verdict = computeVerdict(verdictInputs(comparison), league)
    const html = renderToString(<VerdictView verdict={verdict} gutCheck={buildGutCheck(comparison, verdict)} />)
    expect(html).toContain('Keep Alpha over Bravo')
    expect(html).toContain('YOURS')
    expect(html).toContain('Gut check')
    expect(html).toContain('Case for Bravo')
    expect(html).toContain('the higher ceiling')
  })
})
