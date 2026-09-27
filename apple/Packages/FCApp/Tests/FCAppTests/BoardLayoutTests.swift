import XCTest
@testable import FCApp

/// The Board's saved tile list: order, hidden tiles, and what happens as the
/// catalog changes between versions.
final class BoardLayoutTests: XCTestCase {
    func testUnsetIsTheStandardLayoutWithEveryTile() {
        let layout = BoardLayout.decode(nil)
        XCTAssertEqual(layout, .standard)
        XCTAssertEqual(Set(layout.order), Set(BoardTile.allCases), "every tile is in the standard layout")
        XCTAssertEqual(layout.visible.first, .liveMatchup)
    }

    func testRoundTripsOrderAndHidden() {
        var layout = BoardLayout.standard
        layout.order.swapAt(0, 3)
        layout.hidden = [.news, .byeWeeks]
        let back = BoardLayout.decode(layout.encoded)
        XCTAssertEqual(back, layout)
        XCTAssertFalse(back.visible.contains(.news))
        XCTAssertTrue(layout.encoded.contains("-news"))
    }

    func testUnknownTilesDropAndNewOnesAppendShown() {
        let layout = BoardLayout.decode("injuries,retired,-games,injuries")
        XCTAssertEqual(Array(layout.order.prefix(2)), [.injuries, .games])
        XCTAssertEqual(layout.hidden, [.games])
        XCTAssertEqual(Set(layout.order), Set(BoardTile.allCases), "tiles it didn't know about come back")
        XCTAssertEqual(layout.order.count, BoardTile.allCases.count, "no duplicates")
        XCTAssertTrue(layout.visible.contains(.liveMatchup))
    }

    func testHalfTilesPairAndFullTilesSpan() {
        let rows = BoardLayout.rows([.readiness, .liveMatchup, .injuries, .topPickup, .standings])
        XCTAssertEqual(rows, [[.readiness], [.liveMatchup], [.injuries, .topPickup], [.standings]])
    }

    func testEveryTileOpensAScreenOnThePhone() {
        for tile in BoardTile.allCases {
            XCTAssertNotEqual(PhoneHub.hub(for: tile.destination), .board, "\(tile) opens somewhere else")
        }
    }
}
