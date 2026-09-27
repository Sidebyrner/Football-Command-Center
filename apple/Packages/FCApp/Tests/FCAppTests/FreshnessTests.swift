import XCTest
import FCData
@testable import FCApp

/// Freshness is a claim the UI makes, so its wording is worth pinning down.
final class FreshnessTests: XCTestCase {
    func testLiveDataOwesNoLabel() {
        XCTAssertNil(Freshness.label(for: .live))
        XCTAssertNil(Freshness.explanation(for: .live))
        XCTAssertFalse(Freshness.isDegraded(.live))
    }

    func testCachedDataSaysWhenItWasFetched() {
        XCTAssertEqual(Freshness.label(for: .cached(age: 30)), "Updated just now")
        XCTAssertEqual(Freshness.label(for: .cached(age: 600)), "Updated 10 minutes ago")
        XCTAssertEqual(Freshness.label(for: .cached(age: 7_200)), "Updated 2 hours ago")
        XCTAssertEqual(Freshness.label(for: .cached(age: 172_800)), "Updated 2 days ago")
    }

    func testSingularAndPluralAgree() {
        XCTAssertEqual(Freshness.label(for: .cached(age: 3_600)), "Updated 1 hour ago")
        XCTAssertEqual(Freshness.label(for: .cached(age: 86_400)), "Updated 1 day ago")
    }

    /// Stale data is the offline case and must read as such — never as current.
    func testStaleDataSaysItIsOffline() {
        let label = Freshness.label(for: .staleCache(age: 7_200, failure: "offline"))
        XCTAssertEqual(label, "Offline — showing data from 2 hours ago")
        XCTAssertTrue(Freshness.isDegraded(.staleCache(age: 1, failure: "x")))
    }

    /// Labelled, but not as a warning: bundled stats are the normal state until
    /// a static-data host exists.
    func testBundledDataSaysWhereItCameFromWithoutAlarm() {
        XCTAssertEqual(Freshness.label(for: .bundled), "Shipped with the app")
        XCTAssertFalse(Freshness.isDegraded(.bundled))
    }

    /// A screen assembled from several reads is only as fresh as its oldest
    /// part; claiming otherwise would overstate it.
    func testWeakestProvenanceWins() {
        XCTAssertEqual(Provenance.weakest([.live, .live]), .live)
        XCTAssertEqual(Provenance.weakest([.live, .cached(age: 10)]), .cached(age: 10))
        XCTAssertEqual(Provenance.weakest([.cached(age: 10), .bundled]), .bundled)

        let stale = Provenance.staleCache(age: 10, failure: "offline")
        XCTAssertEqual(Provenance.weakest([.live, .bundled, stale]), stale)
    }

    func testWeakestOfNothingIsLive() {
        XCTAssertEqual(Provenance.weakest([]), .live)
    }

    func testNegativeAgesDoNotProduceNonsense() {
        XCTAssertEqual(Freshness.label(for: .cached(age: -5)), "Updated just now")
    }
}
