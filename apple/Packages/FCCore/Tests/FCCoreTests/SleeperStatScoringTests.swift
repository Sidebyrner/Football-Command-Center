import XCTest
@testable import FCCore

/// Sleeper-keyed stat lines scored by dot product against a league's own
/// `scoring_settings`. The fixtures are real week-2 2026 stat lines and week-3
/// projections pulled from Sleeper, and the real Whack-A-Mole scoring map.
final class SleeperStatScoringTests: XCTestCase {
    private struct Line: Decodable {
        let playerID: String
        let stats: [String: Double]
        let player: Player?
        struct Player: Decodable {
            let firstName: String?
            let lastName: String?
            let position: String?
            enum CodingKeys: String, CodingKey {
                case firstName = "first_name", lastName = "last_name", position
            }
        }
        enum CodingKeys: String, CodingKey {
            case playerID = "player_id", stats, player
        }
        var name: String { [player?.firstName, player?.lastName].compactMap { $0 }.joined(separator: " ") }
    }

    private func lines(_ fixture: String) throws -> [Line] {
        try JSONDecoder().decode([Line].self, from: Fixtures.data(fixture))
    }

    private func leagueScoring() throws -> [String: Double] {
        try JSONDecoder().decode([String: Double].self, from: Fixtures.data("scoring-whack-a-mole.json"))
    }

    /// The gate: under Sleeper's own standard rules, the dot product must
    /// reproduce Sleeper's `pts_std` for every offensive line in the fixture.
    func testReproducesSleeperStandardPointsOnRealStatLines() throws {
        var checked = 0
        for line in try lines("stats-2026-w2.json") {
            guard let position = line.player?.position, ["QB", "RB", "WR", "TE"].contains(position),
                  let reference = line.stats["pts_std"] else { continue }
            let scored = SleeperStatScoring.score(stats: line.stats, scoring: SleeperStatScoring.sleeperStandard)
            XCTAssertEqual(scored.points, reference, accuracy: 0.011, "\(line.name) (\(position))")
            checked += 1
        }
        XCTAssertGreaterThan(checked, 40, "the fixture should carry dozens of offensive lines")
    }

    /// IDP and DEF are scored by the same arithmetic — the whole reason this
    /// engine exists. An IDP line scores from `idp_*` keys and nothing else.
    func testScoresDefensivePositionsUnderTheLeagueRules() throws {
        let scoring = try leagueScoring()
        let idp = try lines("stats-2026-w2.json").filter { ["LB", "DL", "DB"].contains($0.player?.position) }
        XCTAssertFalse(idp.isEmpty)
        var scoredThroughIDPKeys = 0
        for line in idp {
            let scored = SleeperStatScoring.score(stats: line.stats, scoring: scoring)
            for component in scored.components {
                XCTAssertNotNil(scoring[component.key], "\(line.name): \(component.key) is not a league rule")
                XCTAssertFalse(SleeperStatScoring.isNonScoringKey(component.key))
            }
            if scored.components.contains(where: { $0.key.hasPrefix("idp_") }) { scoredThroughIDPKeys += 1 }
        }
        XCTAssertGreaterThan(scoredThroughIDPKeys, 10, "most IDP lines score through idp_* keys")

        // The league pays 5 per sack and nothing per tackle — read live, never
        // the brief's assumed 1 per tackle.
        XCTAssertEqual(scoring["idp_sack"], 5)
        XCTAssertEqual(scoring["idp_tkl"], 0)
    }

    func testTeamDefenseLineScoresPointsAllowedBucket() throws {
        let scoring = try leagueScoring()
        let defenses = try lines("stats-2026-w2.json").filter { $0.player?.position == "DEF" }
        XCTAssertFalse(defenses.isEmpty)
        for line in defenses {
            let scored = SleeperStatScoring.score(stats: line.stats, scoring: scoring)
            let bucketKeys = scored.components.map(\.key).filter { $0.hasPrefix("pts_allow_") }
            XCTAssertLessThanOrEqual(bucketKeys.count, 1, "\(line.playerID): at most one points-allowed bucket fires")
        }
    }

    /// A projection is just a stat line whose units are fractional.
    func testScoresAProjectionUnderTheLeagueRulesWithABreakdown() throws {
        let scoring = try leagueScoring()
        let gibbs = try XCTUnwrap(lines("projections-2026-w3.json").first { $0.name == "Jahmyr Gibbs" })
        let scored = SleeperStatScoring.score(stats: gibbs.stats, scoring: scoring)
        XCTAssertGreaterThan(scored.points, 10)
        // Largest contribution first, and the breakdown sums to the total.
        let sum = scored.components.reduce(0) { $0 + $1.points }
        XCTAssertEqual(sum, scored.points, accuracy: 0.011)
        XCTAssertEqual(scored.components.map { abs($0.points) }, scored.components.map { abs($0.points) }.sorted(by: >))
        XCTAssertTrue(scored.components.contains { $0.key == "rush_yd" })
    }

    func testUnscoredKeysExcludeRanksTotalsAndSnaps() {
        let scored = SleeperStatScoring.score(
            stats: ["pts_std": 12, "pos_rank_ppr": 3, "off_snp": 40, "tm_off_snp": 60, "rec_tgt": 7, "rec_yd": 50, "gp": 1],
            scoring: ["rec_yd": 0.1]
        )
        XCTAssertEqual(scored.points, 5)
        XCTAssertEqual(scored.unscoredKeys, ["rec_tgt"])
    }

    func testZeroAndNonFiniteUnitsContributeNothing() {
        let scored = SleeperStatScoring.score(
            stats: ["rec_yd": 0, "rush_yd": .nan, "rec_td": 1],
            scoring: ["rec_yd": 0.1, "rush_yd": 0.1, "rec_td": 6]
        )
        XCTAssertEqual(scored.points, 6)
        XCTAssertEqual(scored.components.count, 1)
    }
}
