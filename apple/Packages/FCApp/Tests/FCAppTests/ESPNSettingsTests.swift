import XCTest
import FCCore
import FCData
@testable import FCApp

/// The ESPN setup flow: sign in → league id → team, plus sign-out and what
/// happens when ESPN rejects the saved cookies.
@MainActor
final class ESPNSettingsTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    private static let swid = "{AAAAAAAA-0000-0000-0000-00000000AB12}"

    private struct Rig {
        let model: SettingsModel
        let store: InMemorySettingsStore
        let secrets: InMemorySecretStore
        let source: SwitchableLeagueSource
        let transport: StubTransport
    }

    private func make(leagueStatus: Int = 200, settings: AppSettings = AppSettings()) async throws -> Rig {
        let transport = StubTransport()
        await transport.on("/state/nfl", json: #"{"week":3,"season":"2026","season_type":"regular"}"#)
        if leagueStatus == 200 {
            try await transport.on("/leagues/987654", fixture: "espn-league")
        } else {
            await transport.on("/leagues/987654", json: #"{"messages":["no"]}"#, status: leagueStatus)
        }
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        let cache = DiskCache(directory: harness.cacheDirectory.appendingPathComponent("espn"))
        let staticData = harness.staticData
        let store = InMemorySettingsStore(settings)
        let secrets = InMemorySecretStore()
        let source = SwitchableLeagueSource(harness.sleeper)
        let model = SettingsModel(
            sleeper: harness.sleeper, store: store, secrets: InMemorySecretStore(), espnSecrets: secrets,
            leagueSource: source,
            makeESPNSource: { credentials in
                ESPNLeagueService(
                    client: ESPNClient(credentials: credentials, transport: transport, retries: 0),
                    cache: cache,
                    season: { 2026 },
                    playerIndex: { nil },
                    crosswalk: { try? await staticData.playerCrosswalk().value }
                )
            }
        )
        return Rig(model: model, store: store, secrets: secrets, source: source, transport: transport)
    }

    func testSwitchingToESPNAsksForSignInAndClearsTheLeague() async throws {
        let rig = try await make(settings: AppSettings(sleeperUsername: "connor", userID: "u1", leagueID: "L1", rosterID: 1))
        XCTAssertEqual(rig.model.stage, .ready)

        rig.model.setProvider(.espn)

        XCTAssertEqual(rig.model.stage, .needsESPNSignIn)
        XCTAssertEqual(rig.store.load().provider, .espn)
        XCTAssertNil(rig.store.load().leagueID)
        XCTAssertNil(rig.store.load().rosterID)
        // The Sleeper username survives a round trip.
        rig.model.setProvider(.sleeper)
        XCTAssertEqual(rig.model.stage, .needsUsername)
        XCTAssertEqual(rig.model.username, "connor")
    }

    func testSignInThenLeagueURLPicksTheUsersTeam() async throws {
        let rig = try await make()
        rig.model.setProvider(.espn)

        rig.model.saveESPNCredentials(ESPNCredentials(espnS2: "s2-value", swid: Self.swid))
        XCTAssertEqual(rig.model.stage, .needsESPNLeague)
        XCTAssertTrue(rig.model.hasESPNCredentials)
        XCTAssertEqual(rig.model.espnAccountSuffix, "AB12")
        XCTAssertNotNil(rig.secrets.load())
        XCTAssertTrue(rig.source.current is ESPNLeagueService)

        rig.model.espnLeagueText = "https://fantasy.espn.com/football/team?leagueId=987654&teamId=2"
        await rig.model.connectESPNLeague()

        XCTAssertNil(rig.model.errorMessage)
        XCTAssertEqual(rig.model.stage, .ready)
        XCTAssertEqual(rig.store.load().leagueID, "987654")
        // Owner ids are matched case-insensitively: the fixture's team owner
        // is the SWID in lower case.
        XCTAssertEqual(rig.store.load().rosterID, 1)
        XCTAssertEqual(rig.model.teams.map(\.manager), ["Byrne Notice", "Waiver Wire"])

        // The cookies went to ESPN, and only to ESPN.
        let requests = await rig.transport.requests
        for request in requests {
            let cookie = request.value(forHTTPHeaderField: "Cookie")
            if request.url?.path.contains("/leagues/") == true {
                XCTAssertEqual(cookie, "espn_s2=s2-value; SWID=\(Self.swid)")
            } else {
                XCTAssertNil(cookie, "\(request.url!)")
            }
        }
    }

    func testSignOutForgetsCookiesAndTheLeague() async throws {
        let rig = try await make()
        rig.model.setProvider(.espn)
        rig.model.saveESPNCredentials(ESPNCredentials(espnS2: "s2-value", swid: Self.swid))
        rig.model.espnLeagueText = "987654"
        await rig.model.connectESPNLeague()
        XCTAssertEqual(rig.model.stage, .ready)

        rig.model.signOutESPN()

        XCTAssertEqual(rig.model.stage, .needsESPNSignIn)
        XCTAssertFalse(rig.model.hasESPNCredentials)
        XCTAssertNil(rig.secrets.load())
        XCTAssertNil(rig.store.load().leagueID)
        XCTAssertFalse(rig.source.current is ESPNLeagueService)
    }

    func testARejectedCookieSendsTheUserBackToSignIn() async throws {
        let rig = try await make(leagueStatus: 401)
        rig.model.setProvider(.espn)
        rig.model.saveESPNCredentials(ESPNCredentials(espnS2: "stale", swid: Self.swid))
        rig.model.espnLeagueText = "987654"

        await rig.model.connectESPNLeague()

        XCTAssertEqual(rig.model.stage, .needsESPNSignIn)
        XCTAssertEqual(rig.model.errorMessage?.contains("Sign in again"), true)
        XCTAssertNil(rig.store.load().leagueID)
    }

    func testAnUnknownLeagueIsSaidPlainly() async throws {
        let rig = try await make(leagueStatus: 404)
        rig.model.setProvider(.espn)
        rig.model.saveESPNCredentials(ESPNCredentials(espnS2: "s2", swid: Self.swid))
        rig.model.espnLeagueText = "987654"

        await rig.model.connectESPNLeague()

        XCTAssertEqual(rig.model.stage, .needsESPNLeague)
        XCTAssertEqual(rig.model.errorMessage, "ESPN has no league with that id this season.")
    }

    func testAConfiguredESPNInstallWithoutCookiesAsksToSignIn() async throws {
        let rig = try await make(settings: AppSettings(provider: .espn, leagueID: "987654", rosterID: 1))
        XCTAssertEqual(rig.model.stage, .needsESPNSignIn)
        // The screens still gate on the saved league, so cached data shows.
        XCTAssertTrue(rig.model.settings.isConfigured)
    }

    func testParsesALeagueIDOrAnyESPNAddress() {
        XCTAssertEqual(SettingsModel.parseESPNLeagueID(" 987654 "), "987654")
        XCTAssertEqual(SettingsModel.parseESPNLeagueID("https://fantasy.espn.com/football/league?leagueId=987654"), "987654")
        XCTAssertEqual(SettingsModel.parseESPNLeagueID("fantasy.espn.com/football/team?leagueId=42&teamId=3&seasonId=2026"), "42")
        XCTAssertNil(SettingsModel.parseESPNLeagueID("my league"))
        XCTAssertNil(SettingsModel.parseESPNLeagueID("https://fantasy.espn.com/football/team?teamId=3"))
        XCTAssertNil(SettingsModel.parseESPNLeagueID(""))
    }

    func testSettingsSavedBeforeESPNDecodeAsSleeper() throws {
        let old = #"{"sleeperUsername":"connor","userID":"u1","leagueID":"L1","rosterID":4,"accentTheme":"indigo","themeVersion":2}"#
        let settings = try JSONDecoder().decode(AppSettings.self, from: Data(old.utf8))
        XCTAssertEqual(settings.provider, .sleeper)
        XCTAssertEqual(settings.leagueID, "L1")

        var espn = settings
        espn.provider = .espn
        let data = try JSONEncoder().encode(espn)
        XCTAssertEqual(try JSONDecoder().decode(AppSettings.self, from: data).provider, .espn)
    }
}
