# In-season data files

Four files produced by `scripts/preprocess-nflverse.mjs` for the **current season only**,
published to the `data` branch beside the existing files, bundled into the app, and
decoded by `FCCore`. They exist because the weekly production file cannot answer a
forward-looking question — who steps in when a starter is hurt, how much is he
playing, what did his usage *expect* to score — and because the weekly file has no
DEF or IDP rows at all.

Every file carries `_meta.generated` (ISO timestamp), `_meta.season` and
`_meta.source`; the rest of `_meta` is provenance (row counts, join rates) that
decoders may ignore. Large tables are **tuple-encoded** with a `fields` header, exactly like
`weekly/{season}.json`: rows are arrays positionally matched to `fields`, and decoders
zip the header rather than indexing by position. A field the decoder does not know is
ignored; a field it expects but the file lacks reads as absent, never zero.

Team codes are nflverse spelling throughout (`LA`, not `LAR`). Player ids are
**gsis ids** (`00-0034381`); the app joins them to Sleeper ids through
`player-ids.json` as it already does for the weekly file. Positions are in
Sleeper's dialect (`QB RB WR TE K DEF LB DL DB`), translated at the boundary.

## `injuries-{season}.json`

Official injury reports from nflverse `injuries_{season}.csv`, one row per player per
week. The file is a weekly snapshot, not a day-by-day log: `practice` is the latest
practice status nflverse has recorded for that week.

```jsonc
{
  "_meta": { "generated": "…", "season": 2026, "source": "nflverse/nflverse-data injuries", "weeks": [1, 2, 3] },
  "fields": ["gsis", "team", "pos", "status", "practice", "primary"],
  "byWeek": {
    "3": [
      ["00-0034381", "ARI", "LB", "Questionable", "LTD", "Knee"],
      ["00-0035859", "ARI", "K",  null,           "FULL", "Groin"]
    ]
  }
}
```

- `status`: `"Out"`, `"Doubtful"`, `"Questionable"`, or `null` when the report lists
  the player without a game designation.
- `practice`: `"DNP"`, `"LTD"`, `"FULL"`, or `null`.
- `primary`: the reported primary injury (`"Knee"`), or `null`. When the game report
  lists no injury (the common case for a player without a designation) it falls back
  to the practice report's primary injury, which is where nflverse carries strings
  like `"Not injury related - resting player"`.
- `pos` is one of `QB RB WR TE K LB DL DB` (nflverse's `CB S FS SS` → `DB`, `DE DT NT` →
  `DL`, `FB` → `RB`). Rows for offensive linemen, punters and long snappers are dropped.
- Only weeks with at least one row are present.

## `depth-{season}.json`

The latest official depth chart per team from nflverse `depth_charts_{season}.csv`,
reduced to the position groups the app rosters. Within a group, players are in depth
order: every rank-1 player first (a team has three starting receivers), then rank 2,
and so on. Only the newest `dt` snapshot per team is kept.

```jsonc
{
  "_meta": { "generated": "…", "season": 2026, "asOf": "2026-09-22T12:33:43Z", "source": "nflverse/nflverse-data depth_charts" },
  "teams": {
    "KC": {
      "QB": ["00-0033873", "00-0036…"],
      "RB": ["…", "…", "…"],
      "WR": ["…", "…", "…", "…"],
      "TE": ["…"],
      "K":  ["…"],
      "LB": ["…"], "DL": ["…"], "DB": ["…"]
    }
  }
}
```

Position-abbreviation mapping (nflverse `pos_abb` → group): `QB`; `RB`, `FB`; `WR`;
`TE`; `PK` → `K`; `WLB SLB MLB ILB OLB RILB LILB LOLB ROLB LB` → `LB`;
`LDE RDE DE LDT RDT DT NT DL` → `DL`; `FS SS S LCB RCB CB NB DB` → `DB`.
Special-teams and offensive-line slots are dropped.

## `usage-{season}.json`

