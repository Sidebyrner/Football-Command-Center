#!/usr/bin/env python3
"""Generates apple/App/Demo/DemoLeagueData.swift — a Debug-only demo league.

The demo exists so every screen can be seen, screenshotted and UI-tested with
real-looking data and no network. It is built from the shipped 2025 files so
season lines, byes, lines and defense ranks are all real:

- 4 teams, this league's real roster shape (QB RB RB WR WR TE FLEX K DEF
  IDP_FLEX IDP_FLEX + 5 bench).
- Current week 7 of 2025, where BUF and BAL are on bye — so the user's Josh
  Allen triggers a bye alert and Sit/Start benches him for Jared Goff.
- Six completed weeks scored from real weekly rows, a finished draft, a few
  transactions, and trending adds including DEF/IDP.

Re-run after `sync-fixtures.sh` if the 2025 files change:
    python3 apple/Tools/make-demo-league.py
"""
import json, os, hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, "public", "data")
OUT = os.path.join(ROOT, "apple", "App", "Demo", "DemoLeagueData.swift")

ids = json.load(open(os.path.join(DATA, "player-ids.json")))["players"]
weekly = json.load(open(os.path.join(DATA, "weekly", "2025.json")))
fields = weekly["fields"]
F = {name: i for i, name in enumerate(fields)}

# player-ids.json speaks dynastyprocess team codes; Sleeper speaks its own.
DP_TO_SLEEPER = {"GBP": "GB", "KCC": "KC", "NEP": "NE", "NOS": "NO", "SFO": "SF",
                 "TBB": "TB", "LVR": "LV", "JAC": "JAX", "RAM": "LAR", "OAK": "LV",
                 "SDC": "LAC", "STL": "LAR"}
# The weekly file speaks nflverse; Sleeper calls the Rams LAR.
NFLVERSE_TO_SLEEPER = {"LA": "LAR"}

sleeper_by_gsis = {v["gsisId"]: sid for sid, v in ids.items() if v.get("gsisId")}

def stable(seed, lo, hi):
    h = int(hashlib.md5(seed.encode()).hexdigest()[:8], 16)
    return round(lo + (h % 1000) / 1000 * (hi - lo), 1)

# ---- offensive pool from real 2025 production --------------------------------
pool = {}
for gsis, rows in weekly["players"].items():
    meta = weekly["meta"].get(gsis, {})
    pos = meta.get("p")
    sid = sleeper_by_gsis.get(gsis)
    if pos not in ("QB", "RB", "WR", "TE", "K") or not sid:
        continue
    by_week = {r[F["week"]]: (r[F["fp_ppr_ref"]] or 0.0) for r in rows}
    team = rows[-1][F["team"]]
    pool[sid] = {
        "id": sid, "name": meta["n"], "pos": pos,
        "team": NFLVERSE_TO_SLEEPER.get(team, team),
        "total": sum(by_week.values()), "weeks": by_week,
    }

def best(pos, exclude, n):
    ranked = sorted((p for p in pool.values() if p["pos"] == pos and p["id"] not in exclude),
                    key=lambda p: -p["total"])
    return ranked[:n]

# Kickers score 0 in fp_ppr_ref; rank them by games instead so real names appear.
for p in pool.values():
    if p["pos"] == "K":
        p["total"] = len(p["weeks"])
        p["weeks"] = {w: stable(p["id"] + str(w), 3, 14) for w in p["weeks"]}

def by_name(name):
    for p in pool.values():
        if p["name"] == name:
            return p
    raise SystemExit(f"demo player not found: {name}")

# ---- teams --------------------------------------------------------------------
TEAMS = [
    (1, "u1", "connor", "Byrne Notice"),
    (2, "u2", "gurus", "Gridiron Gurus"),
    (3, "u3", "wire", "Waiver Wire Warriors"),
    (4, "u4", "fourth", "Fourth and Long"),
]
DEFENSES = ["PHI", "DEN", "PIT", "HOU"]

