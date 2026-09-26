import XCTest
import SwiftUI
@testable import FCApp

/// Every Board tile drawn with the fixture league at iPhone width — live
/// game, a final and a game before kickoff in the scores feed — so a tile
/// that crashes or collapses when real data arrives is caught here.
@MainActor
final class BoardRenderTests: XCTestCase {
    static let phoneWidth: CGFloat = 390

    static func board(_ services: AppServices, tiles: [BoardTile] = BoardLayout.standard.visible) -> some View {
        BoardGrid(tiles: tiles) { BoardTileView(tile: $0, services: services) }
            .padding()
            .frame(width: phoneWidth)
            .environment(\.appServices, services)
            .environmentObject(services.linkBus)
    }

    func testEveryTileRendersWithTheFixtureLeague() async throws {
        let (services, directory) = try await WorkspaceFixture.services()
        defer { try? FileManager.default.removeItem(at: directory) }
        for tile in BoardTile.allCases {
            let renderer = ImageRenderer(content: Self.board(services, tiles: [tile]))
            let image = try XCTUnwrap(renderer.cgImage, "\(tile) failed to render")
            XCTAssertGreaterThan(image.height, 60, "\(tile) collapsed")
        }
        let whole = try XCTUnwrap(ImageRenderer(content: Self.board(services)).cgImage)
        XCTAssertGreaterThan(whole.height, 900, "the standard Board draws every tile")
    }
}
