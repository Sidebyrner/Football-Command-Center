import Foundation

/// Where a value came from.
///
/// Deliberately **not** nested inside `Fetched`: nesting a type in a generic
/// makes `Fetched<A>.Provenance` and `Fetched<B>.Provenance` distinct types,
/// which breaks the one operation this is for — carrying provenance across a
/// `map` unchanged.
public enum Provenance: Hashable, Sendable {
    /// Fetched from the network just now.
    case live
    /// Served from a cache entry still inside its TTL.
    case cached(age: TimeInterval)
    /// The fetch failed and an **expired** entry was served instead. The UI
    /// must label this; it is the offline case, not the happy path (§8.1).
    case staleCache(age: TimeInterval, failure: String)
    /// Read from the copy shipped in the app bundle.
    case bundled

    public var isLive: Bool { self == .live }

    /// True when the UI owes the user a visible "as of" note.
    public var needsFreshnessLabel: Bool {
        switch self {
        case .live: return false
        case .cached, .staleCache, .bundled: return true
        }
    }

    public var age: TimeInterval? {
        switch self {
        case .live, .bundled: return nil
        case .cached(let age): return age
        case .staleCache(let age, _): return age
        }
    }
}

/// A value plus where it came from.
///
/// The house style in §6 says to state what a number is and where it came from,
/// and "cached from four hours ago" is a materially different claim from "live".
/// Making provenance part of the return type means a caller cannot forget to
/// ask — it has to destructure it to get at the value.
public struct Fetched<Value: Sendable>: Sendable {
    public let value: Value
    public let provenance: Provenance

    public init(value: Value, provenance: Provenance) {
        self.value = value
        self.provenance = provenance
    }
}

public extension Fetched {
    /// Re-wraps the value while carrying provenance across unchanged —
    /// deriving something from cached data does not make it live.
    func map<Other: Sendable>(_ transform: (Value) throws -> Other) rethrows -> Fetched<Other> {
        let mapped = try transform(value)
        return Fetched<Other>(value: mapped, provenance: provenance)
    }
}
