# Project Command Center

One ledger across every coding project, built to answer a single question well:

> **Given the energy and time I have right now, what should I work on next?**

Most trackers sort by priority or due date. Neither helps at 9pm on a Tuesday,
when the real constraint isn't what matters most — it's what you can actually
hold in your head. So the unit of work here carries an **energy** rating
alongside its time estimate, and the tool matches work to the state you're in.

```
$ portfolio pick --energy quick --minutes 30

Energy: quick   Window: 30 min

▸ Football Command Center · football-command-center
    Move the league scoring upload from its current page into Settings
    quick · 25m · untouched 34d · from backlog
    https://github.com/Sidebyrner/Football-Command-Center
```

---

> **Note — this lives inside `Football-Command-Center` for now.** The session that
> built it could not create a repository (the GitHub App lacked permission), so it
> was committed here to avoid losing the work. Nothing depends on that location.
> Create an empty `project-command-center` repo on GitHub, then run
> `bash project-command-center/scripts/move-to-own-repo.sh Sidebyrner/project-command-center`
> from the Football Command Center root to lift it out.

---

## How it works

Three moving parts, no database and no service:

| Part | What it does |
|---|---|
| `projects/<slug>.json` | The ledger. One file per project — status, next action, energy, backlog, and an append-only log. Plain JSON, so git history *is* the audit trail. |
| `scripts/portfolio.mjs` | The CLI. Zero dependencies, Node 18+. |
| `.claude/skills/project-portfolio/` | The skill that teaches Claude the schema and the three verbs, so you can just say "what should I work on" in any session. |
| `hooks/portfolio-log.mjs` | A Claude Code `Stop` hook. Drops a record of every session into an inbox so the ledger stays current without you remembering to update it. |

---

## Setup

### 1. Clone and confirm it runs

```bash
git clone https://github.com/Sidebyrner/project-command-center.git
cd project-command-center
node scripts/portfolio.mjs board
```

Optionally add a shell alias so you can run it from anywhere:

```bash
echo "alias portfolio='node $PWD/scripts/portfolio.mjs'" >> ~/.zshrc
```

### 2. Install the skill

Makes the verbs available to Claude in **every** repo:

```bash
node scripts/install.mjs
```

That symlinks `.claude/skills/project-portfolio` into `~/.claude/skills/`, so
edits here take effect immediately. Pass `--copy` if you'd rather have a
snapshot than a link.

### 3. Wire up automatic session capture

Per project repo — this is the version that works in Claude Code on the web,
since it's committed alongside the code:

```bash
node scripts/install.mjs --hook /path/to/some-project
```

That writes `.claude/hooks/portfolio-log.mjs` and merges a `Stop` hook into
that repo's `.claude/settings.json`. Commit both.

For local-only sessions you can instead install it once globally with
`node scripts/install.mjs --hook-global`, which covers every repo on the
machine without touching any of them.

---

## Daily use

Talk to Claude in plain language — the skill maps it onto the CLI:

| You say | What runs |
|---|---|
| "what should I work on, I've got about an hour" | `pick --energy deep --minutes 60` |
| "I'm fried, anything easy?" | `pick --energy quick` |
| "where does everything stand?" | `board` |
| "log what we did and set the next step" | `log <slug> --summary ... --next ...` |
| "park Lawn Pro until spring" | `set lawn-pro --status paused` |

Or run it directly:

```bash
portfolio board                                  # the whole picture
portfolio board --all                            # including shipped + archived
portfolio pick --energy medium --minutes 45      # what fits right now
portfolio pick --energy quick --tag web          # narrow by tag
portfolio log catch --summary "..." --next "..." # record + set the next move
portfolio set catch --blocked "waiting on API"   # drops it out of pick
portfolio inbox --drain                          # fold in auto-captured sessions
portfolio validate                               # schema + consistency check
```

`PORTFOLIO.md` is regenerated on every `board` — it's the human-readable view.
Never hand-edit it.

---

## The energy model

This is the part worth getting right. Rate by **context load**, not line count:

| Energy | Means | Examples |
|---|---|---|
| `quick` | No ramp-up. Survives a tired evening. | Copy tweaks, dependency bumps, a known one-line fix |
| `medium` | One file or one clear seam. | A component, a bug you can already locate, adding a test |
| `deep` | Needs the whole system in your head. | Architecture, state-shape changes, cross-cutting refactors, anything whose shape isn't decided yet |

**When in doubt, rate up.** A `quick` task that turns out to be `deep` at 10pm is
exactly the failure this tool exists to prevent.

---

## How `pick` ranks

Only unblocked projects with `status` of active, paused or idea are eligible.
Among the actions that fit your energy ceiling and time window:

| Pull | Weight | Why |
|---|---|---|
| Staleness | up to 40 | A project untouched for 60 days should surface over one touched yesterday |
| Commitment | up to 30 | What you called `active` outranks what you called an `idea` |
| Health | up to 18 | `at-risk` and `stalled` get pulled forward |
| Designated | 12 | `next_action` is the move you already decided on; a backlog item has to fit clearly better to displace it |
| Fill | up to 20 | With 90 minutes free, an 80-minute task beats a 10-minute one |
| Untriaged | −6 | A seeded guess shouldn't outrank confirmed work |

`--energy` is a **ceiling**, not an exact match — `deep` includes quick and
medium work too.

---

## Triage

The ledger was seeded from a GitHub repo listing, so most projects carry
`needs_triage: true` — their status is a guess from push recency and nothing
more. `pick` can only be as good as the ledger, so work the triage queue down
a few at a time:

```bash
portfolio board | grep triage
portfolio set <slug> --next "..." --energy medium --minutes 30 --why "..."
```

Setting a real `--next` clears the flag. Or ask Claude to triage one with you —
the skill reads the repo first and proposes a status and next action rather
than inventing one.

---

## Schema

```jsonc
{
  "slug": "football-command-center",     // matches the filename
  "name": "Football Command Center",
  "repo": "Sidebyrner/Football-Command-Center",
  "url": "https://github.com/...",
  "status": "active",                    // active | paused | idea | shipped | archived
  "health": "on-track",                  // on-track | at-risk | stalled | unknown
  "why": "One line on why this exists",
  "stack": ["react", "vite"],
  "tags": ["personal", "web"],
  "needs_triage": false,                 // true = seeded guess, unconfirmed
  "next_action": {
    "what": "A literal first move, startable cold",
    "energy": "deep",                    // quick | medium | deep
    "minutes": 120,
    "why": "context that saves you re-deriving it"
  },
  "backlog": [{ "what": "...", "energy": "quick", "minutes": 15 }],
  "blocked_by": null,                    // non-null removes it from pick
  "last_touched": "2026-09-14",
  "log": [{ "date": "...", "kind": "session", "summary": "..." }]
}
```

Two rules keep it trustworthy:

- **Always set a next action when you log.** A log entry without one is how a
  ledger rots — the next `pick` has nothing to offer and the project goes quiet.
- **Never invent a next action.** A plausible-sounding fabrication is worse than
  a blank, because it looks trustworthy in a board.
