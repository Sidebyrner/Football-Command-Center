import XCTest
import FCCore
import FCData
@testable import FCApp

/// Planning's three jobs against the real 2025 schedule.
///
/// The user's two backs are LAR and SEA, both off in week 8, so week 8 is short at
/// RB. The rival's bench carries Bijan Robinson (ATL, plays week 8) and Jahmyr
/// Gibbs (DET, also off in week 8) — so a correct trade finder offers Bijan for
/// week 8 and never Gibbs. Christian McCaffrey is an unrostered back who plays.
@MainActor
final class PlanningJobsTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    enum Fixture {
        static let rosters = """
        [{"roster_id":1,"owner_id":"u1",
          "players":["qb1","rb_la","rb_sea","wr1","wr2","te1","wr_flex","k1","PHI","lb1","dl1"],
          "starters":["qb1","rb_la","rb_sea","wr1","wr2","te1","wr_flex","k1","PHI","lb1","dl1"]},
         {"roster_id":2,"owner_id":"u2",
          "players":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2","9509","9221"],
          "starters":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"]}]
        """

        static let players = """
        {"qb1":{"full_name":"Starter QB","position":"QB","team":"BUF","active":true},
         "rb_la":{"full_name":"Rams Back","position":"RB","team":"LAR","active":true},
         "rb_sea":{"full_name":"Seattle Back","position":"RB","team":"SEA","active":true},
         "wr1":{"full_name":"Receiver One","position":"WR","team":"MIN","active":true},
         "wr2":{"full_name":"Receiver Two","position":"WR","team":"DAL","active":true},
         "te1":{"full_name":"Tight End","position":"TE","team":"KC","active":true},
         "wr_flex":{"full_name":"Flex Receiver","position":"WR","team":"NE","active":true},
         "k1":{"full_name":"Kicker One","position":"K","team":"BAL","active":true},
         "PHI":{"position":"DEF","team":"PHI","active":true},
         "lb1":{"full_name":"Linebacker One","position":"LB","team":"CHI","active":true},
         "dl1":{"full_name":"Lineman One","position":"DL","team":"GB","active":true},
         "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true},
         "rb_buf":{"full_name":"Bills Back","position":"RB","team":"BUF","active":true},
         "rb_kc":{"full_name":"Chiefs Back","position":"RB","team":"KC","active":true},
         "wr3":{"full_name":"Receiver Three","position":"WR","team":"NYJ","active":true},
         "wr4":{"full_name":"Receiver Four","position":"WR","team":"MIA","active":true},
         "te2":{"full_name":"Tight End Two","position":"TE","team":"SF","active":true},
         "wr_flex2":{"full_name":"Flex Receiver Two","position":"WR","team":"CIN","active":true},
         "k2":{"full_name":"Kicker Two","position":"K","team":"NO","active":true},
         "DAL":{"position":"DEF","team":"DAL","active":true},
         "lb2":{"full_name":"Linebacker Two","position":"LB","team":"NE","active":true},
         "dl2":{"full_name":"Lineman Two","position":"DL","team":"TB","active":true},
         "9509":{"full_name":"Bijan Robinson","position":"RB","team":"ATL","active":true},
         "9221":{"full_name":"Jahmyr Gibbs","position":"RB","team":"DET","active":true},
         "4034":{"full_name":"Christian McCaffrey","position":"RB","team":"SF","active":true},
         "lb_fa":{"full_name":"Free Linebacker","position":"LB","team":"MIA","active":true},
         "SF":{"position":"DEF","team":"SF","active":true}}
        """

