import Foundation
import Security

/// Where the relay access token lives. A secret, so the Keychain — never
/// `UserDefaults` or a settings file.
public protocol SecretStore: Sendable {
    func load() -> String?
    func save(_ value: String?)
}

/// Keychain-backed store for one secret.
public struct KeychainSecretStore: SecretStore {
    private let service: String
    private let account: String
    private let thisDeviceOnly: Bool

    /// - Parameter thisDeviceOnly: keep the item out of iCloud Keychain and
    ///   device backups. Right for a session cookie another device could not
    ///   use anyway and should never be able to read.
    public init(
        service: String = "com.connorbyrne.FantasyCommandCenter.relay",
        account: String = "relay-token",
        thisDeviceOnly: Bool = false
    ) {
        self.service = service
        self.account = account
        self.thisDeviceOnly = thisDeviceOnly
    }

    private var accessible: CFString {
        thisDeviceOnly ? kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly : kSecAttrAccessibleAfterFirstUnlock
    }

    /// The store for ESPN's two session cookies, as one JSON value.
    public static var espn: KeychainSecretStore {
        KeychainSecretStore(
            service: "com.connorbyrne.FantasyCommandCenter.espn", account: "credentials", thisDeviceOnly: true
        )
    }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    public func load() -> String? {
        var lookup = query
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(lookup as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func save(_ value: String?) {
        SecItemDelete(query as CFDictionary)
        guard let value, !value.isEmpty, let data = value.data(using: .utf8) else { return }
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = accessible
        SecItemAdd(item as CFDictionary, nil)
    }
}

/// In-memory store for tests and previews.
public final class InMemorySecretStore: SecretStore, @unchecked Sendable {
    private let lock = NSLock()
    private var value: String?

    public init(_ value: String? = nil) { self.value = value }

    public func load() -> String? {
        lock.lock(); defer { lock.unlock() }
        return value
    }

    public func save(_ value: String?) {
        lock.lock(); defer { lock.unlock() }
        self.value = value
    }
}
