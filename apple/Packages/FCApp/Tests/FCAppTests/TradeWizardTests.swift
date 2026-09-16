import XCTest
import FCCore
import FCData
@testable import FCApp

/// The trade wizard against the real 2025 schedule.
///
/// The user's backs are LAR and SEA, both off in week 8, and their TE (KC) and a
/// WR (DAL) are off in week 10. They carry a spare receiver (IND). The rival's
/// bench holds Bijan Robinson (ATL, plays week 8) and Jahmyr Gibbs (DET, off in
/// week 8). Without Bijan the rival can't fill their flex in week 10, when their
/// KC back and CIN receiver are both off.
@MainActor
final class TradeWizardTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    enum Fixture {
        static let rosters = """
        [{"roster_id":1,"owner_id":"u1",
          "players":["qb1","rb_la","rb_sea","wr1","wr2","te1","wr_flex","k1","PHI","lb1","dl1","wr_spare"],
          "starters":["qb1","rb_la","rb_sea","wr1","wr2","te1","wr_flex","k1","PHI","lb1","dl1"]},
         {"roster_id":2,"owner_id":"u2",
          "players":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2","9509","9221"],
          "starters":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"]}]
        """

        static var players: String {
            PlanningJobsTests.Fixture.players.replacingOccurrences(
                of: #""SF":{"position":"DEF","team":"SF","active":true}}"#,
                with: #""SF":{"position":"DEF","team":"SF","active":true},"wr_spare":{"full_name":"Spare Receiver","position":"WR","team":"IND","active":true}}"#
            )
        }

