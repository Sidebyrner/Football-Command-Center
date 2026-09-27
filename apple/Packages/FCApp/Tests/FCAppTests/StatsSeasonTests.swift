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
        return LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs)
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

/// The three-week rule, with the static store pointed at a stubbed data host
/// that publishes a 2026 weekly file alongside the bundled 2025 one.
@MainActor
final class StatsSeasonThresholdTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    private func manifest(weeks2026: Int) -> String {
        """
        {"_meta":{"generated":"2026-10-01T00:00:00Z"},"seasons":[
          {"season":2026,"file":"/data/weekly/2026.json","weeks":\(weeks2026),"latestWeek":\(weeks2026),"complete":false},
          {"season":2025,"file":"/data/weekly/2025.json","weeks":18,"latestWeek":18,"complete":true}]}
        """
    }

    /// A tiny but valid 2026 weekly file: one quarterback, a few weeks.
    private func weekly2026(weeks: Int) -> String {
        let rows = (1...max(1, weeks)).map { #"[\#($0),"BUF","BAL",250,2]"# }.joined(separator: ",")
        return """
        {"fields":["week","team","opp","pass_yd","pass_td"],
         "meta":{"00-0034857":{"n":"Josh Allen","p":"QB"}},
         "players":{"00-0034857":[\(rows)]}}
        """
    }

    private func context(weeks2026: Int) async throws -> LeagueContext {
        let transport = await Harness.standardTransport()
        await transport.override("/state/nfl", json: #"{"week":4,"season":"2026","season_type":"regular"}"#)
        await transport.on("weekly/index.json", json: manifest(weeks2026: weeks2026))
        await transport.on("weekly/2026.json", json: weekly2026(weeks: weeks2026))

        let made = Harness.make(transport: transport)
        cacheDirectory = made.cacheDirectory
        let staticData = StaticDataStore(
            bundle: .module,
            bundleSubdirectory: "Fixtures",
            cache: DiskCache(directory: made.cacheDirectory.appendingPathComponent("remote-static")),
            transport: transport,
            baseURL: URL(string: "https://data.example.test")!
        )
        return try await LeagueContextLoader(
            sleeper: made.sleeper, staticData: staticData, now: TestClock.beforeKickoffs
        ).load(leagueID: "L1", userRosterID: 1)
    }

    func testTwoWeeksIsNotEnoughToSwitch() async throws {
        let context = try await context(weeks2026: 2)
        XCTAssertEqual(context.scheduleSeason, 2026)
        XCTAssertEqual(context.statsSeason, 2025)
        XCTAssertEqual(context.currentSeasonWeeks, 2)

        let note = try XCTUnwrap(context.statsSeasonNote)
        XCTAssertTrue(note.contains("until 2026 has 3 weeks"), note)
        XCTAssertTrue(note.contains("it has 2"), note)
    }

    func testThreeWeeksSwitchesToTheCurrentSeason() async throws {
        let context = try await context(weeks2026: 3)
        XCTAssertEqual(context.statsSeason, 2026)
        XCTAssertNil(context.statsSeasonNote)
        XCTAssertEqual(context.seasonProfiles.first?.name, "Josh Allen")
    }

    /// The current season's file is downloaded from the data host — it isn't
    /// bundled, so there is no other way it could have loaded.
    func testTheCurrentSeasonIsDownloadedFromTheDataHost() async throws {
        let transport = await Harness.standardTransport()
        await transport.override("/state/nfl", json: #"{"week":6,"season":"2026","season_type":"regular"}"#)
        await transport.on("weekly/index.json", json: manifest(weeks2026: 5))
        await transport.on("weekly/2026.json", json: weekly2026(weeks: 5))
        let made = Harness.make(transport: transport)
        cacheDirectory = made.cacheDirectory
        let staticData = StaticDataStore(
            bundle: .module, bundleSubdirectory: "Fixtures",
            cache: DiskCache(directory: made.cacheDirectory.appendingPathComponent("remote-static")),
            transport: transport, baseURL: URL(string: "https://data.example.test")!
        )
        let context = try await LeagueContextLoader(
            sleeper: made.sleeper, staticData: staticData, now: TestClock.beforeKickoffs
        ).load(leagueID: "L1", userRosterID: 1)

        XCTAssertEqual(context.statsSeason, 2026)
        let paths = await transport.requestedPaths()
        XCTAssertTrue(paths.contains("/weekly/2026.json"))
        XCTAssertTrue(paths.contains("/weekly/index.json"))
    }
}
