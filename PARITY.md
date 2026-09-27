# Web ↔ native parity

The native app (iPhone, iPad, Mac) is the reference. The web app ports its logic line for line and proves it against the same test fixtures, read in place from `apple/**/Tests/**/Fixtures/`. A feature is **done** when it ships on both platforms, or its gap is written down here.

Run both suites with `npm run check-parity` (Swift builds go to a scratch folder outside the repo; nothing under `apple/` is written).

Legend: ✅ ported with its Swift tests · 🟡 ported, tests partial · ⬜ not yet · — not applicable on the web

## Engines (FCCore)

| Area | Status | Parity check |
|---|---|---|
| Scoring engine, profile, Sleeper translation | ✅ | 2025's 6,037 rows score to the cent against nflverse |
| Sleeper stat-line scoring (projections, DEF, IDP) | ✅ | reproduces Sleeper's own `pts_std` |
| Roster slots, lineup optimizer (augmenting path, locks) | ✅ | Swift tests |
| Weekly file, schedule, game lines | ✅ | Swift tests |
| Bye calendar, kickoff calendar (US Eastern, DST) | ✅ | Swift tests |
| Distribution, percentile, team grades, fuzzy search | ✅ | Swift tests |
| In-season files, season scan, baselines, flex demand | ✅ | Swift tests |
| Defense vs position, bye crunch, team needs, acquisition signals | ✅ | Swift tests |
| Player grade, weighted grade, Command Center projection | ✅ | Swift tests |
| Stream decision layer and rest of season | ✅ | `erf` matches libm to 2e-16 |
| QB, D/ST, K streams | ✅ | fixtures to 1e-6, week / balanced / ROS |
| RB, WR, IDP streams | ✅ | fixtures to 1e-6 |

## Data (FCData)

| Area | Status | Notes |
|---|---|---|
| Sleeper client and cache-through service | ✅ | IndexedDB cache instead of files; same keys and TTLs |
| Static data store (bundled → ETag refresh from the `data` branch) | ✅ | bundled copy is the site's `public/data` |
| Relay client, secret store | ✅ | token in `localStorage` (no Keychain in a browser) |
| Demo league | ✅ | `public/demo/routes.json`, exported from the native demo |

## App models (FCApp)

| Area | Status |
|---|---|
| League context and loader, in-season data, freshness, start availability | ✅ |
| Defense lookup, Command Center projector, player metrics, grade context, trend comparison | ✅ |
| Navigation history and router | ✅ |
| Sit/Start, Matchup | ⬜ in progress |
| Injury Center, Waiver Board | ⬜ in progress |
| Trade wizard, trade desk, player schedule | ⬜ in progress |
| Planning, planning jobs, season history | ⬜ in progress |
| Stream screens (six kinds, store, candidate builders) | ⬜ in progress |
| Workspaces (model, geometry, presets, store, link bus) | ⬜ in progress |
| Dashboard / Board, My Team, Discovery, Player Card, compare, Game Day, Settings | ⬜ |

## Screens

| Area | Status |
|---|---|
| Shell: five hubs, segments, back trail, light and dark | ✅ |
| Board, Team, Lineup, Market, Streams screens | ⬜ Release 1 |
| Desktop workspaces | ⬜ Release 2 |

## Known platform differences

- **Storage:** the phone keeps its cache in Application Support and secrets in the Keychain; the web uses IndexedDB and `localStorage`. Settings, Board layout and workspaces move between devices with an export file.
- **Sort stability:** JavaScript's sort is stable and Swift's isn't. Where Swift relies on an explicit tie-break the port copies it; exact ties with no tie-break (display-only breakdown lists) may order differently.
- **`-0`:** a pick'em spread of exactly -0.0 prints "+-0.0" in one Swift explain line and "+0.0" on the web.
