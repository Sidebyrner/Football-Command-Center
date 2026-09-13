import Foundation
import FCCore
import FCData

/// Assembles a `LeagueContext` from the data layer.
///
/// The ordering here is deliberate: every read goes through `SleeperService` or
/// `StaticDataStore`, so each one can come back cached, stale or bundled, and
/// the context carries the weakest of them. A screen built on a four-hour-old
/// roster and a bundled schedule should say so once, at the top, rather than
/// per-row.
public struct LeagueContextLoader: Sendable {
    private let sleeper: SleeperService
    private let staticData: StaticDataStore
    private let memo: ContextMemo

    /// - Parameter reuseFor: how long an assembled context is handed to other
    ///   callers before being rebuilt. Dashboard, Matchup and Planning share one
    ///   loader, so without this a launch decoded the weekly file and re-scored
    ///   the whole season three times in a row. The underlying reads are still
    ///   cached and TTL'd individually in FCData; this only stops the *assembly*
    ///   being repeated.
    public init(sleeper: SleeperService, staticData: StaticDataStore, reuseFor: TimeInterval = 60) {
        self.sleeper = sleeper
        self.staticData = staticData
        self.memo = ContextMemo(maxAge: reuseFor)
    }

    /// - Parameters:
    ///   - season: overrides the schedule season. Normally `nil`, which means
    ///     "the season Sleeper says is current".
    ///   - force: rebuild even if a recent context exists, e.g. after the user
    ///     changes league in Settings or pulls to refresh.
    public func load(
        leagueID: String,
        userRosterID: Int,
        season: Int? = nil,
        force: Bool = false
    ) async throws -> LeagueContext {
        let key = ContextMemo.Key(leagueID: leagueID, rosterID: userRosterID, season: season)
        return try await memo.value(for: key, force: force) {
            try await self.assemble(leagueID: leagueID, userRosterID: userRosterID, season: season)
        }
    }

    private func assemble(leagueID: String, userRosterID: Int, season: Int?) async throws -> LeagueContext {
        let state = try await sleeper.nflState()
        let scheduleSeason = season ?? state.value.seasonYear ?? Calendar.current.component(.year, from: Date())
        let currentWeek = state.value.week ?? 1

        let league = try await sleeper.league(id: leagueID)
        let rosters = try await sleeper.rosters(leagueID: leagueID)
        let members = try await sleeper.members(leagueID: leagueID)
        let players = try await sleeper.playerIndex()
        let schedule = try await staticData.schedule(season: scheduleSeason)
        let (statsSeason, weekly) = try await loadStatsSeason(notAfter: scheduleSeason)
        let crosswalk = try await staticData.playerCrosswalk()

        let template = league.value.slotTemplate
        let scoring = ScoringProfile.fromSleeper(
            scoringSettings: league.value.scoringSettings ?? [:],
            leagueName: league.value.name ?? "League"
        )

        let managerNames = Dictionary(
            members.value.map { ($0.userID, $0.label) },
            uniquingKeysWith: { first, _ in first }
        )

        let teams = rosters.value.map { roster in
            LeagueTeam(
                rosterID: roster.rosterID,
                ownerID: roster.ownerID,
                manager: roster.ownerID.flatMap { managerNames[$0] } ?? "Roster \(roster.rosterID)",
                isUser: roster.rosterID == userRosterID,
                roster: rosterEntries(for: roster, players: players.value),
                starterIDs: roster.filledStarters,
                rawStarters: roster.starters ?? [],
                settings: roster.settings
            )
        }

        let byeCalendar = ByeCalendar(schedule: schedule.value)
        let seasonProfiles = SeasonScan.run(file: weekly.value, profile: scoring.profile)
        let baselines = Baselines.seasonPace(
            players: seasonProfiles, template: template, teamCount: teams.count
        )

        return LeagueContext(
            league: league.value,
            scheduleSeason: scheduleSeason,
            statsSeason: statsSeason,
            template: template,
            scoring: scoring,
            teams: teams,
            userRosterID: userRosterID,
            byeCalendar: byeCalendar,
            schedule: schedule.value,
            weekly: weekly.value,
            currentWeek: currentWeek,
            seasonWeeks: weeks(in: schedule.value),
            seasonProfiles: seasonProfiles,
            baselines: baselines,
            sleeperIDsByGSIS: crosswalk.value.sleeperIDsByGSIS(),
            availabilityBySleeperID: availability(teams: teams, userRosterID: userRosterID),
            unsupportedPositions: unsupportedStartingPositions(template: template),
            players: players.value,
            provenance: Provenance.weakest([
                state.provenance, league.provenance, rosters.provenance, members.provenance,
                players.provenance, schedule.provenance, weekly.provenance, crosswalk.provenance,
            ])
        )
    }

