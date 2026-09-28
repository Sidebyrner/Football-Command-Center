import XCTest
import FCCore
@testable import FCApp

/// Two devices' copies of the watchlist into one.
final class WatchlistMergeTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    private func at(_ seconds: Double) -> Date { t0.addingTimeInterval(seconds) }

    private func entry(_ id: String, added: Double, updated: Double? = nil, comparing: Bool = false,
                       compared: Double? = nil, baseline: Bool = false) -> WatchlistEntry {
        WatchlistEntry(playerID: id, addedAt: at(added), updatedAt: at(updated ?? added), isComparing: comparing,
                       comparedAt: compared.map(at), isBaseline: baseline)
    }

    private func ids(_ snapshot: WatchlistSnapshot) -> [String] { snapshot.entries.map(\.playerID) }

    func testAddsOnBothDevicesAreBothKept() {
        let phone = WatchlistSnapshot(entries: [entry("a", added: 1), entry("b", added: 3)])
        let mac = WatchlistSnapshot(entries: [entry("a", added: 1), entry("c", added: 2)])
        XCTAssertEqual(ids(WatchlistMerge.merge(phone, mac, now: at(10))), ["a", "c", "b"], "in the order added")
    }

    func testARemovalBeatsAnOlderEditButLosesToALaterReAdd() {
        let removedOnMac = WatchlistSnapshot(entries: [], tombstones: ["a": at(5)])
        let editedEarlierOnPhone = WatchlistSnapshot(entries: [entry("a", added: 1, updated: 4, comparing: true, compared: 4)])
        XCTAssertEqual(ids(WatchlistMerge.merge(editedEarlierOnPhone, removedOnMac, now: at(10))), [])

        let reAddedOnPhone = WatchlistSnapshot(entries: [entry("a", added: 6)])
        let merged = WatchlistMerge.merge(reAddedOnPhone, removedOnMac, now: at(10))
        XCTAssertEqual(ids(merged), ["a"])
    }

    func testTheNewerCopyOfAnEntryWins() {
        let phone = WatchlistSnapshot(entries: [entry("a", added: 1, updated: 2, comparing: false)])
        let mac = WatchlistSnapshot(entries: [entry("a", added: 1, updated: 3, comparing: true, compared: 3)])
        XCTAssertEqual(WatchlistMerge.merge(phone, mac, now: at(10)).entries.first?.isComparing, true)
    }

    func testTwoBaselinesResolveToTheMoreRecent() {
        let phone = WatchlistSnapshot(entries: [entry("mine1", added: 1, updated: 2, comparing: true, compared: 2, baseline: true)])
        let mac = WatchlistSnapshot(entries: [entry("mine2", added: 1, updated: 5, comparing: true, compared: 5, baseline: true)])
        let merged = WatchlistMerge.merge(phone, mac, now: at(10))
        XCTAssertEqual(merged.entries.filter(\.isBaseline).map(\.playerID), ["mine2"])
    }

    func testAtMostFourComparedKeepingTheBaselineAndTheMostRecent() {
        let entries = (0..<6).map { entry("p\($0)", added: Double($0), comparing: true, compared: Double($0)) }
            + [entry("mine", added: 0.5, comparing: true, compared: 0.5, baseline: true)]
        let merged = WatchlistMerge.normalize(WatchlistSnapshot(entries: entries), now: at(10))
        XCTAssertEqual(Set(merged.entries.filter(\.isComparing).map(\.playerID)), ["mine", "p5", "p4", "p3"])
        XCTAssertEqual(merged.entries.count, 7, "un-compared, not removed")
    }

    func testAtMostTwelveOnTheListWithTheOverflowTombstoned() {
        let entries = (0..<15).map { entry("p\($0)", added: Double($0), comparing: $0 == 0, compared: $0 == 0 ? 0 : nil) }
        let merged = WatchlistMerge.normalize(WatchlistSnapshot(entries: entries), now: at(20))
        XCTAssertEqual(merged.entries.count, WatchlistMerge.capacity)
        XCTAssertTrue(ids(merged).contains("p0"), "compared players stay")
        XCTAssertFalse(ids(merged).contains("p1"), "the oldest un-compared go")
        XCTAssertNotNil(merged.tombstones["p1"], "so the other device can't bring them back")
        let again = WatchlistMerge.merge(merged, WatchlistSnapshot(entries: entries), now: at(20))
        XCTAssertEqual(ids(again), ids(merged))
    }

    func testOldTombstonesArePruned() {
        let snapshot = WatchlistSnapshot(tombstones: ["old": at(0), "new": at(40 * 24 * 3600)])
        let pruned = WatchlistMerge.normalize(snapshot, now: at(45 * 24 * 3600))
        XCTAssertEqual(Set(pruned.tombstones.keys), ["new"])
    }

    func testMergeIsCommutativeAndIdempotent() {
        let a = WatchlistSnapshot(
            entries: [entry("a", added: 1, updated: 3, comparing: true, compared: 3), entry("b", added: 2)],
            tombstones: ["z": at(4)], modifiedAt: at(4))
        let b = WatchlistSnapshot(
            entries: [entry("a", added: 1, updated: 3, comparing: false), entry("c", added: 5), entry("z", added: 2)],
            tombstones: ["b": at(1)], modifiedAt: at(5))
        let ab = WatchlistMerge.merge(a, b, now: at(10))
        XCTAssertEqual(ab, WatchlistMerge.merge(b, a, now: at(10)))
        XCTAssertEqual(WatchlistMerge.merge(ab, ab, now: at(10)), ab)
        XCTAssertEqual(ids(ab), ["a", "b", "c"], "b was added after its tombstone; z was removed after it was added")
    }

    func testSnapshotsRoundTripThroughStorage() throws {
        let snapshot = WatchlistSnapshot(entries: [entry("a", added: 1, comparing: true, compared: 1)], tombstones: ["b": at(2)], modifiedAt: at(2))
        let decoded = try XCTUnwrap(WatchlistCoding.decode(WatchlistCoding.encode(snapshot)))
        XCTAssertEqual(decoded, snapshot)
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "fcc.watchlist.tests.\(UUID().uuidString)"))
        let store = UserDefaultsWatchlistStore(defaults: defaults)
        store.save(snapshot, key: "k")
        XCTAssertEqual(store.load(key: "k"), snapshot)
    }
}

