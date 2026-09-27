import XCTest
@testable import FCData

/// The cache is the piece most able to fail silently, which is exactly how it
/// failed in the web app: a quota error that looked like a working cache while
/// every load re-downloaded megabytes (§3.1). These tests exist to make its
/// failures loud.
final class DiskCacheTests: XCTestCase {
    private var directory: URL!
    private var cache: DiskCache!

    override func setUp() {
        super.setUp()
        (cache, directory) = makeTemporaryCache()
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
        super.tearDown()
    }

    struct Sample: Codable, Equatable, Sendable {
        let name: String
        let count: Int
    }

    func testStoresAndReadsBack() async throws {
        let value = Sample(name: "Josh Allen", count: 2)
        try await cache.store(value, key: "sample", ttl: 60)

        let hit = await cache.load(Sample.self, key: "sample")
        XCTAssertEqual(hit?.value, value)
        XCTAssertEqual(hit?.isStale, false)
    }

    func testCreatesItsDirectoryOnFirstWrite() async throws {
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))
        try await cache.store(Sample(name: "x", count: 1), key: "sample", ttl: 60)
        XCTAssertTrue(FileManager.default.fileExists(atPath: directory.path))
    }

    func testAMissIsNil() async {
        let hit = await cache.load(Sample.self, key: "never-written")
        XCTAssertNil(hit)
    }

    /// An expired entry is withheld by default.
    func testExpiredEntryIsNotServedByDefault() async throws {
        try await cache.store(
            Sample(name: "old", count: 1),
            key: "sample",
            ttl: 60,
            now: Date().addingTimeInterval(-120)
        )
        let hit = await cache.load(Sample.self, key: "sample")
        XCTAssertNil(hit)
    }

    /// …but is available on request, flagged, which is what makes an offline
    /// launch useful rather than empty (§8.1).
    func testExpiredEntryIsServedWhenStaleIsAllowed() async throws {
        try await cache.store(
            Sample(name: "old", count: 1),
            key: "sample",
            ttl: 60,
            now: Date().addingTimeInterval(-120)
        )
        let hit = await cache.load(Sample.self, key: "sample", allowingStale: true)
        XCTAssertEqual(hit?.value.name, "old")
        XCTAssertEqual(hit?.isStale, true)
        XCTAssertGreaterThan(hit?.age ?? 0, 100)
    }

    /// A schema change must read as a miss, not a crash — the app ships new
    /// versions and old entries survive the upgrade.
    func testEntryOfTheWrongShapeIsAMissAndIsRemoved() async throws {
        try await cache.store(Sample(name: "x", count: 1), key: "sample", ttl: 60)

        struct Different: Codable, Sendable { let entirelyOther: [Int] }
        let hit = await cache.load(Different.self, key: "sample")
        XCTAssertNil(hit)

        // Removed rather than left to rot and fail again on every read.
        let stillThere = await cache.contains(key: "sample")
        XCTAssertFalse(stillThere)
    }

    func testCorruptFileIsAMissRatherThanAThrow() async throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("not json at all".utf8)
            .write(to: directory.appendingPathComponent("sample.json"))

        let hit = await cache.load(Sample.self, key: "sample")
        XCTAssertNil(hit)
    }

    func testRemoveDropsOneEntry() async throws {
        try await cache.store(Sample(name: "x", count: 1), key: "a", ttl: 60)
        try await cache.store(Sample(name: "y", count: 2), key: "b", ttl: 60)

        await cache.remove(key: "a")

        let a = await cache.load(Sample.self, key: "a")
        let b = await cache.load(Sample.self, key: "b")
        XCTAssertNil(a)
        XCTAssertEqual(b?.value.name, "y")
    }

    /// Keys become filenames. A key containing path separators must not be able
    /// to write outside the cache directory — a DEF player id is already a
    /// non-numeric string, and key shapes will keep changing.
    func testKeysCannotEscapeTheCacheDirectory() async throws {
        try await cache.store(Sample(name: "escape", count: 1), key: "../../etc/passwd", ttl: 60)

        let contents = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        XCTAssertEqual(contents.count, 1)
        XCTAssertFalse(contents[0].contains("/"))

        // And it still round-trips under its sanitised name.
        let hit = await cache.load(Sample.self, key: "../../etc/passwd")
        XCTAssertEqual(hit?.value.name, "escape")
    }

    /// Two keys differing only in characters that sanitise to the same thing
    /// would collide; this documents that team-abbreviation ids stay distinct.
    func testTeamAbbreviationKeysStayDistinct() async throws {
        try await cache.store(Sample(name: "philly", count: 1), key: "sleeper-roster-PHI", ttl: 60)
        try await cache.store(Sample(name: "dallas", count: 2), key: "sleeper-roster-DAL", ttl: 60)

        let phi = await cache.load(Sample.self, key: "sleeper-roster-PHI")
        let dal = await cache.load(Sample.self, key: "sleeper-roster-DAL")
        XCTAssertEqual(phi?.value.name, "philly")
        XCTAssertEqual(dal?.value.name, "dallas")
    }
}
