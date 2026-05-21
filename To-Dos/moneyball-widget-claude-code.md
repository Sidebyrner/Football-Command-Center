# Claude Code Task: Moneyball Charting Widget
## Football Command Center — `src/components/research/MoneybballWidget.jsx`

---

## Overview

Build a **self-contained Moneyball Charting Widget** that drops into the existing
`/research` route of the Football Command Center. The widget computes and
visualizes a composite **Moneyball Score** for WR and RB players using the
statistical model described below, then renders interactive Recharts
visualizations inside the app's existing design system.

This is **not** a new page — it is a new component exported from
`src/components/research/MoneybballWidget.jsx` that the existing
`src/pages/Research.jsx` page will import and render.

---

## Repo Context (read before writing any code)

| Item | Value |
|---|---|
| Framework | React 18 + Vite |
| Styling | Tailwind CSS v3 with custom tokens defined in `tailwind.config.js` |
| Charts | Recharts ^2.14 (already installed) |
| Icons | lucide-react (already installed) |
| State | Zustand via `src/store/useAppStore.js` and `src/store/useScoringProfileStore.js` |
| Data | nflverse preprocessed stats via `src/services/nflverseService.js` |
| Design tokens | Dark-first — `bg: #0a0f1e`, `surface: #111827`, `surface-2: #1e293b`, `accent: #f59e0b` |
| Fonts | Inter (body), Sora (display) |
| Existing eval engine | `src/utils/evaluationEngine.js` — exports `evaluateWeekly(player, profile, metrics)` |
| Existing player hook | `src/hooks/usePlayerStats.js` — returns `{ history, seasons }` |
| Existing nflverse adapter | `src/services/nflverseService.js` — exports `toEvalMetrics(seasonStats)` |

**Read these files before writing any code:**
- `src/utils/evaluationEngine.js`
- `src/hooks/usePlayerStats.js`
- `src/store/useScoringProfileStore.js`
- `src/components/eval/EvalPanel.jsx` (for style reference — copy badge/color patterns)
- `tailwind.config.js`

---

## Component Goal

The widget answers one question for the user each week:

> **"Which WRs and RBs on my roster or watchlist have the highest Moneyball Score right now, and should I start or sit them?"**

It renders:
1. A **position toggle** (WR | RB | All)
2. A **sortable score board** — radar/bar hybrid showing composite score per player
3. A **Start / Fringe / Sit band** — color-coded horizontal swimlane chart
4. A **factor breakdown bar chart** — horizontal bars showing each metric's weighted contribution
5. A **matchup overlay** — opponent defensive rank badge on each player card

---

## The Moneyball Scoring Formula

### WR Composite Score

```
WR_Score =
  (targetShare        × 10) +
  (yprr               ×  9) +
  (qbRating           ×  8) +
  (airYardsShare      ×  8) +
  (redZoneTargets     ×  7) +
  (firstReadRate      ×  7) +
  (adot               ×  6) +
  (trueCatchRate      ×  6) +
  (olProtection       ×  5) +
  (separation         ×  4)

Total raw weight = 70
Normalize: WR_Score = (rawSum / 70) × 100
```

### RB Composite Score

```
RB_Score =
  (snapShare          × 10) +
  (touches            × 10) +
  (goalLineCarries    ×  9) +
  (expectedFP         ×  9) +
  (redZoneTouchShare  ×  8) +
  (targetShare        ×  7) +   // PPR modifier
  (successRate        ×  6) +
  (yardsBeforeContact ×  5) +
  (olRunBlocking      ×  4) +
  (catchRate          ×  4) +
  (opponentRank       ×  3)

Total raw weight = 75
Normalize: RB_Score = (rawSum / 75) × 100
```

### All metric values must be normalized to [0, 1] before applying weights.

Use these normalization bounds:

| Metric | Min | Max |
|---|---|---|
| targetShare | 0 | 0.40 |
| yprr | 0 | 4.0 |
| qbRating | 50 | 130 |
| airYardsShare | 0 | 0.45 |
| redZoneTargets | 0 | 20 |
| firstReadRate | 0 | 0.60 |
| adot | 0 | 20 |
| trueCatchRate | 0 | 1.0 |
| olProtection | 0 | 100 |
| separation | 0 | 4.0 |
| snapShare | 0 | 1.0 |
| touches | 0 | 350 |
| goalLineCarries | 0 | 20 |
| expectedFP | 0 | 400 |
| redZoneTouchShare | 0 | 1.0 |
| successRate | 0 | 1.0 |
| yardsBeforeContact | 0 | 4.0 |
| olRunBlocking | 0 | 100 |
| catchRate | 0 | 1.0 |
| opponentRank | 0 | 32 | ← invert: lower rank = better matchup |

---

## Designation Thresholds

Reuse the same thresholds already in `evaluationEngine.js`. If they differ,
use these as the canonical source for this widget:

