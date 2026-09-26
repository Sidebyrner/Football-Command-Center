import Foundation
import FCCore
import FCData

extension KCandidate: StreamCandidate {}

/// One team's kicking conditions this week.
public struct KTeamContext: StreamTeamContext {
    public var team: String
    public var opponent: String
    public var home: Bool?
    public var spreadOff: Double
    public var total: Double
    public var venue: KVenue
    public var windMph: Double
    /// Chance of rain, 0–100.
    public var precipPct: Double
    public var altitude: Bool
    /// Points the opposing defense allows to kickers, % vs average.
    public var dvpPct: Double?
    public var dvpGames: Int
    public var linesSource: StreamContextSource
    public var dvpSource: StreamContextSource
    public var weatherSource: StreamContextSource
    /// Every defense's generosity to kickers — the rest-of-season input.
    public var leagueGenerosity: [String: Double] = [:]

    public var id: String { team }
    public var spread: Double { spreadOff }
    public var implied: Double { (total - spreadOff) / 2 }

    public var opponentLabel: String {
        switch home {
        case .some(true): return "vs \(opponent)"
        case .some(false): return "@\(opponent)"
        case .none: return "vs \(opponent) (neutral)"
        }
    }
}

public struct KTeamOverride: StreamOverride {
    public var spreadOff: Double?
    public var total: Double?
    public var venue: KVenue?
    public var windMph: Double?
    public var precipPct: Double?
    public var dvpPct: Double?
    public var dvpGames: Int?
    public var source: StreamContextSource

    public init(spreadOff: Double? = nil, total: Double? = nil, venue: KVenue? = nil, windMph: Double? = nil,
                precipPct: Double? = nil, dvpPct: Double? = nil, dvpGames: Int? = nil, source: StreamContextSource = .manual) {
        self.spreadOff = spreadOff; self.total = total; self.venue = venue; self.windMph = windMph
        self.precipPct = precipPct; self.dvpPct = dvpPct; self.dvpGames = dvpGames; self.source = source
    }

    public var isEmpty: Bool {
        spreadOff == nil && total == nil && venue == nil && windMph == nil && precipPct == nil && dvpPct == nil && dvpGames == nil
    }
}

public struct KPlayerOverride: StreamOverride {
    public var practice: StreamPractice?
    public var notes: String?

    public init(practice: StreamPractice? = nil, notes: String? = nil) {
        self.practice = practice; self.notes = notes
    }

    public var isEmpty: Bool { practice == nil && (notes ?? "").isEmpty }
}

public typealias KWeekOverrides = StreamWeekOverrides<KTeamOverride, KPlayerOverride>

public struct KGameLine: Hashable, Sendable {
    public let week: Int
    public let opponent: String?
    public let points: Double
    public let made: Double
    public let attempts: Double
    public let longest: Double?
    public let extraPoints: Double
}

/// K Stream's part of the shared stream screen.
public enum KStreamKind: StreamKind {
    public typealias Candidate = KCandidate
    public typealias Projection = KProjection
    public typealias Scoring = KScoring
    public typealias Team = KTeamContext
    public typealias TeamOverride = KTeamOverride
    public typealias PlayerOverride = KPlayerOverride
    public typealias GameLine = KGameLine

    public static let storeFolder = "KStream"
    public static let positions: [Position] = [.k]
    public static let playerNoun = "kicker"
    public static let emptyScoring = KScoring()
    public static let usesHorizon = true

    public static func scoring(sleeperSettings: [String: Double]) -> KScoring { .from(sleeperSettings: sleeperSettings) }
    public static func unmodelledKeys(sleeperSettings: [String: Double]) -> [String] {
        KScoring.unmodelledKeys(sleeperSettings: sleeperSettings)
    }

    public static func autofill(context: LeagueContext, defense: DefenseLookup) -> [String: KTeamContext] {
        let generosity = SleeperTeamTotals.generosity(defense.sleeper, position: .k)
        var out: [String: KTeamContext] = [:]
        for (team, line) in GameLines.week(context.schedule, week: context.currentWeek) {
            // The stadium belongs to the home side.
            let site = line.isHome ? team : line.opponent
            out[team] = KTeamContext(
                team: team, opponent: line.opponent, home: line.isHome,
                spreadOff: line.spread ?? 0, total: line.total ?? 45,
                venue: KStreamEngine.domeHome.contains(site) ? .dome : .outdoor,
                windMph: 0, precipPct: 0, altitude: site == "DEN",
                dvpPct: generosity.pct[line.opponent], dvpGames: generosity.games[line.opponent] ?? 0,
                linesSource: line.spread != nil && line.total != nil ? .schedule : .standard,
                dvpSource: generosity.pct[line.opponent] == nil ? .standard : .sleeperDvP,
                weatherSource: .standard, leagueGenerosity: generosity.pct
            )
        }
        return out
    }

