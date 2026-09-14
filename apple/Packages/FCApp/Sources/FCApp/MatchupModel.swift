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
    /// His game has kicked off, so his slot can no longer change.
    public var isLocked: Bool = false
    /// His game may be in progress right now.
    public var isLive: Bool = false
    /// His game's kickoff this week; `nil` on bye.
    public var kickoff: Date? = nil

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

    /// The average implied total of the NFL teams in the lineup.
    ///
    /// The raw total sums every team's number, which reads as nonsense next to
    /// a fantasy score ("86.7 · 208.0 implied"). The average answers something a
    /// person can use: how many points the teams your players are on are
    /// expected to score. Averaged over the teams that *have* a line.
    public var averageTeamTotal: Double? {
        let counted = teamCount - missingTeams.count
        guard let total, counted > 0 else { return nil }
        return total / Double(counted)
    }
}

/// Which number the head-to-head bars compare. One basis for the whole matchup,
/// always named, never mixed row by row.
public enum ComparisonBasis: Hashable, Sendable {
    /// At least one game has started, so real points exist.
    case livePoints
    /// Nothing has kicked off; season points per game is the only comparable number.
    case seasonAverage

    public var label: String {
        switch self {
        case .livePoints: return "Comparing live points"
        case .seasonAverage: return "No games yet — comparing season pts/gm"
        }
    }
}

/// Who is ahead in one slot.
public enum SlotLeader: Hashable, Sendable {
    case mine
    case theirs
    case even
    /// One or both sides has no number on this basis yet — not yet played, or no
    /// production data. Stated rather than guessed.
    case undecided
}

/// One starting slot with both players side by side.
public struct PairedSlot: Hashable, Sendable, Identifiable {
    public let index: Int
    public let slot: String
    public let mine: MatchupRow?
    public let theirs: MatchupRow?
    public let myValue: Double?
    public let theirValue: Double?
    public let leader: SlotLeader

    public var id: Int { index }

    /// My share of the slot's combined value, 0…1, for the comparison bar.
    /// `nil` when there is nothing to compare.
    public var myShare: Double? {
        guard let myValue, let theirValue, myValue + theirValue > 0 else { return nil }
        return max(0, myValue) / (max(0, myValue) + max(0, theirValue))
    }
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

    /// Starters whose game hasn't kicked off yet — a fact, not a projection.
    /// Empty slots and bye weeks don't count: neither will ever play.
    public var leftToPlay: Int {
        rows.filter { !$0.isEmptySlot && !$0.onBye && !$0.isLocked }.count
    }

    /// Whether any of this side's starters may be playing right now.
    public var hasLiveGame: Bool { rows.contains(where: \.isLive) }
}

/// Matchup — "this week, both sides" (§7.2).
@MainActor
public final class MatchupModel: ObservableObject {
    /// Head-to-head shows both lineups slot by slot; the other two show one team
    /// in full detail.
    public enum Mode: String, CaseIterable, Hashable, Sendable {
        case headToHead = "Head-to-head"
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

    @Published public var mode: Mode = .headToHead

    /// Both lineups paired by slot, for head-to-head.
    @Published public private(set) var pairedSlots: [PairedSlot] = []
    @Published public private(set) var comparisonBasis: ComparisonBasis = .seasonAverage

    private let loader: LeagueContextLoader
    private let sleeper: SleeperService

    public init(loader: LeagueContextLoader, sleeper: SleeperService) {
        self.loader = loader
        self.sleeper = sleeper
    }

    /// The single team shown in an individual mode; `nil` in head-to-head.
    public var visibleSide: MatchupSide? {
        switch mode {
        case .headToHead: return nil
        case .mine: return mySide
        case .opponent: return opponentSide
        }
    }

    /// The modes that make sense right now: no Opponent page when there is no
    /// opponent this week.
    public var availableModes: [Mode] {
        opponentSide == nil ? [.headToHead, .mine] : Mode.allCases
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
            let table = await Task.detached(priority: .userInitiated) {
                DefenseVsPosition.compute(file: context.weekly, profile: context.scoring.profile)
            }.value
            defenseTable = table
            defenseTableBuilds += 1
            apply(Self.build(context: context, matchups: rows, table: table))
            lastLiveUpdate = nil
        } catch {
            errorMessage = String(describing: error)
        }
    }

    // MARK: - Live updates

    /// The defense table for the loaded context. Scoring every row of the season
    /// is the expensive part of a build, and it can't change during a game, so
    /// live refreshes reuse it.
    private var defenseTable: DefenseVsPositionTable?
    /// How many times the table has been computed — for tests.
    private(set) var defenseTableBuilds = 0

    /// When live scores were last refreshed, for "updated 40s ago".
    @Published public private(set) var lastLiveUpdate: Date?

