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
simulator. The app target is small: build the services and the router, hand them to
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
| `SitStartModel.swift` | the optimizer, one named basis at a time |
| `Freshness.swift` | turning a `Provenance` into the words the UI shows |
| `App/` | `AppServices` (every model, built once), `AppRouter` (where the user is) |
| `Workspaces/` | the panel grid model, store, presets, geometry and link bus |
| `Views/` | `RootView`, the screens, `Workspaces/` panels, freshness chrome |

### What is built

All four v1 screens — **Dashboard** (§7.1), **Matchup** (§7.2), **Sit/Start**
(§7.3), **Planning** (§7.4) — and **Settings**. Planning came first on the
brief's own advice: it exercises nearly the whole core, so getting it green
proved the two packages underneath it.

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

### Sit/Start

The lineup optimizer, one basis at a time and always named (§7.3): season points
per game, last-4 form, floor, ceiling, or game environment. Each is a different
question rather than a better answer to the same one. Game environment is the
only basis that knows nothing about the player — and the only one that can value
DEF and IDP.

The proposed swaps and their gain come first. When another basis would pick a
different lineup the screen says which, because disagreement between measures is
the signal that this is a judgement call rather than a calculation. That
comparison uses the lineup that would actually take the field, so a DEF slot no
stats basis can value does not, on its own, read as a disagreement — and on
screen that slot keeps its current starter rather than showing as empty.

Players the basis cannot value are left out and listed by cause, never scored as
zero: no production data (DEF and IDP), no value in the stats season (rookies,
missed games, or not matched), on bye, or no recorded line.

**One deliberate departure from the web app:** a player on bye this week is
unvalued on every basis. The web optimizer did not check, so on a season-average
basis it would keep a bye-week star in the lineup, where he is guaranteed to
score zero. The test for this was checked by removing the rule and watching it
fail.

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

### Workspaces (Mac and iPad)

