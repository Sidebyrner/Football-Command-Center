import Foundation
import FCCore
import FCData

/// A player's season, as the matchup row shows it.
public struct SeasonLine: Hashable, Sendable {
    public let games: Int
    public let pointsPerGame: Double
    /// Last-4 form. A different basis from the season number, not a better one.
    public let formPointsPerGame: Double?
    public let floor: Double?
    public let ceiling: Double?
}

/// One starting slot on one side of the matchup.
public struct MatchupRow: Hashable, Sendable, Identifiable {
    public let index: Int
    /// The slot's own token — `QB`, `FLEX`, `IDP_FLEX` — so a flex player is
    /// labelled by the slot he fills rather than only by his position.
    public let slot: String
    /// `nil` when Sleeper has the slot unset.
    public let playerID: String?
    public let name: String?
    public let position: Position?
    public let nflTeam: String?
    /// This week's opponent in nflverse spelling; `nil` on bye or unknown.
    public let opponent: String?
    public let isHome: Bool?
    public let onBye: Bool
    /// Points so far this week, per Sleeper. `nil` before kickoff or when
    /// Sleeper has not reported a number — not zero.
    public let livePoints: Double?
    /// `nil` for DEF and IDP, which the weekly file does not cover, and for
    /// anyone the crosswalk cannot join. Never a zero line.
    public let season: SeasonLine?
    /// The opponent defense against this player's position.
    public let defense: DefenseCell?
    /// This player's NFL team's implied total, from recorded lines.
    public let impliedTotal: Double?

    public var id: Int { index }
    public var isEmptySlot: Bool { playerID == nil }

    /// Positions with no production data at all say so rather than showing a
    /// blank that reads like "scored nothing" (§3.2).
    public var hasProductionData: Bool {
        position?.hasWeeklyProductionData ?? false
    }

    /// Plain-words read of the defense matchup, always naming its basis.
    public var defenseSummary: String? {
        guard let defense, let rank = defense.rank, let delta = defense.vsLeagueAverage,
              let opponent, let position else { return nil }
        let direction = delta >= 0 ? "more" : "fewer"
        return "\(opponent) ranks #\(rank) softest vs \(position.rawValue) · "
            + String(format: "%.1f %@ pts/gm than average", abs(delta), direction)
    }
}

/// The lineup-level implied scoring environment.
public struct LineupEnvironment: Hashable, Sendable {
    public let total: Double?
    public let teamCount: Int
    /// NFL teams with no recorded line — named, not counted as zero.
    public let missingTeams: [String]
}

/// One side of the matchup.
public struct MatchupSide: Hashable, Sendable {
    public let rosterID: Int
    public let manager: String
    public let isUser: Bool
    public let livePoints: Double?
    public let rows: [MatchupRow]
    public let environment: LineupEnvironment

    public var emptySlots: Int { rows.filter(\.isEmptySlot).count }
    public var startersOnBye: Int { rows.filter(\.onBye).count }
}

/// Matchup — "this week, both sides" (§7.2).
@MainActor
public final class MatchupModel: ObservableObject {
    public enum Showing: String, CaseIterable, Hashable, Sendable {
        case mine = "You"
        case opponent = "Opponent"
    }

    @Published public private(set) var context: LeagueContext?
    @Published public private(set) var mySide: MatchupSide?
    @Published public private(set) var opponentSide: MatchupSide?
    /// Said out loud when there is no opponent this week — a bye week in the
    /// fantasy schedule, or a season that has finished — rather than an empty
    /// screen that looks broken.
    @Published public private(set) var noOpponentReason: String?
    @Published public private(set) var week: Int?
    @Published public private(set) var isLoading = false
    @Published public private(set) var errorMessage: String?

    /// On a phone the two sides are a segmented control, not two columns (§7.2).
    @Published public var showing: Showing = .mine

    private let loader: LeagueContextLoader
    private let sleeper: SleeperService

    public init(loader: LeagueContextLoader, sleeper: SleeperService) {
        self.loader = loader
        self.sleeper = sleeper
    }

    public var visibleSide: MatchupSide? {
        showing == .mine ? mySide : opponentSide
    }

    /// Recorded lines never move during the week, and the UI owes the user
    /// that fact every time it shows one (§3.2).
    public static let linesNote = "Implied totals come from recorded closing lines, not live odds."

    public static let defenseNote = "Defense ranks are points allowed per game to the position, "
        + "counting every player who faced them — so a defense that sees three-receiver sets looks softer to receivers."

    private var lastRequest: (leagueID: String, rosterID: Int, season: Int?)?

    /// Re-reads everything that can change during a week. Wired to pull-to-refresh.
    public func refresh() async {
        guard let request = lastRequest else { return }
        await load(leagueID: request.leagueID, userRosterID: request.rosterID, season: request.season, force: true)
        // Only a refresh that actually reached Sleeper counts. A failed fetch
        // falls back to the cached copy, labelled offline — keeping the screen
        // useful, but not something to confirm with a success haptic.
        if errorMessage == nil, let context, !Freshness.isDegraded(context.provenance) {
            refreshCount += 1
        }
    }

