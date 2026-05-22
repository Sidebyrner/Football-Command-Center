# Football Command Center

A personal fantasy football dashboard that centralizes your Sleeper league data, real-time player news, and betting market signals into one decision-making interface. Built for in-season sit/start decisions, trade analysis, and waiver wire scouting — all in a single dark-mode tool.

The design philosophy is **Bloomberg Terminal meets ESPN+**: dense, data-first, and fast. No AI recommendations, no filler content — just the numbers you need to make your own calls.

---

## Core Capabilities

**Dashboard**
Your weekly command center. See your full roster with injury status badges and bye week indicators, your current matchup with projected points on both sides, trending waiver adds/drops across the league, and a feed of recent transactions (trades and waiver claims) from the last 48 hours.

**Sit / Start Comparison**
Compare up to 4 players side-by-side before setting your lineup. Each player card shows name, team, position, injury status, ownership percentage, a Sleeper news snippet, and implied team total pulled from the betting market. Confidence indicators (green / amber / red) are set manually by you — no automated recommendations.

**Trade Analyzer**
Two-panel input for evaluating trades: what you give, what you receive. See Sleeper trade value scores, injury status, age, and remaining schedule strength for each player. A value delta indicator shows the gap — the data, not a verdict.

**Odds / Game Lines**
Weekly NFL game list with spread and total for every game. An implied team total calculator (total ÷ 2 ± spread ÷ 2) identifies high-ceiling game environments. Teams with implied totals above 27 points are highlighted. Player props tab available when data is accessible.

**Settings**
Connect your Sleeper account by username (no password required — Sleeper's API is public), select which of your leagues to track, set the current NFL week, and optionally add an Odds API key to unlock betting market data. Everything persists locally in your browser — no account, no backend.

---

## Requirements

- **Node.js** v18 or later — [nodejs.org](https://nodejs.org)
- **npm** v9 or later (included with Node)
- A **Sleeper** account with at least one active NFL league — [sleeper.com](https://sleeper.com)
- _(Optional)_ A free **The Odds API** key for betting market data — [the-odds-api.com](https://the-odds-api.com)

---

## Installation

**1. Clone the repository**

```bash
git clone https://github.com/Sidebyrner/Football-Command-Center.git
cd Football-Command-Center
```

**2. Install dependencies**

```bash
npm install
```

**3. Create your environment file**

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Open `.env` in any text editor:

```
VITE_ODDS_API_KEY=your_key_here   # Optional — leave as-is to skip odds features
VITE_DEFAULT_SEASON=2026          # The current NFL season year
VITE_DEFAULT_WEEK=1               # Starting week (you can override this in Settings)
```

> If you don't have an Odds API key, leave `VITE_ODDS_API_KEY` blank or as the placeholder text. The rest of the app works without it.

**4. Start the development server**

```bash
npm run dev
```

The app will open at **http://localhost:5173** in your browser.

---

## First-Time Setup

When you open the app for the first time, you'll be taken directly to the **Settings** page. You must complete this before any other page is accessible.

1. **Enter your Sleeper username** — this is your public display name, not your email address. Click **Look up** (or press Enter).
2. **Select your league** — once your account is found, a dropdown will appear with all your active NFL leagues for the current season. Pick the one you want to track.
3. **Confirm the season and week** — defaults are pulled from your `.env` file but can be overridden here at any time.
4. **Paste your Odds API key** (optional) — if you have one, paste it here. The key is stored only in your browser's local storage.
5. Click **Save Settings** — you'll be redirected to the Dashboard.

Settings are saved to your browser's local storage and will persist across sessions. You can return to Settings at any time via the sidebar to switch leagues or update your API key.

---

## Running a Production Build

To build an optimized static bundle:

```bash
npm run build
```

Output goes to the `dist/` folder. You can serve it locally to test:

```bash
npm run preview
```

Or deploy the `dist/` folder to any static host (Netlify, Vercel, GitHub Pages, Cloudflare Pages, etc.).

---

## Project Structure

```
src/
├── components/
│   ├── layout/         Sidebar, Header, StatusBar
│   └── shared/         SkeletonCard, StatusBadge, PlayerAvatar, RefreshButton
├── hooks/              Data-fetching hooks for Sleeper and Odds APIs
├── pages/              Dashboard, SitStart, TradeAnalyzer, Odds, Settings
├── store/              Zustand store — persisted to localStorage
└── utils/              API clients, cache helpers, player status utilities
```

---

## API Usage & Caching

**Sleeper API** — completely free, no authentication required. The full player database (~5MB) is cached in your browser for 24 hours to avoid re-fetching it on every load. Roster and matchup data refreshes on page load or via the manual refresh button.

**The Odds API** — free tier includes 500 requests per month. To protect your quota, odds data is cached for 10 minutes and there is **no auto-refresh** — you must click the refresh button manually. The remaining credit count is displayed in the status bar at the bottom of the screen.

---

## Tech Stack

| | |
|---|---|
| Framework | React 18 + Vite |
| Styling | Tailwind CSS v3 |
| State | Zustand (with localStorage persistence) |
| Routing | React Router v6 |
| Charts | Recharts |
| Icons | Lucide React |
