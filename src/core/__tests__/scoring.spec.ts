import { describe, expect, it } from 'vitest'
import {
  REFERENCE_TOLERANCE, scoreSeason, scoreWeek, validateAgainstReference,
} from '@core/ScoringEngine'
import { LEAGUE_DEFAULT, PPR_REFERENCE, SCORING_RULES, zeroedProfile } from '@core/ScoringProfile'
import { detectPPR, fromSleeper } from '@core/SleeperScoring'
import { WeeklyFile, WeeklyRow } from '@core/WeeklyStats'
import { gameOpponent, gamesInWeek, weeksAscending } from '@core/Schedule'
import { Player, schedule, weekly2025 } from '../../../tests/coreFixtures'
import { readFixture } from '../../../tests/swiftFixtures'

const rows = (id: string) => weekly2025().rows(id)

/** Port of ScoringGateTests — the highest-value test in the codebase. */
describe('scoring gate', () => {
  const report = validateAgainstReference(weekly2025())

  it('matches nflverse on every row to the cent', () => {
    expect(report.mismatchRows, JSON.stringify(report.worst)).toBe(0)
    expect(report.maxDelta).toBeLessThanOrEqual(REFERENCE_TOLERANCE)
    expect(report.passed).toBe(true)
  })

  it('actually bites: 6,037 rows checked, 543 skipped', () => {
    expect(report.checkedRows).toBe(6037)
    expect(report.skippedRows).toBe(543)
    expect(report.checkedRows + report.skippedRows).toBe(weekly2025().rowCount)
  })

  it('skips kickers rather than failing them', () => {
    const kickerRows = weekly2025().allPlayers().filter((p) => p.position === 'K').reduce((n, p) => n + p.rows.length, 0)
    expect(kickerRows).toBeGreaterThan(0)
    expect(report.skippedRows).toBeGreaterThanOrEqual(kickerRows)
  })

  it('detects a sign flip', () => {
    const broken = { ...PPR_REFERENCE, rushingTD: -6 }
    expect(validateAgainstReference(weekly2025(), broken).mismatchRows).toBeGreaterThan(100)
  })
})

