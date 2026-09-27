/**
 * Port of FCAppTests `TestSupport`: the test league (JSON copied verbatim from
 * the Swift fixtures), a stub transport and a harness wired to the native test
 * bundle's static files, read in place.
 */
import { Cache, MemoryStore } from '@data/cache'
import { SleeperClient } from '@data/SleeperClient'
import { SleeperService } from '@data/SleeperService'
import { StaticDataStore, type BundledSource } from '@data/StaticDataStore'
import { hasFixture, readFixture } from './swiftFixtures'
import { StubTransport } from './stubTransport'

export const TestLeague = {
  rosterPositions: ["QB","RB","RB","WR","WR","TE","FLEX","K","DEF","IDP_FLEX","IDP_FLEX",
     "BN","BN","BN","BN","BN","IR"],
  scoringSettings: {"pass_yd":0.05,"pass_td":6,"pass_int":-5,"rec":0,"rec_yd":0.1,"rec_td":6,
     "rush_yd":0.1,"rush_td":6,"fum_lost":-3},
  leagueJSON(id = 'L1') {
    return JSON.stringify({ league_id: id, name: 'Byrne Notice', season: '2025', total_rosters: 12, roster_positions: TestLeague.rosterPositions, scoring_settings: TestLeague.scoringSettings })
  },
  rosters: String.raw`[{"roster_id":1,"owner_id":"u1",
          "players":["qb1","rb_la","rb_sea","wr1","wr2","te1","wr_flex","k1","PHI","lb1","dl1"],
          "starters":["qb1","rb_la","rb_sea","wr1","wr2","te1","wr_flex","k1","PHI","lb1","dl1"]},
         {"roster_id":2,"owner_id":"u2",
          "players":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"],
          "starters":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"]}]`,
  users: String.raw`[{"user_id":"u1","display_name":"connor","metadata":{"team_name":"Byrne Notice"}},
         {"user_id":"u2","display_name":"rival"}]`,
  players: String.raw`{"qb1":{"full_name":"Starter QB","position":"QB","team":"BUF","active":true},
         "rb_la":{"full_name":"Rams Back","position":"RB","team":"LAR","active":true},
         "rb_sea":{"full_name":"Seattle Back","position":"RB","team":"SEA","active":true},
         "wr1":{"full_name":"Receiver One","position":"WR","team":"MIN","active":true},
         "wr2":{"full_name":"Receiver Two","position":"WR","team":"DAL","active":true},
         "te1":{"full_name":"Tight End","position":"TE","team":"KC","active":true},
         "k1":{"full_name":"Kicker One","position":"K","team":"BAL","active":true},
         "PHI":{"position":"DEF","team":"PHI","active":true},
         "wr_flex":{"full_name":"Flex Receiver","position":"WR","team":"NE","active":true},
         "lb1":{"full_name":"Linebacker One","position":"LB","team":"CHI","active":true},
         "dl1":{"full_name":"Lineman One","position":"DL","team":"GB","active":true},
         "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true},
         "rb_buf":{"full_name":"Bills Back","position":"RB","team":"BUF","active":true},
         "rb_kc":{"full_name":"Chiefs Back","position":"RB","team":"KC","active":true},
         "wr3":{"full_name":"Receiver Three","position":"WR","team":"NYJ","active":true},
         "wr4":{"full_name":"Receiver Four","position":"WR","team":"MIA","active":true},
         "te2":{"full_name":"Tight End Two","position":"TE","team":"SF","active":true},
         "k2":{"full_name":"Kicker Two","position":"K","team":"NO","active":true},
         "DAL":{"position":"DEF","team":"DAL","active":true},
         "wr_flex2":{"full_name":"Flex Receiver Two","position":"WR","team":"CIN","active":true},
         "lb2":{"full_name":"Linebacker Two","position":"LB","team":"NE","active":true},
         "dl2":{"full_name":"Lineman Two","position":"DL","team":"TB","active":true}}`,
  dashboardRosters: String.raw`[{"roster_id":1,"owner_id":"u1",
          "players":["qb1","rb_la","rb_sea","wr1","wr2","te1","wr_flex","k1","PHI","lb1","dl1",
                     "bench_hero","no_score_guy"],
          "starters":["qb1","rb_la","rb_sea","wr1","wr2","te1","0","k1","PHI","lb1","dl1"],
          "settings":{"wins":1,"losses":1,"ties":0,"fpts":210,"fpts_decimal":55,
                      "fpts_against":205,"fpts_against_decimal":0}},
         {"roster_id":2,"owner_id":"u2",
          "players":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2",
                     "rival_pick"],
          "starters":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"],
          "settings":{"wins":2,"losses":0,"ties":0,"fpts":220,"fpts_decimal":0,
                      "fpts_against":190,"fpts_against_decimal":0}}]`,
  dashboardPlayers: String.raw`{"qb1":{"full_name":"Starter QB","position":"QB","team":"BUF","active":true},
         "rb_la":{"full_name":"Rams Back","position":"RB","team":"LAR","active":true},
         "rb_sea":{"full_name":"Seattle Back","position":"RB","team":"SEA","active":true},
         "wr1":{"full_name":"Receiver One","position":"WR","team":"MIN",
                "injury_status":"Questionable","active":true},
         "wr2":{"full_name":"Receiver Two","position":"WR","team":"DAL","active":true},
         "te1":{"full_name":"Tight End","position":"TE","team":"KC","active":true},
         "wr_flex":{"full_name":"Flex Receiver","position":"WR","team":"NE","active":true},
         "k1":{"full_name":"Kicker One","position":"K","team":"BAL","active":true},
         "PHI":{"position":"DEF","team":"PHI","active":true},
         "lb1":{"full_name":"Linebacker One","position":"LB","team":"CHI","active":true},
         "dl1":{"full_name":"Lineman One","position":"DL","team":"GB","active":true},
         "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true},
         "rb_buf":{"full_name":"Bills Back","position":"RB","team":"BUF","active":true},
         "rb_kc":{"full_name":"Chiefs Back","position":"RB","team":"KC","active":true},
         "wr3":{"full_name":"Receiver Three","position":"WR","team":"NYJ","active":true},
         "wr4":{"full_name":"Receiver Four","position":"WR","team":"MIA","active":true},
         "te2":{"full_name":"Tight End Two","position":"TE","team":"SF","active":true},
         "wr_flex2":{"full_name":"Flex Receiver Two","position":"WR","team":"CIN","active":true},
         "k2":{"full_name":"Kicker Two","position":"K","team":"NO","active":true},
         "DAL":{"position":"DEF","team":"DAL","active":true},
         "lb2":{"full_name":"Linebacker Two","position":"LB","team":"NE","active":true},
         "dl2":{"full_name":"Lineman Two","position":"DL","team":"TB","active":true},
         "bench_hero":{"full_name":"Bench Hero","position":"WR","team":"DEN","active":true},
         "no_score_guy":{"full_name":"No Score Guy","position":"WR","team":"CLE","active":true},
         "rival_pick":{"full_name":"Rival Pick","position":"RB","team":"ATL","active":true}}`,
  week1Matchups: String.raw`[{"roster_id":1,"matchup_id":1,"points":76.0,
      "starters":["qb1","rb_la","rb_sea","wr1","wr2","te1","0","k1","PHI","lb1","dl1"],
      "players":["qb1","rb_la","rb_sea","wr1","wr2","te1","k1","PHI","lb1","dl1",
                 "bench_hero","no_score_guy"],
      "players_points":{"qb1":18.0,"rb_la":8.0,"rb_sea":6.0,"wr1":10.0,"wr2":9.0,
                        "te1":5.0,"k1":7.0,"PHI":6.0,"lb1":4.0,"dl1":3.0,"bench_hero":25.0}},
     {"roster_id":2,"matchup_id":1,"points":95.0,
      "starters":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"],
      "players":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"],
      "players_points":{"qb2":22.0,"rb_buf":14.0,"rb_kc":12.0,"wr3":11.0,"wr4":10.0,
                        "te2":8.0,"wr_flex2":7.0,"k2":5.0,"DAL":3.0,"lb2":2.0,"dl2":1.0}}]`,
  week2Matchups: String.raw`[{"roster_id":1,"matchup_id":1,"points":88.0,
      "starters":["qb1","rb_la","rb_sea","wr1","wr2","te1","bench_hero","k1","PHI","lb1","dl1"],
      "players":["qb1","rb_la","rb_sea","wr1","wr2","te1","k1","PHI","lb1","dl1",
                 "bench_hero","no_score_guy"],
      "players_points":{"qb1":20.0,"rb_la":12.0,"rb_sea":9.0,"wr1":11.0,"wr2":8.0,
                        "te1":6.0,"bench_hero":14.0,"k1":4.0,"PHI":2.0,"lb1":1.0,"dl1":1.0}},
     {"roster_id":2,"matchup_id":1,"points":70.0,
      "starters":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"],
      "players":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"],
      "players_points":{"qb2":15.0,"rb_buf":10.0,"rb_kc":9.0,"wr3":8.0,"wr4":8.0,
                        "te2":7.0,"wr_flex2":6.0,"k2":4.0,"DAL":2.0,"lb2":1.0,"dl2":0.0}}]`,
  draftPicks: String.raw`[{"pick_no":1,"player_id":"bench_hero","picked_by":"u1","roster_id":1,"round":1},
     {"pick_no":2,"player_id":"qb2","picked_by":"u2","roster_id":2,"round":1},
     {"pick_no":3,"player_id":"rival_pick","picked_by":"u2","roster_id":2,"round":1},
     {"pick_no":4,"player_id":"wr1","picked_by":"u1","roster_id":1,"round":1}]`,
  transactions: String.raw`[{"transaction_id":"t1","type":"waiver","status":"complete","created":1757700000000,
      "roster_ids":[1],"adds":{"bench_hero":1},"drops":{"no_score_guy":1}}]`,
  nflState: String.raw`{"week":1,"season":"2025","season_type":"regular"}`,
  dashboardState: String.raw`{"week":7,"season":"2025","season_type":"regular"}`,
  drafts: String.raw`[{"draft_id":"D1","status":"complete","season":"2025"}]`,
} as const

