// node --test scripts/in-season-context.test.mjs
//
// The four in-season builders on hand-written rows shaped like the real nflverse,
// ffverse and ESPN CSVs (docs/IN_SEASON_DATA.md is the contract these assert).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildInjuries, buildDepthCharts, buildUsage, buildContext,
  normalizeTeam, toPositionGroup, crosswalkMaps, latestDepthRows,
  INJURY_FIELDS, USAGE_FIELDS, CONTEXT_FIELDS,
} from './lib/inSeasonContext.mjs'

const SEASON = 2026
const zip = (fields, tuple) => Object.fromEntries(fields.map((f, i) => [f, tuple[i]]))

// ── Team codes and positions ──────────────────────────────────────────────────
test('team aliases normalize to nflverse spelling; unknown codes are reported, not silently kept', () => {
  assert.equal(normalizeTeam('LAR'), 'LA')
  assert.equal(normalizeTeam('WSH'), 'WAS')
  assert.equal(normalizeTeam('KAN'), 'KC')
  assert.equal(normalizeTeam('KC'), 'KC')
  assert.equal(normalizeTeam(''), null)
  const diag = { unknownTeams: new Set() }
  assert.equal(normalizeTeam('XYZ', diag), 'XYZ')
  assert.deepEqual([...diag.unknownTeams], ['XYZ'])
})

test('positions and depth slots map to the Sleeper dialect', () => {
  assert.equal(toPositionGroup('PK'), 'K')
  assert.equal(toPositionGroup('RILB'), 'LB')
  assert.equal(toPositionGroup('NB'), 'DB')
  assert.equal(toPositionGroup('FB'), 'RB')
  assert.equal(toPositionGroup('KR'), null)
  assert.equal(toPositionGroup(''), null)
})

// ── Injuries ──────────────────────────────────────────────────────────────────
const injuryRow = (o) => ({
  season: '2026', season_type: 'REG', game_type: 'REG', team: 'ARI', week: '3', gsis_id: '00-0000001',
  position: 'LB', full_name: 'X', report_primary_injury: '', report_secondary_injury: '',
  report_status: '', practice_primary_injury: '', practice_secondary_injury: '', practice_status: '', ...o,
})

test('injuries: status and practice map, empties are null, primary falls back to the practice report, OL is dropped', () => {
  const out = buildInjuries([
    injuryRow({ gsis_id: '00-0000001', report_status: 'Questionable', practice_status: 'Limited Participation in Practice', report_primary_injury: 'Knee' }),
    injuryRow({ gsis_id: '00-0000002', position: 'K', report_status: '', practice_status: 'Full Participation in Practice', practice_primary_injury: 'Groin' }),
    injuryRow({ gsis_id: '00-0000003', position: 'CB', report_status: 'Out', practice_status: 'Did Not Participate In Practice', team: 'LAR' }),
    injuryRow({ gsis_id: '00-0000004', position: 'T', report_status: 'Doubtful', practice_status: '' }),
    injuryRow({ gsis_id: '', report_status: 'Out' }),                       // no id: dropped
    injuryRow({ gsis_id: '00-0000005', week: '1', season_type: 'POST' }),   // not REG: dropped
    injuryRow({ gsis_id: '00-0000006', week: '1', report_status: 'Out' }),
  ], SEASON)

  assert.deepEqual(out.fields, INJURY_FIELDS)
  assert.deepEqual(out._meta.weeks, [1, 3])
  assert.equal(out._meta.season, SEASON)
  assert.deepEqual(Object.keys(out.byWeek).sort(), ['1', '3'])

  const wk3 = out.byWeek[3].map((t) => zip(out.fields, t))
  assert.deepEqual(wk3[0], { gsis: '00-0000001', team: 'ARI', pos: 'LB', status: 'Questionable', practice: 'LTD', primary: 'Knee' })
  assert.deepEqual(wk3[1], { gsis: '00-0000002', team: 'ARI', pos: 'K', status: null, practice: 'FULL', primary: 'Groin' })
  assert.deepEqual(wk3[2], { gsis: '00-0000003', team: 'LA', pos: 'DB', status: 'Out', practice: 'DNP', primary: null })
  assert.equal(wk3.length, 3)                 // the tackle (pos 'T') is not a roster position
  assert.equal(out._meta.droppedRows, 1)
  assert.equal(out._meta.latestCsvWeek, 3)
  assert.equal(out._meta.latestWeekRows, 3)
})