    /// The weekly production file to use, which is **not** necessarily the
    /// current season's.
    ///
    /// The schedule for a season exists before a snap is played; its weekly
    /// production file does not. Asking for the current season's weekly file in
    /// week 2 used to fail the whole league load. So, as the web app does, the
    /// stats season is the newest season the manifest lists at or before the
    /// schedule season — and the context records which one it was, so the UI
    /// can say "2025 production" rather than implying it is this year's.
    private func loadStatsSeason(notAfter scheduleSeason: Int) async throws -> (Int, Fetched<WeeklyFile>) {
        let listed = (try? await staticData.weeklyManifest())?.value.seasons.map(\.season) ?? []
        var candidates = listed.filter { $0 <= scheduleSeason }.sorted(by: >)
        // Without a manifest, fall back to this season then last season rather
        // than giving up.
        if candidates.isEmpty { candidates = [scheduleSeason, scheduleSeason - 1] }

        var lastError: Error = DataLayerError.noFallbackAvailable(resource: "weekly-\(scheduleSeason)")
        for candidate in candidates {
            do {
                return (candidate, try await staticData.weeklyFile(season: candidate))
            } catch {
                lastError = error
            }
        }
        throw lastError
    }

    /// Resolves a roster's Sleeper ids into the entries the crunch needs.
    ///
    /// A player the index doesn't know still becomes an entry with a `nil`
    /// position, because `ByeCrunch` counts those in `unknownPosition` — and a
    /// roster spot the app cannot classify is something the user should see,
    /// not something to quietly drop.
    private func rosterEntries(for roster: SleeperRoster, players: PlayerIndex) -> [RosterEntry] {
        (roster.players ?? []).map { id in
            let player = players[id]
            return RosterEntry(
                id: id,
                position: player?.position,
                // nflverse spelling, because the bye calendar is built from the
                // schedule file and `LAR` there is `LA` (§5.6).
                team: player?.nflverseTeam ?? player?.team
            )
        }
    }

    private func availability(teams: [LeagueTeam], userRosterID: Int) -> [String: Availability] {
        var out: [String: Availability] = [:]
        for team in teams {
            let starting = Set(team.starterIDs)
            for entry in team.roster {
                if team.rosterID == userRosterID {
                    out[entry.id] = .mine
                } else if starting.contains(entry.id) {
                    out[entry.id] = .rivalStarter(rosterID: team.rosterID, manager: team.manager)
                } else {
                    out[entry.id] = .rivalBench(rosterID: team.rosterID, manager: team.manager)
                }
            }
        }
        return out
    }

    /// Starting positions with no production data behind them. In this league
    /// that is DEF plus the two IDP flex slots — 3 of 11 starting spots with
    /// nothing to score, which the UI is required to state (§3.2).
    private func unsupportedStartingPositions(template: SlotTemplate) -> [Position] {
        var positions: Set<Position> = []
        for slot in template.starters {
            if let dedicated = slot.dedicated {
                if !dedicated.hasWeeklyProductionData { positions.insert(dedicated) }
            } else {
                for eligible in slot.eligible where !eligible.hasWeeklyProductionData {
                    positions.insert(eligible)
                }
            }
        }
        return positions.sorted { $0.rawValue < $1.rawValue }
    }

    private func weeks(in schedule: ScheduleFile) -> [Int] {
        schedule.byWeek.keys.compactMap(Int.init).sorted()
    }
}


/// Shares one assembled `LeagueContext` between screens.
///
/// Two screens asking at the same moment get the same in-flight load rather
/// than starting a second one, which is exactly what happens at launch.
actor ContextMemo {
    struct Key: Hashable, Sendable {
        let leagueID: String
        let rosterID: Int
        let season: Int?
    }

    private let maxAge: TimeInterval
    private var entries: [Key: (builtAt: Date, context: LeagueContext)] = [:]
    private var inFlight: [Key: Task<LeagueContext, Error>] = [:]

    init(maxAge: TimeInterval) {
        self.maxAge = maxAge
    }

    func value(
        for key: Key,
        force: Bool,
        make: @escaping @Sendable () async throws -> LeagueContext
    ) async throws -> LeagueContext {
        if !force, let entry = entries[key], Date().timeIntervalSince(entry.builtAt) < maxAge {
            return entry.context
        }
        if !force, let running = inFlight[key] {
            return try await running.value
        }

        let task = Task { try await make() }
        inFlight[key] = task
        defer { inFlight[key] = nil }

        // A failure is not memoised: the next screen to ask should try again,
        // not inherit the error.
        let context = try await task.value
        entries[key] = (Date(), context)
        return context
    }
}