/// The watchlist model: caps, baseline, persistence, sync, and the Blue link
/// group following it.
@MainActor
final class WatchlistModelTests: XCTestCase {
    private var clock = Date(timeIntervalSince1970: 1_800_000_000)

    private func model(store: InMemoryWatchlistStore = InMemoryWatchlistStore(),
                       availability: [String: Availability] = [:]) -> WatchlistModel {
        let model = WatchlistModel(store: store, now: { [unowned self] in self.clock })
        model.availability = { availability[$0] ?? .freeAgent }
        model.setLeague("L1")
        return model
    }

    func testAddingFillsTheComparisonThenJustTheList() {
        let watchlist = model()
        for id in ["a", "b", "c", "d", "e"] { watchlist.add(id) }
        XCTAssertEqual(watchlist.ids, ["a", "b", "c", "d", "e"])
        XCTAssertEqual(watchlist.comparingIDs, ["a", "b", "c", "d"])
        XCTAssertFalse(watchlist.canCompareMore)
        watchlist.toggleCompare("e")
        XCTAssertFalse(watchlist.isComparing("e"), "four is the most")
        watchlist.toggleCompare("b")
        watchlist.toggleCompare("e")
        XCTAssertEqual(watchlist.comparingIDs, ["a", "c", "d", "e"])
    }

    func testAThirteenthDropsTheOldestNotCompared() {
        let watchlist = model()
        for index in 0..<13 { watchlist.add("p\(index)") }
        XCTAssertEqual(watchlist.entries.count, WatchlistModel.capacity)
        XCTAssertFalse(watchlist.isWatched("p4"), "p0–p3 are compared; p4 is the oldest that isn't")
        XCTAssertTrue(watchlist.isWatched("p0"))
        XCTAssertTrue(watchlist.isWatched("p12"))
    }

    func testOnlyYourOwnPlayerCanBeTheBaselineAndHeGoesFirst() {
        let watchlist = model(availability: ["mine": .mine, "rival": .rivalBench(rosterID: 2, manager: "Mike")])
        for id in ["a", "b", "c", "d"] { watchlist.add(id) }
        XCTAssertFalse(watchlist.setBaseline("rival"))
        XCTAssertFalse(watchlist.setBaseline("a"), "a free agent isn't yours")
        XCTAssertTrue(watchlist.setBaseline("mine"))
        XCTAssertEqual(watchlist.baselineID, "mine")
        XCTAssertEqual(watchlist.comparingIDs, ["mine", "b", "c", "d"], "first, taking the longest-compared player's column")
        watchlist.toggleCompare("mine")
        XCTAssertNil(watchlist.baselineID, "out of the comparison, no longer the baseline")
    }

