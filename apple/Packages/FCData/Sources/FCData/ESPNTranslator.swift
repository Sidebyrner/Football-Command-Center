import Foundation
import FCCore

/// Resolves ESPN player ids to the Sleeper ids the rest of the app is keyed by.
///
/// Three sources, in order of trust: the dynastyprocess crosswalk (covers
/// about nine in ten rostered players), Sleeper's own `espn_id` field (a
/// minority, but authoritative), then a name + team + position match against
/// the player pool for whoever is left — deep-bench rookies, mostly. A player
/// none of them place keeps a stable `espn:<id>` id so he still occupies his
/// slot; screens show him by name with no production data, which is the
/// honest answer (§3.2).
public struct ESPNPlayerIDMapper: Sendable {
    private let byESPNID: [String: String]
    private let byNameKey: [String: String]

    public init(crosswalk: PlayerIDCrosswalk?, players: PlayerIndex?) {
        var byESPNID = crosswalk?.sleeperIDsByESPN() ?? [:]
        var byNameKey: [String: String] = [:]
        let pool: [IndexedPlayer] = players.map { Array($0.players.values) } ?? []
        for player in pool {
            if let espnID = player.espnID, byESPNID[String(espnID)] == nil {
                byESPNID[String(espnID)] = player.id
            }
            guard player.active, !player.isTeamDefense else { continue }
            let key = ESPNPlayerIDMapper.nameKey(
                name: player.name, team: player.team, position: player.position?.rawValue
            )
            // First one wins; an ambiguous name key is not worth guessing on.
            if byNameKey[key] == nil { byNameKey[key] = player.id }
        }
        self.byESPNID = byESPNID
        self.byNameKey = byNameKey
    }

    /// The Sleeper id for one ESPN player. Never `nil`: an unplaced player
    /// gets the synthetic id described above.
    public func sleeperID(for player: ESPNLeague.Player?, espnID: Int) -> String {
        if espnID <= -16000, let team = ESPNTranslator.proTeams[-16000 - espnID] {
            // A team defense: ESPN ids them as -16000 - proTeamId; Sleeper as
            // the team abbreviation.
            return team
        }
        if let hit = byESPNID[String(espnID)] { return hit }
        if let player, let name = player.fullName ?? Self.joined(player.firstName, player.lastName) {
            let team = player.proTeamId.flatMap { ESPNTranslator.proTeams[$0] }
            let position = player.defaultPositionId.flatMap { ESPNTranslator.positions[$0] }
            if let hit = byNameKey[Self.nameKey(name: name, team: team, position: position)] { return hit }
        }
        return ESPNPlayerIDMapper.syntheticID(espnID)
    }

    public static func syntheticID(_ espnID: Int) -> String { "espn:\(espnID)" }

    static func nameKey(name: String, team: String?, position: String?) -> String {
        "\(PlayerIndex.normalise(name))|\(team ?? "")|\(position ?? "")"
    }

    private static func joined(_ first: String?, _ last: String?) -> String? {
        let name = [first, last].compactMap { $0 }.joined(separator: " ").trimmingCharacters(in: .whitespaces)
        return name.isEmpty ? nil : name
    }
}

/// Pure ESPN → Sleeper-shape translation. No I/O, so every table in here is
/// exercised by a fixture test rather than a live league.
public enum ESPNTranslator {
    // MARK: - Tables

    /// ESPN lineup slot id → Sleeper `roster_positions` token. Slots this app
    /// has no token for (punter, head coach) are dropped from the template.
    public static let slotTokens: [Int: String] = [
        0: "QB", 1: "QB", 2: "RB", 3: "WRRB_FLEX", 4: "WR", 5: "WRTE_FLEX", 6: "TE", 7: "SUPER_FLEX",
        8: "DL", 9: "DL", 10: "LB", 11: "DL", 12: "DB", 13: "DB", 14: "DB", 15: "IDP_FLEX",
        16: "DEF", 17: "K", 20: "BN", 21: "IR", 23: "FLEX",
    ]

    /// The order slots appear in a Sleeper template, so a translated league's
    /// lineup reads the way a Sleeper one does: offense, flex, DEF, K, IDP.
    static let slotOrder: [Int] = [0, 1, 2, 4, 6, 3, 5, 23, 7, 16, 17, 8, 9, 11, 10, 12, 13, 14, 15, 20, 21]

    static let benchSlot = 20
    static let irSlot = 21