# The user's core is pinned so the demo tells a story; the rest is drafted.
USER_CORE = {"QB": ["Josh Allen", "Jared Goff"], "RB": ["Saquon Barkley", "Jahmyr Gibbs"],
             "WR": ["Ja'Marr Chase", "Puka Nacua"], "TE": [], "K": []}
NEEDS = {"QB": 2, "RB": 3, "WR": 3, "TE": 2, "K": 1}

taken = set()
rosters = {t[0]: {p: [] for p in NEEDS} for t in TEAMS}
for pos, names in USER_CORE.items():
    for name in names:
        p = by_name(name)
        rosters[1][pos].append(p)
        taken.add(p["id"])

draft_order = []  # (roster_id, player) in pick order
for rnd in range(sum(NEEDS.values())):
    order = [t[0] for t in TEAMS] if rnd % 2 == 0 else [t[0] for t in reversed(TEAMS)]
    for rid in order:
        for pos in ("RB", "WR", "QB", "TE", "K"):
            if len(rosters[rid][pos]) < NEEDS[pos]:
                pick = best(pos, taken, 1)
                if pick:
                    rosters[rid][pos].append(pick[0])
                    taken.add(pick[0]["id"])
                    draft_order.append((rid, pick[0]))
                break

# Pinned user players belong in the draft too, early, as a real draft would.
for i, name in enumerate(["Josh Allen", "Saquon Barkley", "Ja'Marr Chase", "Jahmyr Gibbs",
                          "Puka Nacua", "Jared Goff"]):
    draft_order.insert(i * 4, (1, by_name(name)))

# ---- IDP: real ids, no production (the weekly file has none) -----------------
def idp(codes, n, exclude):
    out = []
    for sid, v in sorted(ids.items(), key=lambda kv: kv[0]):
        team = DP_TO_SLEEPER.get(v.get("team"), v.get("team"))
        if v.get("position") in codes and team not in (None, "FA", "FA*") and sid not in exclude:
            out.append({"id": sid, "name": v["name"],
                        "pos": "LB" if "LB" in codes else "DL", "team": team})
            exclude.add(sid)
            if len(out) == n:
                break
    return out

linebackers = idp({"LB"}, 6, taken)
linemen = idp({"DE", "DT"}, 6, taken)

players = {}
lineups = {}
for rid, owner, _, _ in TEAMS:
    r = rosters[rid]
    qb, rbs, wrs, tes, ks = r["QB"], r["RB"], r["WR"], r["TE"], r["K"]
    flex_pool = sorted(rbs[2:] + wrs[2:] + tes[1:], key=lambda p: -p["total"])
    lb, dl = linebackers[rid - 1], linemen[rid - 1]
    starters = [qb[0]["id"], rbs[0]["id"], rbs[1]["id"], wrs[0]["id"], wrs[1]["id"],
                tes[0]["id"], flex_pool[0]["id"], ks[0]["id"], DEFENSES[rid - 1], lb["id"], dl["id"]]
    everyone = [p["id"] for group in (qb, rbs, wrs, tes, ks) for p in group] + \
               [DEFENSES[rid - 1], lb["id"], dl["id"]]
    for p in qb + rbs + wrs + tes + ks + [lb, dl]:
        players[p["id"]] = p
    lineups[rid] = {"starters": starters, "players": everyone}

for code in DEFENSES:
    players[code] = {"id": code, "pos": "DEF", "team": code}

# One questionable starter on the user's team, so the injury alert shows.
players[lineups[1]["starters"][4]]["injury"] = "Questionable"

def points(pid, week):
    p = players[pid]
    if p["pos"] in ("DEF", "LB", "DL"):
        return stable(pid + str(week), 1, 16)
    return float(p.get("weeks", {}).get(week, 0.0))

