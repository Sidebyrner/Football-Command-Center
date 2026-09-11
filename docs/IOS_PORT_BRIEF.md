# Fantasy Command Center — native iOS/macOS port brief

**This document is the starting context for a new Claude Code session that will build
a Swift app.** It is written to be self-contained: you should not need to read the
React codebase to understand *what to build* or *why the math is the way it is*.

The existing web app lives at `https://github.com/Sidebyrner/Football-Command-Center`.
Paths in this document refer to that repo and are given so you can check an exact
implementation when you want one — not because you need to port the React.

**When you need to know how the web app behaves and this document doesn't say:** ask
the user. They have a separate, still-open Claude Code session that holds the full web
app context and can answer precisely. Don't guess at web behaviour, and don't assume a
React file is authoritative just because it exists — several are deliberately
superseded, and this document says which.

---

## 0. Decisions already made

These were decided with the user before this document was written. Treat them as the
starting frame, not as suggestions to re-litigate.

| Decision | Choice |
|---|---|
| **Architecture** | Hybrid — native Swift core, optional relay for extras |
| **First release scope** | Dashboard, Matchup, Sit/Start, Planning |
| **Native capabilities** | Push, widgets, Live Activities, background refresh + offline — all four |
| **Targets & distribution** | iPhone (primary) + Mac, TestFlight, paid Apple Developer account |

### Why hybrid

The deterministic math — scoring, value over replacement, bye crunch, positional
baselines, lineup optimization — gets **reimplemented in Swift**. It runs offline,
unit-tests cleanly against real fixture data, and never depends on a server being
reachable.

The existing Node/Fastify relay (`server/` in the web repo) stays **optional**, serving
only what genuinely needs a server: news RSS aggregation, LM Studio AI briefs, and the
paid odds key. Everything in the first-release scope must work with the relay
completely unreachable. Degrade those features gracefully and visibly — never block a
screen on them.

This matters concretely: the user's machine does **not** currently have Tailscale
installed, so the relay is not reachable from a phone outside the house. A design that
assumes otherwise produces an app that works on the couch and fails everywhere else,
which is the exact opposite of the point.

### Why this app exists

The user manages a fantasy football team and is mostly on a phone. The web app is
desktop-shaped and they don't sit at a desktop during the season. The purpose of the
port is to **react to market conditions on the go** — an injury, a waiver target
trending, a lineup that isn't set, a bye week that guts the roster three weeks out.

---

## 1. The league

8-team league, **non-PPR**, with **IDP** (currently 2 required starters per game, via
two `IDP_FLEX` slots). Scoring is heavily customized — first downs score, incompletions
are negative, yardage is per-20 (passing) and per-10 (rush/rec), and there are yardage
and completion bonuses.

**Never hardcode league settings.** The app reads them live from Sleeper every load, so
a mid-season settings change is picked up automatically. This is an established
principle in the web app and must survive the port:

- roster slots ← `roster_positions` on the league object
- scoring ← `scoring_settings` on the league object

The bundled default profile (§4) is a *fallback and a reference*, not the source of
truth.

---

## 2. Architecture

```
iPhone / Mac (SwiftUI, one multiplatform target)
│
├── SleeperClient ........ direct HTTPS to api.sleeper.app (no key)
├── StaticDataStore ...... nflverse-derived JSON: bundled + refreshed over HTTP
├── ScoringEngine ........ profile-driven point calculation      ← port from JS
├── Analytics ............ VOR, baselines, bye crunch, optimizer ← port from JS
├── Cache ................ disk-backed, TTL'd
└── RelayClient (optional) news, AI briefs, live odds
```

**Suggested module split** (SPM local packages keeps the domain testable without a
simulator):

- `FCCore` — pure value types + algorithms. No networking, no SwiftUI, no Foundation
  URL types. This is where every ported algorithm lives and where the test suite bites.
- `FCData` — Sleeper client, static data store, cache, relay client.
- `FCApp` — SwiftUI views, app lifecycle, widgets, notifications.

Keeping `FCCore` free of I/O is what makes the fixture-driven test strategy in §9 work.

### Platform split

