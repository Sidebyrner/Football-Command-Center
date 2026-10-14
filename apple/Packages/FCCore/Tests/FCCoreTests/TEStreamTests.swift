import XCTest
@testable import FCCore

/// The TE engine has no reference implementation, so it is pinned two ways:
/// a fixture computed by an independent re-implementation of its formulas
/// (seven tight ends covering every role and branch, two scorings), and
/// hand-checked properties of the model.
final class TEStreamTests: XCTestCase {
    private struct CandidatesFile: Decodable {
        let candidates: [TECandidate]
    }

    private func candidates() throws -> [TECandidate] {
        try JSONDecoder().decode(CandidatesFile.self, from: Fixtures.data("te-stream/candidates.json")).candidates
    }

    private func reference() throws -> [String: Any] {
        try XCTUnwrap(try JSONSerialization.jsonObject(with: Fixtures.data("te-stream/projections.json")) as? [String: Any])
    }

    private func scoring(_ name: String) throws -> TEScoring {
        let scorings = try XCTUnwrap(try reference()["scorings"] as? [String: Any])
        let data = try JSONSerialization.data(withJSONObject: try XCTUnwrap(scorings[name]))
        return try JSONDecoder().decode(TEScoring.self, from: data)
    }

    func testMatchesIndependentProjectionsUnderBothScorings() throws {
        let all = try candidates()
        XCTAssertEqual(all.count, 7)
        let projections = try XCTUnwrap(try reference()["projections"] as? [String: [[String: Any]]])
        for name in ["league", "tePremium"] {
            let s = try scoring(name)
            let rows = try XCTUnwrap(projections[name])
            XCTAssertEqual(rows.count, all.count)
            for (c, ref) in zip(all, rows) {
                let p = TEStreamEngine.project(c, scoring: s)
                XCTAssertEqual(p.name, ref["name"] as? String)
                func check(_ key: String, _ value: Double?, line: UInt = #line) {
                    if ref[key] is NSNull { return XCTAssertNil(value, "\(name) \(p.name) \(key)", line: line) }
                    guard let expected = ref[key] as? Double, let value else {
                        return XCTFail("\(name) \(p.name): no \(key)", line: line)
                    }
                    XCTAssertEqual(value, expected, accuracy: 1e-9, "\(name) \(p.name) \(key)", line: line)
                }
                check("expPassAttempts", p.expPassAttempts)
                check("envMult", p.envMult)
                check("estRouteShare", p.estRouteShare)
                check("targetShare", p.targetShare)
                check("expTargets", p.expTargets)
                check("dvpMult", p.dvpMult)
                check("coverageMult", p.coverageMult)
                check("redZoneMult", p.redZoneMult)
                check("eRec", p.eRec)
                check("eRecYd", p.eRecYd)
                check("eFirstDowns", p.eFirstDowns)
                check("eTouchdowns", p.eTouchdowns)
                check("e30", p.e30)
                check("e40", p.e40)
                check("e50", p.e50)
                check("eTouchdowns40", p.eTouchdowns40)
                check("eTouchdowns50", p.eTouchdowns50)
                check("meanIfPlays", p.meanIfPlays)
                check("sdIfPlays", p.sdIfPlays)
                check("pPlay", p.pPlay)
                check("expPts", p.expPts)
                check("floorP25", p.floorP25)
                check("ceilingP75", p.ceilingP75)
                check("utility", p.utility)
            }
        }
    }

    func testBreakdownSumsToMean() throws {
        for name in ["league", "tePremium"] {
            let s = try scoring(name)
            for c in try candidates() {
                let p = TEStreamEngine.project(c, scoring: s)
                let total = p.pointsBreakdown(scoring: s).reduce(0) { $0 + $1.points }
                XCTAssertEqual(total, p.meanIfPlays, accuracy: 1e-9, "\(name) \(p.name)")
            }
        }
    }

    func testTEPremiumAddsExactlyPremiumTimesEvents() throws {
        let c = try candidates()[0]
        let plain = TEScoring.referenceDefaults
        var premium = plain
        premium.premiumReception = 0.5
        premium.premiumFirstDown = 0.25
        let a = TEStreamEngine.project(c, scoring: plain)
        let b = TEStreamEngine.project(c, scoring: premium)
        XCTAssertEqual(b.meanIfPlays - a.meanIfPlays, 0.5 * a.eRec + 0.25 * a.eFirstDowns, accuracy: 1e-9)
        XCTAssertTrue(b.pointsBreakdown(scoring: premium).contains { $0.stat == "TE premium" })
        XCTAssertFalse(a.pointsBreakdown(scoring: plain).contains { $0.stat == "TE premium" })
    }

