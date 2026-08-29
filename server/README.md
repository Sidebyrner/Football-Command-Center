# fcc-server

API proxy for Football Command Center — see `/root/.claude/plans/...` (B1)
for the full design rationale. Deliberately minimal: no database, no ORM.
An in-memory `Map` with TTL is correct at this scale.

## Routes

| Route | Purpose |
|---|---|
| `GET /health` | `{ status, uptime }` — no auth, used for the container healthcheck |
| `GET /api/odds` | Proxies The Odds API; same `{ data, remaining, used }` shape `src/utils/oddsApi.js` already expects client-side |
| `GET /api/odds/:eventId/props` | Proxies player-prop odds for one event |
| `GET /api/news?feed=<alias>` | Fetches + parses an RSS/Atom feed from a server-side alias map (`routes/news.js`). The client never sends a URL — only a short alias — so this cannot become an open relay |

## Environment

| Var | Required | Notes |
|---|---|---|
| `PORT` | no (default 8080) | |
| `ODDS_API_KEY` | for `/api/odds*` | Set in Portainer's env panel, never in compose text or git |
| `ALLOWED_ORIGINS` | yes, for any browser client | Comma-separated. **Unset = no origin is allowed** (fails closed, not open) |

## Local dev

```bash
npm install
ALLOWED_ORIGINS=http://localhost:5173 npm run dev
```

## What this intentionally does NOT do yet

No database (`app.db` is a later phase), no DuckDB/parquet, no scheduled
refresh, and no client file in `../src` has been changed to call this —
it ships with nothing pointed at it yet. That wiring is a separate,
explicitly gated step so the client never silently depends on a server
that might be off.
