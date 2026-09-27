import Foundation
import FCCore

/// One frozen stream run — inputs and output together — so Monday can compare
/// what actually happened with the forecast that was on screen.
public struct StreamSnapshot<Kind: StreamKind>: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public let season: Int
    public let week: Int
    public let asOf: Date
    public let risk: StreamRiskMode
    public let scoring: Kind.Scoring
    public let teams: [Kind.Team]
    public let candidates: [Kind.Candidate]
    public let report: StreamReport<Kind.Projection>
    /// True when the user froze it by hand rather than the daily auto-save.
    public let pinned: Bool
}

/// A snapshot's listing row, readable without decoding the whole run.
public struct StreamSnapshotSummary: Hashable, Sendable, Identifiable {
    public let id: String
    public let season: Int
    public let week: Int
    public let asOf: Date
    public let pinned: Bool
}

/// Durable stream state: each week's overrides and the frozen snapshots, one
/// folder per stream.
///
/// Not `DiskCache`: nothing here expires. An override typed in on Tuesday must
/// still be there on Sunday, and a snapshot is a record, not a cache.
public actor StreamStore {
    private let directory: URL
    private let fileManager: FileManager
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    /// - Parameters:
    ///   - folder: the stream's folder under `Application Support/FantasyCommandCenter`.
    ///   - directory: an explicit location instead, for tests.
    public init(folder: String = "IDPStream", directory: URL? = nil, fileManager: FileManager = .default) {
        self.fileManager = fileManager
        if let directory {
            self.directory = directory
        } else {
            let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
                ?? fileManager.temporaryDirectory
            self.directory = base
                .appendingPathComponent("FantasyCommandCenter", isDirectory: true)
                .appendingPathComponent(folder, isDirectory: true)
        }
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        // A record must never fail to save over one non-finite number.
        encoder.nonConformingFloatEncodingStrategy = .convertToString(positiveInfinity: "inf", negativeInfinity: "-inf", nan: "nan")
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        decoder.nonConformingFloatDecodingStrategy = .convertFromString(positiveInfinity: "inf", negativeInfinity: "-inf", nan: "nan")
    }

    // MARK: - Overrides

    public func overrides<T, P>(leagueID: String, season: Int, week: Int) -> StreamWeekOverrides<T, P> {
        let url = file("overrides-\(leagueID)-\(season)-wk\(week).json")
        guard let data = try? Data(contentsOf: url) else { return .empty }
        return (try? decoder.decode(StreamWeekOverrides<T, P>.self, from: data)) ?? .empty
    }

    public func saveOverrides<T, P>(_ overrides: StreamWeekOverrides<T, P>, leagueID: String, season: Int, week: Int) throws {
        try write(overrides, to: "overrides-\(leagueID)-\(season)-wk\(week).json")
    }

    // MARK: - Snapshots

    /// Freezes a run. The id sorts by time and names the league and week.
    @discardableResult
    public func saveSnapshot<Kind: StreamKind>(
        _ kind: Kind.Type, leagueID: String, season: Int, week: Int, asOf: Date, risk: StreamRiskMode,
        scoring: Kind.Scoring, teams: [Kind.Team], candidates: [Kind.Candidate],
        report: StreamReport<Kind.Projection>, pinned: Bool
    ) throws -> StreamSnapshot<Kind> {
        let stamp = Int(asOf.timeIntervalSince1970)
        let id = "snapshot-\(leagueID)-\(season)-wk\(week)-\(stamp)\(pinned ? "-pinned" : "")"
        let snapshot = StreamSnapshot<Kind>(
            id: id, season: season, week: week, asOf: asOf, risk: risk, scoring: scoring,
            teams: teams.sorted { $0.team < $1.team }, candidates: candidates, report: report, pinned: pinned
        )
        try write(snapshot, to: "\(id).json")
        return snapshot
    }

    /// Every snapshot for a league, newest first, from file names alone.
    public func snapshots(leagueID: String) -> [StreamSnapshotSummary] {
        let prefix = "snapshot-\(leagueID)-"
        let names = (try? fileManager.contentsOfDirectory(atPath: directory.path)) ?? []
        return names.compactMap { name -> StreamSnapshotSummary? in
            guard name.hasPrefix(prefix), name.hasSuffix(".json") else { return nil }
            let id = String(name.dropLast(5))
            let parts = id.dropFirst(prefix.count).split(separator: "-")
            // season, wkN, timestamp, optional "pinned"
            guard parts.count >= 3, let season = Int(parts[0]), parts[1].hasPrefix("wk"),
                  let week = Int(parts[1].dropFirst(2)), let stamp = TimeInterval(parts[2]) else { return nil }
            return StreamSnapshotSummary(id: id, season: season, week: week,
                                         asOf: Date(timeIntervalSince1970: stamp), pinned: parts.count > 3)
        }
        .sorted { $0.asOf > $1.asOf }
    }

    public func snapshot<Kind: StreamKind>(_ kind: Kind.Type, id: String) -> StreamSnapshot<Kind>? {
        guard let data = try? Data(contentsOf: file("\(id).json")) else { return nil }
        return try? decoder.decode(StreamSnapshot<Kind>.self, from: data)
    }

    public func deleteSnapshot(id: String) throws {
        try fileManager.removeItem(at: file("\(id).json"))
    }

    // MARK: - Files

    private func file(_ name: String) -> URL {
        directory.appendingPathComponent(name)
    }

    private func write<T: Encodable>(_ value: T, to name: String) throws {
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        try encoder.encode(value).write(to: file(name), options: .atomic)
    }
}
