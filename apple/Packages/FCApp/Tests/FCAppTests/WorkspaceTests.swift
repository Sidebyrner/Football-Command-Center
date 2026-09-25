import XCTest
@testable import FCApp

final class WorkspaceGeometryTests: XCTestCase {
    private func panel(_ x: Int, _ y: Int, _ w: Int, _ h: Int, kind: PanelKind = .news) -> PanelPlacement {
        PanelPlacement(kind: kind, frame: GridRect(x: x, y: y, w: w, h: h))
    }

    func testFramesIncludeGuttersBetweenCellsOnly() {
        let cell = WorkspaceGeometry.cellWidth(containerWidth: 12 * 80 + 11 * 12)
        XCTAssertEqual(cell, 80, accuracy: 0.001)
        let frame = WorkspaceGeometry.frame(GridRect(x: 1, y: 1, w: 2, h: 2), cellWidth: cell)
        XCTAssertEqual(frame.minX, 92, accuracy: 0.001)
        XCTAssertEqual(frame.width, 172, accuracy: 0.001, "two cells and the one gutter between them")
        XCTAssertEqual(frame.minY, 108, accuracy: 0.001)
        XCTAssertEqual(frame.height, 204, accuracy: 0.001)
    }

    func testMoveSnapsToTheNearestCellAndStaysOnTheGrid() {
        let rect = GridRect(x: 2, y: 1, w: 4, h: 2)
        // Pitch is 92pt across, 108pt down; 50pt rounds to one cell, 40pt to none.
        XCTAssertEqual(WorkspaceGeometry.snappedMove(rect, by: CGSize(width: 50, height: 40), cellWidth: 80),
                       GridRect(x: 3, y: 1, w: 4, h: 2))
        XCTAssertEqual(WorkspaceGeometry.snappedMove(rect, by: CGSize(width: 5_000, height: -5_000), cellWidth: 80),
                       GridRect(x: 8, y: 0, w: 4, h: 2), "clamped to the right edge and the top")
        XCTAssertEqual(WorkspaceGeometry.snappedMove(rect, by: CGSize(width: -5_000, height: 0), cellWidth: 80).x, 0)
    }

    func testResizeNeverGoesBelowTheMinimumOrPastTheEdge() {
        let rect = GridRect(x: 8, y: 0, w: 3, h: 3)
        let min = GridSize(w: 3, h: 2)
        XCTAssertEqual(WorkspaceGeometry.snappedResize(rect, by: CGSize(width: -500, height: -500), cellWidth: 80, min: min),
                       GridRect(x: 8, y: 0, w: 3, h: 2))
        XCTAssertEqual(WorkspaceGeometry.snappedResize(rect, by: CGSize(width: 900, height: 108), cellWidth: 80, min: min),
                       GridRect(x: 8, y: 0, w: 4, h: 4))
    }

    func testFreeSpotsRespectOtherPanelsButNotThePanelBeingMoved() {
        let a = panel(0, 0, 6, 2)
        let b = panel(6, 0, 6, 2)
        XCTAssertFalse(WorkspaceGeometry.isFree(GridRect(x: 5, y: 0, w: 2, h: 1), in: [a, b]))
        XCTAssertTrue(WorkspaceGeometry.isFree(GridRect(x: 1, y: 0, w: 5, h: 2), in: [a, b], excluding: a.id))
        XCTAssertFalse(WorkspaceGeometry.isFree(GridRect(x: 11, y: 3, w: 2, h: 1), in: []), "off the right edge")
        XCTAssertEqual(WorkspaceGeometry.firstFreeSlot(size: GridSize(w: 4, h: 2), in: [a, b]), GridRect(x: 0, y: 2, w: 4, h: 2))
        XCTAssertEqual(WorkspaceGeometry.firstFreeSlot(size: GridSize(w: 4, h: 2), in: [a]), GridRect(x: 6, y: 0, w: 4, h: 2))
    }