# ---- matchups -----------------------------------------------------------------
PAIRS = [[(1, 2), (3, 4)], [(1, 3), (2, 4)], [(1, 4), (2, 3)]]
record = {t[0]: {"w": 0, "l": 0, "pf": 0.0, "pa": 0.0} for t in TEAMS}
matchups = {}
for week in range(1, 8):
    entries = []
    for mid, (a, b) in enumerate(PAIRS[(week - 1) % 3], start=1):
        totals = {}
        for rid in (a, b):
            lu = lineups[rid]
            if week < 7:
                pp = {pid: points(pid, week) for pid in lu["players"]}
            else:
                # Live week: only the early games have been played. Players
                # yet to kick off are absent, which is "no number", not zero.
                pp = {pid: points(pid, week) for i, pid in enumerate(lu["starters"])
                      if i % 2 == 0 and pid != "0" and players[pid]["team"] not in ("BUF", "BAL")}
            total = round(sum(pp.get(pid, 0.0) for pid in lu["starters"]), 2)
            totals[rid] = total
            entries.append({"roster_id": rid, "matchup_id": mid, "points": total,
                            "starters": lu["starters"], "players": lu["players"],
                            "players_points": pp})
        if week < 7:
            winner, loser = (a, b) if totals[a] >= totals[b] else (b, a)
            record[winner]["w"] += 1
            record[loser]["l"] += 1
            for rid, other in ((a, b), (b, a)):
                record[rid]["pf"] += totals[rid]
                record[rid]["pa"] += totals[other]
    matchups[week] = entries

# ---- free agents, transactions, trending -------------------------------------
free_agents = []
for pos in ("RB", "WR", "TE", "QB"):
    free_agents += best(pos, taken, 3)
for p in free_agents:
    players[p["id"]] = p
    taken.add(p["id"])
fa_idp = idp({"LB"}, 2, taken) + idp({"CB", "S"}, 1, taken)
for p in fa_idp:
    if p["pos"] not in ("LB",):
        p["pos"] = "DB"
    players[p["id"]] = p
for code in ("SEA", "ARI"):
    players[code] = {"id": code, "pos": "DEF", "team": code}

transactions = {
    7: [{"transaction_id": "t701", "type": "waiver", "status": "complete", "created": 1760000000000,
         "roster_ids": [3], "adds": {free_agents[0]["id"]: 3}, "drops": None}],
    6: [{"transaction_id": "t601", "type": "free_agent", "status": "complete", "created": 1759400000000,
         "roster_ids": [2], "adds": {free_agents[3]["id"]: 2}, "drops": None},
        {"transaction_id": "t602", "type": "waiver", "status": "complete", "created": 1759390000000,
         "roster_ids": [1], "adds": {free_agents[6]["id"]: 1}, "drops": None}],
    5: [],
}
# Those adds are already reflected as unrostered free agents on purpose: the
# demo is a snapshot, not a ledger.

trending_ids = [p["id"] for p in free_agents[:7]] + ["SEA", "ARI"] + [p["id"] for p in fa_idp]
trending_add = [{"player_id": pid, "count": 9000 - i * 700} for i, pid in enumerate(trending_ids)]
trending_drop = [{"player_id": pid, "count": 4000 - i * 300}
                 for i, pid in enumerate(lineups[4]["players"][3:6])]

# ---- assemble Sleeper payloads -----------------------------------------------
def sleeper_player(p):
    if p["pos"] == "DEF":
        return {"position": "DEF", "team": p["team"], "active": True}
    out = {"full_name": p["name"], "position": p["pos"], "team": p["team"], "active": True}
    if p.get("injury"):
        out["injury_status"] = p["injury"]
    return out

