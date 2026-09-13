import Foundation

/// Failures this layer can produce. Every case names what could not be reached
/// or decoded, because the UI's job when data is missing is to say *which*
/// data — "couldn't load" with no subject is the failure mode the house style
/// in §6 exists to prevent.
public enum DataLayerError: Error, Hashable, Sendable {
    /// A non-HTTP response, which in practice means a malformed URL or a
    /// transport that isn't really HTTP.
    case notHTTP(URL?)
    /// The endpoint answered, but not with success.
    case httpStatus(Int, path: String)
    /// The endpoint answered with success and a body this app cannot decode.
    case undecodable(path: String, underlying: String)
    /// A URL could not be built from the configured base and the given path.
    case badURL(String)
    /// No bundled copy and no cached copy, so there is nothing to fall back to.
    case noFallbackAvailable(resource: String)
}

extension DataLayerError: CustomStringConvertible {
    public var description: String {
        switch self {
        case .notHTTP(let url):
            return "Not an HTTP response: \(url?.absoluteString ?? "unknown URL")"
        case .httpStatus(let code, let path):
            return "HTTP \(code) from \(path)"
        case .undecodable(let path, let underlying):
            return "Could not decode \(path): \(underlying)"
        case .badURL(let path):
            return "Could not build a URL for \(path)"
        case .noFallbackAvailable(let resource):
            return "No bundled or cached copy of \(resource)"
        }
    }
}