    func testTidyUpSlidesPanelsUpWithoutOverlapAndIsStable() {
        let a = panel(0, 3, 6, 2)
        let b = panel(6, 5, 6, 2)
        let c = panel(0, 7, 12, 2)
        let tidy = WorkspaceGeometry.compacted([a, b, c])
        XCTAssertEqual(tidy.map(\.frame.y), [0, 0, 2])
        XCTAssertEqual(tidy.map(\.id), [a.id, b.id, c.id], "caller's order kept")
        XCTAssertTrue(WorkspaceGeometry.validate(tidy).isEmpty)
        XCTAssertEqual(WorkspaceGeometry.compacted(tidy), tidy, "idempotent")
    }

    func testRepairFixesOverlapsSizesAndBounds() {
        let a = panel(0, 0, 2, 1, kind: .sitStart)   // below sitStart's 4x3 minimum
        let b = panel(1, 0, 4, 2)       // overlaps a
        let c = panel(11, 0, 4, 2)      // off the edge
        XCTAssertFalse(WorkspaceGeometry.validate([a, b, c]).isEmpty)
        let repaired = WorkspaceGeometry.repaired([a, b, c])
        XCTAssertTrue(WorkspaceGeometry.validate(repaired).isEmpty)
        XCTAssertEqual(repaired[0].frame.size, PanelKind.sitStart.minSize)
    }
}

final class WorkspacePresetsTests: XCTestCase {
    func testEveryPresetIsAValidLayout() {
        for preset in WorkspacePresets.all {
            let panels = preset.panels()
            XCTAssertEqual(WorkspaceGeometry.validate(panels), [], preset.name)
            XCTAssertEqual(Set(panels.map(\.id)).count, panels.count, preset.name)
        }
    }

    func testEveryPanelKindIsInSomePreset() {
        let used = Set(WorkspacePresets.all.flatMap { $0.panels().map(\.kind) })
        XCTAssertEqual(used, Set(PanelKind.allCases))
    }

    func testEveryPanelFitsInItsDefaultSizeAndMinimum() {
        for kind in PanelKind.allCases {
            XCTAssertLessThanOrEqual(kind.minSize.w, kind.defaultSize.w, kind.title)
            XCTAssertLessThanOrEqual(kind.minSize.h, kind.defaultSize.h, kind.title)
        }
    }
}

@MainActor
final class WorkspaceStoreTests: XCTestCase {
    private var directory: URL!