        /// McCaffrey, a free-agent LB, the SF defense — and one rostered player,
        /// who must never be offered as a pickup.
        static let trending = """
        [{"player_id":"4034","count":9000},{"player_id":"lb_fa","count":8000},
         {"player_id":"SF","count":7000},{"player_id":"rb_buf","count":6000}]
        """
    }

    private func loaded(withSleeper: Bool = true) async throws -> PlanningModel {
        let transport = await Harness.standardTransport()
        await transport.override("/league/L1/rosters", json: Fixture.rosters)
        await transport.override("/players/nfl", json: Fixture.players)
        await transport.override("/trending/add", json: Fixture.trending)
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory

        let model = PlanningModel(
            loader: LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs),
            sleeper: withSleeper ? harness.sleeper : nil
        )
        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)
        if let error = model.errorMessage { throw XCTSkip("load failed: \(error)") }
        return model
    }

    private func onBye(_ model: PlanningModel, _ player: PlanningPlayer, week: Int) -> Bool {
        model.context?.byeCalendar.isOnBye(team: player.team, week: week) ?? false
    }

    // MARK: - Modes

    func testOpensOnByesAndEveryModeStatesItsPurpose() async throws {
        let model = try await loaded()
        XCTAssertEqual(model.mode, .byes)
        for mode in PlanningMode.allCases {
            XCTAssertFalse(mode.purpose.isEmpty)
        }
    }

    // MARK: - Byes

    func testWeekEightNeedsRunningBacks() async throws {
        let model = try await loaded()
        XCTAssertEqual(model.neededPositions(week: 8), [.rb])
    }

    /// A short flex group needs every position that group accepts. Week 5 takes
    /// out both IDP starters (CHI and GB), leaving the two IDP_FLEX slots empty.
    func testAShortFlexGroupNeedsItsEligiblePositions() async throws {
        let model = try await loaded()
        XCTAssertTrue(model.neededPositions(week: 5).isSuperset(of: [.lb, .dl, .db]))
    }

    /// Pickups for a week are free agents at a needed position who play that week.
    func testPickupsAreFreeAgentsAtNeededPositionsWhoPlayThatWeek() async throws {
        let model = try await loaded()
        let pickups = model.pickups(for: 8)

        XCTAssertFalse(pickups.isEmpty)
        for player in pickups {
            XCTAssertEqual(player.position, .rb, "\(player.name) is not at a needed position")
            XCTAssertFalse(onBye(model, player, week: 8), "\(player.name) is on bye in week 8")
            XCTAssertEqual(player.availability, .freeAgent, "\(player.name) can't be picked up")
        }
        // Bijan plays in week 8 but sits on a rival's bench: a trade, not a pickup.
        XCTAssertFalse(pickups.contains { $0.name == "Bijan Robinson" })
        XCTAssertTrue(pickups.contains { $0.name == "Christian McCaffrey" })
        XCTAssertFalse(pickups.contains { $0.name == "Jahmyr Gibbs" }, "DET is on bye in week 8")
    }

    /// No production data exists for IDP, so the only pickups there come from
    /// trending adds — labelled popularity only, never given a points number.
    func testIDPPickupsComeOnlyFromTrendingAndArePopularityOnly() async throws {
        let model = try await loaded()
        let idp = model.pickups(for: 5).filter { Position.idp.contains($0.position) }

        XCTAssertTrue(idp.contains { $0.name == "Free Linebacker" })
        XCTAssertTrue(idp.allSatisfy { $0.popularityOnly && $0.pointsPerGame == nil })
    }

    // MARK: - Trades

    func testTheRivalWithSpareBacksIsATradeTargetForWeekEight() async throws {
        let model = try await loaded()
        let target = try XCTUnwrap(model.tradeTargets.first { $0.rival.rosterID == 2 })
        XCTAssertTrue(target.weeksCovered.contains(8))

        let bijan = try XCTUnwrap(target.candidates.first { $0.name == "Bijan Robinson" })
        XCTAssertTrue(bijan.coversWeeks.contains(8))
    }

    /// Gibbs is on the rival's bench but DET is off in week 8, so he can't fix
    /// week 8 — even though he may cover other weeks.
    func testABenchPlayerOnByeDoesNotCoverThatWeek() async throws {
        let model = try await loaded()
        let target = try XCTUnwrap(model.tradeTargets.first { $0.rival.rosterID == 2 })
        let gibbs = target.candidates.first { $0.name == "Jahmyr Gibbs" }
        XCTAssertFalse(gibbs?.coversWeeks.contains(8) ?? false)
    }

    /// Only bench players are offered: taking a starter would break the rival's
    /// own lineup, which makes the ask unrealistic.
    func testOnlyBenchPlayersAreOffered() async throws {
        let model = try await loaded()
        let starters = Set(model.context?.teams.first { $0.rosterID == 2 }?.starterIDs ?? [])
        for target in model.tradeTargets {
            XCTAssertTrue(target.candidates.allSatisfy { !starters.contains($0.id) })
        }
    }

    /// The rival is short in week 10 themselves (four starters off), so they are
    /// no help that week however deep their bench looks.
    func testARivalShortThatWeekCoversNothingThatWeek() async throws {
        let model = try await loaded()
        XCTAssertTrue(model.cell(rosterID: 2, week: 10)?.isShort ?? false, "fixture precondition")
        let target = model.tradeTargets.first { $0.rival.rosterID == 2 }
        XCTAssertFalse(target?.weeksCovered.contains(10) ?? false)
    }

    // MARK: - Waivers

    /// Every waiver fill is a free agent who genuinely covers each week it claims.
    func testWaiverFillsGenuinelyCoverTheWeeksTheyClaim() async throws {
        let model = try await loaded()
        XCTAssertFalse(model.waiverFills.isEmpty)
        for player in model.waiverFills {
            XCTAssertEqual(player.availability, .freeAgent)
            XCTAssertFalse(player.coversWeeks.isEmpty)
            for week in player.coversWeeks {
                XCTAssertTrue(model.neededPositions(week: week).contains(player.position))
                XCTAssertFalse(onBye(model, player, week: week), "\(player.name) is on bye in \(week)")
            }
        }
    }

    func testTrendingExcludesRosteredPlayersAndIsPopularityOnly() async throws {
        let model = try await loaded()
        let names = model.waiverTrending.map(\.name)

        XCTAssertFalse(names.contains("Bills Back"), "rostered players are not pickups")
        XCTAssertTrue(model.waiverTrending.allSatisfy(\.popularityOnly))
        XCTAssertFalse(model.trendingUnavailable)
    }

    /// The PHI defense is off in week 9, so a trending defense that plays covers it.
    func testATrendingDefenseCoversTheWeekYourDefenseIsOff() async throws {
        let model = try await loaded()
        let sf = try XCTUnwrap(model.waiverTrending.first { $0.id == "SF" })
        XCTAssertEqual(sf.position, .def)
        XCTAssertTrue(sf.coversWeeks.contains(9))
    }

    /// Without the Sleeper service the planner still works on production data
    /// and says the trending sections are unavailable.
    func testWithoutTrendingThePlannerStillWorksAndSaysSo() async throws {
        let model = try await loaded(withSleeper: false)
        XCTAssertTrue(model.trendingUnavailable)
        XCTAssertTrue(model.waiverTrending.isEmpty)
        XCTAssertFalse(model.waiverFills.isEmpty)
    }
}