Use a single SwiftUI multiplatform target rather than Catalyst. The four in-scope
screens are list/table/grid shaped and adapt well with `NavigationSplitView` on Mac and
`NavigationStack` on iPhone. Design **phone-first** and let the Mac layout widen — not
the reverse. The user's Mac usage is secondary and largely "the same thing, bigger."

---

## 3. Data sources and contracts

### 3.1 Sleeper API (`https://api.sleeper.app/v1`)

Public, unofficial, **no authentication, no key**. Endpoints the app uses:

| Path | Returns |
|---|---|
| `/state/nfl` | `{ week, season, season_type }` — authoritative current week |
| `/user/{username}` | user object → `user_id` |
| `/user/{userId}/leagues/nfl/{season}` | the user's leagues |
| `/league/{leagueId}` | league incl. `roster_positions`, `scoring_settings` |
| `/league/{leagueId}/rosters` | `[{ roster_id, owner_id, players[], starters[], settings }]` |
| `/league/{leagueId}/users` | display names, keyed by `user_id` |
| `/league/{leagueId}/matchups/{week}` | per-roster points and starters |
| `/league/{leagueId}/transactions/{week}` | adds/drops/trades |
| `/players/nfl` | **~5 MB** map of every NFL player |
| `/players/nfl/trending/add?limit=25` | league-wide add counts |
| `/players/nfl/trending/drop?limit=25` | league-wide drop counts |

**Critical traps, each already paid for in the web app:**

- **`/players/nfl` is ~5 MB.** Sleeper asks that it be fetched at most once daily. Do
  not keep the raw payload in `UserDefaults` — store a **trimmed projection** (id, name,
  position, team, injury status, active flag) to a file in Application Support. The web
  app lost real time to a silent `localStorage` quota failure that looked exactly like a
  working cache while re-downloading megabytes on every load. `UserDefaults` on iOS will
  bite the same way.
- **A team defense's `player_id` is the team abbreviation** — `"PHI"`, not a numeric id.
  Any code assuming numeric player ids breaks on DEF.
- **`starters` is positionally aligned** to `roster_positions` after bench/IR/taxi slots
  are removed. Index order carries meaning; a `"0"` entry means "slot not set."
- Filter the player pool on the **`active`** flag. Forgetting it silently includes
  retired players.

Cache TTLs currently in use, reasonable to carry over: players 24 h, trending 15 min,
rosters 5 min, odds 10 min, static nflverse files 7 days.

### 3.2 Static nflverse-derived files

Produced by `scripts/preprocess-nflverse.mjs` in the web repo, which pulls from
nflverse and dynastyprocess and writes compact JSON. Total ~1.8 MB.

| File | Size | Shape |
|---|---|---|
| `weekly/{season}.json` | 643 KB | tuple-encoded per-week stat lines |
| `weekly/index.json` | tiny | `{ seasons: [{ season, file, weeks, complete, bytes }] }` |
| `schedule-{season}.json` | 27 KB | `{ byWeek: { "1": [game, ...] } }` |
| `player-ids.json` | 657 KB | `{ players: { [sleeperId]: { gsisId, fantasyprosId, name, position, team } } }` |
| `adp.json` | 170 KB | `{ players: { [fantasyprosId]: { ecr, sd, bye, ... } } }` |
| `nflverse-seasons.json` | 900 KB | season totals per gsis id |
| `cohorts.json` | 24 KB | positional metric distributions |

**`weekly/{season}.json` is the most important file in the app.** Shape:

```jsonc
{
  "fields": ["week","team","opp","cmp","att","pass_yd","pass_td","int","sack",
             "pass_fd","pass_2pt","car","rush_yd","rush_td","rush_fd","rush_fl",
             "rush_2pt","rec","tgt","rec_yd","rec_td","rec_fd","rec_fl","rec_2pt",
             "sack_fl","st_td","fg0_19","fg20_29","fg30_39","fg40_49","fg50_59",
             "fg60","fg_miss","xpm","xpa","tgt_share","ay_share","fp_ppr_ref"],
  "meta":    { "00-0023459": { "n": "Aaron Rodgers", "p": "QB" } },
  "players": { "00-0023459": [ [1,"PIT","NYJ",22,30,244,4,0,4,14,0,1,-1, ...], ... ] }
}
```