    override func setUp() {
        super.setUp()
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("ws-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
        super.tearDown()
    }

    func testAFirstLaunchSeedsTheThreePresetsAndSavesThem() throws {
        let persistence = FileWorkspacePersistence(directory: directory)
        let store = WorkspaceStore(persistence: persistence)
        XCTAssertEqual(store.workspaces.map(\.name), ["Game day", "Waiver Tuesday", "Trade desk"])
        XCTAssertEqual(try persistence.load()?.workspaces.count, 3)
    }

    func testEditsSurviveARelaunch() throws {
        let persistence = FileWorkspacePersistence(directory: directory)
        let store = WorkspaceStore(persistence: persistence)
        let id = try XCTUnwrap(store.workspaces.first?.id)
        store.rename(id, to: "Sunday")
        store.update(id) { $0.panels.removeLast() }
        let added = store.addEmpty()
        store.flush()

        let reopened = WorkspaceStore(persistence: FileWorkspacePersistence(directory: directory))
        XCTAssertEqual(reopened.workspace(id: id)?.name, "Sunday")
        XCTAssertEqual(reopened.workspace(id: id)?.panels.count, WorkspacePresets.gameDay.panels().count - 1)
        XCTAssertNotNil(reopened.workspace(id: added.id))
    }

    func testDuplicateResetAndDelete() throws {
        let store = WorkspaceStore(persistence: InMemoryWorkspacePersistence())
        let original = try XCTUnwrap(store.workspaces.first)
        let copy = try XCTUnwrap(store.duplicate(original.id))
        XCTAssertEqual(copy.name, "Game day copy")
        XCTAssertTrue(Set(copy.panels.map(\.id)).isDisjoint(with: original.panels.map(\.id)))
        XCTAssertEqual(store.workspaces[1].id, copy.id, "right after the original")

        store.update(copy.id) { $0.panels = [] }
        store.resetToPreset(copy.id)
        XCTAssertEqual(store.workspace(id: copy.id)?.panels.map(\.kind), WorkspacePresets.gameDay.panels().map(\.kind))

        store.delete(copy.id)
        XCTAssertNil(store.workspace(id: copy.id))
        XCTAssertEqual(store.add(preset: WorkspacePresets.gameDay).name, "Game day 2", "names stay unique")
    }

    /// A newer app's panel kinds, a bad link colour and missing settings must
    /// not cost the rest of the library.
    func testForgivingDecode() throws {
        let json = """
        {"version": 2, "workspaces": [
          {"id": "\(UUID().uuidString)", "name": "Mine", "panels": [
            {"kind": "news", "frame": {"x": 0, "y": 0, "w": 3, "h": 2}, "linkGroup": 9},
            {"kind": "hologram", "frame": {"x": 3, "y": 0, "w": 3, "h": 2}},
            {"kind": "standings", "frame": {"x": 0, "y": 0, "w": 4, "h": 4}, "linkGroup": 2}
          ]},
          {"name": 42}
        ]}
        """
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let persistence = FileWorkspacePersistence(directory: directory)
        try Data(json.utf8).write(to: persistence.fileURL)
        let store = WorkspaceStore(persistence: persistence)
        let workspace = try XCTUnwrap(store.workspaces.first)
        XCTAssertEqual(store.workspaces.count, 2)
        XCTAssertEqual(workspace.panels.map(\.kind), [.news, .standings], "unknown kind dropped")
        XCTAssertNil(workspace.panels[0].linkGroup)
        XCTAssertEqual(workspace.panels[1].linkGroup, .two)
        XCTAssertTrue(WorkspaceGeometry.validate(workspace.panels).isEmpty, "the overlap was repaired on load")
        XCTAssertEqual(store.workspaces[1].name, "Workspace")
    }

    func testACorruptFileIsSetAsideNotLost() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let persistence = FileWorkspacePersistence(directory: directory)
        try Data("not json".utf8).write(to: persistence.fileURL)
        let store = WorkspaceStore(persistence: persistence)
        XCTAssertEqual(store.workspaces.count, 3, "presets reseeded")
        let aside = directory.appendingPathComponent("library.corrupt.json")
        XCTAssertEqual(try String(contentsOf: aside, encoding: .utf8), "not json")
    }
}

@MainActor
final class LinkBusTests: XCTestCase {
    func testGroupsAreIndependentAndChangesMerge() {
        let bus = LinkBus()
        bus.publish(.player("p1"), to: .one)
        bus.publish(.team(3), to: .one)
        bus.publish(.player("p2"), to: .two)
        XCTAssertEqual(bus.selection(for: .one), LinkedSelection(playerID: "p1", rosterID: 3))
        XCTAssertEqual(bus.selection(for: .two)?.playerID, "p2")
        XCTAssertNil(bus.selection(for: nil))
        bus.clear(.one)
        XCTAssertNil(bus.selection(for: .one))
    }

    func testRepublishingTheSameValueDoesNotNotify() {
        let bus = LinkBus()
        bus.publish(.player("p1"), to: .one)
        var fired = 0
        let token = bus.objectWillChange.sink { fired += 1 }
        bus.publish(.player("p1"), to: .one)
        XCTAssertEqual(fired, 0)
        bus.publish(.player("p9"), to: .one)
        XCTAssertEqual(fired, 1)
        token.cancel()
    }
}

@MainActor
final class AppRouterTests: XCTestCase {
    func testThePhoneNeverShowsAWorkspace() {
        let router = AppRouter(selection: .workspace(UUID()))
        XCTAssertEqual(router.phoneScreen, .dashboard)
        router.phoneScreen = .matchup
        XCTAssertEqual(router.selection, .screen(.matchup))
    }

    func testSwitchingWorkspacesLocksTheLayout() {
        let router = AppRouter()
        let a = UUID()
        router.open(workspace: a)
        router.workspaceEditing = true
        router.open(workspace: a)
        XCTAssertTrue(router.workspaceEditing, "reselecting keeps editing")
        router.open(workspace: UUID())
        XCTAssertFalse(router.workspaceEditing)
    }
}
