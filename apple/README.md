# Fantasy Command Center — native iOS/macOS app

Swift port of the deterministic core of the web app, following
[`docs/IOS_PORT_BRIEF.md`](../docs/IOS_PORT_BRIEF.md).

```
apple/
├── App/                 ← the app target: a thin shell and the bundled data
├── Packages/
│   ├── FCCore/          ← step 1: pure value types + algorithms, no I/O,
│   │                      tested against the real data
│   ├── FCData/          ← step 2: Sleeper client, disk cache, static data
│   │                      store, optional relay — everything that can fail
│   └── FCApp/           ← step 3: SwiftUI screens and their view models
├── project.yml          ← XcodeGen source of truth for the project file
└── Tools/
    └── sync-fixtures.sh   copies public/data/** into the test bundles and
                           into the app bundle
```

## Building and running

```sh
cd apple
xcodegen generate          # only after editing project.yml
open FantasyCommandCenter.xcodeproj
```

The project file is generated from `project.yml` rather than hand-maintained,
so it cannot drift from the folder layout. It is committed so that opening the
project needs no extra tooling; regenerate after adding a target or changing
build settings, not after adding a source file.

One multiplatform target covers iPhone and Mac (§2), signed with the paid team
`H9B7A5KQP3` — the same one the other apps here use. macOS will not build
without it, because the sandbox entitlement requires signing.

**Deployment target is iOS 17 / macOS 14**, matching the packages. Worth
raising to whatever the test devices actually run before TestFlight.

## FCCore

Everything here is pure: value types in, value types out. No networking, no file
system, no SwiftUI. That is what makes the fixture-driven test strategy work —
the whole domain is verifiable without a simulator.

| File | What it owns |
|---|---|
| `Position.swift` | the three position dialects (Sleeper, nflverse, dynastyprocess) |
| `ScoringProfile.swift` | league scoring as data, with the bundled default and the PPR reference |
| `SleeperScoring.swift` | translating a league's own `scoring_settings`, reporting what it can't map |
| `WeeklyStats.swift` | the nflverse weekly file, decoded by zipping its own `fields` header |
| `ScoringEngine.swift` | `score(_:profile:position:)` with a breakdown and an `unsupported` list |
| `ScoringValidation.swift` | the correctness gate against `fp_ppr_ref` |
| `Distribution.swift` | produced floor/median/ceiling (p20/p50/p80), spread, CV |
| `RosterSlots.swift` | `roster_positions` → slot template, and greedy roster assignment |
| `NFLTeams.swift` | team crosswalk and the `LAR → LA` normalisation |
| `Schedule.swift` / `ByeWeeks.swift` | the schedule file and byes derived from it by absence |
| `ByeCrunch.swift` | per-position and per-flex-group shortfall for a week |
| `SeasonProfile.swift` / `Baselines.swift` | season scan and season-pace start/replacement lines |
| `AcquisitionSignals.swift` | the four named signals and the ranked board |
| `LineupOptimizer.swift` | best legal lineup under one stated basis |

### Running the tests

```sh
cd apple/Packages/FCCore
swift test
```

The tests assert against the **real shipped JSON**, copied into the test bundle
by `apple/Tools/sync-fixtures.sh`. Re-run that script after
`npm run preprocess-nflverse` regenerates `public/data`.

The headline test is `ScoringGateTests.testEveryRowMatchesNflverseReference`: it
scores all 6,037 checkable rows of the 2025 season under the PPR reference
profile and requires every one to reproduce nflverse's own number to the cent.

### Two deliberate departures from the React implementation

Both are documented at the call site. Both were made because the brief's stated
*meaning* and the JavaScript's *behaviour* disagree, and in each case the
JavaScript is the one that is wrong.

1. **Flex slots are matched per eligibility set, not pooled** (`ByeCrunch`).
   `crunchForWeek` in the web app pools every flex slot against the union of
   their eligibility sets. In this league that union is
   `{RB, WR, TE, LB, DL, DB}` across one `FLEX` and two `IDP_FLEX` slots, so a
   spare receiver reads as covering a missing linebacker and a week looks
   fillable when it isn't. FCCore runs a maximum bipartite matching instead, so
   overlapping sets still fill optimally and an offensive surplus never covers
   an IDP slot. The reported shortfall is never smaller than the pooled one,
   which is the safe direction for an alarm.

