/** Fixtures shared by the lineup specs — `SitStartModelTests.Fixture` and `MatchupModelTests.Fixture`, verbatim. */

/** SitStartModelTests.Fixture */
export const SitStartFixture = {
  rosters: `[{"roster_id":1,"owner_id":"u1",
          "players":["4984","3163","4866","9221","9509","rb_sea","7564","9493","wr2","te1",
                     "k1","PHI","lb1","dl1"],
          "starters":["4984","4866","rb_sea","7564","wr2","te1","0","k1","PHI","lb1","dl1"]},
         {"roster_id":2,"owner_id":"u2","players":["qb2"],"starters":["qb2"]}]`,
  players: `{"4984":{"full_name":"Josh Allen","position":"QB","team":"BUF","active":true},
         "3163":{"full_name":"Jared Goff","position":"QB","team":"DET","active":true},
         "4866":{"full_name":"Saquon Barkley","position":"RB","team":"PHI","active":true},
         "9221":{"full_name":"Jahmyr Gibbs","position":"RB","team":"DET","active":true},
         "9509":{"full_name":"Bijan Robinson","position":"RB","team":"ATL","active":true},
         "rb_sea":{"full_name":"Seattle Back","position":"RB","team":"SEA","active":true},
         "7564":{"full_name":"Ja'Marr Chase","position":"WR","team":"CIN","active":true},
         "9493":{"full_name":"Puka Nacua","position":"WR","team":"LAR","active":true},
         "wr2":{"full_name":"Receiver Two","position":"WR","team":"DAL","active":true},
         "te1":{"full_name":"Tight End","position":"TE","team":"KC","active":true},
         "k1":{"full_name":"Kicker One","position":"K","team":"BAL","active":true},
         "PHI":{"position":"DEF","team":"PHI","active":true},
         "lb1":{"full_name":"Linebacker One","position":"LB","team":"CHI","active":true},
         "dl1":{"full_name":"Lineman One","position":"DL","team":"GB","active":true},
         "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true}}`,
}


/** MatchupModelTests.Fixture */
export const MatchupFixture = {
  rosters: `[{"roster_id":1,"owner_id":"u1",
          "players":["4984","4866","rb_sea","7564","wr2","te1","k1","PHI","lb1","dl1"],
          "starters":["4984","4866","rb_sea","7564","wr2","te1","0","k1","PHI","lb1","dl1"]},
         {"roster_id":2,"owner_id":"u2",
          "players":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"],
          "starters":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"]}]`,
  players: `{"4984":{"full_name":"Josh Allen","position":"QB","team":"BUF","active":true},
         "4866":{"full_name":"Saquon Barkley","position":"RB","team":"PHI","active":true},
         "7564":{"full_name":"Ja'Marr Chase","position":"WR","team":"CIN","active":true},
         "rb_sea":{"full_name":"Seattle Back","position":"RB","team":"SEA","active":true},
         "wr2":{"full_name":"Receiver Two","position":"WR","team":"DAL","active":true},
         "te1":{"full_name":"Tight End","position":"TE","team":"KC","active":true},
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
         "dl2":{"full_name":"Lineman Two","position":"DL","team":"TB","active":true}}`,
  /**
   * Allen has a live score; nobody else has kicked off. An unreported score
   * must read as `undefined`, never as zero.
   */
  matchups(userMatchupID = '1'): string {
    return `[{"roster_id":1,"matchup_id":${userMatchupID},"points":30.5,
              "starters":["4984","4866","rb_sea","7564","wr2","te1","0","k1","PHI","lb1","dl1"],
              "players_points":{"4984":30.5}},
             {"roster_id":2,"matchup_id":1,"points":0,
              "starters":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"],
              "players_points":{}}]`
  },
}