| Score Range | Designation | Color token |
|---|---|---|
| 80–100 | Strong Start | `text-emerald-400` / `bg-emerald-500/15` |
| 65–79  | Start        | `text-emerald-400` / `bg-emerald-500/10` |
| 50–64  | Fringe       | `text-amber-400`   / `bg-amber-500/10`   |
| 35–49  | Sit          | `text-rose-400`    / `bg-rose-500/10`    |
| 0–34   | Strong Sit   | `text-rose-500`    / `bg-rose-500/15`    |

---

## File Structure to Create

```
src/
  components/
    research/
      MoneybballWidget.jsx          ← Main widget export (PRIMARY FILE)
      MoneyballScoreBoard.jsx       ← Sortable player score table with Recharts bar
      MoneyballSwimLane.jsx         ← Start/Fringe/Sit band visualization
      MoneyballFactorChart.jsx      ← Horizontal factor breakdown bar chart
  utils/
    moneybballEngine.js             ← Pure scoring logic (no React)
  data/
    moneybballMockPlayers.js        ← Mock player dataset (see spec below)
```

**Do not modify** existing files except to add one import + component render
inside `src/pages/Research.jsx`.

---

## `moneybballEngine.js` Spec

Export the following functions:

```js
// Normalize a raw metric value to [0, 1] using the bounds table above
export function normalize(key, value) { ... }

// Compute WR composite score (0–100)
export function scoreWR(metrics) { ... }

// Compute RB composite score (0–100)
export function scoreRB(metrics) { ... }

// Return top 5 contributing factors as [{ key, weight, normalizedValue, contribution }]
export function getTopFactors(position, metrics) { ... }

// Return designation string from score
export function getDesignation(score) { ... }
```

All functions must be **pure** — no side effects, no imports from React or stores.
Include JSDoc comments for each exported function.

---

## `moneybballMockPlayers.js` Spec

Export an array of 16 mock players (8 WR, 8 RB) shaped as:

```js
export const MOCK_PLAYERS = [
  {
    id: 'wr-puka-nacua',
    name: 'Puka Nacua',
    position: 'WR',
    team: 'LAR',
    opponentTeam: 'SEA',
    opponentDefRank: 28,       // vs WR
    injuryStatus: null,        // null | 'Q' | 'D' | 'O'
    metrics: {
      targetShare: 0.285,
      yprr: 3.1,
      qbRating: 98.2,
      airYardsShare: 0.251,
      redZoneTargets: 14,
      firstReadRate: 0.42,
      adot: 11.2,
      trueCatchRate: 0.84,
      olProtection: 72,
      separation: 2.9,
    }
  },
  // ... 15 more players
]
```

Include realistic 2025 season stats for:
- WR: Puka Nacua, Amon-Ra St. Brown, Justin Jefferson, Jaylen Waddle,
       Michael Pittman Jr., Garrett Wilson, Drake London, Jaxon Smith-Njigba
- RB: Christian McCaffrey, Bijan Robinson, Jonathan Taylor, Jahmyr Gibbs,
       James Cook, Saquon Barkley, De'Von Achane, Derrick Henry

---

## `MoneybballWidget.jsx` Spec

### Props
```ts
interface MoneyballWidgetProps {
  players?: PlayerInput[]   // If omitted, use MOCK_PLAYERS
}
```

### State
```js
const [posFilter, setPosFilter] = useState('All')   // 'All' | 'WR' | 'RB'
const [sortKey, setSortKey] = useState('score')      // 'score' | 'name' | 'designation'
const [selectedPlayer, setSelectedPlayer] = useState(null)
```

### Layout structure (Tailwind, dark-first)

```
┌─────────────────────────────────────────────────────┐
│  Header: "Moneyball Rankings" + position toggle      │
├─────────────────────────────────────────────────────┤
│  MoneyballSwimLane (full-width band chart)           │
├─────────────────────────────────────────────────────┤
│  MoneyballScoreBoard (sortable table with mini bars) │
├─────────────────────────────────────────────────────┤
│  [When player selected] MoneyballFactorChart         │
└─────────────────────────────────────────────────────┘
```

Use `bg-surface`, `bg-surface-2`, `text-accent` tokens throughout.
The widget should fill the full available width of the Research page content area.

---

## `MoneyballSwimLane.jsx` Spec

A **custom Recharts ScatterChart** that plots all players on a single horizontal
axis (0–100 score) with vertical bands for each designation tier.

- Background `ReferenceArea` bands: Strong Start (emerald), Start (emerald-light),
  Fringe (amber), Sit (rose), Strong Sit (rose-dark)
- Each player is a `<Scatter>` dot labeled with their last name
- WR dots: `fill="#f59e0b"` (accent), RB dots: `fill="#60a5fa"` (blue)
- Hovering a dot shows a tooltip: Name, Team, Score, Designation
- Clicking a dot sets `selectedPlayer` in parent (use callback prop `onSelect`)

---

## `MoneyballScoreBoard.jsx` Spec

A sortable table using standard HTML `<table>` styled with Tailwind.

Columns: Rank | Player | Pos | Team | Score | Designation | Top Factor | Matchup