test('injuries: a latest CSV week with only unkeyed rows reports zero rows for the self-check', () => {
  const out = buildInjuries([
    injuryRow({ week: '1', gsis_id: '00-0000001', report_status: 'Out' }),
    injuryRow({ week: '2', gsis_id: '' }),
  ], SEASON)
  assert.equal(out._meta.latestCsvWeek, 2)
  assert.equal(out._meta.latestWeekRows, 0)
  assert.deepEqual(out._meta.weeks, [1])
})

// ── Depth charts ──────────────────────────────────────────────────────────────
const depthRow = (o) => ({
  dt: '2026-09-22T12:33:43Z', team: 'KC', player_name: 'P', espn_id: '1', gsis_id: '00-0000001',
  pos_grp_id: '1', pos_grp: '3WR 1TE', pos_id: '1', pos_name: 'Wide Receiver', pos_abb: 'WR', pos_slot: '1', pos_rank: '1', ...o,
})

test('depth: only the newest dt per team survives, even when teams are updated at different times', () => {
  const rows = [
    depthRow({ dt: '2026-09-01T00:00:00Z', gsis_id: '00-0000009', pos_abb: 'QB' }),   // stale KC
    depthRow({ dt: '2026-09-22T12:33:43Z', gsis_id: '00-0000001', pos_abb: 'QB' }),
    depthRow({ dt: '2026-09-21T00:00:00Z', team: 'BUF', gsis_id: '00-0000002', pos_abb: 'QB' }),
    depthRow({ dt: '2026-09-10T00:00:00Z', team: 'BUF', gsis_id: '00-0000008', pos_abb: 'QB' }), // older, listed later
  ]
  const latest = latestDepthRows(rows)
  assert.deepEqual(latest.map((r) => r.gsis_id).sort(), ['00-0000001', '00-0000002'])

  const out = buildDepthCharts(rows, SEASON)
  assert.deepEqual(out.teams.KC.QB, ['00-0000001'])
  assert.deepEqual(out.teams.BUF.QB, ['00-0000002'])
  assert.equal(out._meta.asOf, '2026-09-22T12:33:43Z')
  assert.equal(out._meta.teams, 2)
})

test('depth: slots map to groups, rank 1 across all slots comes before rank 2, special teams and OL are dropped', () => {
  const out = buildDepthCharts([
    depthRow({ gsis_id: 'wr1s2', pos_abb: 'WR', pos_slot: '2', pos_rank: '1', player_name: 'B' }),
    depthRow({ gsis_id: 'wr2s1', pos_abb: 'WR', pos_slot: '1', pos_rank: '2', player_name: 'C' }),
    depthRow({ gsis_id: 'wr1s1', pos_abb: 'WR', pos_slot: '1', pos_rank: '1', player_name: 'A' }),
    depthRow({ gsis_id: 'wr1s3', pos_abb: 'WR', pos_slot: '3', pos_rank: '1', player_name: 'D' }),
    depthRow({ gsis_id: 'wr2s1', pos_abb: 'WR', pos_slot: '3', pos_rank: '3', player_name: 'C' }), // same player twice: best rank wins
    depthRow({ gsis_id: 'k1', pos_abb: 'PK', pos_grp: 'Special Teams' }),
    depthRow({ gsis_id: 'kr1', pos_abb: 'KR', pos_grp: 'Special Teams' }),
    depthRow({ gsis_id: 'lt1', pos_abb: 'LT' }),
    depthRow({ gsis_id: 'fb1', pos_abb: 'FB', pos_slot: '2', pos_rank: '1' }),
    depthRow({ gsis_id: 'rb1', pos_abb: 'RB', pos_slot: '1', pos_rank: '1' }),
    depthRow({ gsis_id: 'lde1', pos_abb: 'LDE', pos_grp: 'Base 4-3 D' }),
    depthRow({ gsis_id: 'rilb2', pos_abb: 'RILB', pos_grp: 'Base 3-4 D', pos_rank: '2' }),
    depthRow({ gsis_id: 'wlb1', pos_abb: 'WLB', pos_grp: 'Base 4-3 D', pos_rank: '1' }),
    depthRow({ gsis_id: 'nb1', pos_abb: 'NB', pos_grp: 'Base 4-3 D' }),
    depthRow({ gsis_id: '', pos_abb: 'TE' }),                                            // no id: dropped
  ], SEASON)
  const kc = out.teams.KC
  assert.deepEqual(kc.WR, ['wr1s1', 'wr1s2', 'wr1s3', 'wr2s1'])
  assert.deepEqual(kc.K, ['k1'])
  assert.deepEqual(kc.RB, ['rb1', 'fb1'])   // FB joins the RB group; same rank, so slot order
  assert.deepEqual(kc.DL, ['lde1'])
  assert.deepEqual(kc.LB, ['wlb1', 'rilb2'])
  assert.deepEqual(kc.DB, ['nb1'])
  assert.equal(kc.TE, undefined)
  assert.equal(kc.OL, undefined)
  assert.deepEqual(Object.keys(kc).sort(), ['DB', 'DL', 'K', 'LB', 'RB', 'WR'])
})

