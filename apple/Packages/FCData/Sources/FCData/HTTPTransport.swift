import Foundation

/// The seam between this package and the network.
///
/// Every request in FCData goes through here, so the whole layer — client,
/// cache, static store, relay — is testable with a stub and no network. That
/// matters more than usual in this app: the interesting failures are timeouts,
/// 304s and malformed payloads, none of which a live server reproduces on demand.
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> HTTPResponse
}

/// A response reduced to the three things this layer actually reasons about.
public struct HTTPResponse: Hashable, Sendable {
    public let status: Int
    public let body: Data
    /// Lower-cased header names — HTTP headers are case-insensitive and
    /// `URLSession` does not normalise them for you.
    public let headers: [String: String]

    public init(status: Int, body: Data, headers: [String: String] = [:]) {
        self.status = status
        self.body = body
        self.headers = headers.reduce(into: [:]) { $0[$1.key.lowercased()] = $1.value }
    }

    public var isOK: Bool { (200..<300).contains(status) }
    /// A `304` carries no body; the caller must fall back to what it already has.
    public var isNotModified: Bool { status == 304 }

    public func header(_ name: String) -> String? { headers[name.lowercased()] }
    public var etag: String? { header("etag") }
}

/// `URLSession`-backed transport used by the app.
public struct URLSessionTransport: HTTPTransport {
    private let session: URLSession

    /// A hung request is worse than a failed one — a failure surfaces and can
    /// retry, a hang just looks like the app is broken. Carried over from the
    /// web client's 8-second timeout.
    public init(timeout: TimeInterval = 8) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = timeout
        configuration.waitsForConnectivity = false
        self.session = URLSession(configuration: configuration)
    }

    public func send(_ request: URLRequest) async throws -> HTTPResponse {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw DataLayerError.notHTTP(request.url)
        }
        var headers: [String: String] = [:]
        for (key, value) in http.allHeaderFields {
            if let key = key as? String, let value = value as? String {
                headers[key] = value
            }
        }
        return HTTPResponse(status: http.statusCode, body: data, headers: headers)
    }
}