2. **The lineup optimizer is exact, not greedy-plus-hill-climb**
   (`LineupOptimizer`). A candidate's value does not depend on which slot he
   fills, so taking candidates in descending value and admitting each one an
   augmenting path can seat is provably optimal. The web app's two-pass greedy
   is not: given a `{RB, WR}` slot and a `{WR}`-only slot it seats the best
   receiver in the flex and strands a better back, and no bench-to-slot
   improvement recovers it. Churn minimisation is applied as an incumbency
   margin *inside* the assignment rather than as a filter on the reported
   swaps, so the proposed lineup and the swap list can never disagree.

One smaller judgement call: **baseline lines are kept at full precision.** The
web app rounds the start line to one decimal before comparing against it, which
pushes the line above the very player who set it — measured on the 2025 file
that makes seven of eight kickers clear an eight-kicker line. Rounding is a
display concern and happens only in the human-readable strings.

---

## FCData

Step 2 of the build order. Everything that can fail, go stale, or be offline
lives here, which is precisely why none of it is in `FCCore`.

| File | What it owns |
|---|---|
| `HTTPTransport.swift` | the one seam between this package and the network |
| `SleeperClient.swift` | the `api.sleeper.app` endpoints, 8 s timeout, one retry |
| `SleeperModels.swift` | Sleeper's payloads, decoded only as far as the app uses them |
| `PlayerIndex.swift` | the **trimmed projection** of the ~5 MB player payload |
| `DiskCache.swift` | TTL'd file cache in Application Support — never `UserDefaults` |
| `SleeperService.swift` | cache-through reads: fresh cache → network → stale cache |
| `StaticDataStore.swift` | bundled nflverse files + conditional HTTP refresh |
| `PlayerIDCrosswalk.swift` | `player-ids.json` and its three dialect traps |
| `RelayClient.swift` | optional enrichment; every call fails soft |
| `Fetched.swift` | a value plus where it came from |

### Running the tests

```sh
cd apple/Packages/FCData
swift test
```

Nothing in the suite touches the network. Every request goes through a
`StubTransport`, because the cases worth testing — a 304, a 500 that then
succeeds, a truncated body — are exactly the ones a live server will not
produce on request. The crosswalk and static-store tests still assert against
the **real** shipped JSON, for the same reason `FCCore`'s do.

### Three decisions worth knowing about

1. **Provenance is part of the return type.** Reads come back as
   `Fetched<Value>`, which pairs the value with where it came from — live,
   cached, stale-cached after a failed fetch, or the bundled copy. The house
   style (§6) requires saying where a number came from, and "cached four hours
   ago" is a materially different claim from "live". Putting it in the type
   means a caller has to destructure it to get at the value, so it cannot
   quietly go unmentioned.

2. **A failed fetch serves expired cache rather than an error.** Read order is
   fresh cache → network → *stale* cache. On a phone with no signal, old data
   beats no data — but it arrives labelled `staleCache`, never disguised as
   current (§8.1).

3. **The player payload is trimmed at the client boundary.**
   `SleeperClient.playerIndex()` returns the projection and never hands back the
   raw ~5 MB body, so there is no way for a caller to hold or cache it. The web
   app's silent `localStorage` quota failure looked exactly like a working cache
   while re-downloading megabytes on every load (§3.1); the cache here is
   file-backed and its writes throw rather than fail quietly.

### Not built yet

The Settings screen named alongside `FCData` in the brief's step 2 is UI, so it
belongs to `FCApp`. The service layer it needs is here and ready: `user(username:)`
→ `leagues(userID:season:)` → `league(id:)` is the username → league-pick flow.

---

## FCApp

Step 3. The SwiftUI layer, kept as a **library** rather than living in the app
target so that every view model is reachable from `swift test` without booting a
simulator. The app target is 40 lines: build three objects, hand them to
`RootView`.

| File | What it owns |
|---|---|
| `AppSettings.swift` | the league and roster the user picked, persisted |
| `SettingsModel.swift` | the username → league → team flow |
| `LeagueContext.swift` | the assembled league, with every dialect already translated |
| `LeagueContextLoader.swift` | composes the FCData reads into that context |
| `PlanningModel.swift` | the bye-crunch grid, the acquisition board, and the link |
| `DashboardModel.swift` | alerts, standings, bench points, trend, draft value, moves |
| `SeasonHistory.swift` | completed weeks, which three of the panels are built on |
| `MatchupModel.swift` | both starting lineups this week, row by row |
| `Freshness.swift` | turning a `Provenance` into the words the UI shows |
| `Views/` | `RootView`, `PlanningView`, `SettingsView`, freshness chrome |

### What is built

**Dashboard** (§7.1), **Matchup** (§7.2), **Planning** (§7.4) and **Settings**.
Planning came first on the brief's own advice — it exercises nearly the whole
core, so getting it green proved the two packages underneath it. Sit/Start is
present in the navigation as an honest "not built yet" screen rather than
hidden, so the shape of the app is visible from the first run.