// ── Usage ─────────────────────────────────────────────────────────────────────
const idRows = [
  { gsis_id: '00-0039165', pfr_id: 'GibbJa00', espn_id: '4429795', sleeper_id: '9509', name: 'Jahmyr Gibbs', position: 'RB' },
  { gsis_id: '00-0033873', pfr_id: 'MahoPa00', espn_id: '3139477', sleeper_id: '4046', name: 'Patrick Mahomes', position: 'QB' },
  { gsis_id: '00-0031234', pfr_id: 'LinemAn00', espn_id: '', sleeper_id: '1', name: 'Some Lineman', position: 'OL' },
  { gsis_id: '00-0036000', pfr_id: 'DefeJo00', espn_id: '', sleeper_id: '2', name: 'Joe Defender', position: 'LB' },
  { gsis_id: '', pfr_id: 'Orphan00', espn_id: '', sleeper_id: '3', name: 'No Gsis', position: 'WR' },
]
const { pfrToGsis, espnToGsis, gsisInfo } = crosswalkMaps(idRows)

test('crosswalk maps skip rows without a gsis id', () => {
  assert.equal(pfrToGsis.get('GibbJa00'), '00-0039165')
  assert.equal(pfrToGsis.has('Orphan00'), false)
  assert.equal(espnToGsis.get('3139477'), '00-0033873')
  assert.equal(gsisInfo['00-0039165'].sleeperId, '9509')
})

const snap = (o) => ({ game_id: 'g', pfr_game_id: 'p', season: '2026', game_type: 'REG', week: '1', player: 'X', pfr_player_id: 'GibbJa00',
  position: 'RB', team: 'DET', opponent: 'GB', offense_snaps: '45', offense_pct: '0.71', defense_snaps: '0', defense_pct: '0', st_snaps: '0', st_pct: '0', ...o })
const ep = (o) => ({ season: '2026', posteam: 'DET', week: '1', game_id: 'g', player_id: '00-0039165', full_name: 'Jahmyr Gibbs', position: 'RB',
  rec_attempt: '8', rush_attempt: '16', receptions: '6', rec_fantasy_points_exp: '9.5', rush_fantasy_points_exp: '12.4', total_fantasy_points_exp: '21.9', total_fantasy_points: '25.1', ...o })
const rush = (o) => ({ season: '2026', week: '1', game_type: 'REG', team: 'DET', opponent: 'GB', pfr_player_name: 'Jahmyr Gibbs', pfr_player_id: 'GibbJa00',
  carries: '16', rushing_yards_before_contact: '34', rushing_yards_before_contact_avg: '2.1', rushing_yards_after_contact: '48', rushing_yards_after_contact_avg: '3.0',
  rushing_broken_tackles: '1', receiving_broken_tackles: '', ...o })