Each row is an array positionally matching `fields`. Decode by zipping, never by fixed
index — the field list has changed before and will again.

`schedule-{season}.json` game shape:

```jsonc
{ "home":"SEA", "away":"NE", "kickoff":"2026-09-09", "time":"20:20",
  "spreadLine":3, "totalLine":44.5 }
```

Note `spreadLine`/`totalLine`: **recorded** closing lines, free, no API key. They do not
move during the week. They are the fallback whenever the paid odds key is absent, and
must be **labelled as recorded** in the UI so they're never mistaken for live lines.

#### Coverage gap — state this in the UI, do not paper over it

`weekly/{season}.json` contains **652 players: QB, RB, WR, TE, K only.** There is
**no DEF and no IDP production data at all.** In this league that is 3 of 11 starting
slots (DEF + 2× IDP_FLEX) with nothing to score.

Consequences you must preserve:

- Any ranking built on weekly production silently excludes DEF/IDP. Those positions may
  appear via **trending adds only**, and must be labelled (the web app says
  `popularity only`).
- Anything derived from the **schedule** — bye weeks especially — covers all positions
  fine, because it doesn't need production data.
- Never let a position with no data score as `0`. Report it as *unsupported*, which is a
  different claim.

#### `player-ids.json` dialect traps

This is a dynastyprocess export and **does not speak Sleeper's dialect**:

- Kickers are **`PK`**, not `K`.
- There are **zero `DEF` entries**. Team defenses simply aren't in it.
- IDP positions are **`CB`/`S`/`DE`/`DT`**, not `DB`/`DL`.

Translate at the boundary. This cost real debugging time in the web app as recently as
the last session.

### 3.3 The optional relay (`server/`, Fastify)

| Route | Purpose |
|---|---|
| `GET /health` | liveness |
| `GET /api/news` | RSS aggregation (no direct-fetch path — needs the relay) |
| `GET /api/odds` | live odds via The Odds API (paid key, 500 req/month) |
| `GET /api/odds/:eventId/props` | player props |
| `POST /api/ai/news-summary` | LM Studio summary |
| `POST /api/ai/strategy-brief` | LM Studio brief |
| `GET`/`POST /api/plan` | persisted draft plan |

Treat all of these as **enrichment**. Every one must fail soft.

---

## 4. The scoring profile

Scoring is data, not code. A profile is a flat struct of numeric rules; the engine walks
a stat line and applies them. Port it as a `Codable` Swift struct.

