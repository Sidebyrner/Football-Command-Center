import XCTest
@testable import FCCore

final class DistributionTests: XCTestCase {
    /// p20/p80 rather than min/max: one injury exit and one garbage-time
    /// touchdown should not define a player's range (§5.2).
    func testUsesP20AndP80NotMinAndMax() throws {
        let points: [Double] = [0, 10, 11, 12, 13, 14, 15, 16, 17, 60]
        let distribution = Distribution(points: points)

        XCTAssertNotEqual(distribution.floor, 0, "the blowup week must not be the floor")
        XCTAssertNotEqual(distribution.ceiling, 60, "the outlier must not be the ceiling")
        XCTAssertEqual(try XCTUnwrap(distribution.floor), 10.8, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(distribution.ceiling), 16.2, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(distribution.median), 13.5, accuracy: 0.001)
        XCTAssertEqual(distribution.sampleCount, 10)
    }

    /// The coefficient of variation is null at a near-zero mean rather than an
    /// infinity that poisons every chart axis downstream.
    func testCoefficientIsNilRatherThanInfiniteAtAZeroMean() {
        let distribution = Distribution(points: [0, 0, 0, 0])
        XCTAssertNil(distribution.coefficientOfVariation)
        XCTAssertEqual(distribution.mean, 0)
        XCTAssertEqual(distribution.standardDeviation, 0)

        let noisyAroundZero = Distribution(points: [-2, 0, 1, 0.4])
        XCTAssertNil(noisyAroundZero.coefficientOfVariation)
    }

    func testEmptyInputProducesNoClaims() {
        let distribution = Distribution(points: [])
        XCTAssertNil(distribution.floor)
        XCTAssertNil(distribution.median)
        XCTAssertNil(distribution.ceiling)
        XCTAssertNil(distribution.mean)
        XCTAssertNil(distribution.coefficientOfVariation)
        XCTAssertEqual(distribution.sampleCount, 0)
    }

    func testSingleWeekIsItsOwnFloorAndCeiling() throws {
        let distribution = Distribution(points: [18.4])
        XCTAssertEqual(try XCTUnwrap(distribution.floor), 18.4, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(distribution.ceiling), 18.4, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(distribution.standardDeviation), 0, accuracy: 0.001)
    }

    /// Against the shipped file, so the interpolation is checked on real shape
    /// rather than a tidy synthetic array.
    func testRealSeasonDistributions() throws {
        let file = try Fixtures.weekly2025()

        let allen = ScoringEngine.score(
            weeks: file.rows(for: Fixtures.Player.joshAllen),
            profile: .leagueDefault, position: .qb
        )
        let allenRange = Distribution(weeks: allen.weeks)
        XCTAssertEqual(allenRange.sampleCount, 16)
        XCTAssertEqual(try XCTUnwrap(allenRange.floor), 12.3, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(allenRange.median), 30.17, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(allenRange.ceiling), 44.55, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(allenRange.mean), 29.89, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(allenRange.standardDeviation), 17.38, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(allenRange.coefficientOfVariation), 0.58, accuracy: 0.001)

        let rodgers = ScoringEngine.score(
            weeks: file.rows(for: Fixtures.Player.aaronRodgers),
            profile: .leagueDefault, position: .qb
        )
        let rodgersRange = Distribution(weeks: rodgers.weeks)
        XCTAssertEqual(try XCTUnwrap(rodgersRange.floor), -2, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(rodgersRange.ceiling), 25.85, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(rodgersRange.coefficientOfVariation), 0.86, accuracy: 0.001)

        // Same games, and the steadier quarterback is the steadier one.
        XCTAssertEqual(rodgersRange.sampleCount, allenRange.sampleCount)
        XCTAssertGreaterThan(
            try XCTUnwrap(rodgersRange.coefficientOfVariation),
            try XCTUnwrap(allenRange.coefficientOfVariation)
        )
    }
}