/** Port of ScoringEngineTests. */
describe('ScoringEngine', () => {
  it('scores a known quarterback week', () => {
    const week1 = rows(Player.aaronRodgers)[0]!
    const score = scoreWeek(week1, LEAGUE_DEFAULT, 'QB')
    expect(score.points).toBeCloseTo(38.1, 3)
    expect([week1.week, week1.team, week1.opponent]).toEqual([1, 'PIT', 'NYJ'])
    const byRule = Object.fromEntries(score.breakdown.map((c) => [c.rule, c.points]))
    expect(byRule.passingYardsPerPoint).toBeCloseTo(12.2, 3)
    expect(byRule.passingTD).toBeCloseTo(24, 3)
    expect(byRule.passingFirstDown).toBeCloseTo(14, 3)
    expect(byRule.incompletion).toBeCloseTo(-8, 3)
    expect(byRule.sackTaken).toBeCloseTo(-4, 3)
  })

  it('orders the breakdown by impact and sums to the total', () => {
    const score = scoreWeek(rows(Player.joshAllen)[0], LEAGUE_DEFAULT, 'QB')
    expect(score.points).toBeCloseTo(60.7, 3)
    const magnitudes = score.breakdown.map((c) => Math.abs(c.points))
    expect(magnitudes).toEqual([...magnitudes].sort((a, b) => b - a))
    expect(score.breakdown.reduce((s, c) => s + c.points, 0)).toBeCloseTo(score.points!, 2)
    expect(score.breakdown.some((c) => c.points === 0)).toBe(false)
  })

  it('stacks yardage bonuses', () => {
    const score = scoreWeek(new WeeklyRow(1, 'BUF', 'NYJ', { passYards: 410, attempts: 30, completions: 30 }), LEAGUE_DEFAULT, 'QB')
    const rules = new Set(score.breakdown.map((c) => c.rule))
    expect(rules.has('passing300Bonus') && rules.has('passing400Bonus') && rules.has('completions25Bonus')).toBe(true)
    expect(score.points).toBeCloseTo(32.5, 3)
  })

  it('never produces infinity from a zero yards-per-point', () => {
    const profile = { ...LEAGUE_DEFAULT, receivingYardsPerPoint: 0, rushingYardsPerPoint: 0, passingYardsPerPoint: 0 }
    const score = scoreWeek(new WeeklyRow(3, 'SF', 'SEA', { recYards: 120, rushYards: 50, passYards: 250, recTD: 1 }), profile, 'WR')
    expect(Number.isFinite(score.points)).toBe(true)
    expect(score.points).toBeCloseTo(9, 3)
    expect(score.breakdown.some((c) => c.rule === 'receivingYardsPerPoint')).toBe(false)
  })

  it('treats a team defense as unsupported, not zero', () => {
    const score = scoreWeek(new WeeklyRow(1, 'PHI', 'DAL', {}), LEAGUE_DEFAULT, 'DEF')
    expect(score.points).toBeUndefined()
    expect(score.reason).toBe('Team defense is not in the nflverse player stats file')
    expect(score.unsupported).toContain('idpTackle')
    expect(score.unsupported).toContain('defPointsAllowed0')
  })

  it('scopes unsupported rules to what could fire and the league pays for', () => {
    const week1 = rows(Player.joshAllen)[0]
    expect(scoreWeek(week1, LEAGUE_DEFAULT, 'QB').unsupported).toEqual(['pickSix'])
    expect(scoreWeek(week1, LEAGUE_DEFAULT, 'RB').unsupported).toEqual([])
    expect(scoreWeek(week1, { ...LEAGUE_DEFAULT, pickSix: 0 }, 'QB').unsupported).toEqual([])
  })

  it('totals known seasons', () => {
    const allen = scoreSeason(rows(Player.joshAllen), LEAGUE_DEFAULT, 'QB')
    expect([allen.games, allen.total, allen.pointsPerGame]).toEqual([16, 478.3, 29.89])
    const bijan = scoreSeason(rows(Player.bijanRobinson), LEAGUE_DEFAULT, 'RB')
    expect([bijan.games, bijan.total, bijan.pointsPerGame]).toEqual([17, 409.8, 24.11])
    expect(allen.weeks.map((w) => w.week)).toEqual([...allen.weeks.map((w) => w.week)].sort((a, b) => a - b))
  })

  it('reports no pace for an empty season', () => {
    const season = scoreSeason([], LEAGUE_DEFAULT, 'WR')
    expect(season.games).toBe(0)
    expect(season.pointsPerGame).toBeUndefined()
  })

  it('is non-PPR by default, combines fumbles, and marks a missing row', () => {
    expect(LEAGUE_DEFAULT.receptionPoints).toBe(0)
    expect(scoreWeek(new WeeklyRow(1, 'MIN', 'CHI', { receptions: 10, recYards: 40, recFirstDowns: 2 }), LEAGUE_DEFAULT, 'WR').points).toBeCloseTo(6, 3)
    expect(scoreWeek(new WeeklyRow(4, 'DET', 'GB', { rushFumblesLost: 1, recFumblesLost: 1, sackFumblesLost: 1 }), LEAGUE_DEFAULT, 'RB').points).toBeCloseTo(-6, 3)
    const missing = scoreWeek(undefined, LEAGUE_DEFAULT, 'WR')
    expect(missing.points).toBeUndefined()
    expect(missing.reason).toBe('No stat line')
  })

  it('addresses every rule on the profile', () => {
    const profile = zeroedProfile('t', 't', 'bundledDefault')
    SCORING_RULES.forEach((rule, i) => { profile[rule] = i + 1 })
    SCORING_RULES.forEach((rule, i) => expect(profile[rule], rule).toBe(i + 1))
    expect(SCORING_RULES).toHaveLength(50)
  })
})

