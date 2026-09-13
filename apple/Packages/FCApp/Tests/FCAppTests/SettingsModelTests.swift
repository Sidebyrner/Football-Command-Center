import XCTest
import FCCore
import FCData
@testable import FCApp

/// The username → league → team flow (step 2 of the build order).
@MainActor
final class SettingsModelTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    private func make(
        transport: StubTransport,
        settings: AppSettings = AppSettings()
    ) -> (model: SettingsModel, store: InMemorySettingsStore) {
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        let store = InMemorySettingsStore(settings)
        return (SettingsModel(sleeper: harness.sleeper, store: store), store)
    }

    private func userTransport() async -> StubTransport {
        let transport = await Harness.standardTransport()
        await transport.on("/user/connor", json: #"{"user_id":"u1","username":"connor"}"#)
        await transport.on(
            "/user/u1/leagues/nfl/2025",
            json: "[\(TestLeague.leagueJSON())]"
        )
        return transport
    }

    func testStartsAtTheUsernameStep() {
        let (model, _) = make(transport: StubTransport())
        XCTAssertEqual(model.stage, .needsUsername)
        XCTAssertFalse(model.settings.isConfigured)
    }

    /// A configured install skips setup entirely.
    func testAConfiguredInstallStartsReady() {
        let (model, _) = make(
            transport: StubTransport(),
            settings: AppSettings(sleeperUsername: "connor", userID: "u1", leagueID: "L1", rosterID: 1)
        )
        XCTAssertEqual(model.stage, .ready)
        XCTAssertEqual(model.username, "connor")
    }

    func testLooksUpLeaguesForAUsername() async {
        let (model, store) = make(transport: await userTransport())
        model.username = "connor"

        await model.lookUpUser()

        XCTAssertEqual(model.stage, .pickingLeague)
        XCTAssertEqual(model.leagues.count, 1)
        XCTAssertEqual(model.leagues.first?.name, "Byrne Notice")
        // The username and id are persisted before the league is chosen, so a
        // user who quits mid-setup does not retype it.
        XCTAssertEqual(store.load().userID, "u1")
    }

    func testWhitespaceAroundAUsernameIsIgnored() async {
        let (model, _) = make(transport: await userTransport())
        model.username = "  connor  "

        await model.lookUpUser()

        XCTAssertEqual(model.stage, .pickingLeague)
        XCTAssertEqual(model.settings.sleeperUsername, "connor")
    }

    func testAnEmptyUsernameAsksRatherThanCallingOut() async {
        let transport = StubTransport()
        let (model, _) = make(transport: transport)
        model.username = "   "

        await model.lookUpUser()

        XCTAssertEqual(model.errorMessage, "Enter your Sleeper username.")
        let count = await transport.requestCount
        XCTAssertEqual(count, 0, "no request for an empty username")
    }

    /// The most common setup failure by far, so it gets plain words rather than
    /// a status code.
    func testAnUnknownUsernameIsExplainedPlainly() async {
        let transport = StubTransport()
        await transport.on("/state/nfl", json: TestLeague.nflStateJSON)
        await transport.on("/user/nobody", json: "null", status: 404)
        let (model, _) = make(transport: transport)
        model.username = "nobody"

        await model.lookUpUser()

        XCTAssertEqual(model.errorMessage, "Sleeper has no user called \"nobody\".")
        XCTAssertEqual(model.stage, .needsUsername)
    }

    /// Having no leagues is an answer, not an error — and it names the season
    /// that was searched so the user is not left guessing.
    func testNoLeaguesNamesTheSeasonSearched() async {
        let transport = await Harness.standardTransport()
        await transport.on("/user/connor", json: #"{"user_id":"u1","username":"connor"}"#)
        await transport.on("/user/u1/leagues/nfl/2025", json: "[]")
        let (model, _) = make(transport: transport)
        model.username = "connor"

        await model.lookUpUser()

        XCTAssertEqual(model.errorMessage, "No leagues found for connor in 2025.")
    }

    /// Sleeper knows which roster is the user's, so the app should not make
    /// them hunt for their own team.
    func testPickingALeagueAutoSelectsTheUsersOwnRoster() async {
        let (model, store) = make(transport: await userTransport())
        model.username = "connor"
        await model.lookUpUser()

        await model.selectLeague(model.leagues[0])

        XCTAssertEqual(model.stage, .ready)
        XCTAssertEqual(store.load().rosterID, 1)
        XCTAssertEqual(store.load().leagueID, "L1")
    }

    /// When it cannot be inferred, ask — with the managers' real names.
    func testAnUnmatchedUserIsAskedWhichTeamIsTheirs() async {
        let transport = await Harness.standardTransport()
        await transport.on("/user/stranger", json: #"{"user_id":"u99","username":"stranger"}"#)
        await transport.on("/user/u99/leagues/nfl/2025", json: "[\(TestLeague.leagueJSON())]")
        let (model, _) = make(transport: transport)
        model.username = "stranger"
        await model.lookUpUser()

        await model.selectLeague(model.leagues[0])

        XCTAssertEqual(model.stage, .pickingTeam)
        XCTAssertEqual(model.teams.map(\.rosterID), [1, 2])
        XCTAssertEqual(model.teams.first?.manager, "Byrne Notice")
    }

    func testChoosingATeamCompletesSetup() async {
        let transport = await Harness.standardTransport()
        await transport.on("/user/stranger", json: #"{"user_id":"u99"}"#)
        await transport.on("/user/u99/leagues/nfl/2025", json: "[\(TestLeague.leagueJSON())]")
        let (model, store) = make(transport: transport)
        model.username = "stranger"
        await model.lookUpUser()
        await model.selectLeague(model.leagues[0])

        model.selectTeam(rosterID: 2)

        XCTAssertEqual(model.stage, .ready)
        XCTAssertTrue(store.load().isConfigured)
        XCTAssertEqual(store.load().rosterID, 2)
    }

    /// Switching leagues keeps the username — retyping it would be busywork.
    func testSwitchingLeagueKeepsTheUsername() async {
        let (model, store) = make(
            transport: StubTransport(),
            settings: AppSettings(sleeperUsername: "connor", userID: "u1", leagueID: "L1", rosterID: 1)
        )

        model.changeLeague()

        XCTAssertEqual(model.stage, .needsUsername)
        XCTAssertEqual(store.load().sleeperUsername, "connor")
        XCTAssertNil(store.load().leagueID)
        XCTAssertNil(store.load().rosterID)
        XCTAssertFalse(store.load().isConfigured)
    }

    func testRelayURLIsOptionalAndPersisted() {
        let (model, store) = make(transport: StubTransport())
        XCTAssertNil(store.load().relayBaseURL)

        model.setRelayURL(URL(string: "https://relay.example.test")!)
        XCTAssertEqual(store.load().relayBaseURL?.host, "relay.example.test")

        model.setRelayURL(nil)
        XCTAssertNil(store.load().relayBaseURL)
    }
}

/// `AppSettings` persistence in its own right.
final class AppSettingsTests: XCTestCase {
    func testIsConfiguredNeedsBothALeagueAndARoster() {
        XCTAssertFalse(AppSettings().isConfigured)
        XCTAssertFalse(AppSettings(leagueID: "L1").isConfigured)
        XCTAssertFalse(AppSettings(rosterID: 1).isConfigured)
        XCTAssertTrue(AppSettings(leagueID: "L1", rosterID: 1).isConfigured)
    }

    func testRoundTripsThroughUserDefaults() throws {
        let suite = try XCTUnwrap(UserDefaults(suiteName: "fcc.tests.\(UUID().uuidString)"))
        defer { suite.removePersistentDomain(forName: suite.description) }

        let store = UserDefaultsSettingsStore(defaults: suite, key: "settings")
        store.save(AppSettings(sleeperUsername: "connor", userID: "u1", leagueID: "L1", rosterID: 3))

        let loaded = store.load()
        XCTAssertEqual(loaded.sleeperUsername, "connor")
        XCTAssertEqual(loaded.rosterID, 3)
    }

    func testAnEmptyStoreYieldsDefaults() throws {
        let suite = try XCTUnwrap(UserDefaults(suiteName: "fcc.tests.\(UUID().uuidString)"))
        defer { suite.removePersistentDomain(forName: suite.description) }

        let loaded = UserDefaultsSettingsStore(defaults: suite, key: "absent").load()
        XCTAssertFalse(loaded.isConfigured)
    }
}
