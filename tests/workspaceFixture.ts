/**
 * Port of FCAppTests `WorkspaceFixture`'s league: a two-team 2026 superflex
 * league at week 3 with week-2 Sleeper lines. `services()` in Swift builds the
 * whole AppServices; until that's ported, `context()` returns the loaded
 * league context the services share.
 */
import { LeagueContextLoader } from '@models/league/LeagueContextLoader'
import { AppServices } from '@models/app/AppServices'
import { InMemorySettingsStore, makeAppSettings } from '@models/settings/AppSettings'
import { InMemoryWorkspacePersistence } from '@models/workspaces/WorkspaceStore'
import { InMemorySecretStore } from '@data/secretStore'
import type { StubTransport } from './stubTransport'
import { makeHarness, standardTransport, TestClock } from './appHarness'
import { fixtureText } from './swiftFixtures'

export const WorkspaceFixture = {
  mahomes: '4046', ward: '12522', cook: '8138', bolton: '7648', kyren: '8150',
  goff: '3163', stafford: '421', gibbs: '9221', edmunds: '4968',
  prescott: '3294', hampton: '12507', purdy: '8183', henderson: '12529', jsn: '9488',
  /** A free agent with no Sleeper line and no projection. */
  unknown: '99001',
  scoresWeek3: String.raw`[{"game_id":"g1","week":3,"status":"in_progress","start_time":1790528400000,
    "metadata":{"home_team":"LAR","away_team":"DET","home_score":17,"away_score":20,"quarter":"3","quarter_num":3,
                "time_remaining":"7:42","possession":"DET","down_and_distance":"3rd & 4","red_zone":"true",
                "yard_line":12,"is_in_progress":true,"is_over":false,"spread":{"LAR":2.5,"DET":-2.5}}},
   {"game_id":"g2","week":3,"status":"complete","start_time":1790442000000,
    "metadata":{"home_team":"BUF","away_team":"MIA","home_score":27,"away_score":10,"quarter":"F","quarter_num":4,
                "is_in_progress":false,"is_over":true}},
   {"game_id":"g3","week":3,"status":"pre_game","start_time":1790640900000,
    "metadata":{"home_team":"KC","away_team":"NYG","home_score":null,"away_score":null,"quarter":"","quarter_num":"",
                "is_in_progress":false,"is_over":false,"moneyline":{"KC":71.0,"NYG":33.0,"updated_at":1}}},
   {"game_id":"g4","week":3,"status":"pre_game","start_time":1790640900000,
    "metadata":{"home_team":"GB","away_team":"CHI","quarter":"","is_in_progress":false,"is_over":false}}]`,

  transport(): StubTransport {
    const f = WorkspaceFixture
    const list = (ids: string[]) => ids.map((id) => `"${id}"`).join(',')
    const mine = [f.mahomes, f.ward, f.cook, f.jsn, f.bolton, f.kyren]
    const theirs = [f.goff, f.stafford, f.gibbs, f.edmunds, f.prescott, f.hampton, f.purdy]
    const t = standardTransport()
    t.override('/state/nfl', '{"week":3,"season":"2026","season_type":"regular"}')
    t.replace('/league/L1', `{"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":2,
       "roster_positions":["QB","SUPER_FLEX","RB","WR","LB","BN","BN","BN","IR"],
       "scoring_settings":{"pass_yd":0.04,"pass_td":4,"pass_int":-2,"rush_yd":0.1,"rush_td":6,"rush_fd":1,
         "rec":0,"rec_yd":0.1,"rec_td":6,"rec_fd":1,"idp_tkl_solo":2,"idp_tkl_ast":1,"idp_sack":5},
       "settings":{"waiver_type":2,"waiver_budget":100,"reserve_slots":1,"trade_deadline":11}}`)
    t.replace('/league/L1/rosters', `[{"roster_id":1,"owner_id":"u1","players":[${list(mine)}],
        "starters":[${list([f.mahomes, f.ward, f.cook, f.jsn, f.bolton])}],"reserve":["${f.kyren}"]},
       {"roster_id":2,"owner_id":"u2","players":[${list(theirs)}],
        "starters":[${list([f.goff, f.stafford, f.gibbs, '0', f.edmunds])}],"reserve":["${f.purdy}"]}]`)
    t.replace('/players/nfl', `{"${f.mahomes}":{"full_name":"Patrick Mahomes","position":"QB","team":"KC","active":true},
       "${f.ward}":{"full_name":"Cam Ward","position":"QB","team":"TEN","active":true},
       "${f.cook}":{"full_name":"James Cook","position":"RB","team":"BUF","active":true},
       "${f.jsn}":{"full_name":"Jaxon Smith-Njigba","position":"WR","team":"SEA","active":true,"injury_status":"Questionable","injury_body_part":"Ankle"},
       "${f.bolton}":{"full_name":"Nick Bolton","position":"LB","team":"KC","active":true},
       "${f.kyren}":{"full_name":"Kyren Williams","position":"RB","team":"LAR","active":true,"injury_status":"IR"},
       "${f.goff}":{"full_name":"Jared Goff","position":"QB","team":"DET","active":true},
       "${f.stafford}":{"full_name":"Matthew Stafford","position":"QB","team":"LAR","active":true},
       "${f.gibbs}":{"full_name":"Jahmyr Gibbs","position":"RB","team":"DET","active":true},
       "${f.edmunds}":{"full_name":"Tremaine Edmunds","position":"LB","team":"NYG","active":true},
       "${f.prescott}":{"full_name":"Dak Prescott","position":"QB","team":"DAL","active":true},
       "${f.hampton}":{"full_name":"Omarion Hampton","position":"RB","team":"LAC","active":true},
       "${f.henderson}":{"full_name":"TreVeyon Henderson","position":"RB","team":"NE","active":true},
       "${f.purdy}":{"full_name":"Brock Purdy","position":"QB","team":"SF","active":true},
       "${f.unknown}":{"full_name":"Deep Sleeper","position":"RB","team":"NE","active":true,"age":22,"years_exp":0,
                      "college":"Nowhere State","height":"70","weight":"201"}}`)
    t.json('/stats/nfl/2026/1', fixtureText('FCApp', 'stats-2026-w2.json'))
    t.json('/stats/nfl/2026/2', fixtureText('FCApp', 'stats-2026-w2.json'))
    t.json('/projections/nfl/2026/3', fixtureText('FCApp', 'projections-2026-w3.json'))
    t.override('/scores/nfl/regular/2026/3', f.scoresWeek3)
    t.override('/league/L1/matchups/3', `[{"roster_id":1,"matchup_id":1,"points":24.6,"starters":["${f.mahomes}","${f.kyren}","${f.cook}","${f.jsn}","${f.bolton}"],
        "players_points":{"${f.cook}":24.6}},
       {"roster_id":2,"matchup_id":1,"points":31.2,"starters":["${f.goff}","${f.stafford}","${f.gibbs}","${f.hampton}","${f.edmunds}"],
        "players_points":{"${f.goff}":14.2,"${f.stafford}":9.0,"${f.gibbs}":8.0}}]`)
    return t
  },

  /** The whole app's services, loaded — Swift's `WorkspaceFixture.services()`. */
  async services(): Promise<AppServices> {
    const { sleeper, staticData } = makeHarness(WorkspaceFixture.transport())
    const settingsStore = new InMemorySettingsStore(makeAppSettings({ sleeperUsername: 'me', userID: 'u1', leagueID: 'L1', rosterID: 1 }))
    const services = new AppServices({
      sleeper, staticData, settingsStore, workspacePersistence: new InMemoryWorkspacePersistence(),
      secrets: new InMemorySecretStore(), now: TestClock.beforeKickoffs,
    })
    await services.loadIfConfigured()
    return services
  },

  /** The shared league context the Swift services load (user roster 1, clock before kickoffs). */
  async context() {
    const { sleeper, staticData } = makeHarness(WorkspaceFixture.transport())
    return new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs).load({ leagueID: 'L1', userRosterID: 1 })
  },
}