### Two seasons, not one

The **schedule season** is the current one: byes, opponents, recorded lines.
The **stats season** is the newest season with a weekly production file, which
early in a year is *last* year — a weekly file cannot exist before games are
played. `LeagueContext` carries both and says so whenever they differ, so last
season's points per game are never read as this season's. Collapsing the two
was a real bug: a 2026 league would not load at all.

### One context, three screens

Dashboard, Matchup and Planning share a single `LeagueContextLoader`, which
reuses an assembled context for 60 seconds and shares an in-flight load between
screens that ask at the same moment. Without that, a launch decoded the weekly
file and re-scored the whole season three times back to back. Changing league or
team is a different cache key, so Settings never sees a stale context.

### Matchup

A head-to-head summary on top, then one side at a time behind a segmented
control — two columns do not fit a phone (§7.2). Each starting slot is a row,
labelled by the slot it fills, with the unset ones kept in place.

Per player: this week's opponent and venue, the player's team's implied total,
live points, season points per game, last-4 form, floor–ceiling, and where the
opponent defense ranks against that position. Three states are kept distinct
because they are different claims:

- **no production data** — DEF and IDP, which the weekly file does not cover;
- **no season line** — a covered position the crosswalk could not join;
- **no live points** — not kicked off, or Sleeper has no number; never zero.

Implied totals are labelled as recorded closing lines, and the defense ranks
state their definition: points allowed per game to the position, counting every
player who faced the defense.

### Dashboard

Alerts pinned at the top, everything else scrolling below. It is the default tab
because it is the screen a notification deep-links into, so whatever the
notification raised has to be answerable without scrolling.

Alerts are ordered by what it costs to ignore them: a starter **on bye** scores
exactly zero, an **unset slot** scores exactly zero, and an **injury** is a risk
rather than a certainty. Unset slots are counted from the raw `starters` array,
since the `"0"` entries are the only record that a slot was never filled.

Below that: standings (free — Sleeper returns records with the rosters),
**points left on your bench**, a weekly scoring trend against the field you
actually played, **draft value realized**, league moves, and — only when a relay
is configured — news filtered to your own players.

Two of those deserve a note:

- **Points left on the bench** runs `LineupOptimizer` with points actually
  scored as the basis, so overlapping flex slots are handled properly and
  equal-value shuffles are never reported as missed moves. A player Sleeper gave
  no number for is excluded rather than scored as zero — "didn't play" and "we
  have no number" are different claims, and only one of them justifies telling
  someone they made a mistake. The live week is never graded, because accusing
  the user of a mistake they can still fix is the wrong thing for this screen
  to do.
- **Draft value realized** grades each of your picks against what that pick
  number actually returned across the league this season — the *n*th-best real
  season total among everyone drafted — not against anyone's preseason ranking.
  Picks are attributed by who *made* them, not by who holds the player now.

### The link between the two halves

Tapping a shortfall — a week where you cannot field a legal lineup — filters the
acquisition board to players **not themselves on bye that week**. A player on
bye in week 8 cannot solve week 8, however good he is. That link is the reason
the grid and the board share a screen, and it is the thing the tests pin down
hardest.

The grid also shows rivals' rows, because the trade you actually want is with
someone who is *not* short in the same week. `tradePartners(week:)` is that
question asked directly.

### Tests

```sh
cd apple/Packages/FCApp
swift test
```

The Planning tests run against the **real** 2025 schedule and weekly files.
Week 8 byes in that file are ARI, DET, JAX, LA, LV and SEA; the test roster's
two backs are LAR and SEA, so the shortfall the tests assert on is derived from
shipped data rather than typed into a fixture. That also exercises the `LAR` →
`LA` normalisation — without it the Rams back reads as available and the alarm
never fires.

The Dashboard tests do the same with week 7, where the shipped schedule puts BAL
and BUF on bye, so the fixture's BUF quarterback and BAL kicker are flagged from
real data. Weeks 3 to 6 are deliberately left unscripted, which also exercises
`SeasonHistory` skipping a week it cannot load rather than failing the screen.

Sleeper responses come from a stub; nothing in the suite touches the network.

### Known gaps

- The static store runs **bundle-only**: `baseURL` is `nil` until the generated
  JSON has a stable HTTPS home (§9, open question 2). Everything for the
  conditional refresh is built and tested — it just needs a URL.
- Sit/Start is a placeholder.
- No widgets, notifications or background refresh yet (§8).
