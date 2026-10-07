import XCTest
import FCCore
@testable import FCApp

/// The Lineup tab's status cards and the Injuries screen's groups.
@MainActor
final class LineupHubTests: XCTestCase {
    func testSitStartCard() {
        XCTAssertEqual(LineupStatus.sitStart(swaps: 0), .init(text: "Lineup set", tone: .good))
        XCTAssertEqual(LineupStatus.sitStart(swaps: 1).text, "1 swap")
        XCTAssertEqual(LineupStatus.sitStart(swaps: 3), .init(text: "3 swaps", tone: .caution))
    }

    func testMatchupCardShowsTheScoreOnceThereIsOneElseTheNextKickoff() {
        let live = LineupStatus.matchup(mine: 24.6, theirs: 31.2, live: true, nextKickoff: nil)
        XCTAssertEqual(live.text, "24.6–31.2")
        XCTAssertEqual(live.tone, .bad)
        XCTAssertTrue(live.isLive)
        XCTAssertEqual(LineupStatus.matchup(mine: 40, theirs: 12, live: false, nextKickoff: nil).tone, .good)
        let kickoff = Date(timeIntervalSince1970: 1_790_528_400)
        let before = LineupStatus.matchup(mine: 0, theirs: 0, live: false, nextKickoff: kickoff)
        XCTAssertEqual(before.text, LockCountdown.kickoffLabel(kickoff), "0–0 before kickoff reads as the kickoff time")
        XCTAssertEqual(LineupStatus.matchup(mine: nil, theirs: nil, live: false, nextKickoff: nil).text, "This week")
    }

    func testInjuriesCard() {
        XCTAssertEqual(LineupStatus.injuries(out: 2, questionable: 1), .init(text: "2 out", tone: .bad))
        XCTAssertEqual(LineupStatus.injuries(out: 0, questionable: 1), .init(text: "1 Q", tone: .caution))
        XCTAssertEqual(LineupStatus.injuries(out: 0, questionable: 0), .init(text: "All clear", tone: .good))
    }

    func testDecideCard() {
        XCTAssertEqual(LineupStatus.decide(closeCalls: 0), .init(text: "All clear", tone: .good))
        XCTAssertEqual(LineupStatus.decide(closeCalls: 2), .init(text: "2 close", tone: .caution))
    }

    func testRuledOutStartersActNowEveryoneElseIsWatched() async throws {
        let (services, directory) = try await WorkspaceFixture.services()
        defer { try? FileManager.default.removeItem(at: directory) }
        let model = services.injuries
        let context = try XCTUnwrap(model.context)
        let groups = InjuryGroups(roster: model.roster, context: context)
        XCTAssertEqual(groups.actNow.count + groups.watch.count, model.roster.count, "nobody dropped")
        XCTAssertTrue(groups.actNow.allSatisfy { $0.isStarter && StartAvailability.of($0.id, context: context).blocksStart })
        XCTAssertFalse(groups.watch.contains { $0.isStarter && StartAvailability.of($0.id, context: context).blocksStart })
        let order = model.roster.map(\.id)
        XCTAssertEqual(groups.watch.map(\.id), order.filter { id in groups.watch.contains { $0.id == id } }, "worst-first kept")
    }
}