    /// Bumped by each successful pull-to-refresh, so the screen can play a
    /// success haptic for a refresh without also playing one on first load.
    @Published public private(set) var refreshCount = 0

    public func load(leagueID: String, userRosterID: Int, season: Int? = nil, force: Bool = false) async {
        lastRequest = (leagueID, userRosterID, season)
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let context = try await loader.load(
                leagueID: leagueID, userRosterID: userRosterID, season: season, force: force
            )
            self.context = context
            self.week = context.currentWeek

            let matchups = try await sleeper.matchups(leagueID: leagueID, week: context.currentWeek, force: force)
            // Defense-vs-position scores every row of the season, so it runs off
            // the main thread rather than stalling the screen while it does.
            let rows = matchups.value
            let built = await Task.detached(priority: .userInitiated) {
                Self.build(context: context, matchups: rows)
            }.value
            mySide = built.mine
            opponentSide = built.opponent
            noOpponentReason = built.noOpponentReason
        } catch {
            errorMessage = String(describing: error)
        }
    }

    // MARK: - Building

    nonisolated static func build(
        context: LeagueContext,
        matchups: [SleeperMatchup]
    ) -> (mine: MatchupSide?, opponent: MatchupSide?, noOpponentReason: String?) {
        let lines = GameLines.week(context.schedule, week: context.currentWeek)
        let table = DefenseVsPosition.compute(file: context.weekly, profile: context.scoring.profile)
        let profilesByGSIS = Dictionary(
            context.seasonProfiles.map { ($0.gsisID, $0) }, uniquingKeysWith: { first, _ in first }
        )
        let gsisBySleeper = Dictionary(
            context.sleeperIDsByGSIS.map { ($0.value, $0.key) }, uniquingKeysWith: { first, _ in first }
        )

        func side(for team: LeagueTeam, matchup: SleeperMatchup?) -> MatchupSide {
            // The matchup's own starters are what is actually locked in for the
            // week; the roster's are the fallback before Sleeper has a matchup.
            let starters = matchup?.starters ?? team.rawStarters
            let rows = starters.enumerated().map { index, rawID -> MatchupRow in
                let slot = context.template.starters.indices.contains(index)
                    ? context.template.starters[index].token
                    : "—"
                guard rawID != SleeperRoster.emptyStarterSlot, !rawID.isEmpty else {
                    return MatchupRow(
                        index: index, slot: slot, playerID: nil, name: nil, position: nil,
                        nflTeam: nil, opponent: nil, isHome: nil, onBye: false, livePoints: nil,
                        season: nil, defense: nil, impliedTotal: nil
                    )
                }

                let player = context.players[rawID]
                let position = player?.position
                // A team defense's id *is* its team (§3.1).
                let nflTeam = player?.nflverseTeam ?? player?.team ?? (position == .def ? rawID : nil)
                let line = nflTeam.flatMap { lines[$0] }
                let onBye = nflTeam.map { context.byeCalendar.isOnBye(team: $0, week: context.currentWeek) } ?? false

                let profile = gsisBySleeper[rawID].flatMap { profilesByGSIS[$0] }
                let season = profile.map {
                    SeasonLine(
                        games: $0.games,
                        pointsPerGame: $0.pointsPerGame,
                        formPointsPerGame: $0.formPointsPerGame,
                        floor: $0.floor,
                        ceiling: $0.ceiling
                    )
                }

                return MatchupRow(
                    index: index,
                    slot: slot,
                    playerID: rawID,
                    name: player?.name ?? rawID,
                    position: position,
                    nflTeam: nflTeam,
                    opponent: line?.opponent,
                    isHome: line?.isHome,
                    onBye: onBye,
                    livePoints: matchup?.playersPoints?[rawID],
                    season: season,
                    defense: table.cell(defense: line?.opponent, position: position),
                    impliedTotal: line?.impliedTotal
                )
            }

            let environment = GameLines.lineupEnvironment(
                teams: rows.filter { !$0.isEmptySlot }.map(\.nflTeam), lines: lines
            )

            return MatchupSide(
                rosterID: team.rosterID,
                manager: team.manager,
                isUser: team.isUser,
                livePoints: matchup?.points,
                rows: rows,
                environment: LineupEnvironment(
                    total: environment.total,
                    teamCount: environment.teamCount,
                    missingTeams: environment.missing
                )
            )
        }

        guard let userTeam = context.userTeam else {
            return (nil, nil, "Your roster is not in this league any more.")
        }

        let myMatchup = matchups.first { $0.rosterID == userTeam.rosterID }
        let mine = side(for: userTeam, matchup: myMatchup)

        guard let matchupID = myMatchup?.matchupID else {
            return (mine, nil, "No opponent scheduled in week \(context.currentWeek) — a fantasy bye, or the season is over.")
        }

        guard let opponentMatchup = matchups.first(where: {
            $0.matchupID == matchupID && $0.rosterID != userTeam.rosterID
        }),
            let opponentTeam = context.teams.first(where: { $0.rosterID == opponentMatchup.rosterID })
        else {
            return (mine, nil, "Sleeper has not paired an opponent for week \(context.currentWeek) yet.")
        }

        return (mine, side(for: opponentTeam, matchup: opponentMatchup), nil)
    }
}