const rec = (o) => ({ season: '2026', week: '1', game_type: 'REG', team: 'DET', opponent: 'GB', pfr_player_name: 'Jahmyr Gibbs', pfr_player_id: 'GibbJa00',
  rushing_broken_tackles: '', receiving_broken_tackles: '1', passing_drops: '', passing_drop_pct: '', receiving_drop: '0', receiving_drop_pct: '0', receiving_int: '0', receiving_rat: '100.0', ...o })

test('usage: tuple order matches fields and every source lands in its column', () => {
  const out = buildUsage({
    snapRows: [snap({})], epRows: [ep({})], pfrRushRows: [rush({})], pfrRecRows: [rec({})], pfrToGsis, gsisInfo,
  }, SEASON)
  assert.deepEqual(out.fields, USAGE_FIELDS)
  assert.deepEqual(out.fields, ['week', 'off_snp', 'off_pct', 'def_snp', 'def_pct', 'xfp', 'xfp_rush', 'xfp_rec',
    'rush_att', 'tgt', 'ybc_avg', 'yac_avg', 'broken_tackles', 'drops'])
  const rows = out.players['00-0039165']
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], [1, 45, 0.71, 0, 0, 21.9, 12.4, 9.5, 16, 8, 2.1, 3.0, 2, 0])
  assert.deepEqual(out.meta['00-0039165'], { n: 'Jahmyr Gibbs', p: 'RB', t: 'DET' })
  assert.deepEqual(out._meta.weeks, [1])
  assert.equal(out._meta.joinRates.ep, 1)
  assert.equal(out._meta.joinRates.snap, 1)
})

test('usage: an absent source is null in its columns, never 0', () => {
  // Week 1: snaps only (no ep, no pfr). Week 2: ep only.
  const out = buildUsage({
    snapRows: [snap({ week: '1' })],
    epRows: [ep({ week: '2' })],
    pfrRushRows: [], pfrRecRows: [], pfrToGsis, gsisInfo,
  }, SEASON)
  const [wk1, wk2] = out.players['00-0039165'].map((t) => zip(out.fields, t))
  assert.equal(wk1.week, 1)
  assert.equal(wk1.off_snp, 45)
  assert.equal(wk1.xfp, null)
  assert.equal(wk1.rush_att, null)
  assert.equal(wk1.ybc_avg, null)
  assert.equal(wk1.broken_tackles, null)
  assert.equal(wk1.drops, null)
  assert.equal(wk2.week, 2)
  assert.equal(wk2.off_snp, null)
  assert.equal(wk2.off_pct, null)
  assert.equal(wk2.def_snp, null)
  assert.equal(wk2.xfp, 21.9)
  assert.deepEqual(out._meta.weeks, [1, 2])
})

test('usage: snap and pfr rows join through pfr→gsis; unmapped pfr ids and OL are dropped, IDP snaps are kept', () => {
  const out = buildUsage({
    snapRows: [
      snap({ pfr_player_id: 'MahoPa00', player: 'Patrick Mahomes', position: 'QB', team: 'KC' }),
      snap({ pfr_player_id: 'Nobody00', player: 'Unknown' }),                          // not in crosswalk
      snap({ pfr_player_id: 'LinemAn00', player: 'Some Lineman', position: 'G' }),     // OL: dropped
      snap({ pfr_player_id: 'DefeJo00', player: 'Joe Defender', position: 'LB', offense_snaps: '0', offense_pct: '0', defense_snaps: '60', defense_pct: '0.92' }),
    ],
    epRows: [ep({ player_id: '00-0033873', full_name: 'Patrick Mahomes', position: 'QB', posteam: 'KC' }), ep({ player_id: '00-0099999', full_name: 'Not In Crosswalk' })],
    pfrRushRows: [rush({ pfr_player_id: 'MahoPa00', pfr_player_name: 'Patrick Mahomes', team: 'KAN', rushing_yards_before_contact_avg: '4.5', rushing_yards_after_contact_avg: '1.5', rushing_broken_tackles: '0' })],
    pfrRecRows: [],
    pfrToGsis, gsisInfo,
  }, SEASON)
  assert.deepEqual(Object.keys(out.players).sort(), ['00-0033873', '00-0036000', '00-0099999'])
  const m = zip(out.fields, out.players['00-0033873'][0])
  assert.equal(m.off_snp, 45)
  assert.equal(m.ybc_avg, 4.5)
  assert.equal(m.broken_tackles, 0)
  assert.equal(m.drops, null)
  assert.equal(out.meta['00-0033873'].t, 'KC')
  const d = zip(out.fields, out.players['00-0036000'][0])
  assert.equal(d.def_snp, 60)
  assert.equal(d.def_pct, 0.92)
  assert.equal(out.meta['00-0036000'].p, 'LB')
  // 3 of 4 snap rows mapped; 1 of 2 ep rows in the crosswalk.
  assert.equal(out._meta.joinRates.snap, 0.75)
  assert.equal(out._meta.joinRates.ep, 0.5)
  assert.equal(out._meta.rowCounts.snap, 4)
})