The default (mirrors the user's league; real values come live from Sleeper):

```swift
// Passing
passingYardsPerPoint = 20   // 1 pt per 20 yds
passingTD = 6,  passingFirstDown = 1,  incompletion = -1
sackTaken = -1, interception = -5,     pickSix = -10
passing300Bonus = 3, passing400Bonus = 6, completions25Bonus = 3

// Rushing
rushingYardsPerPoint = 10
rushingTD = 6, rushingFirstDown = 1
rushing100Bonus = 3, rushing200Bonus = 6

// Receiving
receptionPoints = 0         // NOT PPR
receivingYardsPerPoint = 10
receivingTD = 6, receivingFirstDown = 1
receiving100Bonus = 3, receiving200Bonus = 6

// All positions
fumbleLost = -2
passing2pt = 2, rushing2pt = 2, receiving2pt = 2
specialTeamsTD = 6          // return TD — scored separately in every feed

// Kicker
fg0to39 = 3, fg40to49 = 4, fg50to59 = 5, fg60plus = 6
xp = 1, missedFG = -2

// Team DEF
defSack = 1, defInterception = 3, defFumbleRecovery = 2
defTD = 6, defSafety = 2
defPointsAllowed0 = 12,  1to6 = 9,  7to13 = 6,  14to20 = 3
defPointsAllowed21to27 = 1, 28to34 = 0, over35 = -3

// IDP
idpTackle = 1, idpSack = 3, idpInterception = 5
idpFumbleRecovery = 3, idpTD = 6, idpPassDefended = 1
```

**Two hard-won rules:**

1. **A yards-per-point of `0` means "this league does not score yards," not "divide by
   zero."** An `Infinity` here poisons every downstream average and chart axis. Guard it.
2. **Unmapped scoring events must be surfaced, not dropped.** `fumbleLost` was once
   missing from the profile, so Sleeper's `fum_lost` fell into an `unmapped` bucket and
   every projection silently ran high. When translating Sleeper's `scoring_settings`,
   report anything you couldn't map rather than ignoring it.

### The correctness gate

The web app validates its scoring engine by scoring every row under a **PPR reference
profile** and comparing against that row's own `fp_ppr_ref` value carried in the weekly
file. Port this — it's the single highest-value test in the codebase, because it proves
the engine against thousands of real stat lines rather than a handful of hand-written
cases.

Kickers are excluded from the gate: nflverse reports PPR points as 0 for K, so a
comparison there measures nothing.

---

## 5. Algorithms to port

All of these live in `src/utils/` in the web repo. Semantics matter more than the
implementations — port the meaning, write idiomatic Swift.

### 5.1 `scoreWeek` / `scoreWeeks` — `weeklyScoring.js`

Scores one decoded row, or a season of them, under a profile and position. Returns
points plus a **breakdown** (which rules contributed how much) and an `unsupported`
list. Keep the breakdown: the UI shows *why* a number is what it is, and that's a core
product value, not a debugging aid.

### 5.2 `distribution` — `weeklyScoring.js`

Floor / median / ceiling / mean / stdev / coefficient of variation over scored weeks.

- Uses **p20 / p80**, not min/max — one injury exit and one garbage-time TD should not
  define a player's range. Linear-interpolated percentile.
- `cv` is null when mean ≤ 0.5, rather than Infinity.
- This is a floor the player **actually produced**. There is a separate modelled
  floor/ceiling elsewhere in the web app. **They are different claims and the UI must
  label them differently.** Do not merge them.

### 5.3 `parseRosterPositions` / slot template — `rosterSlots.js`

Parses Sleeper's `roster_positions` into a slot template.

```
DIRECT_POSITIONS = QB RB WR TE K DEF LB DL DB

FLEX_ELIGIBILITY:
  FLEX        → RB, WR, TE
  SUPER_FLEX  → QB, RB, WR, TE
  WRRB_FLEX   → RB, WR
  WRTE_FLEX   → WR, TE
  REC_FLEX    → WR, TE
  IDP_FLEX    → LB, DL, DB
```

Unknown tokens containing `FLEX` fall back to standard offensive eligibility and are
reported as `unrecognized` — never silently dropped, because a dropped slot corrupts
every roster-construction calculation downstream. `BN`, `IR`, `TAXI` are skipped.

### 5.4 `byeWeeksFromSchedule` — `byeWeeks.js`

Derives byes from the schedule **by absence**: collect all teams across all 18 weeks; a
team appearing in no game that week is on bye.

This is deliberately *not* the `bye` field on player objects, which arrives through a
FantasyPros ADP name match and reaches **no IDP player at all**.

**Guard:** a week with zero games means the file doesn't cover that week — **not** that
all 32 teams are on bye. Skip it. Inventing 32 byes out of missing data is the obvious
bug here and there's a test for it.

### 5.5 `crunchForWeek` — `byeWeeks.js`

*Can this roster field a legal lineup in week N?*

1. Count required slots per position from the template; count flex slots separately with
   their eligibility sets.
2. Walk the roster. A player whose (normalized) team is on bye that week goes to `onBye`;
   everyone else increments availability at their position.
3. Fill **dedicated slots first**. Surplus at a flex-eligible position becomes flex supply.
4. Shortfall = unfilled dedicated slots + unfilled flex slots.

Report **per position**, not as one feasible/infeasible boolean. "RB: 1 available for 2
slots" is the thing the user acts on; a boolean isn't.

### 5.6 Team normalization — `nflTeams.js`

Sleeper and nflverse disagree on exactly one live team code, and it silently breaks bye
detection for every Rams player if you skip it:

```
LAR → LA     (the live one)
STL → LA
SD  → LAC
OAK → LV
```

Apply before **any** join between a Sleeper-sourced team and an nflverse-sourced team.
There is a dedicated regression test for the LAR→LA case; port it.

### 5.7 Positional baselines — season pace

The start line at a position = the season points-per-game pace of the **last player the
league actually starts** there (8 teams × 2 RB ⇒ the 16th-best RB). Replacement line =
the next player. Require a minimum of 3 games before a player can set a line.

**Do not port `positionBaselines` from `weeklyAggregates.js` for this purpose.** That
function averages each *week's* Nth-best single-week score. It's correct for the matchup
screen (comparing one week against that same week's line) but wrong for season
comparisons: a different player holds the Nth rank every week, so the average of weekly
Nth-bests sits far above the season pace of the actual Nth-best player.

Measured on the shipped 2025 file: **29.7 vs 23.9 for QB.** Using the inflated line left
only **2 of 70** quarterbacks reading as "startable." The season-pace line puts exactly
QB1–QB8 above it, which is what the phrase means.

**Flex slots are deliberately excluded** from the starter counts that set these lines.
Flex demand is split across RB/WR/TE by whatever each manager happens to start, so
charging it fully to every eligible position would count the same slot three times and
push all three lines too high. Excluding it makes the lines mildly conservative, which
is the safer direction.

### 5.8 Acquisition signals — `useAcquisitionBoard.js`

Four **separately named** signals. Current thresholds:

| Signal | Fires when |
|---|---|
| `startable` | season pts/gm ≥ position start line |
| `above-replacement` | ≥ replacement line but below start line (mutually exclusive with the above) |
| `opportunity` | recent (last 4) target share ≥ 20% **and** still below the start line |
| `form` | last-4 pts/gm > season pts/gm × 1.25, with ≥ 4 games played |

`opportunity` is the buy-low and the only forward-leaning signal in the app that is
still a **reported fact** (usage already happened) rather than a forecast.

Rank by **value over the position's start line**, not raw points per game. A QB
outscores every RB in absolute terms, so a raw sort just lists quarterbacks and buries
exactly the undervalued players the feature exists to surface.

### 5.9 `optimizeLineup` — `lineupOptimizer.js`

```
optimizeLineup(currentStarterIds, playerIds, template, playersById, valueOf)
  → (proposedIds, swaps, currentTotal, proposedTotal, gain, unranked, valuedCount)
```

Handles overlapping flex eligibility and minimizes churn (doesn't propose a swap for a
rounding-error gain). **`valueOf` returning nil means "this basis cannot value this
player"** — they are excluded and reported in `unranked`, *never* silently treated as
zero. That distinction is the whole reason the function is trustworthy.

The optimizer takes **exactly one basis at a time** and the UI always names which. The
web app offers: actual pts/gm, last-4 form, floor, ceiling, model score, and game
environment (the implied team total — which knows nothing about the player, and that's
the point of running it *against* the others rather than instead of them).

---

## 6. The house style — read this before writing a feature

The web app has a strong, deliberate methodology. It is the main reason the thing is
trustworthy, and it is easy to destroy by accident. Carry it over.

### Never blend independent signals into a single verdict

This is the cardinal rule. A composite "score" that mixes production, opportunity, form,
and market sentiment hides *which* claim you're betting on, and those claims have
different shelf lives and different failure modes.

A blended weekly evaluator (`evaluateWeekly`) was built in this codebase and then
**deliberately reverted for overclaiming**. Do not rebuild it. If you find yourself
averaging two differently-sourced numbers into one headline figure, stop.

Show separate, named, labelled signals. Let the user pick the ranking basis. Say which
basis is active.

### Say what the number is and where it came from

- Recorded closing line vs live odds → labelled differently.
- Actually-produced floor vs modelled floor → labelled differently.
- Current week from Sleeper vs from local settings → the UI literally says which.
- A position with no data → "unsupported," never 0.

### Prefer derivable truth over a convenient field

Byes from the schedule, not the ADP-matched `bye` field. Roster slots from the league's
own `roster_positions`, not an assumption. Current week from `/state/nfl`, not a
hand-typed setting.

### Two similar-looking things may not be duplicates

The web app has two weekly-data paths that look redundant and are not: Sleeper has
DEF/IDP coverage and the actual started lineups; nflverse has full-population
distributions and usage shares. Neither can replace the other. Both file headers
document the boundary. Expect similar pairs and check before consolidating.

---

## 7. First release — the four screens

Design phone-first. Each screen below names what it must do; the web layout is a
reference, not a spec. A 6" screen wants progressive disclosure, not a dense grid.

### 7.1 Dashboard — "what needs me right now"

Lineup alerts (empty slot, injured/bye starter before kickoff), standings, recent
league transactions, news tied to players on the user's roster, draft-pick value
realized, bench points left on the bench, weekly scoring trend.

Mobile priority: **alerts at the top, everything else scrollable below.** This is the
screen a notification deep-links into.

### 7.2 Matchup — "this week, both sides"

Both rosters side by side, per-player: opponent, actual pts/gm, last-4, floor/ceiling,
defense-vs-position context, and the game's implied total. On a phone, side-by-side
becomes a segmented control or a vertically paired list — don't force two columns.

### 7.3 Sit/Start — "who do I actually play"

The lineup optimizer, one basis at a time, always naming the basis. Show the proposed
swaps and the gain. Surface `unranked` players explicitly rather than hiding them.

### 7.4 Planning — "get ahead of the schedule" ← most recently built, most differentiated

Two halves, and the link between them is the point:

1. **Bye crunch grid** — week × team, every team in the league. Each cell is *starting
   slots that team can't fill that week*, computed against the real slot template with
   flex. The user's row is broken out. Rivals' rows matter: the trade you want is with
   someone who *isn't* short in the same week.
2. **Acquisition board** — ranked candidates with their named signals (§5.8), each
   labelled free agent (a claim) vs on a rival's bench (a trade) vs rival starter.

Tapping a shortfall cell filters the board to players **not themselves on bye** that
week. That link is why the two halves share a screen.

On a phone the week × team grid is the hard layout problem. Consider a horizontally
scrolling grid with a pinned team column, or a week-detail drill-down. Worth prototyping
both.

### Deferred (explicitly out of scope for v1)

Draft Dashboard, Draft Plan, Mock Draft, Research, Odds, Power Rankings, Trade Analyzer.
The draft tooling is preseason and the worst fit for a small screen. Don't build toward
them, but don't wall them out of the data layer either.

---

## 8. Native capabilities

All four were requested. Build them in this order — each one's foundation feeds the next.

### 8.1 Background refresh + offline (build first)

Everything else depends on fresh local data existing without the app being open.

- `BGAppRefreshTask` for opportunistic refresh. **Timing is not guaranteed** — iOS
  decides. Never build a feature that requires a refresh to have happened at a specific
  time; always show the data's age.
- Bundle the static nflverse JSON in the app so a cold launch with no network still
  works.
- Cache Sleeper responses to disk with the TTLs in §3.1.
- Every screen must render correctly from cache alone, with a visible staleness
  indicator.

### 8.2 Push notifications

**Recommended approach: local notifications scheduled from background refresh.** No APNs
infrastructure, no server dependency, works with the relay unreachable — which, per §0,
is the normal case away from home.

Triggers worth having:

- A starter is ruled out / questionable and kickoff is near
- A lineup slot is empty as kickoff approaches
- An acquisition-board target crosses a signal threshold, or trending spikes
- A bye crunch week is approaching with an unfilled slot (N weeks of lead time)

If true server-pushed alerts are wanted later, the relay can send APNs — but that is an
upgrade, not the foundation. Don't make v1 depend on it.

### 8.3 Home Screen widgets

WidgetKit, reading from a **shared App Group container** so the widget and app use the
same cache. Candidates: live score vs opponent, this week's lineup holes, top
acquisition target, next bye crunch.

### 8.4 Live Activities / Dynamic Island

Gameday score vs opponent on the Lock Screen.

**Be honest about the constraint:** without APNs push updates, a Live Activity can only
update from the app or a background task, so refresh cadence during a Sunday slate will
be coarse. Either accept coarse updates and label the timestamp, or stand up APNs on the
relay specifically for this. Decide deliberately — don't ship something that looks live
and isn't.

---

## 9. Keeping the static data fresh

The nflverse files are regenerated by a Node script on a machine. A phone can't run it.

**Recommended:** publish the generated JSON to a stable HTTPS location (GitHub Releases
or raw repo content both work), and have the app fetch with `ETag`/`If-None-Match` on a
~7-day TTL, falling back to the copies bundled at build time.

This gives: works offline immediately on first launch, stays current without a TestFlight
build, costs nothing to host. The alternative — bundle-only — means the data is frozen
until the next build, which is wrong during a season.

Version the payload and have the app tolerate a newer schema than it knows (ignore
unknown fields; never crash on them).

---

## 10. Testing

The web app's most valuable tests assert against the **real shipped data files**, not
mocks. Mocks would have passed while the actual dialect mismatches (§3.2) sailed through.
Copy this approach: put the real JSON in the test bundle and assert on it.

Port these specifically — each one guards a bug that actually happened:

- **Scoring correctness gate** (§4) — score every row under the PPR reference profile,
  compare to `fp_ppr_ref`. Thousands of real stat lines.
- **Bye derivation** — 32 teams found; a known week's byes reproduce exactly; a
  zero-game week yields no byes rather than 32; `LAR` normalizes to `LA` and a Rams
  player correctly reads as on bye.
- **Crunch math** — a position flags short only when non-bye players genuinely can't
  fill its slots; flex eligibility respected; a position with no rostered players
  reports its full shortfall.
- **Baselines** — exactly *N* players clear the start line at a position with *N*
  starters; start line sits above replacement; no baseline is invented for a position
  with no weekly data.
- **Signals** — `startable` and `above-replacement` are mutually exclusive; every
  `opportunity` flag is genuinely below the start line with a real ≥20% target share; a
  position with no baseline produces zero signals rather than a bogus one.
- **Optimizer** — a nil-valued player lands in `unranked` and is never scored as 0.

Add a UI smoke test per screen that renders from a fixture with no network.

---

## 11. Suggested build order

1. **`FCCore` + tests.** Scoring engine, profile, distribution, slot template, bye
   derivation, crunch, baselines, signals, optimizer. No UI. Get the correctness gate
   green — this is the foundation and it's verifiable without a single view.
2. **`FCData`.** Sleeper client, disk cache, static data store with bundled fallback +
   HTTP refresh. Settings screen (username → league pick).
3. **Planning screen.** The most differentiated feature and it exercises nearly the whole
   core. Build it first as the proof.
4. **Dashboard**, then **Matchup**, then **Sit/Start**.
5. **Background refresh + offline polish**, then **local notifications**.
6. **Widgets**, then **Live Activities**.
7. **Mac layout pass.**
8. **TestFlight.**

Ship to TestFlight as early as step 3 — the user wants this on a phone during a live
season, and feedback from real use will beat any amount of anticipated design.

---

## 12. Things not to do

- Don't rebuild a blended composite score. It was built, and reverted, on purpose (§6).
- Don't rank cross-position by raw points per game (§5.8).
- Don't use weekly-Nth-best baselines for season comparisons (§5.7).
- Don't assume numeric player ids — DEF breaks that (§3.1).
- Don't skip team normalization on any Sleeper↔nflverse join (§5.6).
- Don't score a position with no data as 0 (§3.2).
- Don't put the 5 MB player payload in `UserDefaults` (§3.1).
- Don't make any v1 feature depend on the relay being reachable (§0).
- Don't hardcode league scoring or roster slots (§1).

---

## 13. Open questions for the user

Ask these when you reach them; none block starting on `FCCore`.

1. **Apple Developer account** — is it already set up, or does that need doing before the
   first TestFlight build?
2. **Static data hosting** — is publishing the generated JSON to the existing GitHub repo
   acceptable, or should it go somewhere else?
3. **Live Activities fidelity** — accept coarse updates without APNs, or stand up push on
   the relay for real-time gameday scoring?
4. **Watch app** — not currently in scope. Worth it later, or not interesting?
5. **Notification aggressiveness** — how chatty should alerts be? Injury-only, or the
   full set in §8.2?
6. **Does the web app keep running** in parallel, or is the Swift app intended to replace
   it once it reaches parity? Affects whether the preprocess pipeline needs to keep
   serving both.
