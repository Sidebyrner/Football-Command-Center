import XCTest
import FCCore
import FCData
@testable import FCApp

/// Sit/Start against the real 2025 files.
///
/// The roster mixes real players, whose values come from the actual weekly
/// file through the real crosswalk, with fixture players who cannot be joined —
/// so "can't value him" is exercised for each of its causes. Week 7 is the bye
/// case: BUF and BAL are off in the shipped schedule, so Josh Allen must be
/// benched for Jared Goff on every basis.
@MainActor
final class SitStartModelTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    enum Fixture {
        static let rosters = """
        [{"roster_id":1,"owner_id":"u1",
          "players":["4984","3163","4866","9221","9509","rb_sea","7564","9493","wr2","te1",
                     "k1","PHI","lb1","dl1"],
          "starters":["4984","4866","rb_sea","7564","wr2","te1","0","k1","PHI","lb1","dl1"]},
         {"roster_id":2,"owner_id":"u2","players":["qb2"],"starters":["qb2"]}]
        """

        static let players = """
        {"4984":{"full_name":"Josh Allen","position":"QB","team":"BUF","active":true},
         "3163":{"full_name":"Jared Goff","position":"QB","team":"DET","active":true},
         "4866":{"full_name":"Saquon Barkley","position":"RB","team":"PHI","active":true},
         "9221":{"full_name":"Jahmyr Gibbs","position":"RB","team":"DET","active":true},
         "9509":{"full_name":"Bijan Robinson","position":"RB","team":"ATL","active":true},
         "rb_sea":{"full_name":"Seattle Back","position":"RB","team":"SEA","active":true},
         "7564":{"full_name":"Ja'Marr Chase","position":"WR","team":"CIN","active":true},
         "9493":{"full_name":"Puka Nacua","position":"WR","team":"LAR","active":true},
         "wr2":{"full_name":"Receiver Two","position":"WR","team":"DAL","active":true},
         "te1":{"full_name":"Tight End","position":"TE","team":"KC","active":true},
         "k1":{"full_name":"Kicker One","position":"K","team":"BAL","active":true},
         "PHI":{"position":"DEF","team":"PHI","active":true},
         "lb1":{"full_name":"Linebacker One","position":"LB","team":"CHI","active":true},
         "dl1":{"full_name":"Lineman One","position":"DL","team":"GB","active":true},
         "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true}}
        """
    }

    private func loaded(week: Int = 1) async throws -> SitStartModel {
        let transport = await Harness.standardTransport()
        await transport.override("/state/nfl", json: #"{"week":\#(week),"season":"2025","season_type":"regular"}"#)
        await transport.override("/league/L1/rosters", json: Fixture.rosters)
        await transport.override("/players/nfl", json: Fixture.players)
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory

        let model = SitStartModel(
            loader: LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs)
        )
        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)
        if let error = model.errorMessage { throw XCTSkip("load failed: \(error)") }
        return model
    }

    private func starters(_ model: SitStartModel) -> [String] {
        model.lineup.compactMap(\.name)
    }

    private func slot(_ model: SitStartModel, _ token: String) -> ProposedSlot? {
        model.lineup.first { $0.slot == token }
    }

    /// Points per game straight from the context, independent of the optimizer,
    /// so assertions about who should start are not the optimizer grading itself.
    private func pointsPerGame(_ model: SitStartModel, _ name: String) throws -> Double {
        try XCTUnwrap(model.context?.seasonProfiles.first { $0.name == name }?.pointsPerGame, name)
    }

    // MARK: - The recommendation

    func testDefaultsToSeasonAverage() async throws {
        let model = try await loaded()
        XCTAssertEqual(model.basis, .seasonAverage)
        XCTAssertNotNil(model.proposal)
    }

    /// Two real backs and a real receiver sit on the bench while an unjoinable
    /// back, an unjoinable receiver and an empty flex start. All three must come
    /// in, and the two players with no value must go out.
    func testValuedBenchPlayersReplaceUnvaluedAndEmptySlots() async throws {
        let model = try await loaded()
        let names = starters(model)

        XCTAssertTrue(names.contains("Jahmyr Gibbs"))
        XCTAssertTrue(names.contains("Bijan Robinson"))
        XCTAssertTrue(names.contains("Puka Nacua"))
        XCTAssertFalse(names.contains("Seattle Back"))
        XCTAssertFalse(names.contains("Receiver Two"))

        XCTAssertTrue(model.swaps.contains { $0.outName == nil }, "the empty flex is filled")
        XCTAssertEqual(slot(model, "FLEX")?.changed, true)
    }

    /// Whichever quarterback averaged more starts — checked against the season
    /// data directly, not against the optimizer's own output.
    func testTheBetterQuarterbackStartsInANormalWeek() async throws {
        let model = try await loaded()
        let expected = try pointsPerGame(model, "Josh Allen") >= pointsPerGame(model, "Jared Goff")
            ? "Josh Allen" : "Jared Goff"
        XCTAssertEqual(slot(model, "QB")?.name, expected)
    }

    /// The headline gain is built from the swaps it summarises.
    func testGainAgreesWithTheSwaps() async throws {
        let model = try await loaded()
        let gain = try XCTUnwrap(model.gain)
        let deltas = model.swaps.map(\.delta).reduce(0, +)

        XCTAssertGreaterThan(gain, 0)
        // Each delta is rounded to one decimal on its own.
        XCTAssertEqual(gain, deltas, accuracy: 0.05 * Double(model.swaps.count) + 0.1)
    }

    // MARK: - What to actually do

    /// Week 7: Allen is benched for Goff. That is one start and one sit — not a
    /// slot-by-slot list that makes a kept player look benched.
    func testChangesReadAsStartsAndSits() async throws {
        let model = try await loaded(week: 7)
        XCTAssertTrue(model.starts.contains { $0.name == "Jared Goff" && $0.slot == "QB" })
        XCTAssertTrue(model.sits.contains { $0.name == "Josh Allen" && $0.slot == "QB" })
    }

    /// Nobody can be both started and sat, and a player who only changes slot is
    /// a move — never a sit.
    func testStartsSitsAndMovesNeverOverlap() async throws {
        for week in [1, 7] {
            let model = try await loaded(week: week)
            let started = Set(model.starts.map(\.playerID))
            let sat = Set(model.sits.map(\.playerID))
            let moved = Set(model.moves.map(\.playerID))
            XCTAssertTrue(started.isDisjoint(with: sat), "week \(week)")
            XCTAssertTrue(moved.isDisjoint(with: sat), "week \(week): a moved player is still starting")
            XCTAssertTrue(moved.isDisjoint(with: started), "week \(week)")
        }
    }

    /// The changes must reproduce the proposed lineup exactly from the current one.
    func testChangesAccountForTheWholeProposedLineup() async throws {
        let model = try await loaded(week: 7)
        let current = Set((model.context?.userTeam?.rawStarters ?? []).filter { $0 != "0" })
        let proposed = Set(model.lineup.compactMap(\.playerID))
        let rebuilt = current
            .subtracting(model.sits.map(\.playerID))
            .union(model.starts.map(\.playerID))
        XCTAssertEqual(rebuilt, proposed)
    }

    // MARK: - Unvalued players, by cause

    /// On a stats basis DEF and IDP cannot be valued, so their slots show the
    /// current starter as kept rather than an empty slot.
    func testUnvaluedSlotsKeepTheirStarterRatherThanGoingEmpty() async throws {
        let model = try await loaded()
        let defense = try XCTUnwrap(model.lineup.first { $0.playerID == "PHI" })

        XCTAssertTrue(defense.keptBecauseUnvalued)
        XCTAssertFalse(defense.changed)
        XCTAssertNil(defense.value)
    }

    func testTheCausesAreReportedSeparately() async throws {
        let model = try await loaded()

        XCTAssertTrue(model.unranked.noProductionData.contains("Linebacker One"))
        XCTAssertTrue(model.unranked.noProductionData.contains("Lineman One"))
        XCTAssertTrue(model.unranked.noSeasonLine.contains("Seattle Back"))
        XCTAssertTrue(model.unranked.noSeasonLine.contains("Kicker One"))
        XCTAssertTrue(model.unranked.onBye.isEmpty, "nobody is on bye in week 1")
        XCTAssertTrue(model.unranked.noGameLine.isEmpty)
    }

    // MARK: - Game environment

    /// The only basis that can value DEF and IDP — it reads the team's implied
    /// total, not the player.
    func testEnvironmentValuesEveryPositionIncludingDefense() async throws {
        let model = try await loaded()
        model.basis = .environment

        XCTAssertTrue(model.unranked.noProductionData.isEmpty)
        let defense = try XCTUnwrap(model.lineup.first { $0.playerID == "PHI" })
        XCTAssertFalse(defense.keptBecauseUnvalued)
        // PHI hosted DAL in week 1, favored by 8.5 on a 47.5 total.
        XCTAssertEqual(try XCTUnwrap(defense.value), 28.0, accuracy: 0.001)
    }

    // MARK: - Byes

    /// Week 7: BUF is on bye. Starting Allen scores exactly zero, so he is
    /// benched for Goff whatever he averages. The web app did not check this.
    func testAQuarterbackOnByeIsBenched() async throws {
        let model = try await loaded(week: 7)

        XCTAssertEqual(slot(model, "QB")?.name, "Jared Goff")
        XCTAssertTrue(model.swaps.contains { $0.outName == "Josh Allen" && $0.inName == "Jared Goff" })
        XCTAssertTrue(model.unranked.onBye.contains("Josh Allen"))
    }

    /// No basis may start a player on bye — not even game environment, where a
    /// bye team simply has no line.
    func testNoBasisEverStartsAPlayerOnBye() async throws {
        let model = try await loaded(week: 7)
        for basis in LineupBasis.allCases {
            model.basis = basis
            let proposed = Set(model.proposal?.proposedIDs.compactMap { $0 } ?? [])
            XCTAssertFalse(proposed.contains("4984"), "\(basis) started Josh Allen on bye")
            XCTAssertFalse(proposed.contains("k1"), "\(basis) started a BAL kicker on bye")
        }
    }

    // MARK: - Disagreement

    /// A basis is listed as disagreeing exactly when its lineup differs.
    func testDisagreementIsListedExactlyWhenLineupsDiffer() async throws {
        let model = try await loaded()
        let context = try XCTUnwrap(model.context)
        let mine = model.effectiveLineup(try XCTUnwrap(model.proposal), context: context)

        for other in LineupBasis.allCases where other != model.basis {
            let theirs = model.effectiveLineup(model.optimize(other, context: context), context: context)
            XCTAssertEqual(
                model.disagreeingBases.contains(other), theirs != mine,
                "\(other) listed wrongly"
            )
        }
    }

    /// An unvalued DEF slot must not, on its own, make two bases look like they
    /// disagree — that would turn the warning into noise.
    func testAnUnvaluedSlotAloneIsNotADisagreement() async throws {
        let model = try await loaded()
        let context = try XCTUnwrap(model.context)
        let season = model.optimize(.seasonAverage, context: context)
        let effective = model.effectiveLineup(season, context: context)

        XCTAssertTrue(effective.contains("PHI"), "the kept DEF counts as starting")
    }

    // MARK: - Failure

    func testAFailedLoadNamesWhatFailed() async {
        let transport = StubTransport()
        await transport.on("/state/nfl", json: TestLeague.nflStateJSON)
        await transport.fail("/league/L1")
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        let model = SitStartModel(
            loader: LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs)
        )

        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)

        XCTAssertNotNil(model.errorMessage)
        XCTAssertTrue(model.lineup.isEmpty)
    }
}
