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

    public init(sleeper: SleeperService, staticData: StaticDataStore) {
        self.sleeper = sleeper
        self.staticData = staticData
    }

    public func load(leagueID: String, userRosterID: Int, season: Int? = nil) async throws -> LeagueContext {
        let state = try await sleeper.nflState()
        let resolvedSeason = season ?? state.value.seasonYear ?? Calendar.current.component(.year, from: Date())
        let currentWeek = state.value.week ?? 1

        let league = try await sleeper.league(id: leagueID)
        let rosters = try await sleeper.rosters(leagueID: leagueID)
        let members = try await sleeper.members(leagueID: leagueID)
        let players = try await sleeper.playerIndex()
        let schedule = try await staticData.schedule(season: resolvedSeason)
        let weekly = try await staticData.weeklyFile(season: resolvedSeason)
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
            template: template,
            scoring: scoring,
            teams: teams,
            userRosterID: userRosterID,
            byeCalendar: byeCalendar,
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
