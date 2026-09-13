import Foundation
import XCTest
@testable import FCData

/// A transport that answers from a script instead of the network.
///
/// Every test in this target goes through one of these. Nothing here touches
/// `api.sleeper.app`: a suite that needs the real endpoint fails on a train,
/// and the cases worth testing — a 304, a 500 that then succeeds, a truncated
/// body — are precisely the ones a live server will not produce on demand.
actor StubTransport: HTTPTransport {
    /// Responses to hand out, in order, per path suffix. A path with one
    /// response left keeps returning it.
    private var scripted: [(match: String, results: [Result<HTTPResponse, Error>])] = []
    private(set) var requests: [URLRequest] = []

    init() {}

    func on(_ pathContains: String, respond results: [Result<HTTPResponse, Error>]) {
        scripted.append((pathContains, results))
    }

    func on(_ pathContains: String, json: String, status: Int = 200, headers: [String: String] = [:]) {
        on(pathContains, respond: [.success(
            HTTPResponse(status: status, body: Data(json.utf8), headers: headers)
        )])
    }

    func on(_ pathContains: String, data: Data, status: Int = 200, headers: [String: String] = [:]) {
        on(pathContains, respond: [.success(
            HTTPResponse(status: status, body: data, headers: headers)
        )])
    }

    func on(_ pathContains: String, failWith error: Error) {
        on(pathContains, respond: [.failure(error)])
    }

    var requestCount: Int { requests.count }

    func requestedPaths() -> [String] {
        requests.compactMap { $0.url?.path }
    }

    func header(_ name: String, onRequestAt index: Int) -> String? {
        guard requests.indices.contains(index) else { return nil }
        return requests[index].value(forHTTPHeaderField: name)
    }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        requests.append(request)
        let path = request.url?.absoluteString ?? ""
        for index in scripted.indices where path.contains(scripted[index].match) {
            guard !scripted[index].results.isEmpty else { continue }
            let result = scripted[index].results.count == 1
                ? scripted[index].results[0]
                : scripted[index].results.removeFirst()
            return try result.get()
        }
        throw StubError.unscripted(path)
    }

    enum StubError: Error, Equatable {
        case unscripted(String)
        case offline
    }
}

enum Fixtures {
    static func url(_ name: String) throws -> URL {
        let bundle = Bundle.module
        guard let url = bundle.url(forResource: "Fixtures/\(name)", withExtension: "json")
            ?? bundle.url(forResource: name, withExtension: "json", subdirectory: "Fixtures")
        else {
            throw CocoaError(.fileNoSuchFile)
        }
        return url
    }

    static func data(_ name: String) throws -> Data {
        try Data(contentsOf: url(name))
    }

    /// The directory holding the fixtures, usable as a `Bundle`-free source for
    /// the static store's bundled-copy path.
    static func directory() throws -> URL {
        try url("player-ids").deletingLastPathComponent()
    }
}

/// A throwaway cache directory per test, so tests cannot see each other's writes.
func makeTemporaryCache() -> (cache: DiskCache, directory: URL) {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("fcdata-tests-\(UUID().uuidString)", isDirectory: true)
    return (DiskCache(directory: directory), directory)
}
