# Football Command Center

A personal fantasy football research hub built for Sleeper leagues. It pulls live player and league data directly from Sleeper's free API and supplements it with historical NFL stats from nflverse. No subscription, no backend, no database — everything runs in your browser.

---

## What it does

| Page | What's live |
|------|-------------|
| **Draft** | Full active player list sourced from Sleeper — positions, teams, injury status, bye weeks, trending adds/drops, watchlist, search and filters |
| **Player Drawer** | Click any player to open a side panel with context, historical season stats (after running the data script), scoring-profile-aware evaluation, and your saved research notes |
| **Research** | Freeform note cards tied to players — tag by injury, depth chart, role change, target share, etc. |
| **Dashboard** | Roster/matchup data shell (in progress) |
| **Sit / Start** | Coming soon |
| **Trade Analyzer** | Coming soon |
| **Odds** | Coming soon |

---

## Before you start

You need two things installed on your computer:

### 1. Node.js (v18 or later)

Node.js is the JavaScript runtime that powers the development server and the data preprocessing script.

- Go to [nodejs.org](https://nodejs.org) and download the **LTS** version
- Run the installer — it also installs `npm` automatically
- Verify it worked by opening a terminal and running:

```
node --version
npm --version
```

Both commands should print a version number. If they do, you're good.

### 2. Git

Git lets you download the code from GitHub.

- Go to [git-scm.com](https://git-scm.com) and download the installer for your OS
- Verify: `git --version`

---

## Installation

Open a terminal (on Mac: search Spotlight for "Terminal"; on Windows: search for "Command Prompt" or "PowerShell").

**Step 1 — Download the code**

```bash
git clone https://github.com/Sidebyrner/Football-Command-Center.git
```

**Step 2 — Move into the project folder**

```bash
cd Football-Command-Center
```

**Step 3 — Install dependencies**

```bash
npm install
```

This downloads all the libraries the app needs. It may take 30–60 seconds. You only need to do this once.

---

## Environment setup (optional)

The app works without this step, but it lets you set default values so you don't have to change them in the UI every time.

**Step 1 — Copy the example file**

```bash
cp .env.example .env
```

On Windows Command Prompt use `copy` instead of `cp`:

```
copy .env.example .env
```

**Step 2 — Open `.env` in any text editor and fill it in**

```
VITE_ODDS_API_KEY=your_key_here
VITE_DEFAULT_SEASON=2026
VITE_DEFAULT_WEEK=1
```

- `VITE_DEFAULT_SEASON` — the NFL season year (e.g. `2026`)
- `VITE_DEFAULT_WEEK` — the current week number (1–18)
- `VITE_ODDS_API_KEY` — only needed if you want the Odds page (see [The Odds API](#the-odds-api-optional) below)

Save the file. The `.env` file is intentionally not committed to Git — it stays private on your machine.

---

## Running the app

```bash
npm run dev
```

You'll see output like:

```
  VITE v6.x.x  ready in 300ms

  ➜  Local:   http://localhost:5173/
```

Open [http://localhost:5173](http://localhost:5173) in your browser. The app loads instantly — no build step needed in dev mode.

To stop the server, press `Ctrl + C` in the terminal.

---

## First-time setup (inside the app)

The app will redirect you to **Settings** the first time you open it. This is where you connect your Sleeper account.

### Step 1 — Enter your Sleeper username

Type your **Sleeper username** (not your email — the public @username you see in the app) and click **Look up**. The app confirms your account and loads your leagues automatically.

### Step 2 — Select your league

A dropdown appears with your NFL leagues for the current season. Pick the one you want to work with.

### Step 3 — Set season and week

Match these to the current NFL season and week. The defaults from your `.env` file pre-fill these.

### Step 4 — Save

Click **Save Settings**. You'll be redirected to the dashboard. Your settings are saved in your browser's local storage, so you only need to do this once per browser.

---

## The Odds API (optional)

The Odds page requires a free API key from [The Odds API](https://the-odds-api.com).

- Sign up for free — the free tier gives you 500 requests per month
- Copy your key from their dashboard
- Paste it into the Odds API Key field in Settings (or add it to your `.env` file as `VITE_ODDS_API_KEY`)

You can use every other feature without this key.

---

## Historical player stats (optional — highly recommended)

The **Stats tab** in the player drawer and the real-data inputs for the **Evaluate tab** both require a one-time preprocessing step. This downloads historical NFL player stats from [nflverse](https://nflreadr.nflverse.com) and converts them into a compact file the app can use instantly.

**Run this from the project folder:**

```bash
npm run preprocess-nflverse
```

This downloads 2024 and 2023 regular season stats (~two seasons of data), processes them, and writes the result to `public/data/nflverse-seasons.json`. It takes 1–3 minutes depending on your internet speed.

To also pull 2022 data:

```bash
npm run preprocess-nflverse:all
```

Once the script finishes, **restart the dev server** (`Ctrl + C`, then `npm run dev` again) and historical stats will appear in every player drawer.

You can re-run this command at the start of each season to refresh the data.

---

## Project structure

```
Football-Command-Center/
├── public/
│   └── data/
│       └── nflverse-seasons.json   ← generated by the preprocess script
├── scripts/
│   └── preprocess-nflverse.mjs     ← data prep script (run with npm run preprocess-nflverse)
├── src/
│   ├── components/
│   │   ├── draft/
│   │   │   ├── DraftFilters.jsx    ← search + filter bar
│   │   │   ├── PlayerDrawer.jsx    ← right-side player panel (Overview / Stats / Evaluate / Research tabs)
│   │   │   └── PlayerTable.jsx     ← main sortable player grid
│   │   ├── eval/
│   │   │   ├── EvalPanel.jsx       ← weekly start/sit + draft value scoring UI
│   │   │   └── ScoringProfileManager.jsx
│   │   ├── layout/                 ← Sidebar, Header, StatusBar
│   │   └── research/               ← note card components
│   ├── hooks/
│   │   ├── useDraftPlayers.js      ← fetches + normalizes Sleeper player list
│   │   ├── usePlayerStats.js       ← lazy-loads nflverse history per player
│   │   ├── useSleeperLeague.js
│   │   ├── useSleeperMatchup.js
│   │   ├── useSleeperRoster.js
│   │   └── useSleeperUser.js
│   ├── services/
│   │   ├── sleeperService.js       ← all Sleeper API helpers (league, rosters, drafts, players)
│   │   └── nflverseService.js      ← loads + caches the preprocessed stats file
│   ├── pages/
│   │   ├── Dashboard.jsx
│   │   ├── DraftDashboard.jsx      ← main active page
│   │   ├── Research.jsx
│   │   ├── Settings.jsx
│   │   └── ...
│   ├── store/
│   │   ├── useAppStore.js          ← Sleeper account + league settings (persisted)
│   │   ├── useResearchStore.js     ← saved player notes (persisted)
│   │   └── useScoringProfileStore.js
│   └── utils/
│       ├── sleeperApi.js           ← raw Sleeper API fetch calls
│       ├── evaluationEngine.js     ← start/sit + draft value scoring model
│       ├── cache.js                ← localStorage TTL cache
│       └── playerHelpers.js
├── .env.example                    ← copy this to .env and fill it in
├── package.json
└── vite.config.js
```

---

## Data sources

| Source | What it provides | How it's used |
|--------|-----------------|---------------|
| [Sleeper API](https://docs.sleeper.com) | Player metadata, league settings, rosters, matchups, drafts, trending | Primary layer — all live fantasy context. Free, no key required. |
| [nflverse](https://nflreadr.nflverse.com) | Historical season stats, advanced metrics (target share, ADOT, WOPR, etc.) | Supplemental layer — loaded after running the preprocess script. |
| [The Odds API](https://the-odds-api.com) | NFL game lines and player props | Optional — requires a free API key. |

All data is fetched directly in your browser or preprocessed locally. There is no server or database.

---

## Available commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start the local development server |
| `npm run build` | Build a production-ready version into `/dist` |
| `npm run preview` | Preview the production build locally |
| `npm run preprocess-nflverse` | Download + process nflverse 2023–2024 player stats |
| `npm run preprocess-nflverse:all` | Same as above but also includes 2022 |

---

## Troubleshooting

**The page is blank or shows an error about Settings**

Open [http://localhost:5173/settings](http://localhost:5173/settings) and complete the first-time setup. The app requires a Sleeper username and league before most pages load.

**"Username not found on Sleeper"**

Make sure you're typing your Sleeper **username** (the public @handle), not your email address. You can find it in the Sleeper app under your profile.

**No leagues appear after looking up my username**

The league lookup is tied to the season year in Settings. If your league ran in a different year than what's set, update the Season field first and click Look up again.

**The Stats tab says "Historical data not loaded"**

Run `npm run preprocess-nflverse` from the project folder in your terminal, then restart the dev server.

**npm install fails**

Make sure you're running Node.js v18 or later (`node --version`). If you're on an older version, download the LTS from [nodejs.org](https://nodejs.org) and reinstall.

**Port 5173 is already in use**

Either stop whatever is running on that port, or Vite will automatically try the next port (5174, 5175, etc.) and print the actual URL in the terminal.

---

## Tech stack

- **React 18** — UI framework
- **Vite** — dev server and build tool
- **Tailwind CSS** — styling
- **Zustand** — state management (settings and research notes persist across sessions)
- **Recharts** — chart components
- **Lucide React** — icons