/** Port of SleeperScoringTests. */
describe('Sleeper scoring translation', () => {
  it('converts yardage by reciprocal and falls back rather than exploding', () => {
    const t = fromSleeper({ pass_yd: 0.04, rush_yd: 0.1, rec_yd: 0.1 })
    expect([t.profile.passingYardsPerPoint, t.profile.rushingYardsPerPoint, t.profile.receivingYardsPerPoint]).toEqual([25, 10, 10])
    expect(fromSleeper({ pass_yd: 0 }).profile.passingYardsPerPoint).toBe(LEAGUE_DEFAULT.passingYardsPerPoint)
  })

  it('zeroes absent rules instead of inheriting them', () => {
    const t = fromSleeper({ pass_td: 6 })
    expect(t.profile.passingTD).toBe(6)
    expect([t.profile.receptionPoints, t.profile.interception, t.profile.idpTackle]).toEqual([0, 0, 0])
    expect(t.profile.source).toBe('sleeper')
  })

  it('maps fumbles lost and surfaces unmapped paying rules, sorted', () => {
    expect(fromSleeper({ fum_lost: -2 }).profile.fumbleLost).toBe(-2)
    expect(fromSleeper({ fum_lost: -2 }).unmapped).not.toContain('fum_lost')
    expect(fromSleeper({ pass_td: 6, zeta_bonus: 3, alpha_bonus: 1, worthless_rule: 0 }).unmapped).toEqual(['alpha_bonus', 'zeta_bonus'])
  })

  it('collapses field-goal tiers to the longest bucket and reports a lossy collapse', () => {
    const t = fromSleeper({ fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50_59: 5 })
    expect([t.profile.fg0to39, t.profile.fg40to49, t.profile.fg50to59, t.profile.fg60plus]).toEqual([3, 4, 5, 5])
    expect(t.lossyFieldGoalTiers).toEqual([])
    const lossy = fromSleeper({ fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 4 })
    expect(lossy.profile.fg0to39).toBe(4)
    expect(lossy.lossyFieldGoalTiers).toEqual(['fgm_0_19', 'fgm_20_29', 'fgm_30_39'])
  })

  it('detects the PPR format', () => {
    expect(detectPPR({ rec: 1 }).label).toBe('Full PPR')
    expect(detectPPR({ rec: 0.5 }).label).toBe('Half PPR')
    expect(detectPPR({}).label).toBe('Non-PPR (standard)')
    expect(detectPPR(undefined).value).toBe(0)
    expect(detectPPR({ rec: 0 }).label).toBe('Non-PPR (standard)')
  })

  it('translates a league like the default and scores identically', () => {
    const settings = {
      pass_yd: 0.05, pass_td: 6, pass_fd: 1, pass_inc: -1, pass_sack: -1, pass_int: -5, pass_int_td: -10,
      bonus_pass_yd_300: 3, bonus_pass_yd_400: 6, bonus_pass_cmp_25: 3,
      rush_yd: 0.1, rush_td: 6, rush_fd: 1, bonus_rush_yd_100: 3, bonus_rush_yd_200: 6,
      rec: 0, rec_yd: 0.1, rec_td: 6, rec_fd: 1, bonus_rec_yd_100: 3, bonus_rec_yd_200: 6,
      fum_lost: -2, pass_2pt: 2, rush_2pt: 2, rec_2pt: 2, st_td: 6,
      fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50_59: 5, fgm_60p: 6, xpm: 1, fgmiss: -2,
      sack: 1, int: 3, fum_rec: 2, def_td: 6, safe: 2,
      pts_allow_0: 12, pts_allow_1_6: 9, pts_allow_7_13: 6, pts_allow_14_20: 3, pts_allow_21_27: 1, pts_allow_28_34: 0, pts_allow_35p: -3,
      idp_tkl: 1, idp_sack: 3, idp_int: 5, idp_fum_rec: 3, idp_def_td: 6, idp_pass_def: 1,
    }
    const t = fromSleeper(settings, 'Command Center')
    expect(t.unmapped).toEqual([])
    expect(t.ppr.label).toBe('Non-PPR (standard)')
    expect(t.profile.name).toBe('Command Center (from Sleeper)')
    for (const rule of SCORING_RULES) expect(t.profile[rule], rule).toBe(LEAGUE_DEFAULT[rule])
    const r = rows(Player.joshAllen)
    expect(scoreSeason(r, t.profile, 'QB').total).toBeCloseTo(scoreSeason(r, LEAGUE_DEFAULT, 'QB').total, 3)
  })

  it('lets a mid-season settings change flow through', () => {
    const row = rows(Player.bijanRobinson)[0]!
    const before = scoreWeek(row, fromSleeper({ rec_yd: 0.1, rec: 0 }).profile, 'RB').points!
    const after = scoreWeek(row, fromSleeper({ rec_yd: 0.1, rec: 1 }).profile, 'RB').points!
    expect(after).toBeGreaterThan(before)
    expect(after - before).toBeCloseTo(row.number('receptions'), 3)
  })
})

