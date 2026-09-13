# Fantasy Command Center — native iOS/macOS app

Swift port of the deterministic core of the web app, following
[`docs/IOS_PORT_BRIEF.md`](../docs/IOS_PORT_BRIEF.md).

```
apple/
├── Packages/
│   ├── FCCore/          ← step 1: pure value types + algorithms, no I/O,
│   │                      tested against the real data
│   └── FCData/          ← step 2: Sleeper client, disk cache, static data
│                          store, optional relay — everything that can fail
└── Tools/
    └── sync-fixtures.sh   copies public/data/** into both test bundles
```

`FCApp` (SwiftUI, widgets, notifications) is the next step and does not exist
yet. There is no Xcode app project until it does, so nothing here runs in a
simulator — the two packages are verified by `swift test` alone, which is the
point of keeping the domain I/O-free.

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