/** The FCApp test bundle's static files stand in for the site's `data/` folder. */
export const appFixtureBundle: BundledSource = async (r) =>
  hasFixture('FCApp', `${r.bundledName}.json`) ? readFixture('FCApp', `${r.bundledName}.json`) : undefined

/** A service and store wired to the stub, plus the real bundled static files. */
export function makeHarness(transport: StubTransport) {
  const sleeper = new SleeperService(
    new SleeperClient({ baseURL: 'https://api.example.test/v1', transport, retries: 0 }),
    new Cache(new MemoryStore()),
  )
  const staticData = new StaticDataStore({ cache: new Cache(new MemoryStore()), transport, baseURL: null, bundled: appFixtureBundle })
  return { sleeper, staticData }
}

/** Order matters: the catch-all `/league/L1` goes last, as in the Swift harness. */
export function standardTransport(): StubTransport {
  return new StubTransport()
    .json('/state/nfl', TestLeague.nflState)
    .json('/league/L1/rosters', TestLeague.rosters)
    .json('/league/L1/users', TestLeague.users)
    .json('/players/nfl', TestLeague.players)
    .json('/league/L1', TestLeague.leagueJSON())
}

/** Week 7, one unset slot, two completed weeks, a draft and a waiver claim. */
export function dashboardTransport(): StubTransport {
  return new StubTransport()
    .json('/state/nfl', TestLeague.dashboardState)
    .json('/league/L1/rosters', TestLeague.dashboardRosters)
    .json('/league/L1/users', TestLeague.users)
    .json('/league/L1/drafts', TestLeague.drafts)
    .json('/draft/D1/picks', TestLeague.draftPicks)
    .json('/matchups/1', TestLeague.week1Matchups)
    .json('/matchups/2', TestLeague.week2Matchups)
    .json('/matchups/8', '[]')
    .json('/matchups/9', '[]')
    .json('/transactions/7', TestLeague.transactions)
    .json('/players/nfl', TestLeague.dashboardPlayers)
    .json('/league/L1', TestLeague.leagueJSON())
}

/** Fixed clocks for tests that depend on lineup locks. */
export const TestClock = {
  /** 2025-09-01, before any 2025 game: nothing is locked. */
  beforeKickoffs: () => Date.parse('2025-09-01T12:00:00Z'),
  /** Week 7 of 2025, Sunday 2:30pm ET. */
  week7MidSunday: () => Date.parse('2025-10-19T18:30:00Z'),
}