/** Port of WeeklyFileTests (the schedule checks included). */
describe('WeeklyFile and schedule', () => {
  it('decodes the shipped file', () => {
    const f = weekly2025()
    expect([f.playerCount, f.rowCount, f.fileMeta?.season, f.fileMeta?.complete, f.fileMeta?.weeks?.length]).toEqual([652, 6580, 2025, true, 18])
  })

  it('carries no defense or IDP data', () => {
    const f = weekly2025()
    expect(new Set(f.playerIDs.map((id) => f.position(id)))).toEqual(new Set(['QB', 'RB', 'WR', 'TE', 'K']))
  })

  it('decodes rows by field name, not index', () => {
    const reference = rows(Player.joshAllen)[0]!
    const reordered = new WeeklyFile(JSON.parse('{"fields":["opp","team","week","pass_yd","pass_td"],"meta":{"x":{"n":"Test","p":"QB"}},"players":{"x":[["BAL","BUF",1,394,2]]}}'))
    const row = reordered.rows('x')[0]!
    expect([row.week, row.team, row.opponent, row.number('passYards'), row.number('passTD')])
      .toEqual([reference.week, reference.team, reference.opponent, reference.number('passYards'), reference.number('passTD')])
  })

  it('tolerates unknown columns', () => {
    const f = new WeeklyFile(JSON.parse('{"fields":["week","team","rec_yd","brand_new_metric"],"meta":{"x":{"n":"Test","p":"WR"}},"players":{"x":[[3,"PHI",88,0.42]]},"_meta":{"season":2027,"somethingElse":true}}'))
    const row = f.rows('x')[0]!
    expect([row.week, row.number('recYards'), f.fileMeta?.season]).toEqual([3, 88, 2027])
    expect(scoreWeek(row, LEAGUE_DEFAULT, 'WR').points).toBeCloseTo(8.8, 3)
  })

  it('distinguishes an absent column from zero', () => {
    const f = new WeeklyFile(JSON.parse('{"fields":["week","team","rec_yd","fp_ppr_ref"],"meta":{"present":{"n":"A","p":"WR"},"absent":{"n":"B","p":"WR"}},"players":{"present":[[1,"PHI",50,5]],"absent":[[1,"PHI",50,null]]}}'))
    expect(f.rows('present')[0]!.value('pprReference')).toBe(5)
    expect(f.rows('absent')[0]!.value('pprReference')).toBeUndefined()
    expect(f.rows('absent')[0]!.number('pprReference')).toBe(0)
    const report = validateAgainstReference(f)
    expect([report.checkedRows, report.skippedRows]).toEqual([1, 1])
  })

  it('returns rows ascending, nothing for an unknown player, and a stable order', () => {
    const f = weekly2025()
    for (const id of f.playerIDs.slice(0, 50)) {
      const weeks = f.rows(id).map((r) => r.week)
      expect(weeks).toEqual([...weeks].sort((a, b) => a - b))
    }
    expect(f.rows('not-a-player')).toEqual([])
    expect(f.allPlayers().map((p) => p.gsisID)).toEqual([...f.playerIDs].sort())
  })

  it('decodes the manifest', () => {
    const manifest = readFixture<{ seasons: { season: number; weeks?: number; complete?: boolean }[]; _meta?: { generated?: string } }>('FCCore', 'weekly-index.json')
    const season = manifest.seasons.find((s) => s.season === 2025)!
    expect([season.weeks, season.complete]).toEqual([18, true])
    expect(manifest._meta?.generated).toBeDefined()
  })

  it('carries recorded closing lines in the schedule', () => {
    const s = schedule(2025)
    const opener = gamesInWeek(s, 1)[0]!
    expect([opener.home, opener.away, opener.spreadLine, opener.totalLine]).toEqual(['PHI', 'DAL', 8.5, 47.5])
    expect([gameOpponent(opener, 'PHI'), gameOpponent(opener, 'DAL'), gameOpponent(opener, 'KC')]).toEqual(['DAL', 'PHI', undefined])
    expect(weeksAscending(s).map((w) => w.week)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1))
    expect(s._meta?.games).toBe(272)
  })
})