    /// ESPN `defaultPositionId` → Sleeper position code.
    public static let positions: [Int: String] = [1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF"]

    /// ESPN `proTeamId` → the abbreviation Sleeper uses (its own dialect:
    /// `LAR`, `JAX`, `WAS`).
    public static let proTeams: [Int: String] = [
        1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET", 9: "GB",
        10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO",
        19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB",
        28: "WAS", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
    ]

    /// ESPN `statId` → Sleeper scoring key(s). Yardage items are per-yard on
    /// both platforms, so the points carry over unchanged. ESPN's single
    /// 0–39 yard field-goal bucket fans out to Sleeper's three; its points-
    /// allowed buckets are mapped to the nearest Sleeper one. Anything not
    /// listed is dropped, and the scoring profile treats it as zero.
    public static let scoringKeys: [Int: [String]] = [
        3: ["pass_yd"], 4: ["pass_td"], 19: ["pass_2pt"], 20: ["pass_int"],
        24: ["rush_yd"], 25: ["rush_td"], 26: ["rush_2pt"],
        42: ["rec_yd"], 43: ["rec_td"], 44: ["rec_2pt"], 53: ["rec"],
        68: ["fum"], 72: ["fum_lost"],
        74: ["fgm_50p"], 77: ["fgm_40_49"], 80: ["fgm_0_19", "fgm_20_29", "fgm_30_39"],
        85: ["fgmiss"], 86: ["xpm"], 88: ["xpmiss"],
        89: ["pts_allow_0"], 90: ["pts_allow_1_6"], 91: ["pts_allow_7_13"], 92: ["pts_allow_14_20"],
        121: ["pts_allow_14_20"], 122: ["pts_allow_21_27"], 123: ["pts_allow_28_34"], 124: ["pts_allow_35p"],
        125: ["pts_allow_35p"],
        95: ["int"], 96: ["fum_rec"], 97: ["blk_kick"], 98: ["safe"], 99: ["sack"],
        101: ["def_st_td"], 102: ["def_st_td"], 103: ["def_td"], 104: ["def_td"], 106: ["ff"],
        108: ["idp_tkl_solo"], 107: ["idp_tkl_ast"], 111: ["idp_pass_def"],
    ]

    // MARK: - League

    public static func league(_ raw: ESPNLeague, id: String) -> SleeperLeague {
        let settings = raw.settings
        let counts = settings?.rosterSettings?.lineupSlotCounts ?? [:]
        let rosterPositions = rosterPositions(lineupSlotCounts: counts)

        var scoring: [String: Double] = [:]
        for item in settings?.scoringSettings?.scoringItems ?? [] {
            guard let statId = item.statId, let points = item.points, let keys = scoringKeys[statId] else { continue }
            for key in keys { scoring[key] = points }
        }

        let regularWeeks = settings?.scheduleSettings?.matchupPeriodCount
        let acquisition = settings?.acquisitionSettings
        let waiverType: Int? = acquisition.map { $0.isUsingAcquisitionBudget == true ? 2 : ($0.acquisitionType == "WAIVERS_CONTINUOUS" ? 0 : 1) }
        let waiverDay = acquisition?.waiverProcessDays?.first.flatMap { weekdays[$0.uppercased()] }

        return SleeperLeague(
            leagueID: id,
            name: settings?.name,
            season: raw.seasonId.map(String.init),
            status: "in_season",
            totalRosters: raw.teams?.count,
            rosterPositions: rosterPositions,
            scoringSettings: scoring.isEmpty ? nil : scoring,
            settings: SleeperLeague.LeagueSettings(
                // ESPN keeps the deadline as a date, not a week; without the
                // schedule to place it, "unknown" is more honest than a guess.
                tradeDeadline: nil,
                waiverDayOfWeek: waiverDay,
                playoffWeekStart: regularWeeks.map { $0 + 1 },
                waiverType: waiverType,
                waiverBudget: acquisition?.isUsingAcquisitionBudget == true ? acquisition?.acquisitionBudget : nil,
                playoffTeams: settings?.scheduleSettings?.playoffTeamCount,
                reserveSlots: counts[String(irSlot)]
            )
        )
    }

    static let weekdays: [String: Int] = [
        "SUNDAY": 0, "MONDAY": 1, "TUESDAY": 2, "WEDNESDAY": 3, "THURSDAY": 4, "FRIDAY": 5, "SATURDAY": 6,
    ]

    /// Sleeper's `roster_positions`: one token per slot, starters first.
    public static func rosterPositions(lineupSlotCounts counts: [String: Int]) -> [String] {
        var tokens: [String] = []
        for slot in slotOrder {
            guard let count = counts[String(slot)], count > 0, let token = slotTokens[slot] else { continue }
            tokens.append(contentsOf: Array(repeating: token, count: count))
        }
        return tokens
    }

    // MARK: - Members

    /// ESPN compares SWIDs case-insensitively and is not consistent about
    /// which case it sends, so every id is upper-cased before it becomes a
    /// key — the member list and the roster owners must join.
    static func swid(_ raw: String?) -> String? {
        raw?.uppercased()
    }

    public static func members(_ raw: ESPNLeague) -> [SleeperLeagueMember] {
        let teamNames = Dictionary(
            (raw.teams ?? []).compactMap { team -> (String, String)? in
                guard let owner = swid(team.owners?.first), let name = team.displayName else { return nil }
                return (owner, name)
            },
            uniquingKeysWith: { first, _ in first }
        )
        return (raw.members ?? []).compactMap { member in
            guard let id = swid(member.id) else { return nil }
            let fullName = [member.firstName, member.lastName].compactMap { $0 }.joined(separator: " ")
                .trimmingCharacters(in: .whitespaces)
            return SleeperLeagueMember(
                userID: id,
                displayName: member.displayName ?? (fullName.isEmpty ? nil : fullName),
                teamName: teamNames[id]
            )
        }
    }

    // MARK: - Rosters

    public static func rosters(_ raw: ESPNLeague, leagueID: String, mapper: ESPNPlayerIDMapper) -> [SleeperRoster] {
        let counts = raw.settings?.rosterSettings?.lineupSlotCounts ?? [:]
        return (raw.teams ?? []).compactMap { team in
            guard let teamID = team.id else { return nil }
            let entries = team.roster?.entries ?? []
            let lineup = lineup(entries: entries, lineupSlotCounts: counts, mapper: mapper)
            let record = team.record?.overall
            return SleeperRoster(
                rosterID: teamID,
                ownerID: swid(team.owners?.first),
                leagueID: leagueID,
                players: lineup.players,
                starters: lineup.starters,
                reserve: lineup.reserve,
                settings: SleeperRoster.Settings(
                    wins: record?.wins, losses: record?.losses, ties: record?.ties,
                    pointsFor: record?.pointsFor, pointsAgainst: record?.pointsAgainst,
                    waiverBudgetUsed: team.transactionCounter?.acquisitionBudgetSpent,
                    waiverPosition: team.waiverRank
                )
            )
        }
    }

    struct Lineup {
        var players: [String]
        /// Aligned to `rosterPositions` with bench/IR removed; `"0"` for an
        /// unfilled slot, exactly as Sleeper sends it (§3.1).
        var starters: [String]
        var reserve: [String]
    }

    /// Fills the league's starting slots from the entries' `lineupSlotId`s.
    ///
    /// When the league's slot counts are unknown (a matchup response carries
    /// no settings) the template is inferred from the slots actually used.
    static func lineup(entries: [ESPNLeague.Entry], lineupSlotCounts counts: [String: Int], mapper: ESPNPlayerIDMapper) -> Lineup {
        var idsBySlot: [Int: [String]] = [:]
        var players: [String] = []
        var reserve: [String] = []
        for entry in entries {
            guard let espnID = entry.playerId ?? entry.playerPoolEntry?.id else { continue }
            let id = mapper.sleeperID(for: entry.playerPoolEntry?.player, espnID: espnID)
            players.append(id)
            let slot = entry.lineupSlotId ?? benchSlot
            if slot == irSlot { reserve.append(id); continue }
            idsBySlot[slot, default: []].append(id)
        }

        var effectiveCounts = counts
        if effectiveCounts.isEmpty {
            for (slot, ids) in idsBySlot { effectiveCounts[String(slot)] = ids.count }
        }

        var starters: [String] = []
        for slot in slotOrder where slot != benchSlot && slot != irSlot {
            guard let count = effectiveCounts[String(slot)], count > 0, slotTokens[slot] != nil else { continue }
            var filled = idsBySlot[slot] ?? []
            for _ in 0..<count {
                starters.append(filled.isEmpty ? SleeperRoster.emptyStarterSlot : filled.removeFirst())
            }
        }
        return Lineup(players: players, starters: starters, reserve: reserve)
    }

    // MARK: - Matchups

    /// Two Sleeper matchups per ESPN game in the given week, sharing an id.
    public static func matchups(_ raw: ESPNLeague, week: Int, mapper: ESPNPlayerIDMapper) -> [SleeperMatchup] {
        let counts = raw.settings?.rosterSettings?.lineupSlotCounts ?? [:]
        var out: [SleeperMatchup] = []
        for game in raw.schedule ?? [] where game.matchupPeriodId == week {
            guard let matchupID = game.id else { continue }
            for side in [game.home, game.away] {
                guard let side, let teamID = side.teamId else { continue }
                let entries = side.rosterForCurrentScoringPeriod?.entries ?? []
                let lineup = lineup(entries: entries, lineupSlotCounts: counts, mapper: mapper)
                var playersPoints: [String: Double] = [:]
                for entry in entries {
                    guard let espnID = entry.playerId ?? entry.playerPoolEntry?.id,
                          let points = entry.playerPoolEntry?.appliedStatTotal else { continue }
                    playersPoints[mapper.sleeperID(for: entry.playerPoolEntry?.player, espnID: espnID)] = points
                }
                let points = side.pointsByScoringPeriod?[String(week)] ?? side.totalPoints
                out.append(SleeperMatchup(
                    rosterID: teamID,
                    matchupID: matchupID,
                    points: points,
                    starters: entries.isEmpty ? nil : lineup.starters,
                    players: entries.isEmpty ? nil : lineup.players,
                    playersPoints: playersPoints.isEmpty ? nil : playersPoints,
                    startersPoints: entries.isEmpty ? nil : lineup.starters.map { playersPoints[$0] ?? 0 }
                ))
            }
        }
        return out
    }
}