// ── Context ───────────────────────────────────────────────────────────────────
const stat = (o) => ({ player_id: 'p', player_display_name: 'P', position: 'WR', season: '2026', week: '1', season_type: 'REG', team: 'KC', opponent_team: 'DEN',
  completions: '0', attempts: '0', passing_yards: '0', passing_tds: '0', passing_interceptions: '0', sacks_suffered: '0', carries: '0', targets: '0', ...o })

const statRows = [
  // KC week 1: one passer, two backs, three targets. 38 att + 26 car + 2 sacks = 66 plays.
  stat({ player_id: '00-0033873', position: 'QB', completions: '25', attempts: '38', passing_yards: '300', passing_tds: '3', passing_interceptions: '0', sacks_suffered: '2', carries: '3' }),
  stat({ player_id: 'rb1', position: 'RB', carries: '18', targets: '4' }),
  stat({ player_id: 'rb2', position: 'RB', carries: '5', targets: '2' }),
  stat({ player_id: 'wr1', position: 'WR', targets: '12' }),
  stat({ player_id: 'te1', position: 'TE', targets: '8' }),
  stat({ player_id: 'lb1', position: 'LB' }),   // IDP row: contributes nothing, breaks nothing
  // DEN week 1: no pfr rows, no qbr row.
  stat({ team: 'DEN', opponent_team: 'KC', player_id: 'qbD', position: 'QB', completions: '20', attempts: '30', passing_yards: '200', passing_tds: '1', passing_interceptions: '1', sacks_suffered: '4' }),
  stat({ team: 'DEN', opponent_team: 'KC', player_id: 'rbD', position: 'RB', carries: '20', targets: '5' }),
  stat({ team: 'DEN', opponent_team: 'KC', player_id: 'wrD', position: 'WR', targets: '5' }),
  // A POST row must be ignored.
  stat({ season_type: 'POST', week: '19', player_id: 'x', attempts: '40' }),
]
const pfrPassRows = [
  { season: '2026', week: '1', game_type: 'REG', team: 'KC', opponent: 'DEN', pfr_player_name: 'Patrick Mahomes', pfr_player_id: 'MahoPa00', times_sacked: '2', times_pressured: '8', times_pressured_pct: '0.208' },
  { season: '2026', week: '1', game_type: 'REG', team: 'KC', opponent: 'DEN', pfr_player_name: 'Backup', pfr_player_id: 'Back00', times_sacked: '0', times_pressured: '1', times_pressured_pct: '0.5' },
]
const ctxRushRows = [
  rush({ team: 'KC', pfr_player_id: 'a', carries: '18', rushing_yards_before_contact: '54' }),
  rush({ team: 'KC', pfr_player_id: 'b', carries: '6', rushing_yards_before_contact: '30' }),
]
const qbrRows = [
  { season: '2026', season_type: 'Regular', game_week: '1', team_abb: 'KC', player_id: '3139477', qbr_total: '94.0', qualified: 'TRUE', qb_plays: '45' },
  { season: '2025', season_type: 'Regular', game_week: '1', team_abb: 'KC', player_id: '3139477', qbr_total: '50.0', qualified: 'TRUE', qb_plays: '45' },  // wrong season
  { season: '2026', season_type: 'Playoffs', game_week: '1', team_abb: 'DEN', player_id: '1', qbr_total: '10.0', qualified: 'TRUE', qb_plays: '45' },     // not regular
]

