import XCTest
import FCCore
import FCData
@testable import FCApp

/// The week's games with their live state, which of your (and your
/// opponent's) starters play in each, and when the shared poller wakes.
@MainActor
final class GameDayTests: XCTestCase {
    private var cacheDirectory: URL?

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    private func services() async throws -> AppServices {
        let (services, directory) = try await WorkspaceFixture.services()
        cacheDirectory = directory
        return services
    }

    func testLoadsTheWeeksGames() async throws {
        let model = try await services().gameDay
        XCTAssertEqual(model.games.count, 4)
        XCTAssertFalse(model.unavailable)
        XCTAssertTrue(model.anyLive)
        let live = try XCTUnwrap(model.games.first { $0.status == .inProgress })
        XCTAssertEqual(GameDay.clock(live), "Q3 7:42")
        XCTAssertTrue(live.isRedZone)
        XCTAssertEqual(live.possession, "DET")
    }

    func testGamesPairWithStartersFromBothSidesLiveFirst() async throws {
        let services = try await services()
        let mine = services.matchup.mySide?.rows ?? []
        let theirs = services.matchup.opponentSide?.rows ?? []
        let paired = GameDay.pair(games: services.gameDay.games, mine: mine, theirs: theirs)
        XCTAssertEqual(paired.map { $0.game.away + "@" + $0.game.home }, ["DET@LAR", "NYG@KC", "MIA@BUF"])
        XCTAssertEqual(paired[0].mine.compactMap(\.name), ["Kyren Williams"], "Sleeper's LAR finds the rows' LA")
        XCTAssertEqual(paired[0].theirs.compactMap(\.name), ["Jared Goff", "Matthew Stafford", "Jahmyr Gibbs"])
        XCTAssertEqual(paired.first?.game.status, .inProgress, "live games lead")
        XCTAssertFalse(paired.contains { $0.game.home == "GB" }, "a game with none of either side's starters is left out")
        let statuses = paired.map(\.game.status)
        XCTAssertEqual(statuses, statuses.sorted { rank($0) < rank($1) })
    }

    func testSleepersLARJoinsTheRowsLA() {
        let game = SleeperGameScore(gameID: "g", week: 3, status: .inProgress, startTime: nil, home: "LAR", away: "DET")
        let rams = row(team: "LA"), lions = row(team: "DET"), other = row(team: "KC")
        let paired = GameDay.pair(games: [game], mine: [rams, other], theirs: [lions])
        XCTAssertEqual(paired.first?.mine.map(\.nflTeam), ["LA"])
        XCTAssertEqual(paired.first?.theirs.map(\.nflTeam), ["DET"])
    }

    func testClockLabels() {
        func game(_ status: SleeperGameScore.Status, q: String? = nil, n: Int? = nil, t: String? = nil) -> SleeperGameScore {
            SleeperGameScore(gameID: "g", week: 3, status: status, startTime: Date(timeIntervalSince1970: 1_790_528_400),
                             home: "A", away: "B", quarter: q, quarterNumber: n, timeRemaining: t)
        }
        XCTAssertEqual(GameDay.clock(game(.inProgress, q: "2", n: 2, t: "0:31")), "Q2 0:31")
        XCTAssertEqual(GameDay.clock(game(.inProgress, q: "HT", n: 2)), "Half")
        XCTAssertEqual(GameDay.clock(game(.inProgress, q: "OT", n: 5, t: "9:12")), "OT 9:12")
        XCTAssertEqual(GameDay.clock(game(.complete, q: "F", n: 4)), "Final")
        XCTAssertEqual(GameDay.clock(game(.complete, q: "F", n: 5)), "Final/OT")
        XCTAssertFalse(GameDay.clock(game(.pregame)).isEmpty)
    }

    // MARK: - Poller

    private let kickoff = Date(timeIntervalSince1970: 1_790_528_400)
    private func final(_ start: Date) -> SleeperGameScore {
        SleeperGameScore(gameID: "f", week: 3, status: .complete, startTime: start, home: "A", away: "B")
    }

    func testPollsEveryMinuteDuringAGame() {
        let now = kickoff.addingTimeInterval(90 * 60)
        XCTAssertTrue(LivePoller.anyGameLive(kickoffs: [kickoff], games: [], now: now))
        XCTAssertEqual(LivePoller.nextDelay(kickoffs: [kickoff], games: [], now: now), .seconds(60))
    }

    func testSleepsUntilKickoffCappedAtFifteenMinutes() {
        XCTAssertEqual(LivePoller.nextDelay(kickoffs: [kickoff], games: [], now: kickoff.addingTimeInterval(-600)), .seconds(600))
        XCTAssertEqual(LivePoller.nextDelay(kickoffs: [kickoff], games: [], now: kickoff.addingTimeInterval(-3 * 3600)),
                       LivePoller.idleCap, "overnight")
        XCTAssertEqual(LivePoller.nextDelay(kickoffs: [kickoff], games: [], now: kickoff.addingTimeInterval(-5)),
                       LivePoller.minimum, "a kickoff seconds away doesn't spin")
        XCTAssertEqual(LivePoller.nextDelay(kickoffs: [], games: [], now: kickoff), LivePoller.idleCap, "no games left this week")
    }

    func testStopsOnceEveryGameInTheWindowIsFinal() {
        let now = kickoff.addingTimeInterval(3.5 * 3600)
        XCTAssertFalse(LivePoller.anyGameLive(kickoffs: [kickoff], games: [final(kickoff)], now: now))
        XCTAssertFalse(LivePoller.anyGameLive(kickoffs: [kickoff], games: [], now: kickoff.addingTimeInterval(5 * 3600)),
                       "past the four-hour window")
        let flexed = SleeperGameScore(gameID: "x", week: 3, status: .inProgress, startTime: nil, home: "A", away: "B")
        XCTAssertTrue(LivePoller.anyGameLive(kickoffs: [], games: [flexed], now: now), "Sleeper saying in progress wins")
    }

    // MARK: - Helpers

    private func rank(_ s: SleeperGameScore.Status) -> Int {
        switch s { case .inProgress: return 0; case .pregame: return 1; case .complete: return 2 }
    }

    private func row(team: String) -> MatchupRow {
        MatchupRow(index: 0, slot: "RB", playerID: "p\(team)", name: team, position: .rb, nflTeam: team, opponent: nil,
                   isHome: nil, onBye: false, livePoints: nil, season: nil, defense: nil, impliedTotal: nil)
    }
}
