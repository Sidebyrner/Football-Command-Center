import { describe, expect, it } from 'vitest'
import { MatchupModel, myShare, type MatchupRow, type MatchupSide } from '../MatchupModel'

/** Port of MatchupPairingTests: `MatchupModel.pair` as a pure function, with rows built by hand. */
function row(index: number, options: { slot?: string; name?: string | null; live?: number; season?: number; onBye?: boolean } = {}): MatchupRow {
  const { slot = 'RB', live, season, onBye = false } = options
  const name = options.name === null ? undefined : options.name ?? 'Player'
  return {
    index, slot, playerID: name === undefined ? undefined : `p${index}${name}`,
    name, position: 'RB', nflTeam: 'PHI', opponent: onBye ? undefined : 'DAL',
    isHome: true, onBye, livePoints: live,
    season: season === undefined ? undefined : { games: 10, pointsPerGame: season },
    defense: undefined, impliedTotal: undefined,
    isLocked: false, isLive: false,
  }
}

const side = (rows: MatchupRow[]): MatchupSide => ({
  rosterID: 1, manager: 'x', isUser: true, livePoints: undefined, rows,
  environment: { total: undefined, teamCount: 0, missingTeams: [] },
})

describe('MatchupModel.pair', () => {
  it('before kickoff the basis is season average', () => {
    const result = MatchupModel.pair(side([row(0, { season: 18 })]), side([row(0, { season: 12 })]))
    expect(result.basis).toBe('seasonAverage')
    expect(result.slots[0]!.leader).toBe('mine')
    expect(Math.abs((myShare(result.slots[0]!) ?? 0) - 0.6)).toBeLessThanOrEqual(0.001)
  })

  /** One basis for the whole matchup: once anyone has a live number, season averages are not mixed in. */
  it('one live score anywhere switches every slot to live', () => {
    const result = MatchupModel.pair(
      side([row(0, { live: 4, season: 30 }), row(1, { season: 20 })]),
      side([row(0, { live: 9, season: 5 }), row(1, { season: 10 })]),
    )
    expect(result.basis).toBe('livePoints')
    expect(result.slots[0]!.leader, 'live points win over a better season').toBe('theirs')
    expect(result.slots[1]!.leader, 'no live numbers yet in slot 2').toBe('undecided')
  })

  it('a bye starter counts as zero', () => {
    const result = MatchupModel.pair(side([row(0, { season: 40, onBye: true })]), side([row(0, { season: 8 })]))
    expect(result.slots[0]!.myValue).toBe(0)
    expect(result.slots[0]!.leader).toBe('theirs')
  })

  it('close values are even', () => {
    const result = MatchupModel.pair(side([row(0, { season: 12.02 })]), side([row(0, { season: 12.0 })]))
    expect(result.slots[0]!.leader).toBe('even')
  })

  /** Two empty slots, or an empty slot against a bye, decide nothing. */
  it('empty against bye is undecided', () => {
    const result = MatchupModel.pair(side([row(0, { name: null })]), side([row(0, { season: 10, onBye: true })]))
    expect(result.slots[0]!.leader).toBe('undecided')
  })

  it('no opponent still pairs my side', () => {
    const result = MatchupModel.pair(side([row(0, { season: 10 })]), undefined)
    expect(result.slots.length).toBe(1)
    expect(result.slots[0]!.theirs).toBeUndefined()
    expect(myShare(result.slots[0]!)).toBeUndefined()
  })
})