Per player-week usage that the weekly production file does not carry: snap counts
(nflverse `snap_counts`, keyed by pfr id and joined through the crosswalk), expected
fantasy points (ffverse `ffopportunity` `ep_weekly`, keyed by gsis id) and
Pro-Football-Reference advanced stats (nflverse `pfr_advstats` weekly rush and rec
files, keyed by pfr id).

```jsonc
{
  "_meta": { "generated": "…", "season": 2026, "weeks": [1, 2], "source": "nflverse snap_counts + pfr_advstats, ffverse ffopportunity" },
  "fields": ["week", "off_snp", "off_pct", "def_snp", "def_pct", "xfp", "xfp_rush", "xfp_rec",
             "rush_att", "tgt", "ybc_avg", "yac_avg", "broken_tackles", "drops"],
  "meta": { "00-0039165": { "n": "Jahmyr Gibbs", "p": "RB", "t": "DET" } },
  "players": {
    "00-0039165": [
      [1, 45, 0.71, 0, 0, 21.9, 12.4, 9.5, 16, 8, 2.1, 3.0, 1, 0],
      [2, 48, 0.73, 0, 0, 24.2, 13.1, 11.1, 18, 9, 2.4, 2.6, 2, 0]
    ]
  }
}
```

- `off_snp`/`off_pct`: offensive snaps and share; `def_snp`/`def_pct` the same for
  IDP. A player with no snap-count row that week carries `null` in those four
  columns, which is different from playing zero snaps.
- `xfp`, `xfp_rush`, `xfp_rec`: expected fantasy points (ffopportunity's own
  half-PPR-ish scale; used as an *opportunity* measure, never as points in the
  league's scoring). `null` when ffopportunity has no row.
- `rush_att`, `tgt`: from ffopportunity, for rate denominators.
- `ybc_avg`, `yac_avg`, `broken_tackles`, `drops`: from pfr advstats; `null` when absent.
- `meta.t` is the player's team in that season's most recent row. `meta.p` uses the
  same eight positions as the injuries file; offensive linemen, punters and long
  snappers are dropped even though the snap-count file lists them.

## `context-{season}.json`

Per team-week situational context: how well the line protects, how the quarterback is
playing, how concentrated the targets are, how many plays the offense runs.

```jsonc
{
  "_meta": { "generated": "…", "season": 2026, "weeks": [1, 2], "source": "nflverse stats_player_week + pfr_advstats + espn qbr" },
  "fields": ["week", "opp", "plays", "pass_att", "rush_att", "pressure_pct", "sacks",
             "ybc_avg", "qbr", "pass_rtg", "top_tgt_share", "top2_tgt_share"],
  "teams": {
    "KC": [
      [1, "DEN", 68, 38, 26, 0.208, 2, 3.5, 94.0, 105.3, 0.31, 0.52]
    ]
  }
}
```

- `plays` = pass attempts + rush attempts + sacks taken, from the team's own players'
  rows in `stats_player_week`.
- `pressure_pct`, `sacks`: from pfr `advstats_week_pass` for the team's primary passer
  that week (most attempts). `null` when pfr has no row.
- `ybc_avg`: attempt-weighted yards before contact across the team's backs, from pfr
  `advstats_week_rush`. `null` when absent.
- `qbr`: ESPN Total QBR for the team's qualified quarterback that week, from
  `qbr_week_level.csv` joined on team and week. `null` when absent.
- `pass_rtg`: NFL passer rating computed from the team's passing totals that week.
- `top_tgt_share`, `top2_tgt_share`: share of team targets taken by the top one and top
  two targets, the "target competition" measure.

## Refresh cadence

The GitHub Action runs twice daily in season (10:30 and 22:00 UTC) so the Friday
practice report and Saturday depth-chart changes are published before Sunday. The app
fetches each file with `ETag`/`If-None-Match` on the 12-hour in-season TTL and falls
back to the bundled copy. Every screen states the file's `generated` time as its
freshness.
