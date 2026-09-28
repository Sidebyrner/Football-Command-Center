import XCTest
import SwiftUI
import ImageIO
@testable import FCApp

/// The Discovery preset drawn whole — list, profile, schedule, trend chart,
/// news, game log and a three-player compare with its charts — at desktop
/// width. Catches a panel that crashes or collapses when real data arrives.
@MainActor
final class DiscoveryRenderTests: XCTestCase {
    func testTheDiscoveryWorkspaceRendersWithALinkedPlayerAndACompare() async throws {
        let (services, directory) = try await WorkspaceFixture.services()
        defer { try? FileManager.default.removeItem(at: directory) }
        services.linkBus.publish(.player(WorkspaceFixture.cook), to: .one)
        for id in [WorkspaceFixture.cook, WorkspaceFixture.gibbs, WorkspaceFixture.henderson] {
            services.linkBus.publish(.addCompare(id), to: .one)
        }
        let workspace = WorkspacePresets.discovery.makeWorkspace()
        let width: CGFloat = 1180
        let view = WorkspaceGridView(workspace: workspace, editing: false, services: services,
                                     selectedPanelID: .constant(nil), onUpdate: { _ in })
            .environment(\.workspaceStaticWidth, width)
            .environment(\.appServices, services)
            .environmentObject(services.linkBus)
            .frame(width: width)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 1
        let image = try XCTUnwrap(renderer.cgImage)
        XCTAssertEqual(image.width, Int(width))
        XCTAssertGreaterThan(image.height, 1_000, "all thirteen rows of the preset are drawn")
    }

    func testEveryPanelKindRendersAtItsMinimumSize() async throws {
        let (services, directory) = try await WorkspaceFixture.services()
        defer { try? FileManager.default.removeItem(at: directory) }
        services.linkBus.publish(.player(WorkspaceFixture.henderson), to: .one)
        services.linkBus.publish(.addCompare(WorkspaceFixture.henderson), to: .one)
        for kind in PanelKind.allCases {
            let frame = GridRect(x: 0, y: 0, w: kind.minSize.w, h: kind.minSize.h)
            let workspace = Workspace(name: kind.title, panels: [PanelPlacement(kind: kind, frame: frame, linkGroup: .one)])
            let view = WorkspaceGridView(workspace: workspace, editing: false, services: services,
                                         selectedPanelID: .constant(nil), onUpdate: { _ in })
                .environment(\.workspaceStaticWidth, 1180)
                .environment(\.appServices, services)
                .environmentObject(services.linkBus)
                .frame(width: 1180)
            XCTAssertNotNil(ImageRenderer(content: view).cgImage, "\(kind.title) failed to render")
        }
    }

    /// A Compare panel holding every section card, for four players at four
    /// positions. Set FCC_RENDER_DIR to keep the image for a look.
    func testCompareRendersEverySectionCardAcrossPositions() async throws {
        let (services, directory) = try await WorkspaceFixture.services()
        defer { try? FileManager.default.removeItem(at: directory) }
        for id in [WorkspaceFixture.cook, WorkspaceFixture.jsn, WorkspaceFixture.mahomes, WorkspaceFixture.bolton] {
            services.linkBus.publish(.addCompare(id), to: .one)
        }
        var settings = PanelSettings()
        let cards = [CompareCardSpec.trend(TrendChartSpec(metric: .fantasyPoints))]
            + CompareCardSpec.Section.allCases.map(CompareCardSpec.section)
        settings.extra["charts"] = CompareCardSpec.encode(cards)
        let placement = PanelPlacement(kind: .compare, frame: GridRect(x: 0, y: 0, w: 12, h: 40), linkGroup: .one, settings: settings)
        let width: CGFloat = 1180
        let view = WorkspaceGridView(workspace: Workspace(name: "Compare", panels: [placement]), editing: false, services: services,
                                     selectedPanelID: .constant(nil), onUpdate: { _ in })
            .environment(\.workspaceStaticWidth, width)
            .environment(\.appServices, services)
            .environmentObject(services.linkBus)
            .frame(width: width)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 1
        let image = try XCTUnwrap(renderer.cgImage)
        XCTAssertEqual(image.width, Int(width))
        if let dir = ProcessInfo.processInfo.environment["FCC_RENDER_DIR"] {
            let url = URL(fileURLWithPath: dir).appendingPathComponent("compare-cards.png")
            let destination = try XCTUnwrap(CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil))
            CGImageDestinationAddImage(destination, image, nil)
            XCTAssertTrue(CGImageDestinationFinalize(destination))
        }
    }
}
