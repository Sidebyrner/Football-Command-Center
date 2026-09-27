import XCTest
import FCCore
@testable import FCApp

final class StartAvailabilityTests: XCTestCase {
    func testTheMostSevereSourceWins() {
        XCTAssertEqual(StartAvailability.evaluate(sleeperTag: nil, designation: nil, onReserve: false), .clear)
        XCTAssertEqual(StartAvailability.evaluate(sleeperTag: "Questionable", designation: nil, onReserve: false), .questionable)
        XCTAssertEqual(StartAvailability.evaluate(sleeperTag: "Questionable", designation: .doubtful, onReserve: false),
                       .unavailable("Doubtful"), "the official report downgraded him")
        XCTAssertEqual(StartAvailability.evaluate(sleeperTag: nil, designation: .out, onReserve: false), .unavailable("Out"))
        XCTAssertEqual(StartAvailability.evaluate(sleeperTag: "IR", designation: .questionable, onReserve: false), .unavailable("IR"))
        XCTAssertEqual(StartAvailability.evaluate(sleeperTag: nil, designation: .questionable, onReserve: false), .questionable)
        XCTAssertEqual(StartAvailability.evaluate(sleeperTag: nil, designation: nil, onReserve: true), .unavailable("On your IR"))
    }

    func testEveryDoNotStartTagBlocks() {
        for tag in ["Out", "Doubtful", "IR", "PUP", "PUP-R", "NFI", "Sus", "NA", "COV", "DNR"] {
            XCTAssertTrue(StartAvailability.evaluate(sleeperTag: tag, designation: nil, onReserve: false).blocksStart, tag)
        }
        XCTAssertFalse(StartAvailability.evaluate(sleeperTag: "Questionable", designation: nil, onReserve: false).blocksStart)
        XCTAssertEqual(StartAvailability.evaluate(sleeperTag: "Doubtful", designation: nil, onReserve: false).badge, "Doubtful")
        XCTAssertEqual(StartAvailability.questionable.badge, "Q")
    }
}