    public static func apply(_ overrides: [String: KTeamOverride], to teams: [String: KTeamContext]) -> [String: KTeamContext] {
        var out = teams
        for (team, change) in overrides {
            guard var context = out[team], !change.isEmpty else { continue }
            if let v = change.spreadOff { context.spreadOff = v; context.linesSource = change.source }
            if let v = change.total { context.total = v; context.linesSource = change.source }
            if let v = change.venue { context.venue = v; context.weatherSource = change.source }
            if let v = change.windMph { context.windMph = v; context.weatherSource = change.source }
            if let v = change.precipPct { context.precipPct = v; context.weatherSource = change.source }
            if let v = change.dvpPct {
                context.dvpPct = v
                context.dvpGames = change.dvpGames ?? max(context.dvpGames, 1)
                context.dvpSource = change.source
            }
            out[team] = context
        }
        return out
    }

    public static func candidates(context: LeagueContext, teams: [String: KTeamContext],
                                  players: [String: KPlayerOverride], alwaysInclude: Set<String>) -> [KCandidate] {
        let totals = SleeperTeamTotals(context: context)
        let generosity = teams.values.first?.leagueGenerosity ?? [:]
        let mine = Set(context.userTeam?.roster.map(\.id) ?? [])
        return context.players.players(at: .k).compactMap { player -> KCandidate? in
            guard let team = player.nflverseTeam else { return nil }
            var fga: [KBucket: Double] = [:], fgm: [KBucket: Double] = [:]
            var xpa = 0.0, xpm = 0.0, games = 0
            var flags: [String] = []
            for week in totals.weeks {
                guard let line = context.inSeason.weekStats[week]?[player.id] else { continue }
                let s = line.stats
                guard (s["fga"] ?? 0) > 0 || (s["xpa"] ?? 0) > 0 || line.played else { continue }
                games += 1
                func v(_ k: String) -> Double { s[k] ?? 0 }
                let made: [KBucket: Double] = [
                    .short: v("fgm_0_19") + v("fgm_20_29") + v("fgm_30_39"),
                    .forty: v("fgm_40_49"),
                    .fifty: s["fgm_50_59"] ?? max(0, v("fgm_50p") - v("fgm_60p")),
                    .sixty: v("fgm_60p"),
                ]
                var missed: [KBucket: Double] = [
                    .short: v("fgmiss_0_19") + v("fgmiss_20_29") + v("fgmiss_30_39"),
                    .forty: v("fgmiss_40_49"),
                    .fifty: s["fgmiss_50_59"] ?? max(0, v("fgmiss_50p") - v("fgmiss_60p")),
                    .sixty: v("fgmiss_60p"),
                ]
                // A miss Sleeper didn't bucket: count it from 40–49.
                let unplaced = v("fgmiss") - missed.values.reduce(0, +)
                if unplaced > 0.5 {
                    missed[.forty, default: 0] += unplaced
                    flags.append("some misses without a distance counted as 40–49")
                }
                for b in KBucket.allCases {
                    fgm[b, default: 0] += made[b] ?? 0
                    fga[b, default: 0] += (made[b] ?? 0) + (missed[b] ?? 0)
                }
                xpa += v("xpa"); xpm += v("xpm")
            }
            let hasRole = games > 0 || player.depthChartOrder == 1
            guard hasRole || mine.contains(player.id) || alwaysInclude.contains(player.id) else { return nil }
            let offense = totals.offenseTotal(team)
            let game = teams[team]
            let override = players[player.id]
            var practice = override?.practice ?? StreamPracticeMapper.status(player, context: context)
            if game == nil {
                practice = .OUT
                flags.append("bye week")
            } else if game?.linesSource == .standard {
                flags.append("no recorded line — neutral spread and total")
            }
            if game?.weatherSource == .standard, game?.venue != .dome {
                flags.append("no weather entered — calm and dry")
            }
            var seen = Set<String>()
            flags = flags.filter { seen.insert($0).inserted }
            return KCandidate(
                name: player.name, team: team, opp: game?.opponentLabel ?? "BYE", home: game?.home,
                spreadOff: game?.spreadOff ?? 0, total: game?.total ?? 45, games: games,
                fga: fga, fgm: fgm, xpa: xpa, xpm: xpm,
                teamFga: offense.total.fieldGoalAttempts, teamOffTd: offense.total.touchdowns, teamGames: offense.games,
                venue: game?.venue ?? .outdoor, windMph: game?.windMph ?? 0, precipPct: game?.precipPct ?? 0,
                altitude: game?.altitude ?? false, dvpPct: game?.dvpPct ?? 0,
                dvpGames: game?.dvpPct == nil ? 0 : (game?.dvpGames ?? 0),
                schedule: SleeperTeamTotals.schedule(context.schedule, team: team), oppDvp: generosity,
                homeMap: SleeperTeamTotals.homeMap(context.schedule, team: team),
                currentWeek: context.currentWeek, practice: practice, rosterPct: nil,
                available: context.availability(ofSleeperID: player.id) == .freeAgent,
                notes: override?.notes ?? "", sources: ["Sleeper weekly stats", "schedule lines"],
                dataFlags: flags, playerID: player.id
            )
        }
        .sorted { $0.name < $1.name }
    }

