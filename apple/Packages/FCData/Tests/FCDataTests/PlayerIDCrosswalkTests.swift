import XCTest
import FCCore
@testable import FCData

/// The crosswalk is where the three position dialects meet, and §3.2 records
/// that getting it wrong cost real debugging time in the web app as recently as
/// the last session. Every test here asserts against the **real** shipped
/// `player-ids.json`, because a mock would simply have spoken whichever dialect
/// the author had in mind.
final class PlayerIDCrosswalkTests: XCTestCase {
    private func crosswalk() throws -> PlayerIDCrosswalk {
        try JSONDecoder().decode(PlayerIDCrosswalk.self, from: Fixtures.data("player-ids"))
    }

    func testDecodesTheShippedFile() throws {
        let file = try crosswalk()
        XCTAssertGreaterThan(file.players.count, 5_000)
    }

    /// Trap 1: kickers are `PK` here, not `K`.
    func testKickersAreSpelledPKAndTranslateToK() throws {
        let file = try crosswalk()
        let rawKickers = file.players.values.filter { $0.positionCode == "PK" }
        XCTAssertGreaterThan(rawKickers.count, 50, "the file should carry PK kickers")

        // Nothing is spelled the Sleeper way.
        XCTAssertTrue(file.players.values.allSatisfy { $0.positionCode != "K" })

        // But every one of them reads as a kicker once translated.
        XCTAssertTrue(rawKickers.allSatisfy { $0.position == .k })
    }

    /// Trap 2: there are **zero** DEF entries. A caller must not expect one.
    func testThereAreNoTeamDefences() throws {
        let file = try crosswalk()
        XCTAssertTrue(file.players.values.allSatisfy { $0.positionCode != "DEF" })
        XCTAssertTrue(file.players.values.allSatisfy { $0.position != .def })
    }

    /// Trap 3: IDP is spelled `CB`/`S`/`DE`/`DT`, and must collapse to the
    /// app's `DB`/`DL`.
    func testIDPDialectCollapsesToTheAppsPositions() throws {
        let file = try crosswalk()

        let backs = file.players.values.filter { ["CB", "S"].contains($0.positionCode ?? "") }
        let linemen = file.players.values.filter { ["DE", "DT"].contains($0.positionCode ?? "") }
        XCTAssertGreaterThan(backs.count, 100)
        XCTAssertGreaterThan(linemen.count, 100)

        XCTAssertTrue(backs.allSatisfy { $0.position == .db })
        XCTAssertTrue(linemen.allSatisfy { $0.position == .dl })
    }

    /// Punters and the file's `XX` placeholder are positions this app does not
    /// model. `nil` is the honest answer; guessing would put a punter in a flex.
    func testUnmodelledPositionsTranslateToNil() throws {
        let file = try crosswalk()
        let punters = file.players.values.filter { $0.positionCode == "PN" }
        XCTAssertGreaterThan(punters.count, 0, "the file should carry punters")
        XCTAssertTrue(punters.allSatisfy { $0.position == nil })
    }

    func testResolvesASleeperIDToAGSISID() throws {
        let file = try crosswalk()
        let withGSIS = file.players.first { $0.value.gsisId != nil }
        let sleeperID = try XCTUnwrap(withGSIS?.key)
        XCTAssertEqual(file.gsisID(forSleeperID: sleeperID), withGSIS?.value.gsisId)
    }

    /// A team defense resolving to nothing is routine, not a bug — and the
    /// resolution reports it rather than dropping it, because the UI has to be
    /// able to say the coverage gap out loud (§3.2).
    func testATeamDefenceIsReportedUnmatchedRatherThanDropped() throws {
        let file = try crosswalk()
        let realPlayer = try XCTUnwrap(file.players.first { $0.value.gsisId != nil }?.key)

        let resolution = file.resolve(sleeperIDs: [realPlayer, "PHI", "SF"])

        XCTAssertEqual(resolution.matchedCount, 1)
        XCTAssertEqual(Set(resolution.unmatched), ["PHI", "SF"])
    }

    func testReverseLookupRoundTrips() throws {
        let file = try crosswalk()
        let reverse = file.sleeperIDsByGSIS()
        let sample = try XCTUnwrap(file.players.first { $0.value.gsisId != nil })
        let gsis = try XCTUnwrap(sample.value.gsisId)
        XCTAssertEqual(reverse[gsis], sample.key)
    }

    /// The weekly and schedule files speak nflverse's team spelling, so the
    /// crosswalk has to hand back that one, not Sleeper's (§5.6).
    func testTeamIsNormalisedForJoiningAgainstTheStaticFiles() throws {
        let file = try crosswalk()
        let rams = file.players.values.filter { $0.team == "LAR" }
        if rams.isEmpty {
            throw XCTSkip("no LAR rows in this export")
        }
        XCTAssertTrue(rams.allSatisfy { $0.nflverseTeam == "LA" })
    }

    /// The file's own team dialect: every team code it uses must translate to
    /// one of the 32 codes the schedule actually contains, or bye detection
    /// silently fails for that team.
    func testEveryTeamCodeTranslatesToAScheduleTeam() throws {
        let file = try crosswalk()
        let schedule = try JSONDecoder().decode(ScheduleFile.self, from: Fixtures.data("schedule-2025"))
        let scheduleTeams = Set(schedule.byWeek.values.flatMap { $0.flatMap { [$0.home, $0.away] } }.compactMap { $0 })
        XCTAssertEqual(scheduleTeams.count, 32)

        let untranslated = Set(
            file.players.values
                .filter { !$0.isFreeAgent && $0.team != "FA*" && $0.team != nil }
                .compactMap(\.nflverseTeam)
                .filter { !scheduleTeams.contains($0) }
        )
        XCTAssertTrue(untranslated.isEmpty, "untranslated team codes: \(untranslated.sorted())")
    }

    func testKansasCityIsNotLeftAsKCC() throws {
        let file = try crosswalk()
        let chiefs = file.players.values.filter { $0.team == "KCC" }
        XCTAssertFalse(chiefs.isEmpty)
        XCTAssertTrue(chiefs.allSatisfy { $0.nflverseTeam == "KC" })
    }

    func testFreeAgentsAreFlagged() throws {
        let file = try crosswalk()
        let freeAgents = file.players.values.filter { $0.team == "FA" }
        XCTAssertGreaterThan(freeAgents.count, 0)
        XCTAssertTrue(freeAgents.allSatisfy(\.isFreeAgent))
    }
}