    func testAClaimedTargetStaysAndIsMarked() {
        var availability: [String: Availability] = [:]
        let watchlist = WatchlistModel(store: InMemoryWatchlistStore(), now: { [unowned self] in self.clock })
        watchlist.availability = { availability[$0] ?? .freeAgent }
        watchlist.add("target")
        XCTAssertFalse(watchlist.wasClaimed("target"))
        availability["target"] = .rivalBench(rosterID: 2, manager: "Mike")
        XCTAssertTrue(watchlist.isWatched("target"))
        XCTAssertTrue(watchlist.wasClaimed("target"))
    }

    func testTheListOutlivesTheModelAndIsPerLeague() {
        let store = InMemoryWatchlistStore()
        let first = model(store: store)
        first.add("a")
        first.add("b")
        first.remove("a")
        let second = model(store: store)
        XCTAssertEqual(second.ids, ["b"])
        second.setLeague("L2")
        XCTAssertEqual(second.ids, [])
        second.setLeague("L1")
        XCTAssertEqual(second.ids, ["b"])
    }

    func testAChangeFromTheOtherDeviceIsMergedIn() async {
        let store = InMemoryWatchlistStore()
        let watchlist = model(store: store)
        watchlist.add("phone")
        clock = clock.addingTimeInterval(60)
        var remote = store.load(key: WatchlistModel.key(leagueID: "L1")) ?? .empty
        remote.entries.append(WatchlistEntry(playerID: "mac", addedAt: clock))
        store.simulateRemote(remote, key: WatchlistModel.key(leagueID: "L1"))
        for _ in 0..<20 where !watchlist.isWatched("mac") { await Task.yield() }
        XCTAssertEqual(watchlist.ids, ["phone", "mac"])
    }

    func testTheBlueGroupFollowsTheWatchlistAndTheOthersDont() {
        let watchlist = model()
        let bus = LinkBus()
        bus.watchlist = watchlist
        watchlist.onCompareChange = { [weak bus] in bus?.mirrorCompare($0, in: LinkBus.watchlistGroup) }

        bus.publish(.addCompare("a"), to: .one)
        bus.publish(.addCompare("b"), to: .one)
        XCTAssertEqual(watchlist.comparingIDs, ["a", "b"])
        XCTAssertEqual(bus.compareList(for: .one), ["a", "b"])

        bus.publish(.removeCompare("a"), to: .one)
        XCTAssertEqual(bus.compareList(for: .one), ["b"])
        XCTAssertTrue(watchlist.isWatched("a"), "out of the comparison, still on the list")

        watchlist.add("c")
        XCTAssertEqual(bus.compareList(for: .one), ["b", "c"], "a change made on the watchlist reaches the group")

        bus.publish(.addCompare("x"), to: .two)
        XCTAssertEqual(bus.compareList(for: .two), ["x"])
        XCTAssertFalse(watchlist.isWatched("x"), "other colours are scratch lists")

        bus.publish(.clearCompare, to: .one)
        XCTAssertEqual(bus.compareList(for: .one), [])
        XCTAssertEqual(watchlist.ids, ["a", "b", "c"])
    }

    func testAppServicesWiresTheWatchlistToTheLeague() async throws {
        let (services, directory) = try await WorkspaceFixture.services()
        defer { try? FileManager.default.removeItem(at: directory) }
        services.linkBus.publish(.addCompare(WorkspaceFixture.henderson), to: .one)
        XCTAssertEqual(services.watchlist.comparingIDs, [WorkspaceFixture.henderson])
        XCTAssertEqual(services.watchlist.entry(WorkspaceFixture.henderson)?.availabilityWhenAdded, "freeAgent")
        XCTAssertTrue(services.watchlist.setBaseline(WorkspaceFixture.cook), "Cook is on my roster")
        XCTAssertFalse(services.watchlist.setBaseline(WorkspaceFixture.gibbs), "Gibbs is the rival's")
        XCTAssertEqual(services.linkBus.compareList(for: .one), [WorkspaceFixture.cook, WorkspaceFixture.henderson])
    }
}