    public static func project(_ candidate: KCandidate, scoring: KScoring, risk: StreamRiskMode) -> KProjection {
        KStreamEngine.project(candidate, scoring: scoring, risk: risk, horizon: .week)
    }

    public static func project(_ candidate: KCandidate, scoring: KScoring, risk: StreamRiskMode,
                               horizon: StreamHorizon) -> KProjection {
        KStreamEngine.project(candidate, scoring: scoring, risk: risk, horizon: horizon)
    }

    public static func recentGames(context: LeagueContext, playerID: String, limit: Int) -> [KGameLine] {
        let scoring = context.league.scoringSettings ?? [:]
        return context.inSeason.weekStats.keys.filter { $0 < context.currentWeek }.sorted(by: >)
            .compactMap { week -> KGameLine? in
                guard let line = context.inSeason.weekStats[week]?[playerID], line.played else { return nil }
                let s = line.stats
                return KGameLine(week: week, opponent: NFLTeams.nflverse(line.opponent),
                                 points: line.score(scoring: scoring).points, made: s["fgm"] ?? 0,
                                 attempts: s["fga"] ?? 0, longest: s["fgm_lng"], extraPoints: s["xpm"] ?? 0)
            }
            .prefix(limit).map { $0 }
    }

    public static func roleLabel(for player: IndexedPlayer) -> String? { nil }

    public static func parseImport(_ data: Data) throws -> KWeekOverrides {
        let root = try StreamImport.root(data)
        var out = KWeekOverrides()
        for (team, row) in StreamImport.teams(root) {
            let dvp = StreamImport.number(row["dvpPct"]) ?? (row["dvpPct"] as? [String: Any]).flatMap { StreamImport.number($0["K"]) }
            let change = KTeamOverride(
                spreadOff: StreamImport.number(row["spreadOff"]) ?? StreamImport.number(row["spreadDef"]),
                total: StreamImport.number(row["total"]),
                venue: (row["venue"] as? String).flatMap(KVenue.init(rawValue:)),
                windMph: StreamImport.number(row["windMph"]) ?? StreamImport.number(row["wind_mph"]),
                precipPct: StreamImport.number(row["precipPct"]) ?? StreamImport.number(row["precip_pct"]),
                dvpPct: dvp, dvpGames: dvp == nil ? nil : StreamImport.number(row["dvpGames"]).map { Int($0) },
                source: .imported
            )
            if !change.isEmpty { out.teams[team] = change }
        }
        for (id, row) in StreamImport.players(root) {
            let change = KPlayerOverride(practice: (row["practice"] as? String).flatMap(StreamPractice.init(rawValue:)),
                                         notes: row["notes"] as? String)
            if !change.isEmpty { out.players[id] = change }
        }
        return out
    }

    public static func sourceNotes(teams: [String: KTeamContext]) -> [String] {
        [
            "Field-goal attempts follow the implied team total and how often the offense stalls into kicks; distances and make rates are shrunk to league norms from Sleeper's lines.",
            "There's no weather feed: wind and rain are calm and dry unless you enter them in Game context. Domes and Denver's altitude are set from the stadium.",
            "Rest of season scores the remaining schedule against each defense's generosity to kickers, with domes (+3%) and late-season cold outdoors (−6%).",
        ]
    }
}

public typealias KStreamScreenModel = StreamScreenModel<KStreamKind>