- Score column renders a `<BarChart>` mini sparkbar (single horizontal bar,
  width proportional to score / 100, colored by designation)
- Matchup column shows opponent team abbreviation + a color-coded defense rank
  badge (green = favorable ≥ 25, amber = neutral 13-24, red = tough ≤ 12)
- Clicking a row sets `selectedPlayer` in parent
- Active row highlighted with `bg-surface-2 border-l-2 border-accent`

---

## `MoneyballFactorChart.jsx` Spec

A **Recharts `BarChart` with `layout="vertical"`** showing the top 5 weighted
factor contributions for the selected player.

- X axis: 0–10 (contribution points)
- Y axis: factor label (human-readable, same labels as `EvalPanel.jsx`)
- Bar fill: `#f59e0b` (accent) with `opacity` proportional to contribution magnitude
- Include a `ReferenceLine` at the position average contribution per factor
- Title: `"{Player Name} — Factor Breakdown"`
- Show the overall score and designation badge above the chart

---

## Integration: `src/pages/Research.jsx`

Add the following **at the top** of the existing Research page component, after any
existing imports:

```jsx
import MoneybballWidget from '../components/research/MoneybballWidget'
```

Then render it inside the page's existing layout, **above** any existing content:

```jsx
<section className="mb-8">
  <MoneybballWidget />
</section>
```

Do not remove or refactor any existing Research page content.

---

## Acceptance Criteria

- [ ] `moneybballEngine.js` exports all 5 functions with correct normalization logic
- [ ] WR and RB scores compute to values between 0–100 for all mock players
- [ ] `getTopFactors()` returns exactly 5 items sorted descending by contribution
- [ ] `MoneybballWidget` renders without errors when `players` prop is omitted
- [ ] Position toggle correctly filters SwimLane and ScoreBoard to WR / RB / All
- [ ] Clicking a SwimLane dot OR a ScoreBoard row opens the FactorChart for that player
- [ ] FactorChart displays the correct player name and score
- [ ] All components use only Tailwind classes from `tailwind.config.js` tokens —
      no hardcoded hex colors except where matching the existing EvalPanel patterns
- [ ] Injury status badge (`Q` / `D` / `O`) appears on player name in ScoreBoard
      when `injuryStatus` is non-null
- [ ] No TypeScript errors (JSDoc types are acceptable; full `.tsx` is optional)
- [ ] No modifications to any existing file except `src/pages/Research.jsx`

---

## Edge Cases to Handle

| Scenario | Expected Behavior |
|---|---|
| A metric value is `null` or `undefined` | Treat as position-average default (0.5 normalized) and flag in missing metrics array |
| All players have the same score | SwimLane still renders; ScoreBoard sorts alphabetically as tiebreaker |
| `players` prop is an empty array | Render an empty state: "No players available — using sample data" and fall back to MOCK_PLAYERS |
| Selected player changes position filter away from their position | Clear `selectedPlayer` |
| Player has `injuryStatus: 'O'` (Out) | Apply 0× multiplier to score (score = 0), force designation to "Out" |
| Player has `injuryStatus: 'D'` (Doubtful) | Apply 0.25× multiplier to score |
| Player has `injuryStatus: 'Q'` (Questionable) | Apply 0.85× multiplier to score |

---

## Style Rules (match existing repo aesthetic)

- Background surfaces: always `bg-[var(--color-bg)]`, `bg-[var(--color-surface)]`, `bg-[var(--color-surface-2)]`
- Section headers: `font-display text-sm font-bold uppercase tracking-widest text-[var(--color-text-faint)]`
- Borders: `border border-[var(--color-border)]` or `border border-white/10`
- Focus rings: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`
- No colored left-border "stripe" on cards (match existing EvalPanel convention)
- Recharts `Tooltip` content: use custom `<div>` with `bg-surface-2 border border-white/10 rounded p-2 text-xs`
- Recharts axes: `stroke="#374151"` (matches surface-2 tone), tick `fill="#6b7280"`, `fontSize={11}`

---

## Do Not

- Do not install any new npm packages
- Do not use `localStorage` or `sessionStorage`
- Do not create a new route or page
- Do not modify `evaluationEngine.js`, `useAppStore.js`, or `useScoringProfileStore.js`
- Do not use inline `style` objects for colors that have a Tailwind token equivalent
- Do not use `@apply` in CSS files — all styles via Tailwind class names in JSX

---

## Deliverable Summary

| File | Action |
|---|---|
| `src/utils/moneybballEngine.js` | **Create** |
| `src/data/moneybballMockPlayers.js` | **Create** |
| `src/components/research/MoneybballWidget.jsx` | **Create** |
| `src/components/research/MoneyballScoreBoard.jsx` | **Create** |
| `src/components/research/MoneyballSwimLane.jsx` | **Create** |
| `src/components/research/MoneyballFactorChart.jsx` | **Create** |
| `src/pages/Research.jsx` | **Modify** (add import + render only) |