    func testSleeperScoringReadsPremiumKeysAndStacksTiers() {
        let s = TEScoring.from(sleeperSettings: [
            "rec": 0.5, "rec_yd": 0.1, "rec_fd": 1, "rec_td": 6, "rec_30_39": 1, "rec_40p": 2,
            "bonus_rec_te": 0.5, "bonus_fd_te": 0.5, "rec_2pt": 2, "bonus_rec_yd_200": 5, "bonus_rec_wr": 1,
        ])
        XCTAssertEqual(s.premiumReception, 0.5)
        XCTAssertEqual(s.premiumFirstDown, 0.5)
        XCTAssertEqual(s.bonus30, 1)
        XCTAssertEqual(s.bonus40, 1)
        XCTAssertEqual(TEScoring.unmodelledKeys(sleeperSettings: [
            "bonus_rec_te": 0.5, "rec_2pt": 2, "bonus_rec_yd_200": 5, "bonus_rec_wr": 1, "rec_fd": 1,
        ]), ["bonus_rec_yd_200", "rec_2pt"])
    }

    /// Two tight ends with the same snaps and share: the one who blocks on
    /// more of them runs fewer routes, so his share is pulled lower.
    func testRouteProxyDependsOnRole() throws {
        var mover = try candidates()[0]
        mover.roleConf = 0.5
        var blocker = mover
        blocker.role = .rotational
        let moverRoutes = try XCTUnwrap(TEStreamEngine.estimatedRouteShare(mover))
        let blockerRoutes = try XCTUnwrap(TEStreamEngine.estimatedRouteShare(blocker))
        XCTAssertEqual(moverRoutes, 0.82 * 0.85, accuracy: 1e-12)
        XCTAssertEqual(blockerRoutes, 0.82 * 0.55, accuracy: 1e-12)
        XCTAssertGreaterThan(TEStreamEngine.projectedTargetShare(mover), TEStreamEngine.projectedTargetShare(blocker))
    }

    /// Three TDs on nine targets is a 33% rate; the model keeps it near the prior.
    func testTouchdownStreakIsRegressed() throws {
        let goalLine = try candidates()[3]
        let rates = TEStreamEngine.conversionRates(goalLine, TEStreamPriors.prior(for: .redZone))
        XCTAssertEqual(rates.touchdowns, (9.0 / 169) * (3.0 / 9) + (160.0 / 169) * 0.095, accuracy: 1e-12)
        XCTAssertLessThan(rates.touchdowns, 0.12)
        XCTAssertTrue(TEStreamEngine.project(goalLine, scoring: .referenceDefaults).flags
            .contains("TD rate well above norm — regressed"))
    }

    func testMatchupAndBoostCaps() throws {
        let all = try candidates()
        // Goal Line Blocker: DvP +30% over 3 games → w·30% = 10% (under the cap);
        // seam coverage 1.5 caps at +30%; red-zone share 33% caps at +70%.
        let m = TEStreamEngine.matchupMultipliers(all[3])
        XCTAssertEqual(m.dvp, 1 + 0.3 * 3 / 9, accuracy: 1e-12)
        XCTAssertEqual(m.coverage, 1.3, accuracy: 1e-12)
        XCTAssertEqual(m.redZone, 1.7, accuracy: 1e-12)
        // Committee TE2: a 0.20 vacated boost is capped at 0.10.
        let committee = all[4]
        var unboosted = committee
        unboosted.vacatedTargetBoost = 0
        XCTAssertEqual(TEStreamEngine.projectedTargetShare(committee) - TEStreamEngine.projectedTargetShare(unboosted),
                       0.10, accuracy: 1e-12)
    }

    func testRoleInference() {
        XCTAssertEqual(TEStreamEngine.inferRole(targetShare: 0.22, adot: 5, redZoneShare: 0.3, snapShare: 0.4), .featured)
        XCTAssertEqual(TEStreamEngine.inferRole(targetShare: 0.10, adot: 5, redZoneShare: 0.25, snapShare: 0.7), .redZone)
        XCTAssertEqual(TEStreamEngine.inferRole(targetShare: 0.12, adot: 10, redZoneShare: 0.1, snapShare: 0.45), .rotational)
        XCTAssertEqual(TEStreamEngine.inferRole(targetShare: 0.15, adot: 10, redZoneShare: 0.1, snapShare: 0.75), .seam)
        XCTAssertEqual(TEStreamEngine.inferRole(targetShare: 0.15, adot: 7, redZoneShare: nil, snapShare: nil), .checkdown)
        XCTAssertEqual(TEStreamEngine.inferRole(targetShare: nil, adot: nil, redZoneShare: nil, snapShare: nil), .checkdown)
    }

    func testOutPlayerHasZeroExpectedPointsAndRanksLast() throws {
        let report = TEStreamEngine.report(candidates: try candidates(), scoring: try scoring("league"))
        let out = try XCTUnwrap(report.ranked.first { $0.name == "Injured Starter" })
        XCTAssertEqual(out.expPts, 0)
        XCTAssertEqual(report.ranked.first?.name, "Featured Move TE")
    }
}
