# fcc-server

API proxy for Football Command Center — see `/root/.claude/plans/...` (B1-B3)
for the full design rationale. Deliberately minimal: no ORM, no relational
database. An in-memory `Map` with TTL handles odds/news caching; the draft
plan is a single JSON file on disk (see "Why not SQLite" below).

## Routes

| Route | Purpose |
|---|---|
| `GET /health` | `{ status, uptime }` — no auth, used for the container healthcheck |
| `GET /api/odds` | Proxies The Odds API; same `{ data, remaining, used }` shape `src/utils/oddsApi.js` already expects client-side |
| `GET /api/odds/:eventId/props` | Proxies player-prop odds for one event |
| `GET /api/news?feed=<alias>` | Fetches + parses an RSS/Atom feed from a server-side alias map (`routes/news.js`). The client never sends a URL — only a short alias — so this cannot become an open relay |
| `GET /api/plan` | Returns `{ targets, updatedAt }` — the last plan written. No auth (matches odds/news) |
| `PUT /api/plan` | Write-through target for the client's draft plan. Whole-document overwrite, no auth |
| `GET /plan` | Human-facing read-only HTML view — the page you actually open on your phone. Gated by `?token=` when `PLAN_AUTH_TOKEN` is set |

## Environment

| Var | Required | Notes |
|---|---|---|
| `PORT` | no (default 8080) | |
| `DATA_DIR` | no (default `/data`) | Where `plan.json` is written — should point at the bind-mounted volume so it survives container restarts |
| `ODDS_API_KEY` | for `/api/odds*` | Set in Portainer's env panel, never in compose text or git |
| `ALLOWED_ORIGINS` | yes, for any browser client | Comma-separated. **Unset = no origin is allowed** (fails closed, not open) |
| `PLAN_AUTH_TOKEN` | recommended once you rely on `/plan` | Gates only the human-facing HTML view, not the JSON API. Unset means anything that can reach this server can read your draft plan — the server logs a warning at boot if it's unset. Pick a long random string; bookmark `/plan?token=<it>` on your phone |

## Why the plan is a flat file, not SQLite

One document, one writer (the browser app), no concurrent-writer conflict to
arbitrate. `writePlan()` in `lib/store.js` serializes writes through a
promise chain and writes atomically (temp file + rename), which is enough
correctness for this shape of problem. A real database is worth it if/when a
later phase needs multiple synced entities (notes, watchlist) with actual
conflict resolution — not before.

## Local dev

```bash
npm install
ALLOWED_ORIGINS=http://localhost:5173 DATA_DIR=./.data npm run dev
```

## What this intentionally does NOT do yet

No DuckDB/parquet, no scheduled refresh, and the client's *read* path for
odds/news is opt-in via `VITE_API_BASE_URL` (unset = today's direct-fetch
behavior, unaffected by this server existing or not). The draft plan sync
(B3) is one-directional and best-effort: this server is never the only copy
of anything, by design.
