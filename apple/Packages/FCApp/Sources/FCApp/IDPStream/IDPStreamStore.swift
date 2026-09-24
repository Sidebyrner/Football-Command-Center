import Foundation
import FCCore

/// One frozen IDP stream run — inputs and output together — so Monday can
/// compare what actually happened with the forecast that was on screen.
public struct IDPStreamSnapshot: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public let season: Int
    public let week: Int
    public let asOf: Date
    public let risk: IDPRiskMode
    public let scoring: IDPScoring
    public let teams: [IDPTeamContext]
    public let candidates: [IDPCandidate]
    public let report: IDPStreamReport
    /// True when the user froze it by hand rather than the daily auto-save.
    public let pinned: Bool
}

/// A snapshot's listing row, readable without decoding the whole run.
public struct IDPSnapshotSummary: Hashable, Sendable, Identifiable {
    public let id: String
    public let season: Int
    public let week: Int
    public let asOf: Date
    public let pinned: Bool
}

/// Durable IDP Stream state: the week's overrides and the frozen snapshots.
///
/// Not `DiskCache`: nothing here expires. An override typed in on Tuesday must
/// still be there on Sunday, and a snapshot is a record, not a cache.
public actor IDPStreamStore {
    private let directory: URL
    private let fileManager: FileManager
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    /// - Parameter directory: defaults to `Application Support/FantasyCommandCenter/IDPStream`.
    public init(directory: URL? = nil, fileManager: FileManager = .default) {
        self.fileManager = fileManager
        if let directory {
            self.directory = directory
        } else {
            let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
                ?? fileManager.temporaryDirectory
            self.directory = base
                .appendingPathComponent("FantasyCommandCenter", isDirectory: true)
                .appendingPathComponent("IDPStream", isDirectory: true)
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

    public func overrides(leagueID: String, season: Int, week: Int) -> IDPWeekOverrides {
        let url = file("overrides-\(leagueID)-\(season)-wk\(week).json")
        guard let data = try? Data(contentsOf: url) else { return .empty }
        return (try? decoder.decode(IDPWeekOverrides.self, from: data)) ?? .empty
    }

    public func saveOverrides(_ overrides: IDPWeekOverrides, leagueID: String, season: Int, week: Int) throws {
        try write(overrides, to: "overrides-\(leagueID)-\(season)-wk\(week).json")
    }

    // MARK: - Snapshots

    /// Freezes a run. The id sorts by time and names the league and week.
    @discardableResult
    public func saveSnapshot(leagueID: String, season: Int, week: Int, asOf: Date, risk: IDPRiskMode,
                             scoring: IDPScoring, teams: [IDPTeamContext], candidates: [IDPCandidate],
                             report: IDPStreamReport, pinned: Bool) throws -> IDPStreamSnapshot {
        let stamp = Int(asOf.timeIntervalSince1970)
        let id = "snapshot-\(leagueID)-\(season)-wk\(week)-\(stamp)\(pinned ? "-pinned" : "")"
        let snapshot = IDPStreamSnapshot(
            id: id, season: season, week: week, asOf: asOf, risk: risk, scoring: scoring,
            teams: teams.sorted { $0.team < $1.team }, candidates: candidates, report: report, pinned: pinned
        )
        try write(snapshot, to: "\(id).json")
        return snapshot
    }

    /// Every snapshot for a league, newest first, from file names alone.
    public func snapshots(leagueID: String) -> [IDPSnapshotSummary] {
        let prefix = "snapshot-\(leagueID)-"
        let names = (try? fileManager.contentsOfDirectory(atPath: directory.path)) ?? []
        return names.compactMap { name -> IDPSnapshotSummary? in
            guard name.hasPrefix(prefix), name.hasSuffix(".json") else { return nil }
            let id = String(name.dropLast(5))
            let parts = id.dropFirst(prefix.count).split(separator: "-")
            // season, wkN, timestamp, optional "pinned"
            guard parts.count >= 3, let season = Int(parts[0]), parts[1].hasPrefix("wk"),
                  let week = Int(parts[1].dropFirst(2)), let stamp = TimeInterval(parts[2]) else { return nil }
            return IDPSnapshotSummary(id: id, season: season, week: week,
                                      asOf: Date(timeIntervalSince1970: stamp), pinned: parts.count > 3)
        }
        .sorted { $0.asOf > $1.asOf }
    }

    public func snapshot(id: String) -> IDPStreamSnapshot? {
        guard let data = try? Data(contentsOf: file("\(id).json")) else { return nil }
        return try? decoder.decode(IDPStreamSnapshot.self, from: data)
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