    private func apply(_ built: (mine: MatchupSide?, opponent: MatchupSide?, noOpponentReason: String?)) {
        mySide = built.mine
        opponentSide = built.opponent
        noOpponentReason = built.noOpponentReason
        let paired = Self.pair(mine: built.mine, theirs: built.opponent)
        comparisonBasis = paired.basis
        pairedSlots = paired.slots
        if opponentSide == nil, mode == .opponent { mode = .mine }
    }

    /// Whether any starter on either side may be playing right now, judged on
    /// the clock at this moment rather than when the rows were built.
    public var anyGameLive: Bool {
        guard let context else { return false }
        let ids = ((mySide?.rows ?? []) + (opponentSide?.rows ?? [])).compactMap(\.playerID)
        return ids.contains { context.isLive($0) }
    }

    /// One live refresh: re-reads this week's matchups and rebuilds both sides,
    /// but only while a game involving either lineup may be in progress.
    /// Returns whether it polled. The screen calls this on a timer while it is
    /// visible, so outside game windows it costs nothing.
    @discardableResult
    public func liveTick() async -> Bool {
        guard let context, let request = lastRequest, anyGameLive else { return false }
        guard let matchups = try? await sleeper.matchups(
            leagueID: request.leagueID, week: context.currentWeek, force: true
        ) else { return false }
        let table = defenseTable
        let rows = matchups.value
        let built = await Task.detached(priority: .utility) {
            Self.build(context: context, matchups: rows, table: table)
        }.value
        apply(built)
        lastLiveUpdate = context.now()
        return true
    }

    // MARK: - Pairing

    /// Pairs both lineups by slot index — both follow the same slot template, so
    /// index `n` is the same slot on each side.
    ///
    /// The basis is chosen once for the whole matchup: live points as soon as
    /// anyone on either side has a live number, otherwise season points per game.
    /// Within live points a player yet to play has no value, so his slot is
    /// undecided rather than counted as a zero-point loss.
    nonisolated static func pair(
        mine: MatchupSide?,
        theirs: MatchupSide?
    ) -> (basis: ComparisonBasis, slots: [PairedSlot]) {
        let allRows = (mine?.rows ?? []) + (theirs?.rows ?? [])
        let basis: ComparisonBasis = allRows.contains { $0.livePoints != nil } ? .livePoints : .seasonAverage

        func value(_ row: MatchupRow?) -> Double? {
            guard let row, !row.isEmptySlot else { return nil }
            // A starter on bye is a certain zero on either basis.
            if row.onBye { return 0 }
            switch basis {
            case .livePoints: return row.livePoints
            case .seasonAverage: return row.season?.pointsPerGame
            }
        }

        let count = max(mine?.rows.count ?? 0, theirs?.rows.count ?? 0)
        let slots = (0..<count).map { index -> PairedSlot in
            let left = mine?.rows.indices.contains(index) == true ? mine?.rows[index] : nil
            let right = theirs?.rows.indices.contains(index) == true ? theirs?.rows[index] : nil
            let myValue = value(left)
            let theirValue = value(right)

            // An empty slot is a certain zero, so it loses to any real player
            // who isn't on bye — even one yet to kick off.
            func fielded(_ row: MatchupRow?) -> Bool {
                guard let row else { return false }
                return !row.isEmptySlot && !row.onBye
            }

            let leader: SlotLeader
            if left?.isEmptySlot == true, fielded(right) {
                leader = .theirs
            } else if right?.isEmptySlot == true, fielded(left) {
                leader = .mine
            } else if let myValue, let theirValue {
                leader = abs(myValue - theirValue) < 0.05 ? .even : (myValue > theirValue ? .mine : .theirs)
            } else {
                leader = .undecided
            }

            return PairedSlot(
                index: index,
                slot: left?.slot ?? right?.slot ?? "—",
                mine: left,
                theirs: right,
                myValue: myValue,
                theirValue: theirValue,
                leader: leader
            )
        }
        return (basis, slots)
    }

    // MARK: - Building

    nonisolated static func build(
        context: LeagueContext,
        matchups: [SleeperMatchup],
        table: DefenseVsPositionTable? = nil
    ) -> (mine: MatchupSide?, opponent: MatchupSide?, noOpponentReason: String?) {
        let lines = GameLines.week(context.schedule, week: context.currentWeek)
        let table = table ?? DefenseVsPosition.compute(file: context.weekly, profile: context.scoring.profile)
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
                    impliedTotal: line?.impliedTotal,
                    isLocked: context.isLocked(rawID),
                    isLive: context.isLive(rawID),
                    kickoff: context.kickoffs.kickoff(team: nflTeam, week: context.currentWeek)
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
