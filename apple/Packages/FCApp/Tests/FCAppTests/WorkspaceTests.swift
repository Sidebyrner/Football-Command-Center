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

    // MARK: Push and float

    private func frame(_ panels: [PanelPlacement], _ panel: PanelPlacement) -> GridRect? {
        panels.first { $0.id == panel.id }?.frame
    }

    func testWideningIntoANeighbourPushesItDownAndShrinkingFloatsItBack() {
        let a = panel(0, 0, 6, 2)
        let b = panel(6, 0, 6, 2)
        let wide = WorkspaceGeometry.layout([a, b], pinning: a.id, at: GridRect(x: 0, y: 0, w: 8, h: 2))
        XCTAssertEqual(frame(wide, a), GridRect(x: 0, y: 0, w: 8, h: 2), "the resized panel is exactly where it was put")
        XCTAssertEqual(frame(wide, b), GridRect(x: 6, y: 2, w: 6, h: 2), "the neighbour slides straight down, keeping its column")
        XCTAssertTrue(WorkspaceGeometry.validate(wide).isEmpty)

        let narrowAgain = WorkspaceGeometry.layout(wide, pinning: a.id, at: GridRect(x: 0, y: 0, w: 6, h: 2))
        XCTAssertEqual(frame(narrowAgain, b), GridRect(x: 6, y: 0, w: 6, h: 2), "room again, so it floats back up")
    }

    func testPushesChainDownTheColumn() {
        let a = panel(0, 0, 4, 2)
        let b = panel(0, 2, 4, 2)
        let c = panel(0, 4, 4, 2)
        let taller = WorkspaceGeometry.layout([a, b, c], pinning: a.id, at: GridRect(x: 0, y: 0, w: 4, h: 3))
        XCTAssertEqual(frame(taller, b)?.y, 3)
        XCTAssertEqual(frame(taller, c)?.y, 5)
        XCTAssertTrue(WorkspaceGeometry.validate(taller).isEmpty)
    }

    func testMovingOntoAPanelSwapsThemVertically() {
        let a = panel(0, 0, 6, 2)
        let b = panel(0, 2, 6, 2)
        let moved = WorkspaceGeometry.settle(WorkspaceGeometry.layout([a, b], pinning: b.id, at: GridRect(x: 0, y: 0, w: 6, h: 2)))
        XCTAssertEqual(frame(moved, b)?.y, 0)
        XCTAssertEqual(frame(moved, a)?.y, 2)
    }

    func testPanelsBesideTheChangeAreLeftAlone() {
        let a = panel(0, 0, 4, 2)
        let b = panel(4, 0, 4, 2)
        let c = panel(8, 0, 4, 4)
        let taller = WorkspaceGeometry.layout([a, b, c], pinning: a.id, at: GridRect(x: 0, y: 0, w: 4, h: 5))
        XCTAssertEqual(frame(taller, b), b.frame)
        XCTAssertEqual(frame(taller, c), c.frame)
    }

    func testAnyDragLeavesAValidLayoutAndSettlingIsStable() {
        let panels = WorkspacePresets.discovery.panels()
        for target in panels {
            for rect in [GridRect(x: 0, y: 0, w: 12, h: 3), GridRect(x: 5, y: 2, w: 7, h: 6), GridRect(x: 8, y: 20, w: 4, h: 4)] {
                let result = WorkspaceGeometry.settle(WorkspaceGeometry.layout(panels, pinning: target.id, at: rect))
                XCTAssertEqual(WorkspaceGeometry.validate(result).filter { if case .belowMinimum = $0 { return false }; return true }, [])
                XCTAssertEqual(WorkspaceGeometry.settle(result), result)
                XCTAssertEqual(result.count, panels.count)
            }
        }
    }

    func testInsertingAndAppending() {
        let a = panel(0, 0, 12, 2)
        let new = PanelPlacement(kind: .news, frame: GridRect(x: 0, y: 0, w: 1, h: 1))
        let inserted = WorkspaceGeometry.inserting(new, at: GridRect(x: 3, y: 0, w: 4, h: 2), into: [a])
        XCTAssertEqual(frame(inserted, new), GridRect(x: 3, y: 0, w: 4, h: 2))
        XCTAssertEqual(frame(inserted, a)?.y, 2, "the full-width panel moves down for the drop")

        let appended = WorkspaceGeometry.appending([.news, .standings, .injuries], into: [a], link: { _ in .one })
        XCTAssertEqual(appended.count, 4)
        XCTAssertTrue(WorkspaceGeometry.validate(appended).isEmpty)
        XCTAssertEqual(appended.last?.linkGroup, .one)
    }

    func testDropPointsMapToCells() {
        let cell: CGFloat = 80   // pitch 92 across, 108 down
        XCTAssertTrue(WorkspaceGeometry.cell(at: CGPoint(x: 0, y: 0), cellWidth: cell) == (0, 0))
        XCTAssertTrue(WorkspaceGeometry.cell(at: CGPoint(x: 91, y: 107), cellWidth: cell) == (0, 0))
        XCTAssertTrue(WorkspaceGeometry.cell(at: CGPoint(x: 92, y: 108), cellWidth: cell) == (1, 1))
        XCTAssertTrue(WorkspaceGeometry.cell(at: CGPoint(x: 5_000, y: -40), cellWidth: cell) == (11, 0), "clamped to the grid")
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

    func testAFirstLaunchSeedsThePresetsAndSavesThem() throws {
        let persistence = FileWorkspacePersistence(directory: directory)
        let store = WorkspaceStore(persistence: persistence)
        XCTAssertEqual(store.workspaces.map(\.name), ["Game day", "Waiver Tuesday", "Trade desk", "Discovery"])
        XCTAssertEqual(try persistence.load()?.workspaces.count, 4)
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
        XCTAssertEqual(store.workspaces.count, WorkspacePresets.all.count, "presets reseeded")
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

    func testCompareListsArePerGroupAndCappedAtFour() {
        let bus = LinkBus()
        for id in ["a", "b", "c", "d"] { bus.publish(.addCompare(id), to: .one) }
        var fired = 0
        let token = bus.objectWillChange.sink { fired += 1 }
        bus.publish(.addCompare("e"), to: .one)
        bus.publish(.addCompare("a"), to: .one)
        XCTAssertEqual(fired, 0, "over the cap and duplicates are no-ops")
        token.cancel()
        XCTAssertEqual(bus.compareList(for: .one), ["a", "b", "c", "d"])
        XCTAssertFalse(bus.canAddToCompare(in: .one))
        XCTAssertTrue(bus.canAddToCompare(in: .two))
        XCTAssertFalse(bus.canAddToCompare(in: nil))
        bus.publish(.removeCompare("b"), to: .one)
        XCTAssertEqual(bus.compareList(for: .one), ["a", "c", "d"])
        XCTAssertTrue(bus.isComparing("c", in: .one))
        XCTAssertFalse(bus.isComparing("c", in: .two))
        bus.publish(.player("p"), to: .one)
        XCTAssertEqual(bus.compareList(for: .one).count, 3, "selecting a player leaves the compare list alone")
        bus.publish(.clearCompare, to: .one)
        XCTAssertTrue(bus.compareList(for: .one).isEmpty)
        XCTAssertEqual(bus.selection(for: .one)?.playerID, "p")
        bus.publish(.addCompare("x"), to: .one)
        bus.clear(.one)
        XCTAssertTrue(bus.compareList(for: .one).isEmpty)
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