test('context: plays, pressure for the primary passer, weighted ybc, qbr, passer rating and target shares', () => {
  const out = buildContext({ statRows, pfrPassRows, pfrRushRows: ctxRushRows, qbrRows, pfrToGsis, espnToGsis }, SEASON)
  assert.deepEqual(out.fields, CONTEXT_FIELDS)
  assert.deepEqual(out._meta.weeks, [1])
  assert.deepEqual(Object.keys(out.teams).sort(), ['DEN', 'KC'])

  const kc = zip(out.fields, out.teams.KC[0])
  assert.equal(kc.week, 1)
  assert.equal(kc.opp, 'DEN')
  assert.equal(kc.plays, 66)
  assert.equal(kc.pass_att, 38)
  assert.equal(kc.rush_att, 26)
  assert.equal(kc.pressure_pct, 0.208)     // Mahomes' row, not the backup's 0.5
  assert.equal(kc.sacks, 2)
  assert.equal(kc.ybc_avg, 3.5)            // (54 + 30) / (18 + 6)
  assert.equal(kc.qbr, 94)
  assert.equal(kc.pass_rtg, Math.round(passerRatingRef(25, 38, 300, 3, 0) * 10) / 10)
  assert.equal(kc.top_tgt_share, 0.462)    // 12 / 26
  assert.equal(kc.top2_tgt_share, 0.769)   // 20 / 26
})

test('context: a team with no pfr or qbr row carries nulls, not zeros', () => {
  const out = buildContext({ statRows, pfrPassRows, pfrRushRows: ctxRushRows, qbrRows, pfrToGsis, espnToGsis }, SEASON)
  const den = zip(out.fields, out.teams.DEN[0])
  assert.equal(den.plays, 54)              // 30 + 20 + 4
  assert.equal(den.pressure_pct, null)
  assert.equal(den.sacks, null)
  assert.equal(den.ybc_avg, null)
  assert.equal(den.qbr, null)
  assert.equal(den.top_tgt_share, 0.5)
  assert.equal(den.top2_tgt_share, 1)
  assert.equal(typeof den.pass_rtg, 'number')
})

test('context: a team with no targets or attempts has null shares and rating, and ESPN/PFR spellings join', () => {
  const out = buildContext({
    statRows: [stat({ team: 'LA', opponent_team: 'SF', player_id: 'x', carries: '10' })],
    pfrPassRows: [{ season: '2026', week: '1', game_type: 'REG', team: 'RAM', pfr_player_id: 'z', times_sacked: '1', times_pressured: '3', times_pressured_pct: '0.3' }],
    pfrRushRows: [],
    qbrRows: [{ season: '2026', season_type: 'Regular', game_week: '1', team_abb: 'LAR', player_id: '9', qbr_total: '61.2', qualified: 'TRUE', qb_plays: '30' }],
    pfrToGsis, espnToGsis,
  }, SEASON)
  const la = zip(out.fields, out.teams.LA[0])
  assert.equal(la.plays, 10)              // 10 carries; sacks come from stat rows, not the pfr row
  assert.equal(la.pass_rtg, null)
  assert.equal(la.top_tgt_share, null)
  assert.equal(la.top2_tgt_share, null)
  assert.equal(la.sacks, 1)                // RAM → LA
  assert.equal(la.qbr, 61.2)               // LAR → LA
})

// Reference passer rating, written out longhand so the test is not the code under test.
function passerRatingRef(cmp, att, yds, td, int) {
  const cl = (x) => Math.max(0, Math.min(2.375, x))
  const a = cl((cmp / att - 0.3) * 5), b = cl((yds / att - 3) * 0.25)
  const c = cl((td / att) * 20), d = cl(2.375 - (int / att) * 25)
  return ((a + b + c + d) / 6) * 100
}
