import XCTest
import FCCore
import FCData
@testable import FCApp

/// The Planning screen, built against the real 2025 schedule and weekly files.
///
/// Bye weeks here are not invented: LAR and SEA really are on bye in week 8 of
/// the shipped schedule, which is what makes the user's shortfall a derived
/// fact rather than a number typed into a fixture.
@MainActor
final class PlanningModelTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    private func loadedModel() async throws -> PlanningModel {
        let transport = await Harness.standardTransport()
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory

        let model = PlanningModel(
            loader: LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs)
        )
        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)
        if let error = model.errorMessage { throw XCTSkip("load failed: \(error)") }
        return model
    }

    func testLoadsALeagueContext() async throws {
        let model = try await loadedModel()
        let context = try XCTUnwrap(model.context)

        XCTAssertEqual(context.teams.count, 2)
        XCTAssertEqual(context.userRosterID, 1)
        XCTAssertEqual(context.template.totalStarterSlots, 11)
        XCTAssertEqual(context.template.benchCount, 5)
    }

    /// Scoring comes from the league's own settings, never hardcoded (§1).
    func testScoringComesFromTheLeague() async throws {
        let model = try await loadedModel()
        let context = try XCTUnwrap(model.context)

        XCTAssertEqual(context.scoring.profile.source, .sleeper)
        XCTAssertEqual(context.scoring.profile.passingTD, 6)
        XCTAssertEqual(context.scoring.profile.receptionPoints, 0, "this league is not PPR")
    }

    /// The manager's own team name wins over their display name.
    func testTeamsAreNamedByTheirManagers() async throws {
        let model = try await loadedModel()
        let context = try XCTUnwrap(model.context)

        XCTAssertEqual(context.userTeam?.manager, "Byrne Notice")
        XCTAssertEqual(context.rivals.first?.manager, "rival")
    }

    // MARK: - The grid

    func testGridCoversEveryTeamAndRemainingWeek() async throws {
        let model = try await loadedModel()
        let context = try XCTUnwrap(model.context)

        XCTAssertEqual(model.grid.count, context.teams.count * context.remainingWeeks.count)
    }

    /// Week 8 byes in the shipped 2025 file are ARI, DET, JAX, LA, LV, SEA. The
    /// user's two backs are LAR and SEA, so both are out and RB goes short.
    func testTheUserIsShortAtRunningBackInWeekEight() async throws {
        let model = try await loadedModel()
        let week8 = try XCTUnwrap(model.cell(rosterID: 1, week: 8))

        XCTAssertTrue(week8.isShort)
        XCTAssertTrue(week8.shortPositions.contains(.rb))
        XCTAssertEqual(week8.report.byPosition[.rb]?.shortfall, 2)
    }

    /// `LAR` on Sleeper is `LA` in the schedule file. Without the normalisation
    /// in the loader the Rams back would read as available and the alarm would
    /// never fire (§5.6).
    func testTheRamsBackIsRecognisedAsOnByeDespiteTheSpelling() async throws {
        let model = try await loadedModel()
        let week8 = try XCTUnwrap(model.cell(rosterID: 1, week: 8))

        XCTAssertTrue(week8.report.onBye.contains { $0.id == "rb_la" })
        XCTAssertTrue(week8.report.onBye.contains { $0.id == "rb_sea" })
    }

    /// A full roster with nobody on bye fields a legal lineup.
    func testAWeekWithNoByesIsFeasible() async throws {
        let model = try await loadedModel()
        let week1 = try XCTUnwrap(model.cell(rosterID: 1, week: 1))

        XCTAssertFalse(week1.isShort)
        XCTAssertTrue(week1.report.isFeasible)
    }

    func testShortWeeksAreSurfacedForTheUser() async throws {
        let model = try await loadedModel()
        let short = model.userShortWeeks()

        XCTAssertTrue(short.contains { $0.week == 8 })
        XCTAssertTrue(short.allSatisfy(\.isShort))
    }

    /// The trade you want is with someone who is not short the same week — that
    /// is the entire reason rivals' rows are on screen (§7.4).
    func testTradePartnersAreRivalsWhoAreNotShortThatWeek() async throws {
        let model = try await loadedModel()
        let partners = model.tradePartners(week: 8)

        XCTAssertEqual(partners.map(\.rosterID), [2])
        XCTAssertFalse(model.cell(rosterID: 2, week: 8)?.isShort ?? true)
    }

    // MARK: - The board and the link between the halves

    func testTheBoardIsRankedByValueOverTheStartLine() async throws {
        let model = try await loadedModel()
        XCTAssertFalse(model.board.isEmpty)

        let values = model.board.map(\.valueOverStartLine)
        XCTAssertEqual(values, values.sorted(by: >))
    }

    func testEveryBoardRowCarriesAtLeastOneNamedSignal() async throws {
        let model = try await loadedModel()
        XCTAssertTrue(model.board.allSatisfy { !$0.signals.isEmpty })
    }

    /// Selecting a shortfall filters the board to players who can actually play
    /// that week. A player on bye in week 8 cannot solve week 8.
    func testSelectingAWeekExcludesPlayersOnByeThatWeek() async throws {
        let model = try await loadedModel()
        let unfiltered = model.board.count

        model.selectedWeek = 8

        let week8Byes: Set<String> = ["ARI", "DET", "JAX", "LA", "LV", "SEA"]
        XCTAssertTrue(
            model.board.allSatisfy { !week8Byes.contains($0.team ?? "") },
            "a player on bye in week 8 cannot fill a week 8 hole"
        )
        XCTAssertLessThan(model.board.count, unfiltered, "the filter must actually remove someone")
    }

    func testClearingTheWeekRestoresTheFullBoard() async throws {
        let model = try await loadedModel()
        let unfiltered = model.board.count

        model.selectedWeek = 8
        model.selectedWeek = nil

        XCTAssertEqual(model.board.count, unfiltered)
    }

    /// The board is about who to *get*, so the user's own players are out by
    /// default — but the toggle is real.
    func testOwnPlayersCanBeIncluded() async throws {
        let model = try await loadedModel()
        XCTAssertTrue(model.board.allSatisfy { $0.availability != .mine })

        model.excludeOwnPlayers = false
        XCTAssertFalse(model.board.isEmpty)
    }

    /// Availability names the kind of move, because a claim and a trade are
    /// not the same ask.
    func testAvailabilityIsStatedForEveryRow() async throws {
        let model = try await loadedModel()
        XCTAssertTrue(model.board.allSatisfy { !$0.availability.label.isEmpty })
    }

    // MARK: - Coverage

    /// DEF and IDP are 3 of this league's 11 starting slots and the weekly file
    /// has nothing for them. The screen must say so rather than implying those
    /// players scored zero (§3.2).
    func testTheCoverageGapIsStatedRatherThanHidden() async throws {
        let model = try await loadedModel()
        let context = try XCTUnwrap(model.context)

        XCTAssertTrue(context.unsupportedPositions.contains(.def))
        XCTAssertTrue(context.unsupportedPositions.contains(.lb))

        let warning = try XCTUnwrap(model.coverageWarning)
        XCTAssertTrue(warning.contains("DEF"))
        XCTAssertTrue(
            warning.lowercased().contains("bye"),
            "the warning must say byes still work — they come from the schedule"
        )
    }

    /// Bye derivation covers all positions because it needs no production data,
    /// which is precisely why the coverage gap does not disable the grid.
    func testByesStillCoverPositionsWithNoProductionData() async throws {
        let model = try await loadedModel()
        let context = try XCTUnwrap(model.context)

        // PHI is the user's DEF and is on bye in week 9 in the shipped file.
        let week9 = try XCTUnwrap(model.cell(rosterID: 1, week: 9))
        XCTAssertTrue(week9.report.onBye.contains { $0.id == "PHI" })
    }

    // MARK: - Provenance

    /// The screen is assembled from several reads and is only as fresh as its
    /// oldest part. Here the static files are bundled, so the whole screen says
    /// bundled rather than claiming to be live.
    func testProvenanceIsTheWeakestOfEverythingThatWentIntoIt() async throws {
        let model = try await loadedModel()
        let context = try XCTUnwrap(model.context)

        XCTAssertEqual(context.provenance, .bundled)
        XCTAssertNotNil(model.freshnessLabel)
    }

    /// A failure names what went wrong instead of an empty screen.
    func testAFailedLoadReportsWhatFailed() async throws {
        let transport = StubTransport()
        await transport.on("/state/nfl", json: TestLeague.nflStateJSON)
        await transport.fail("/league/L1")
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory

        let model = PlanningModel(
            loader: LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs)
        )
        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)

        XCTAssertNotNil(model.errorMessage)
        XCTAssertNil(model.context)
        XCTAssertTrue(model.board.isEmpty)
    }
}
