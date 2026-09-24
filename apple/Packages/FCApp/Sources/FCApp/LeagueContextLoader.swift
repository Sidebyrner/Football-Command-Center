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
    /// - Parameter now: the clock. Injected so tests and the demo league can fix
    ///   the time — lineup locks depend on it.
    public init(
        sleeper: SleeperService,
        staticData: StaticDataStore,
        now: @escaping @Sendable () -> Date = { Date() },
        reuseFor: TimeInterval = 60
    ) {
        self.sleeper = sleeper
        self.staticData = staticData
        self.now = now
        self.memo = ContextMemo(maxAge: reuseFor)
    }

    private let now: @Sendable () -> Date

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
            try await self.assemble(
                leagueID: leagueID, userRosterID: userRosterID, season: season, force: force
            )
        }
    }

    /// - Parameter force: re-read what changes during a week — the current week,
    ///   league settings, rosters and managers. The player index stays on its
    ///   daily cache (Sleeper asks for once a day) and the static files on theirs.
    private func assemble(
        leagueID: String,
        userRosterID: Int,
        season: Int?,
        force: Bool
    ) async throws -> LeagueContext {
        let state = try await sleeper.nflState(force: force)
        let scheduleSeason = season ?? state.value.seasonYear ?? Calendar.current.component(.year, from: Date())
        let currentWeek = state.value.week ?? 1

        let league = try await sleeper.league(id: leagueID, force: force)
        let rosters = try await sleeper.rosters(leagueID: leagueID, force: force)
        let members = try await sleeper.members(leagueID: leagueID, force: force)
        // The schedule first: it decides how fresh the player index — where the
        // injury tags live — has to be.
        let schedule = try await staticData.schedule(season: scheduleSeason)
        let players = try await sleeper.playerIndex(
            maxAge: GameDayWindow.playerIndexMaxAge(
                kickoffs: KickoffCalendar(schedule: schedule.value), week: currentWeek, now: now()
            )
        )
        let (statsSeason, weekly, currentSeasonWeeks) = try await loadStatsSeason(notAfter: scheduleSeason)
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
            var team = LeagueTeam(
                rosterID: roster.rosterID,
                ownerID: roster.ownerID,
                manager: roster.ownerID.flatMap { managerNames[$0] } ?? "Roster \(roster.rosterID)",
                isUser: roster.rosterID == userRosterID,
                roster: rosterEntries(for: roster, players: players.value),
                starterIDs: roster.filledStarters,
                rawStarters: roster.starters ?? [],
                settings: roster.settings
            )
            team.reserveIDs = roster.reserve ?? []
            return team
        }

        let byeCalendar = ByeCalendar(schedule: schedule.value)
        let seasonProfiles = SeasonScan.run(file: weekly.value, profile: scoring.profile)
        let baselines = Baselines.seasonPace(
            players: seasonProfiles, template: template, teamCount: teams.count
        )

        // Everything forward-looking, fetched together and never allowed to
        // fail the load: a screen renders from the produced numbers alone when
        // Sleeper's undocumented routes or the data host are unreachable (§0).
        let inSeason = await loadInSeason(
            season: scheduleSeason, currentWeek: currentWeek, force: force,
            kickoffs: KickoffCalendar(schedule: schedule.value)
        )
        let userRoster = rosters.value.first { $0.rosterID == userRosterID }

        var context = LeagueContext(
            league: league.value,
            scheduleSeason: scheduleSeason,
            statsSeason: statsSeason,
            currentSeasonWeeks: currentSeasonWeeks,
            template: template,
            scoring: scoring,
            teams: teams,
            userRosterID: userRosterID,
            byeCalendar: byeCalendar,
            kickoffs: KickoffCalendar(schedule: schedule.value),
            now: now,
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
            ]),
            sleeperProvenance: Provenance.weakest([
                state.provenance, league.provenance, rosters.provenance, members.provenance, players.provenance,
            ]),
            staticProvenance: Provenance.weakest([
                schedule.provenance, weekly.provenance, crosswalk.provenance,
            ])
        )
        context.leagueFacts = LeagueFacts.from(league: league.value, userRoster: userRoster?.settings)
        context.inSeason = inSeason
        return context
    }

    /// The in-season reads, each failing soft and reporting itself by name.
    ///
    /// Sleeper's projection and stats routes are undocumented, and the four
    /// static files only exist once the season's first data run has published
    /// them. A missing source is a labelled absence on screen, not an error.
    private func loadInSeason(
        season: Int,
        currentWeek: Int,
        force: Bool,
        kickoffs: KickoffCalendar
    ) async -> InSeasonData {
        let onGameDay = GameDayWindow.playerIndexMaxAge(kickoffs: kickoffs, week: currentWeek, now: now())
            < CacheTTL.players
        let projectionMaxAge = onGameDay ? 60 * 60 : CacheTTL.projections

        async let projectionsRead = try? sleeper.projections(
            season: season, week: currentWeek, force: force, maxAge: projectionMaxAge
        )
        async let injuriesRead = try? staticData.injuries(season: season)
        async let depthRead = try? staticData.depthCharts(season: season)
        async let usageRead = try? staticData.usage(season: season)
        async let contextRead = try? staticData.teamContext(season: season)

        // Every week so far: completed weeks on the long lifetime, the live
        // week on the short one.
        let weeks = Array(1...max(1, currentWeek))
        let statReads: [(Int, Fetched<[SleeperWeekStat]>?)] = await withTaskGroup(
            of: (Int, Fetched<[SleeperWeekStat]>?).self
        ) { group in
            for week in weeks {
                group.addTask {
                    (week, try? await self.sleeper.weekStats(
                        season: season, week: week, isCompleted: week < currentWeek, force: force && week == currentWeek
                    ))
                }
            }
            var out: [(Int, Fetched<[SleeperWeekStat]>?)] = []
            for await read in group { out.append(read) }
            return out
        }

        let projections = await projectionsRead
        let injuries = await injuriesRead
        let depth = await depthRead
        let usage = await usageRead
        let teamContext = await contextRead

        var unavailable: [String] = []
        if projections == nil { unavailable.append("Rotowire projections via Sleeper") }
        if injuries == nil { unavailable.append("official injury report") }
        if depth == nil { unavailable.append("depth charts") }
        if usage == nil { unavailable.append("snap counts and expected points") }
        if teamContext == nil { unavailable.append("team context") }

        var weekStats: [Int: [String: SleeperWeekStat]] = [:]
        var statProvenances: [Provenance] = []
        var missingStatWeeks: [Int] = []
        for (week, read) in statReads.sorted(by: { $0.0 < $1.0 }) {
            guard let read else { missingStatWeeks.append(week); continue }
            statProvenances.append(read.provenance)
            weekStats[week] = Dictionary(read.value.map { ($0.playerID, $0) }, uniquingKeysWith: { first, _ in first })
        }
        if !missingStatWeeks.isEmpty {
            unavailable.append("Sleeper stats for week\(missingStatWeeks.count == 1 ? "" : "s") "
                + missingStatWeeks.map(String.init).joined(separator: ", "))
        }

        let projectionsByID = Dictionary(
            (projections?.value ?? []).map { ($0.playerID, $0) }, uniquingKeysWith: { first, _ in first }
        )
        let sleeperProvenances = [projections?.provenance].compactMap { $0 } + statProvenances
        let fileProvenances = [injuries?.provenance, depth?.provenance, usage?.provenance, teamContext?.provenance]
            .compactMap { $0 }

        return InSeasonData(
            projections: projectionsByID,
            weekStats: weekStats,
            practiceReports: injuries?.value.reportsByPlayer(week: currentWeek) ?? [:],
            depthCharts: depth?.value,
            usage: usage?.value,
            teamContext: teamContext?.value,
            sleeperProvenance: sleeperProvenances.isEmpty ? nil : Provenance.weakest(sleeperProvenances),
            filesProvenance: fileProvenances.isEmpty ? nil : Provenance.weakest(fileProvenances),
            unavailable: unavailable,
            projectionSourceLabel: projections?.value.first?.sourceLabel
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
    private func loadStatsSeason(
        notAfter scheduleSeason: Int
    ) async throws -> (season: Int, weekly: Fetched<WeeklyFile>, currentSeasonWeeks: Int) {
        let listed = (try? await staticData.weeklyManifest())?.value.seasons ?? []
        let eligible = listed.filter { $0.season <= scheduleSeason }.sorted { $0.season > $1.season }
        let currentSeasonWeeks = listed.first { $0.season == scheduleSeason }.map(Self.weeksPlayed) ?? 0

        // A season with fewer than three weeks of games is too thin to average
        // over — one game is a noisy floor and ceiling — so it is tried only
        // after every season that clears the bar. Three matches the baselines'
        // own minimum games for a line.
        var candidates = eligible.filter { Self.weeksPlayed($0) >= Self.minimumWeeksForStatsSeason }.map(\.season)
            + eligible.filter { Self.weeksPlayed($0) < Self.minimumWeeksForStatsSeason }.map(\.season)
        // Without a manifest, fall back to last season then this one rather than
        // giving up.
        if candidates.isEmpty { candidates = [scheduleSeason - 1, scheduleSeason] }

        var lastError: Error = DataLayerError.noFallbackAvailable(resource: "weekly-\(scheduleSeason)")
        for candidate in candidates {
            do {
                return (candidate, try await staticData.weeklyFile(season: candidate), currentSeasonWeeks)
            } catch {
                lastError = error
            }
        }
        throw lastError
    }

    /// Weeks of games a season has, 18 for a complete one.
    static func weeksPlayed(_ entry: WeeklyManifest.SeasonEntry) -> Int {
        entry.weeks ?? entry.latestWeek ?? 0
    }

    /// The current season becomes the stats season once it has this many weeks.
    public static let minimumWeeksForStatsSeason = 3


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
