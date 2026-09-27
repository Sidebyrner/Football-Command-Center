import XCTest
@testable import FCCore

/// The four in-season files, decoded from the real shipped 2026 outputs of the
/// preprocess script (docs/IN_SEASON_DATA.md). Assertions are against what the
/// pipeline actually wrote, not a hand-typed fixture.
final class InSeasonFilesTests: XCTestCase {
    private func decode<Value: Decodable>(_ type: Value.Type, _ name: String) throws -> Value {
        try JSONDecoder().decode(type, from: Fixtures.data(name))
    }

    // MARK: Injuries

    func testInjuryReportDecodesDesignationsAndPracticeStatus() throws {
        let file = try decode(InjuryReportFile.self, "injuries-2026.json")
        XCTAssertEqual(file.fileMeta?.season, 2026)
        XCTAssertFalse(file.weeks.isEmpty)
        XCTAssertNotNil(file.fileMeta?.generatedAt)

        let latest = try XCTUnwrap(file.weeks.last)
        let reports = file.reports(week: latest)
        XCTAssertGreaterThan(reports.count, 100)

        // Every designation and practice value in the file is one the enum
        // knows; an unknown one would silently read as nil, so count them.
        let designated = reports.filter { $0.designation != nil }
        XCTAssertGreaterThan(designated.count, 20)
        XCTAssertTrue(reports.contains { $0.practice == .didNotParticipate })
        XCTAssertTrue(reports.contains { $0.practice == .full })
        XCTAssertTrue(reports.contains { $0.designation == .out })
        XCTAssertTrue(reports.allSatisfy { $0.position != nil }, "positions are in Sleeper's dialect")

        let byPlayer = file.reportsByPlayer(week: latest)
        XCTAssertEqual(byPlayer.count, reports.count)
        XCTAssertTrue(file.reports(week: 99).isEmpty)
    }

    func testInjuryDesignationsOrderWorstFirst() {
        XCTAssertLessThan(InjuryDesignation.out, InjuryDesignation.doubtful)
        XCTAssertLessThan(InjuryDesignation.doubtful, InjuryDesignation.questionable)
    }

    // MARK: Depth charts

    func testDepthChartsCoverEveryTeamInNflverseSpelling() throws {
        let file = try decode(DepthChartFile.self, "depth-2026.json")
        XCTAssertEqual(file.teamCount, 32)
        XCTAssertFalse(file.chart(team: "LA", position: .rb).isEmpty)
        // A Sleeper spelling is normalised at the boundary.
        XCTAssertEqual(file.chart(team: "LAR", position: .rb), file.chart(team: "LA", position: .rb))
        XCTAssertTrue(file.chart(team: nil, position: .rb).isEmpty)

        for position in Position.allCases where position != .def {
            XCTAssertFalse(file.chart(team: "KC", position: position).isEmpty, "KC has no \(position.rawValue) group")
        }
        XCTAssertEqual(file.chart(team: "KC", position: .k).count, 1)
    }

    /// Rank and "who is behind him" — the handcuff question.
    func testDepthRankAndPlayersBehind() throws {
        let file = try decode(DepthChartFile.self, "depth-2026.json")
        let backs = file.chart(team: "PIT", position: .rb)
        XCTAssertGreaterThanOrEqual(backs.count, 3)
        let starter = backs[0]
        XCTAssertEqual(file.rank(gsisID: starter, team: "PIT", position: .rb), 0)
        XCTAssertEqual(file.behind(gsisID: starter, team: "PIT", position: .rb), Array(backs.dropFirst()))
        XCTAssertNil(file.rank(gsisID: "nobody", team: "PIT", position: .rb))
        XCTAssertTrue(file.behind(gsisID: "nobody", team: "PIT", position: .rb).isEmpty)
    }

    // MARK: Usage

