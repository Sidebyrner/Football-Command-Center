import Foundation

/// The two cookies ESPN issues at sign-in, which are all a private league
/// needs. The app never sees the password: these are read out of the sign-in
/// web view's cookie store and go nowhere but the Keychain and ESPN's own
/// fantasy host.
public struct ESPNCredentials: Codable, Hashable, Sendable {
    /// The session cookie. Long-lived (about a year) and the actual secret.
    public let espnS2: String
    /// The account id, braces included, exactly as ESPN sets it — the fantasy
    /// API compares it byte for byte, and it is also how the user's own team
    /// is found among a league's `owners`.
    public let swid: String

    public init(espnS2: String, swid: String) {
        self.espnS2 = espnS2
        self.swid = swid
    }

    /// The value the fantasy API expects.
    var cookieHeader: String { "espn_s2=\(espnS2); SWID=\(swid)" }

    /// The last few characters of the account id, for "signed in as …ab12".
    public var swidSuffix: String {
        let trimmed = swid.trimmingCharacters(in: CharacterSet(charactersIn: "{}"))
        return String(trimmed.suffix(4))
    }

    // MARK: - Keychain

    /// Reads the saved pair, or `nil` when none is saved or it cannot be read.
    public static func load(from store: SecretStore) -> ESPNCredentials? {
        guard let raw = store.load(), let data = raw.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(ESPNCredentials.self, from: data)
    }

    public func save(to store: SecretStore) {
        guard let data = try? JSONEncoder().encode(self) else { return }
        store.save(String(decoding: data, as: UTF8.self))
    }

    public static func clear(from store: SecretStore) {
        store.save(nil)
    }
}

// Redacted on purpose: a stray `print` or an error message interpolating a
// credentials value must never put the session cookie in a log.
extension ESPNCredentials: CustomStringConvertible, CustomDebugStringConvertible {
    public var description: String { "ESPNCredentials(swid: …\(swidSuffix), espnS2: <redacted>)" }
    public var debugDescription: String { description }
}
