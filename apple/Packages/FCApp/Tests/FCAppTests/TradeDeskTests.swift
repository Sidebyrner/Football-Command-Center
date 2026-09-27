import XCTest
import FCCore
import FCData
@testable import FCApp

/// The Trade Desk in a two-team superflex league on the recorded week-2 2026
/// Sleeper lines. The user starts Cam Ward (8 points) at SUPER_FLEX and has
/// Kyren Williams on IR; the rival has Dak Prescott spare on the bench and
/// Brock Purdy on IR.
@MainActor
final class TradeDeskTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    private static let mahomes = "4046", ward = "12522", cook = "8138", bolton = "7648", kyren = "8150"
    private static let allen = "4984", young = "9228", shough = "12545"
    private static let goff = "3163", stafford = "421", gibbs = "9221", edmunds = "4968"
    private static let prescott = "3294", hampton = "12507", purdy = "8183", lamar = "4881"

    private func context(myBench: [String] = [], theirBench: [String] = [], deadline: Int? = 11) async throws -> LeagueContext {
        let transport = await Harness.standardTransport()
        await transport.override("/state/nfl", json: #"{"week":3,"season":"2026","season_type":"regular"}"#)
        let deadlineSetting = deadline.map { #","trade_deadline":\#($0)"# } ?? ""
        await transport.replace("/league/L1", json: """
            {"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":2,
             "roster_positions":["QB","SUPER_FLEX","RB","LB","BN","BN","BN","IR"],
             "scoring_settings":{"pass_yd":0.04,"pass_td":4,"pass_int":-2,"rush_yd":0.1,"rush_td":6,"rush_fd":1,
               "rec_yd":0.1,"rec_td":6,"rec_fd":1,"idp_tkl_solo":2,"idp_tkl_ast":1,"idp_sack":5},
             "settings":{"waiver_type":2,"waiver_budget":100,"reserve_slots":1\(deadlineSetting)}}
            """)
        let mine = [Self.mahomes, Self.ward, Self.cook, Self.bolton, Self.kyren] + myBench
        let theirs = [Self.goff, Self.stafford, Self.gibbs, Self.edmunds, Self.prescott, Self.hampton, Self.purdy] + theirBench
        func list(_ ids: [String]) -> String { ids.map { "\"\($0)\"" }.joined(separator: ",") }
        await transport.replace("/league/L1/rosters", json: """
            [{"roster_id":1,"owner_id":"u1","players":[\(list(mine))],
              "starters":[\(list([Self.mahomes, Self.ward, Self.cook, Self.bolton]))],"reserve":["\(Self.kyren)"]},
             {"roster_id":2,"owner_id":"u2","players":[\(list(theirs))],
              "starters":[\(list([Self.goff, Self.stafford, Self.gibbs, Self.edmunds]))],"reserve":["\(Self.purdy)"]}]
            """)
        await transport.replace("/players/nfl", json: """
            {"\(Self.mahomes)":{"full_name":"Patrick Mahomes","position":"QB","team":"KC","active":true},
             "\(Self.ward)":{"full_name":"Cam Ward","position":"QB","team":"TEN","active":true},
             "\(Self.cook)":{"full_name":"James Cook","position":"RB","team":"BUF","active":true},
             "\(Self.bolton)":{"full_name":"Nick Bolton","position":"LB","team":"KC","active":true},
             "\(Self.kyren)":{"full_name":"Kyren Williams","position":"RB","team":"LAR","active":true,"injury_status":"IR"},
             "\(Self.allen)":{"full_name":"Josh Allen","position":"QB","team":"BUF","active":true},
             "\(Self.young)":{"full_name":"Bryce Young","position":"QB","team":"CAR","active":true},
             "\(Self.shough)":{"full_name":"Tyler Shough","position":"QB","team":"NO","active":true},
             "\(Self.goff)":{"full_name":"Jared Goff","position":"QB","team":"DET","active":true},
             "\(Self.stafford)":{"full_name":"Matthew Stafford","position":"QB","team":"LAR","active":true},
             "\(Self.gibbs)":{"full_name":"Jahmyr Gibbs","position":"RB","team":"DET","active":true},
             "\(Self.edmunds)":{"full_name":"Tremaine Edmunds","position":"LB","team":"NYG","active":true},
             "\(Self.prescott)":{"full_name":"Dak Prescott","position":"QB","team":"DAL","active":true},
             "\(Self.hampton)":{"full_name":"Omarion Hampton","position":"RB","team":"LAC","active":true},
             "\(Self.purdy)":{"full_name":"Brock Purdy","position":"QB","team":"SF","active":true},
             "\(Self.lamar)":{"full_name":"Lamar Jackson","position":"QB","team":"BAL","active":true}}
            """)
        try await transport.on("/stats/nfl/2026/2", fixture: "stats-2026-w2")
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        let loader = LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs)
        return try await loader.load(leagueID: "L1", userRosterID: 1)
    }

    private func desk(myBench: [String] = [], theirBench: [String] = [], relay: RelayClient? = nil,
                      secrets: SecretStore = InMemorySecretStore(), prefill: TradeWizardPrefill? = nil) async throws -> TradeWizardModel {
        TradeWizardModel(context: try await context(myBench: myBench, theirBench: theirBench),
                         relay: relay, secrets: secrets, prefill: prefill)
    }

    private func flexUpgrade(_ model: TradeWizardModel) throws -> TradeGoal {
        try XCTUnwrap(model.goals.first { $0.upgradeOverID == Self.ward })
    }

    // MARK: - Values

    func testValuesAreThisSeasonsAndCoverIDP() async throws {
        let model = try await desk()
        XCTAssertEqual(model.primaryBasis, .thisSeason)
        XCTAssertEqual(model.basis, .thisSeason)
        XCTAssertEqual(model.label(.thisSeason), "2026 pts/gm")
        XCTAssertTrue(model.hint(.thisSeason).contains("week 2 —"))
        XCTAssertNotNil(model.value(Self.bolton, .thisSeason), "a linebacker is valued from Sleeper's lines")
        XCTAssertNil(model.value(Self.bolton, .production))
        // 183 passing yards, 7 rushing, two rushing TDs and a rushing first down.
        let expected: Double = 7.32 + 0.7 + 12 + 1
        XCTAssertEqual(try XCTUnwrap(model.value(Self.ward, .thisSeason)), expected, accuracy: 0.01)
        XCTAssertTrue(model.availableBases.contains(.thisSeason))
    }

    func testAWeakSuperflexQuarterbackBecomesAnUpgradeGoal() async throws {
        let model = try await desk()
        let goal = try flexUpgrade(model)
        XCTAssertTrue(goal.title.contains("flex QB"))
        XCTAssertTrue(goal.positions.contains(.qb))
        model.choose(goal: goal)
        let partner = try XCTUnwrap(model.partners.first)
        XCTAssertTrue(partner.theirOffer.contains { $0.id == Self.prescott })
        XCTAssertFalse(partner.theirOffer.contains { $0.id == Self.purdy }, "an IR player is not an offer")
    }

    func testTheQuarterbackStartLineCountsSuperflexDemand() async throws {
        let model = try await desk()
        // Both teams start a QB in SUPER_FLEX: four QBs start, not two, so the
        // line is the fourth-best quarterback — Mahomes (29.98), behind Allen,
        // Prescott and Purdy. A dedicated-only count would put it at Prescott.
        XCTAssertEqual(try XCTUnwrap(model.value(Self.mahomes, .overStartLine)), 0, accuracy: 0.01)
        XCTAssertEqual(try XCTUnwrap(model.value(Self.prescott, .overStartLine)), 31.76 - 29.98, accuracy: 0.01)
        XCTAssertLessThan(try XCTUnwrap(model.value(Self.goff, .overStartLine)), 0)
    }

    // MARK: - IR

    func testIRPlayersAreMarkedAndNeverSpare() async throws {
        let model = try await desk()
        model.choose(goal: try flexUpgrade(model))
        model.choose(partner: try XCTUnwrap(model.partners.first))
        let purdy = try XCTUnwrap(model.theirPlayers.first { $0.id == Self.purdy })
        XCTAssertTrue(purdy.isReserve)
        XCTAssertFalse(purdy.isSurplus)
        XCTAssertEqual(model.theirPlayers.last?.id, Self.purdy, "IR sorts last")
        let kyren = try XCTUnwrap(model.yourPlayers.first { $0.id == Self.kyren })
        XCTAssertTrue(kyren.isReserve)
        XCTAssertEqual(kyren.injuryBadge, "On your IR")
        XCTAssertFalse(model.sending.contains(Self.kyren))
    }

    // MARK: - Deal math

    func testBothTeamsLineupsAndGradesMove() async throws {
        let model = try await desk()
        model.choose(goal: try flexUpgrade(model))
        model.choose(partner: try XCTUnwrap(model.partners.first))
        model.toggleSending(Self.ward)
        if !model.receiving.contains(Self.prescott) { model.toggleReceiving(Self.prescott) }
        let effects = model.effects
        XCTAssertGreaterThan(try XCTUnwrap(effects.you.lineupDelta), 0, "Prescott for Ward improves your lineup")
        XCTAssertNotNil(effects.them.lineupDelta)
        XCTAssertNotNil(effects.you.gradeBefore?.letter)
        XCTAssertNotNil(effects.you.gradeAfter?.letter)
        XCTAssertEqual(model.grades.count, 2)
        XCTAssertNotNil(model.partners.first?.grade)
    }

    func testRosterRoomIsCheckedOnBothSides() async throws {
        // You: 7 active. Taking two for one needs a drop.
        let full = try await desk(myBench: [Self.allen, Self.young, Self.shough])
        full.choose(goal: try flexUpgrade(full))
        full.choose(partner: try XCTUnwrap(full.partners.first))
        for id in full.sending { full.toggleSending(id) }
        full.toggleSending(Self.ward)
        for id in [Self.prescott, Self.hampton] where !full.receiving.contains(id) { full.toggleReceiving(id) }
        XCTAssertEqual(full.effects.you.mustDrop, 1)
        XCTAssertTrue(full.effects.warnings.contains("You receive 1 more player than you send — you'd need to drop 1"))

        // Them: 7 active. Sending two for one makes them drop.
        let theirsFull = try await desk(theirBench: [Self.lamar])
        theirsFull.choose(goal: try flexUpgrade(theirsFull))
        theirsFull.choose(partner: try XCTUnwrap(theirsFull.partners.first))
        for id in theirsFull.receiving where id != Self.prescott { theirsFull.toggleReceiving(id) }
        if !theirsFull.receiving.contains(Self.prescott) { theirsFull.toggleReceiving(Self.prescott) }
        for id in theirsFull.sending { theirsFull.toggleSending(id) }
        theirsFull.toggleSending(Self.ward)
        theirsFull.toggleSending(Self.cook)
        XCTAssertEqual(theirsFull.effects.them.mustDrop, 1)
        XCTAssertTrue(theirsFull.effects.warnings.contains { $0.hasPrefix("rival would need to drop 1") })
    }

    // MARK: - Pitch

    func testThePitchKeepsYourReasonsToYourself() async throws {
        let model = try await desk()
        model.choose(goal: try flexUpgrade(model))
        model.choose(partner: try XCTUnwrap(model.partners.first))
        for id in model.sending { model.toggleSending(id) }
        model.toggleSending(Self.ward)
        XCTAssertFalse(model.pitchFacts.contains { $0.contains(" my ") || $0.hasPrefix("Fixes my") || $0.hasPrefix("Narrows my") })
        XCTAssertTrue(model.pitchFacts.contains { $0.contains("Cam Ward is averaging") && $0.contains("this season") })
    }

    // MARK: - Navigation

    func testGoingBackKeepsTheDeal() async throws {
        let model = try await desk()
        let goal = try flexUpgrade(model)
        model.choose(goal: goal)
        let partner = try XCTUnwrap(model.partners.first)
        model.choose(partner: partner)
        model.toggleSending(Self.cook)
        let deal = (model.sending, model.receiving)
        model.back()
        model.back()
        XCTAssertEqual(model.step, .goal)
        model.choose(goal: goal)
        model.choose(partner: partner)
        XCTAssertEqual(model.step, .deal)
        XCTAssertEqual(model.sending, deal.0)
        XCTAssertEqual(model.receiving, deal.1)
    }

    // MARK: - Finding and prefill

    func testSearchFindsRivalPlayersOnly() async throws {
        let model = try await desk()
        let results = model.search("dak prescot")
        XCTAssertEqual(results.first?.player.id, Self.prescott)
        XCTAssertEqual(results.first?.rival.manager, "rival")
        XCTAssertTrue(model.search("mahomes").isEmpty, "your own players are not trade targets")

        model.target(try XCTUnwrap(results.first))
        XCTAssertEqual(model.step, .deal)
        XCTAssertEqual(model.receiving, [Self.prescott])
        XCTAssertEqual(model.partner?.rival.rosterID, 2)
    }

    func testPrefillExplainsWhatItCouldNotDo() async throws {
        let gone = try await desk(prefill: TradeWizardPrefill(positions: [.qb], rivalRosterID: 2, theirPlayerID: "traded-away"))
        XCTAssertEqual(gone.partner?.rival.rosterID, 2)
        XCTAssertTrue(gone.prefillNote?.contains("no longer on rival's roster") ?? false)

        let missing = try await desk(prefill: TradeWizardPrefill(rivalRosterID: 99))
        XCTAssertEqual(missing.prefillNote, "That team couldn't be found in your league.")
    }

    func testOfferingYourPlayerKeepsHimOnTheSendSide() async throws {
        let model = try await desk(prefill: TradeWizardPrefill(myPlayerID: Self.cook))
        XCTAssertTrue(model.prefillNote?.contains("James Cook is set to go out") ?? false)
        model.choose(goal: try flexUpgrade(model))
        model.choose(partner: try XCTUnwrap(model.partners.first))
        XCTAssertEqual(model.sending, [Self.cook])
    }

    // MARK: - Polish

    private func polished(status: Int, token: String?) async throws -> TradeWizardModel {
        let transport = StubTransport()
        await transport.on("/api/ai/trade-pitch", json: #"{"error":"x"}"#, status: status)
        let relay = RelayClient(baseURL: URL(string: "https://relay.example.test")!, transport: transport)
        let model = try await desk(relay: relay, secrets: token.map { InMemorySecretStore($0) } ?? InMemorySecretStore())
        model.choose(goal: try flexUpgrade(model))
        model.choose(partner: try XCTUnwrap(model.partners.first))
        await model.polishPitch()
        return model
    }

    func testPolishFailuresSayWhatToFix() async throws {
        let refused = try await polished(status: 401, token: "bad")
        XCTAssertEqual(refused.polishError, "Your relay turned down the token. Check it in Settings.")
        let broken = try await polished(status: 500, token: "good")
        XCTAssertEqual(broken.polishError, "Your relay hit an error (500). The pitch above still works.")
        XCTAssertFalse(broken.isPolishing)

        // Editing the deal clears the old error.
        broken.toggleSending(Self.cook)
        XCTAssertNil(broken.polishError)
    }

    // MARK: - Deadline and bases

    func testDeadlineEdges() {
        XCTAssertEqual(TradeWindow.from(deadline: 0, currentWeek: 3), .noDeadline)
        XCTAssertEqual(TradeWindow.from(deadline: 99, currentWeek: 3), .noDeadline)
        XCTAssertEqual(TradeWindow.from(deadline: 11, currentWeek: 11), .open(deadlineWeek: 11, weeksLeft: 0))
        XCTAssertTrue(TradeWindow.from(deadline: 11, currentWeek: 12).isClosed)
    }

    func testRestOfSeasonIsBuiltOnPrepare() async throws {
        let model = try await desk()
        XCTAssertFalse(model.restOfSeasonReady)
        await model.prepare()
        XCTAssertTrue(model.restOfSeasonReady)
        model.basis = .restOfSeason
        XCTAssertTrue(model.hint(.restOfSeason).contains("regressed"))
    }
}
