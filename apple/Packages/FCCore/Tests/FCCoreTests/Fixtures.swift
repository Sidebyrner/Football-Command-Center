import Foundation
import XCTest
@testable import FCCore

/// Loads the real shipped data files.
///
/// These are the actual nflverse-derived JSON the app ships, not mocks. Mocks
/// would have passed while the dialect mismatches in §3.2 sailed through, so the
/// most valuable tests here assert against the real thing (§10).
enum Fixtures {
    enum FixtureError: Error, CustomStringConvertible {
        case missing(String)

        var description: String {
            switch self {
            case .missing(let name):
                return "Fixture \(name) is not in the test bundle. Run apple/Tools/sync-fixtures.sh."
            }
        }
    }

    static func url(_ name: String) throws -> URL {
        let parts = name.split(separator: ".", maxSplits: 1).map(String.init)
        let base = parts[0]
        let ext = parts.count > 1 ? parts[1] : ""

        if let url = Bundle.module.url(forResource: "Fixtures/\(base)", withExtension: ext) {
            return url
        }
        if let resources = Bundle.module.resourceURL {
            let candidate = resources.appendingPathComponent("Fixtures").appendingPathComponent(name)
            if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
        }
        throw FixtureError.missing(name)
    }

    static func data(_ name: String) throws -> Data {
        try Data(contentsOf: Fixtures.url(name))
    }

    static func decode<T: Decodable>(_ type: T.Type, from name: String) throws -> T {
        try JSONDecoder().decode(type, from: Fixtures.data(name))
    }

    // Decoding 650 KB of JSON on every test would dominate the run; each file is
    // immutable so one shared copy is correct and much faster.
    private static let weekly2025Storage = Result<WeeklyFile, Error> {
        try Fixtures.decode(WeeklyFile.self, from: "weekly-2025.json")
    }
    private static let schedule2025Storage = Result<ScheduleFile, Error> {
        try Fixtures.decode(ScheduleFile.self, from: "schedule-2025.json")
    }
    private static let schedule2026Storage = Result<ScheduleFile, Error> {
        try Fixtures.decode(ScheduleFile.self, from: "schedule-2026.json")
    }

    static func weekly2025() throws -> WeeklyFile { try weekly2025Storage.get() }
    static func schedule2025() throws -> ScheduleFile { try schedule2025Storage.get() }
    static func schedule2026() throws -> ScheduleFile { try schedule2026Storage.get() }

    /// The user's league: 8 teams, non-PPR, IDP via two `IDP_FLEX` slots.
    /// Used as a *test* fixture only — the app reads the real thing live from
    /// Sleeper on every load (§1).
    static let leagueRosterPositions = [
        "QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "IDP_FLEX", "IDP_FLEX",
        "BN", "BN", "BN", "BN", "BN", "BN", "IR",
    ]

    static var leagueTemplate: SlotTemplate { RosterSlots.parse(leagueRosterPositions) }

    static let leagueTeamCount = 8

    /// gsis ids used by name in several tests.
    enum Player {
        static let aaronRodgers = "00-0023459"
        static let joshAllen = "00-0034857"
        static let bijanRobinson = "00-0038542"
    }

    static func gsisID(named name: String, in file: WeeklyFile) -> String? {
        file.playerIDs.first { file.playerMeta(for: $0)?.name == name }
    }
}