        static func league(deadline: Int) -> String {
            TestLeague.leagueJSON().replacingOccurrences(
                of: #""total_rosters":12,"#,
                with: #""total_rosters":12,"settings":{"trade_deadline":\#(deadline)},"#
            )
        }
    }

    private func context(deadline: Int = 11, state: String = TestLeague.nflStateJSON) async throws -> LeagueContext {
        let transport = await Harness.standardTransport()
        await transport.override("/league/L1/rosters", json: Fixture.rosters)
        await transport.override("/players/nfl", json: Fixture.players)
        await transport.replace("/league/L1", json: Fixture.league(deadline: deadline))
        await transport.replace("/state/nfl", json: state)
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        let loader = LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs)
        return try await loader.load(leagueID: "L1", userRosterID: 1, season: 2025)
    }

    private func wizard(
        deadline: Int = 11,
        relay: RelayClient? = nil,
        secrets: SecretStore = InMemorySecretStore(),
        prefill: TradeWizardPrefill? = nil
    ) async throws -> TradeWizardModel {
        let context = try await context(deadline: deadline)
        return TradeWizardModel(context: context, relay: relay, secrets: secrets, prefill: prefill)
    }

    private func rbWeek8(_ model: TradeWizardModel) throws -> TradeGoal {
        try XCTUnwrap(model.goals.first { $0.positions == [.rb] && $0.weeks == [8] })
    }

    // MARK: - Goals

    func testGoalsComeFromYourShortWeeks() async throws {
        let model = try await wizard()
        let rb = try rbWeek8(model)
        XCTAssertEqual(rb.title, "RB depth for week 8")
        XCTAssertTrue(model.goals.contains { $0.positions == [.te] && $0.weeks.contains(10) })
        XCTAssertEqual(model.step, .goal)

        // Soonest week first, upgrades last.
        let firstWeeks = model.goals.compactMap { $0.weeks.min() }
        XCTAssertEqual(firstWeeks, firstWeeks.sorted())
        if let firstUpgrade = model.goals.firstIndex(where: { $0.weeks.isEmpty }) {
            XCTAssertTrue(model.goals[firstUpgrade...].allSatisfy { $0.weeks.isEmpty })
        }
    }

    // MARK: - Partners

    func testPartnersOfferSparePlayersWhoPlayTheGoalWeeks() async throws {
        let model = try await wizard()
        model.choose(goal: try rbWeek8(model))

        XCTAssertEqual(model.step, .partner)
        let fit = try XCTUnwrap(model.partners.first)
        XCTAssertEqual(fit.rival.rosterID, 2)
        XCTAssertEqual(fit.theirOffer.map(\.id), ["9509"], "Gibbs is off in week 8 and starters aren't spare")
        XCTAssertTrue(fit.facts.contains("Has 1 spare RB who plays week 8"))
    }

    // MARK: - Deal effects

    func testTheirBackNarrowsYourWeekEight() async throws {
        let model = try await wizard()
        model.choose(goal: try rbWeek8(model))
        model.choose(partner: try XCTUnwrap(model.partners.first))
        XCTAssertEqual(model.receiving, ["9509"])

        model.toggleSending("wr_spare")
        let week8 = try XCTUnwrap(model.effects.yourWeeks.first { $0.week == 8 })
        XCTAssertEqual(week8.before, 2)
        XCTAssertEqual(week8.after, 1)
        XCTAssertTrue(model.effects.yourGains.contains("Narrows my week 8 shortfall from 2 to 1"))
        XCTAssertTrue(model.canApproach)
    }

    /// Your spare receiver fills the flex Bijan leaves behind, so the deal as
    /// proposed opens no hole for them. Taking Bijan for nothing does.
    func testTheDealWarnsWhenItBreaksTheirLineup() async throws {
        let model = try await wizard()
        model.choose(goal: try rbWeek8(model))
        model.choose(partner: try XCTUnwrap(model.partners.first))

        XCTAssertTrue(model.effects.warnings.contains { $0.hasPrefix("Leaves rival short") && $0.contains("week 10") })
        XCTAssertTrue(model.effects.warnings.contains { $0.hasPrefix("You receive 1 more player") })
        XCTAssertFalse(model.canApproach, "Nothing is being sent")

        model.toggleSending("wr_spare")
        XCTAssertFalse(model.effects.warnings.contains { $0.hasPrefix("Leaves rival short") })
        XCTAssertTrue(model.effects.theirWeeks.allSatisfy { $0.after <= $0.before })
    }

    // MARK: - Pitch

    func testThePitchIsOnlyTheDealsFacts() async throws {
        let model = try await wizard()
        model.choose(goal: try rbWeek8(model))
        model.choose(partner: try XCTUnwrap(model.partners.first))
        model.toggleSending("wr_spare")
        model.advanceToApproach()

        XCTAssertEqual(model.step, .approach)
        XCTAssertEqual(model.pitchFacts.first, "I'd send Spare Receiver (WR) for Bijan Robinson (RB).")
        XCTAssertEqual(
            model.pitch,
            (["Hey rival — trade idea."] + model.pitchFacts + ["Open to it?"]).joined(separator: " ")
        )
        XCTAssertFalse(model.pitch.contains("Gibbs"))
    }

    func testPolishUsesTheRelayWithTheStoredToken() async throws {
        let transport = StubTransport()
        await transport.on("/api/ai/trade-pitch", json: #"{"pitch":"  Polished pitch  "}"#)
        let relay = RelayClient(baseURL: URL(string: "https://relay.example.test")!, transport: transport)
        let model = try await wizard(relay: relay, secrets: InMemorySecretStore("secret"))
        model.choose(goal: try rbWeek8(model))
        model.choose(partner: try XCTUnwrap(model.partners.first))
        model.toggleSending("wr_spare")

        await model.polishPitch()
        XCTAssertEqual(model.polishedPitch, "Polished pitch")
        XCTAssertNil(model.polishError)
    }

    func testPolishWithoutATokenSaysWhereToAddOne() async throws {
        let transport = StubTransport()
        await transport.on("/api/ai/trade-pitch", json: #"{"error":"no"}"#, status: 401)
        let relay = RelayClient(baseURL: URL(string: "https://relay.example.test")!, transport: transport)
        let model = try await wizard(relay: relay)
        model.choose(goal: try rbWeek8(model))
        model.choose(partner: try XCTUnwrap(model.partners.first))
        model.toggleSending("wr_spare")

        await model.polishPitch()
        XCTAssertNil(model.polishedPitch)
        XCTAssertEqual(model.polishError, "Add your relay token in Settings to use your AI.")
    }

    // MARK: - Prefill and deadline

    func testPrefillFromATradeTargetOpensOnTheDeal() async throws {
        let model = try await wizard(prefill: TradeWizardPrefill(positions: [.rb], weeks: [8], rivalRosterID: 2, theirPlayerID: "9509"))
        XCTAssertEqual(model.step, .deal)
        XCTAssertEqual(model.receiving, ["9509"])
    }

    func testDeadlineWindow() {
        XCTAssertEqual(TradeWindow.from(deadline: nil, currentWeek: 7), .noDeadline)
        XCTAssertEqual(TradeWindow.from(deadline: 11, currentWeek: 7), .open(deadlineWeek: 11, weeksLeft: 4))
        XCTAssertEqual(TradeWindow.from(deadline: 11, currentWeek: 7).label, "4 weeks until the trade deadline (week 11)")
        XCTAssertEqual(TradeWindow.from(deadline: 7, currentWeek: 7).label, "Trade deadline is this week (week 7)")
        XCTAssertTrue(TradeWindow.from(deadline: 6, currentWeek: 7).isClosed)
    }

    func testAClosedWindowBlocksTheApproach() async throws {
        let context = try await context(deadline: 6, state: TestLeague.dashboardStateJSON)
        let model = TradeWizardModel(context: context, secrets: InMemorySecretStore())
        XCTAssertTrue(model.window.isClosed)
        if let goal = model.goals.first {
            model.choose(goal: goal)
            if let partner = model.partners.first {
                model.choose(partner: partner)
                model.toggleSending("wr_spare")
            }
        }
        XCTAssertFalse(model.canApproach)
        model.advanceToApproach()
        XCTAssertNotEqual(model.step, .approach)
    }

    func testAZeroDeadlineMeansNone() async throws {
        let model = try await wizard(deadline: 0)
        XCTAssertEqual(model.window, .noDeadline)
    }
}