routes = {
    "/v1/state/nfl": {"week": 7, "season": "2025", "season_type": "regular", "leg": 7},
    "/v1/user/connor": {"user_id": "u1", "username": "connor", "display_name": "connor"},
    "/v1/user/u1/leagues/nfl/2025": [None],
    "/v1/league/L1": None,
    "/v1/league/L1/users": [
        {"user_id": owner, "display_name": disp, "metadata": {"team_name": name}}
        for _, owner, disp, name in TEAMS],
    "/v1/league/L1/rosters": [
        {"roster_id": rid, "owner_id": owner, "league_id": "L1",
         "players": lineups[rid]["players"], "starters": lineups[rid]["starters"],
         "settings": {"wins": record[rid]["w"], "losses": record[rid]["l"], "ties": 0,
                      "fpts": int(record[rid]["pf"]), "fpts_decimal": int(round(record[rid]["pf"] % 1 * 100)),
                      "fpts_against": int(record[rid]["pa"]),
                      "fpts_against_decimal": int(round(record[rid]["pa"] % 1 * 100))}}
        for rid, owner, _, _ in TEAMS],
    "/v1/players/nfl": {pid: sleeper_player(p) for pid, p in players.items()},
    "/v1/players/nfl/trending/add": trending_add,
    "/v1/players/nfl/trending/drop": trending_drop,
    "/v1/league/L1/drafts": [{"draft_id": "D1", "status": "complete", "season": "2025"}],
    "/v1/draft/D1/picks": [
        {"pick_no": i + 1, "player_id": p["id"], "roster_id": rid,
         "picked_by": TEAMS[rid - 1][1], "round": i // 4 + 1}
        for i, (rid, p) in enumerate(draft_order)],
}
league = {
    "league_id": "L1", "name": "Byrne Notice Dynasty", "season": "2025", "status": "in_season",
    "total_rosters": 4,
    "roster_positions": ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF",
                         "IDP_FLEX", "IDP_FLEX", "BN", "BN", "BN", "BN", "BN", "IR"],
    "scoring_settings": {"pass_yd": 0.05, "pass_td": 6, "pass_int": -5, "pass_fd": 1,
                         "rec": 0, "rec_yd": 0.1, "rec_td": 6, "rec_fd": 1,
                         "rush_yd": 0.1, "rush_td": 6, "rush_fd": 1, "fum_lost": -3,
                         # Kicking, so demo kickers aren't all 0.0 pts/gm.
                         "fgm_0_19": 3, "fgm_20_29": 3, "fgm_30_39": 3, "fgm_40_49": 4,
                         "fgm_50p": 5, "xpm": 1, "fgmiss": -1},
}
routes["/v1/league/L1"] = league
routes["/v1/user/u1/leagues/nfl/2025"] = [league]
for week, entries in matchups.items():
    routes[f"/v1/league/L1/matchups/{week}"] = entries
for week in range(1, 8):
    routes[f"/v1/league/L1/transactions/{week}"] = transactions.get(week, [])

lines = ["// GENERATED by apple/Tools/make-demo-league.py — do not edit by hand.",
         "//",
         "// Debug-only demo league built from the shipped 2025 files. Compiled out of",
         "// Release entirely by the #if below.",
         "",
         "#if DEBUG",
         "enum DemoLeagueData {",
         "    /// Sleeper URL path → JSON body.",
         "    static let routes: [String: String] = ["]
for path in sorted(routes):
    body = json.dumps(routes[path], separators=(",", ":"), ensure_ascii=False)
    assert '"###' not in body
    lines.append(f'        "{path}": ###"{body}"###,')
lines += ["    ]", "}", "#endif", ""]
open(OUT, "w").write("\n".join(lines))

print(f"wrote {OUT}")
print("user starters:", [players[s]["name"] if players[s]["pos"] != "DEF" else s for s in lineups[1]["starters"]])
print("user bench:", [players[s]["name"] if players[s]["pos"] != "DEF" else s for s in lineups[1]["players"] if s not in lineups[1]["starters"]])
print("records:", {rid: (r["w"], r["l"]) for rid, r in record.items()})
print("routes:", len(routes), "bytes:", os.path.getsize(OUT))