The desktop shell has a **Workspaces** section in the sidebar: dashboards you
build yourself out of panels, the way a trading platform's desktop is built
(Bloomberg Launchpad's pages of components, IBKR Mosaic's snap grid and colour
linking, thinkorswim's gadget library and preset workspaces).

- **Panels.** Twenty-two compact views — lineup readiness, Sit/Start, matchup,
  injuries, waiver targets, trade partners, byes, the three streams, news,
  standings, a Player Card, the seven Discovery panels, a Metric panel and a
  Player search — each drawn
  from the *same* model its full screen uses, so a panel never loads anything
  of its own. The arrow on a panel's title bar opens the full screen.
- **Grid.** Twelve columns; rows of 96pt. Unlock (⌘E) to drag a panel by its
  title bar or resize it from the corner. It goes exactly where you put it:
  anything in the way slides straight down, live, and everything floats back
  up to fill gaps when you shrink or move away (the gridstack model) — nothing
  overlaps and nothing snaps back. "Tidy up" slides everything up.
- **Adding panels.** While unlocked, a panel tray docks beside the grid and
  stays open: click an item to drop it in the next free spot, or drag it onto
  the grid where you want it (the ghost and the push preview follow the
  pointer). Every metric is also a tray item, so one drag makes a Targets or
  Snap share panel. The Add panel sheet (⇧⌘A) still works, and takes several
  at once — tick them and "Add N panels".
- **Linking.** The dot on a title bar sets a link colour. Click a player in
  any panel of that colour and the Player Card panel shows him; the Trade
  partners panel offers "Trade for…" or "Offer…". Standings publishes a team.
- **Discovery.** A list of *every* active free agent at the positions the
  league starts — the Waiver Board's rows without its "has a number" filter —
  searchable (typos forgiven), sortable on any board column, with rival
  benches on a toggle. Click a player and the linked **Profile** (bio, status,
  depth chart, bye, grade and situation chips), **Player news**, **Game log**
  (last game and the last N), **Trend** chart (points with Rotowire's
  projection dashed, or snaps, targets, xFP) and **Schedule & SoS** follow.
  The schedule shows each remaining opponent with the **recorded closing
  lines** from the nflverse schedule file — labelled as such, and usually
  present only for the next week or two — and each defense's rank against his
  position; strength of schedule is mean points allowed over the league
  average. Live odds through the relay is a follow-up, with the hook in
  `PlayerSchedule.build(liveLines:)`.
- **Compare.** Each link colour keeps a compare list of up to four players.
  ⌘-click a player in any panel of that colour (the row's menu on iPad), or
  search in the Compare panel. It draws weekly points as overlaid lines,
  per-game numbers as grouped bars, a table with the best value on each row
  picked out (lower is better for opponent rank), and each player's range.
- **Metric panels and Player search.** A Metric panel shows one of fourteen
  stats (fantasy points, snap share, targets, target share, receptions,
  receiving/air/rushing yards, carries, red-zone touches, xFP, yards after
  contact, tackles, sacks). It picks whose numbers: the clicked player, the
  link colour's compare list, players pinned to it, or your roster. One
  player gets his season average, last game, last three with a trend arrow,
  rank at his position and a chart against the position average; several
  get overlaid lines and a mini leaderboard. The two-column Player search
  focuses a player on click and adds him to the comparison with ＋ or ⌘-click,
  so a search plus a few Metric panels is a comparison board of your own.
- **Library.** Five presets ship — Game day, Waiver Tuesday, Trade desk,
  Discovery, Comparison lab — and
  workspaces can be added (empty or from a preset), renamed, given an icon,
  duplicated, reordered, reset to their preset, or deleted. ⌥⌘1–9 switch
  between them.
- **Storage.** `Application Support/FantasyCommandCenter/Workspaces/library.json`,
  never `AppSettings`: a bad decode can't cost the league selection. Unknown
  panel kinds from a newer version are dropped, overlaps are repaired, and a
  file that won't parse is set aside as `library.corrupt.json` before the
  presets are reseeded. The demo league keeps its library in memory.
- **Code.** `App/AppServices` holds the loader and every model (still not
  observed by the shell); `App/AppRouter` holds the sidebar selection and edit
  mode. `Workspaces/` is the model, store, presets, pure `WorkspaceGeometry`
  and `LinkBus`; `Views/Workspaces/` is the grid, panel chrome and panels.
  `DiscoveryModel`, `PlayerSchedule` and `PlayerComparison` feed the
  Discovery panels; the charts are Swift Charts.
  iPhone is untouched — the tab bar never shows a workspace.

### Known gaps

- The static store runs **bundle-only**: `baseURL` is `nil` until the generated
  JSON has a stable HTTPS home (§9, open question 2). Everything for the
  conditional refresh is built and tested — it just needs a URL.
- The web app's 0–100 "model score" Sit/Start basis is not ported: it depends
  on a season-scoring system that was not in the brief's port list. The screen
  says so.
- No widgets, notifications or background refresh yet (§8).


---

## Seeing it without a league: the demo league

Debug builds accept `-FCCDemoLeague`, which runs the app against a generated
four-team league with no network — built from the shipped 2025 files by
`apple/Tools/make-demo-league.py`, current week 7 (BUF and BAL on bye). Add
`-FCCTab <screen>` to open a tab directly and `-FCCAccent <theme>` to pick an
accent. All of it is compiled out of Release.

## UI tests

`FantasyCommandCenterUITests` runs against the demo league:

- **Every screen renders** from the fixture with no network (§10).
- **Matchup pages swipe and nothing drifts sideways** — pages Head-to-head → You
  → Opponent and back, checking that nothing straddles the window edge and the
  content returns exactly where it started. This guards the drift Connor saw.
- **Workspaces on iPad** — opens the Game day preset (`-FCCTab
  workspace:game-day`), checks its panels and the sidebar, unlocks, adds a
  panel from the library and locks again, adds two panels from the tray and
  two at once from the sheet, and switches to Waiver Tuesday.
  Skipped on iPhone.
- **Hubs on iPhone** — five tabs and no More, segments switch and are
  remembered, a deep link lands on its hub and segment, and Team's gear opens
  Settings.
- **Discover on iPhone** — the list renders, a player's page opens, and
  nothing on either is wider than the phone.
- **Screenshot tour** — walks every screen and mode and saves images to
  `FCC_SCREENSHOT_DIR` (`TEST_RUNNER_FCC_SCREENSHOT_DIR=… xcodebuild test …`),
  optionally with `FCC_ACCENT`. Skipped when the variable isn't set.

## iPhone layout

Five tabs, so nothing hides under More: **Team** (My Team, with Settings on a
gear), **Lineup** (Sit/Start · Matchup), **Injuries**, **Market** (Discover ·
Waivers · Trades · Planning) and **Streams** (IDP · WR · RB). A segment bar
under the title switches a hub's screens; each segment keeps its own
navigation stack and scroll position, and a hub reopens on the segment you
left it on. Lineup's badge counts the changes Sit/Start recommends and
Injuries' counts starters who can't play. `-FCCTab <screen>` deep links land
on the right hub and segment. Mac and iPad keep one sidebar row per screen;
a compact-width iPad uses the hubs.

## Look and feel

`FCApp/Sources/FCApp/Theme/` holds the palette (the web app's start/caution/sit
and position colours), six accent themes picked in Settings, shared components
(card, section header, position chip, sliding picker), and `Motion`, which every
animation routes through so Reduce Motion is honoured in one place.

Screens refresh with pull-to-refresh and a success haptic (only when Sleeper was
actually reached), show placeholder cards instead of a spinner while loading, and
animate numbers, mode switches and list entrances.
