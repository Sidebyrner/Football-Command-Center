import { describe, expect, it } from 'vitest'
import { Cache, MemoryStore } from '@data/cache'
import {
  bench, decodeLeague, decodeMember, decodeNFLState, decodeRoster, decodeTransaction, effectiveTradeDeadline,
  EMPTY_STARTER_SLOT, filledStarters, isRegularSeason, isTransactionComplete, memberLabel, pointsAgainst, pointsFor,
  seasonYear,
} from '@data/sleeperModels'

const j = (s: string) => JSON.parse(s) as unknown

/** Port of SleeperModelTests (the FCCore-dependent ones arrive with Phase 1). */
describe('Sleeper models', () => {
  it('keeps starters positionally aligned', () => {
    const r = decodeRoster(j('{"roster_id":1,"owner_id":"u1","starters":["4034","0","6794","PHI"],"players":["4034","6794","PHI","1234"]}'))
    expect(r.starters).toEqual(['4034', '0', '6794', 'PHI'])
    expect(r.starters?.[1]).toBe(EMPTY_STARTER_SLOT)
  })

  it('drops unset slots from filled starters but keeps order', () => {
    expect(filledStarters(decodeRoster(j('{"roster_id":1,"starters":["4034","0","6794","PHI"],"players":[]}')))).toEqual(['4034', '6794', 'PHI'])
  })

  it('keeps a team defense as a starter', () => {
    const r = decodeRoster(j('{"roster_id":1,"starters":["PHI"],"players":["PHI"]}'))
    expect(filledStarters(r)).toEqual(['PHI'])
    expect(bench(r)).toEqual([])
  })

  it('benches what is rostered but not starting, never the sentinel', () => {
    expect(bench(decodeRoster(j('{"roster_id":1,"starters":["4034","0"],"players":["4034","6794","1234"]}')))).toEqual(['6794', '1234'])
    expect(bench(decodeRoster(j('{"roster_id":1,"starters":["0","0"],"players":["4034"]}')))).toEqual(['4034'])
  })

  it("recombines points across Sleeper's split fields", () => {
    const r = decodeRoster(j('{"roster_id":1,"settings":{"wins":7,"losses":3,"fpts":1234,"fpts_decimal":56,"fpts_against":1100,"fpts_against_decimal":4}}'))
    expect(pointsFor(r.settings)).toBeCloseTo(1234.56, 3)
    expect(pointsAgainst(r.settings)).toBeCloseTo(1100.04, 3)
    expect(pointsFor(decodeRoster(j('{"roster_id":1,"settings":{"wins":0}}')).settings)).toBeUndefined()
  })

  it('reads the team name from nested metadata, then falls back', async () => {
    const m = decodeMember(j('{"user_id":"u1","display_name":"connor","metadata":{"team_name":"Byrne Notice"}}'))
    expect(m.teamName).toBe('Byrne Notice')
    expect(memberLabel(m)).toBe('Byrne Notice')
    expect(memberLabel(decodeMember(j('{"user_id":"u1","display_name":"connor"}')))).toBe('connor')
    expect(memberLabel(decodeMember(j('{"user_id":"u1"}')))).toBe('u1')
    // Round-trips through the cache with its team name intact.
    const cache = new Cache(new MemoryStore())
    await cache.store(m, 'member', 60)
    expect((await cache.load<typeof m>('member'))?.value.teamName).toBe('Byrne Notice')
  })

  it('exposes the season as a number', () => {
    const s = decodeNFLState(j('{"week":3,"season":"2026","season_type":"regular","leg":3}'))
    expect(s.week).toBe(3)
    expect(seasonYear(s)).toBe(2026)
    expect(isRegularSeason(s)).toBe(true)
  })

  it('reads transaction timestamps as milliseconds', () => {
    const t = decodeTransaction(j('{"transaction_id":"t1","type":"waiver","status":"complete","created":1757700000000,"roster_ids":[1],"adds":{"4034":1},"drops":null}'))
    expect(new Date(t.created!).getUTCFullYear()).toBeGreaterThan(2020)
    expect(isTransactionComplete(t)).toBe(true)
    expect(t.adds?.['4034']).toBe(1)
  })

  it('ignores unknown fields', () => {
    expect(decodeLeague(j('{"league_id":"L1","name":"Test","brand_new_field":{"nested":[1,2,3]},"another":"surprise"}')).leagueID).toBe('L1')
  })

  it('decodes league timing settings; a zero deadline means none', () => {
    const l = decodeLeague(j('{"league_id":"L1","settings":{"trade_deadline":11,"waiver_day_of_week":3,"playoff_week_start":15,"unrelated":7}}'))
    expect(effectiveTradeDeadline(l.settings)).toBe(11)
    expect(l.settings?.waiverDayOfWeek).toBe(3)
    expect(l.settings?.playoffWeekStart).toBe(15)
    expect(effectiveTradeDeadline(decodeLeague(j('{"league_id":"L1","settings":{"trade_deadline":0}}')).settings)).toBeUndefined()
  })

  it('refuses a league with no id', () => {
    expect(() => decodeLeague(j('{"unexpected":"shape"}'))).toThrow()
  })
})
