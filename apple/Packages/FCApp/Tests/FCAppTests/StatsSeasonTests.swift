import XCTest
import FCCore
import FCData
@testable import FCApp

/// Regression: a league in the *current* season must load.
///
/// The schedule for a season exists before a snap is played; its weekly
/// production file does not. The loader used to ask for the current season's
/// weekly file, so a real 2026 league in week 2 failed to load at all — every
/// other test pinned the season to 2025 and never saw it.
@MainActor
final class StatsSeasonTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    private func transport2026() async -> StubTransport {
        let transport = await Harness.standardTransport()
        await transport.override("/state/nfl", json: #"{"week":2,"season":"2026","season_type":"regular"}"#)
        return transport
    }

    private func loader(_ transport: StubTransport) -> LeagueContextLoader {
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        return LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData)
    }

    func testACurrentSeasonLeagueLoadsWithoutItsOwnWeeklyFile() async throws {
        let context = try await loader(await transport2026())
            .load(leagueID: "L1", userRosterID: 1)

        XCTAssertEqual(context.scheduleSeason, 2026)
        XCTAssertEqual(context.statsSeason, 2025, "newest season the manifest lists")
        XCTAssertFalse(context.seasonProfiles.isEmpty)
    }

    /// Byes and opponents must come from *this* season's schedule even though
    /// production comes from last season's.
    func testByesComeFromTheCurrentSeasonsSchedule() async throws {
        let context = try await loader(await transport2026())
            .load(leagueID: "L1", userRosterID: 1)

        let schedule2026 = try JSONDecoder().decode(
            ScheduleFile.self,
            from: Data(contentsOf: XCTUnwrap(
                Bundle.module.url(forResource: "schedule-2026", withExtension: "json", subdirectory: "Fixtures")
            ))
        )
        XCTAssertEqual(context.byeCalendar, ByeCalendar(schedule: schedule2026))
    }

    /// Last year's points per game must never read as this year's (§6).
    func testTheSeasonMismatchIsStated() async throws {
        let context = try await loader(await transport2026())
            .load(leagueID: "L1", userRosterID: 1)

        let note = try XCTUnwrap(context.statsSeasonNote)
        XCTAssertTrue(note.contains("2025"))
        XCTAssertTrue(note.contains("2026"))
    }

    func testNoNoteWhenTheSeasonsMatch() async throws {
        let context = try await loader(await Harness.standardTransport())
            .load(leagueID: "L1", userRosterID: 1, season: 2025)

        XCTAssertEqual(context.statsSeason, 2025)
        XCTAssertNil(context.statsSeasonNote)
    }
}
