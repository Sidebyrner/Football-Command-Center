import { describe, expect, it } from 'vitest'
import {
  activePlayers, buildPlayerIndex, hasInjuryDesignation, heightLabel, isTeamDefense, playerCount, playerNflverseTeam,
  playerPosition, playersAt, searchPlayers,
} from '@data/playerIndex'
import { DataLayerError } from '@data/errors'

const payload = {
  4034: { full_name: 'Christian McCaffrey', first_name: 'Christian', last_name: 'McCaffrey', position: 'RB', team: 'SF', injury_status: null, active: true },
  6794: { full_name: 'Justin Jefferson', first_name: 'Justin', last_name: 'Jefferson', position: 'WR', team: 'MIN', injury_status: 'Questionable', active: true },
  PHI: { position: 'DEF', team: 'PHI', active: true },
  1234: { full_name: 'Retired Guy', position: 'WR', team: 'FA', active: false },
  9999: { full_name: 'No Flag', position: 'TE', team: 'NYJ' },
  5555: { first_name: 'Only', last_name: 'Parts', position: 'QB', team: 'LAR', active: true },
}

/** Port of PlayerIndexTests — the trimmed projection of the 5 MB payload. */
describe('PlayerIndex', () => {
  const index = buildPlayerIndex(payload)

  it('builds from the raw payload', () => {
    expect(playerCount(index)).toBe(6)
    expect(index.players['4034']?.name).toBe('Christian McCaffrey')
    expect(playerPosition(index.players['4034']!)).toBe('RB')
  })

  it('keys a team defense by abbreviation and still names it', () => {
    const d = index.players.PHI!
    expect(playerPosition(d)).toBe('DEF')
    expect(isTeamDefense(d)).toBe(true)
    expect(d.name).toBe('Philadelphia Eagles')
  })

  it('treats inactive and flagless players as out of the pool', () => {
    const active = activePlayers(index).map((p) => p.id)
    expect(active).not.toContain('1234')
    expect(active).toContain('4034')
    expect(index.players['9999']?.active).toBe(false)
    expect(active).not.toContain('9999')
  })

  it('falls back to first and last name', () => {
    expect(index.players['5555']?.name).toBe('Only Parts')
  })

  it('filters by position', () => {
    expect(playersAt(index, 'RB').map((p) => p.id)).toEqual(['4034'])
    expect(playersAt(index, 'DEF').map((p) => p.id)).toEqual(['PHI'])
  })

  it('searches ignoring case and punctuation, active only, never everything', () => {
    expect(searchPlayers(index, 'mccaffrey').map((p) => p.id)).toEqual(['4034'])
    expect(searchPlayers(index, 'Mc.Caffrey').map((p) => p.id)).toEqual(['4034'])
    expect(searchPlayers(index, 'JEFFERSON').map((p) => p.id)).toEqual(['6794'])
    expect(searchPlayers(index, 'Retired')).toEqual([])
    expect(searchPlayers(index, '')).toEqual([])
    expect(searchPlayers(index, '   ')).toEqual([])
  })

  it('sets an injury designation only when Sleeper reports one', () => {
    expect(hasInjuryDesignation(index.players['6794']!)).toBe(true)
    expect(hasInjuryDesignation(index.players['4034']!)).toBe(false)
  })

  it('normalises the team to the nflverse spelling', () => {
    expect(index.players['5555']?.team).toBe('LAR')
    expect(playerNflverseTeam(index.players['5555']!)).toBe('LA')
  })

  it('is substantially smaller than the payload', () => {
    // A real Sleeper record carries ~40 fields the app never reads.
    const unused = {
      search_rank: 12, search_full_name: 'x', search_first_name: 'x', search_last_name: 'x', fantasy_data_id: 1,
      rotowire_id: 1, rotoworld_id: 1, sportradar_id: 'abc-def', espn_id: 1, yahoo_id: 1, stats_id: 1, gsis_id: 'x',
      high_school: 'x', hashtag: '#x', birth_city: 'x', birth_state: 'x', birth_country: 'x', metadata: { x: 1 },
      fantasy_positions: ['RB'], practice_participation: null, injury_start_date: null, status: 'Active', sport: 'nfl',
    }
    const realistic = Object.fromEntries(Object.entries(payload).map(([id, p]) => [id, { ...p, ...unused }]))
    const trimmed = buildPlayerIndex(realistic)
    expect(JSON.stringify(trimmed).length).toBeLessThan(JSON.stringify(realistic).length / 3)
  })

  it('decodes bio fields in whatever shape Sleeper sends', () => {
    const bio = buildPlayerIndex(JSON.parse(`{
      "1": {"full_name":"A","position":"RB","team":"SF","active":true,"age":29,"years_exp":8,
            "college":"Stanford","height":"71","weight":"205","birth_date":"1996-06-07","number":23},
      "2": {"full_name":"B","position":"WR","team":"MIN","active":true,"height":"6'1\\"","weight":215,
            "birth_date":"1999-06-16","years_exp":0},
      "3": {"full_name":"C","position":"TE","team":"KC","active":true,"height":"","weight":null,"age":"31",
            "depth_chart_order":"2"}
    }`), Date.parse('2026-09-25T12:00:00Z'))
    const a = bio.players['1']!
    expect([a.age, a.yearsExperience, a.college, a.heightInches, heightLabel(a), a.weightPounds, a.jerseyNumber])
      .toEqual([29, 8, 'Stanford', 71, `5'11"`, 205, 23])
    const b = bio.players['2']!
    expect([b.heightInches, b.weightPounds, b.age, b.yearsExperience]).toEqual([73, 215, 27, 0])
    const c = bio.players['3']!
    expect([c.heightInches, c.weightPounds, c.age, c.depthChartOrder]).toEqual([undefined, undefined, 31, 2])
  })

  it('names the endpoint when the payload is malformed', () => {
    try {
      buildPlayerIndex([])
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(DataLayerError)
      const d = (error as DataLayerError).detail
      expect(d.kind === 'undecodable' && d.path).toBe('/players/nfl')
    }
  })
})