    func testUsageDecodesSnapsExpectedPointsAndContactStats() throws {
        let file = try decode(UsageFile.self, "usage-2026.json")
        XCTAssertGreaterThan(file.playerCount, 1_000)

        let gibbs = try XCTUnwrap(file.meta.first { $0.value.name == "Jahmyr Gibbs" }?.key)
        XCTAssertEqual(file.meta[gibbs]?.position, .rb)
        XCTAssertEqual(file.meta[gibbs]?.team, "DET")
        let weeks = file.weeks(for: gibbs)
        XCTAssertEqual(weeks.map(\.week), [1, 2])
        let week1 = weeks[0]
        XCTAssertEqual(week1.offensiveSnaps, 57)
        XCTAssertEqual(try XCTUnwrap(week1.offensiveSnapShare), 0.74, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(week1.expectedPoints), 32.96, accuracy: 0.001)
        XCTAssertEqual(week1.rushAttempts, 29)
        XCTAssertEqual(week1.targets, 5)
        XCTAssertNotNil(week1.yardsBeforeContactPerAttempt)
        XCTAssertEqual(file.recentWeeks(for: gibbs, count: 1).map(\.week), [2])
    }

    /// An IDP has defensive snaps and nothing else — every offensive column is
    /// absent, not zero.
    func testUsageKeepsAbsentSourcesAsNil() throws {
        let file = try decode(UsageFile.self, "usage-2026.json")
        let linebacker = try XCTUnwrap(file.meta.first { $0.value.position == .lb && !file.weeks(for: $0.key).isEmpty }?.key)
        let week = try XCTUnwrap(file.weeks(for: linebacker).first)
        XCTAssertNotNil(week.defensiveSnaps)
        XCTAssertNil(week.expectedPoints)
        XCTAssertNil(week.targets)
        XCTAssertTrue(file.weeks(for: "nobody").isEmpty)
    }

    // MARK: Team context

    func testTeamContextDecodesEveryTeamWeek() throws {
        let file = try decode(TeamContextFile.self, "context-2026.json")
        XCTAssertEqual(file.teamCount, 32)
        let kc = file.weeks(team: "KC")
        XCTAssertEqual(kc.map(\.week), [1, 2])
        XCTAssertEqual(kc[0].opponent, "DEN")
        XCTAssertEqual(kc[0].plays, 67)
        XCTAssertEqual(try XCTUnwrap(kc[0].pressureRate), 0.182, accuracy: 0.0005)
        XCTAssertEqual(kc[0].sacksAllowed, 2)
        XCTAssertNotNil(kc[0].qbr)
        XCTAssertNotNil(kc[0].passerRating)
        XCTAssertEqual(try XCTUnwrap(kc[0].topTargetShare), 0.24, accuracy: 0.001)
        // Sleeper's spelling resolves to the same rows.
        XCTAssertEqual(file.weeks(team: "LAR").map(\.week), file.weeks(team: "LA").map(\.week))
        XCTAssertEqual(file.allTeams().count, 32)
    }

    /// PFR publishes late: a team-week without a pfr row carries nil pressure
    /// and sacks, which is a different claim from zero pressure.
    func testTeamContextKeepsUnpublishedColumnsNil() throws {
        let file = try decode(TeamContextFile.self, "context-2026.json")
        let unpublished = file.allTeams().values.flatMap { $0 }.filter { $0.pressureRate == nil }
        XCTAssertFalse(unpublished.isEmpty, "the fixture was taken while week 2 pfr data was partial")
        for week in unpublished {
            XCTAssertNil(week.sacksAllowed)
            XCTAssertNotNil(week.plays, "plays come from nflverse and are always present")
        }
    }

    /// A column the decoder does not know is ignored; one it expects but the
    /// file lacks reads as absent, never zero (§9).
    func testTupleReaderToleratesUnknownAndMissingFields() throws {
        let json = """
        {"fields":["week","off_snp","brand_new_column"],"meta":{},"players":{"p":[[3,40,99]]}}
        """
        let file = try JSONDecoder().decode(UsageFile.self, from: Data(json.utf8))
        let week = try XCTUnwrap(file.weeks(for: "p").first)
        XCTAssertEqual(week.week, 3)
        XCTAssertEqual(week.offensiveSnaps, 40)
        XCTAssertNil(week.expectedPoints)
    }
}
