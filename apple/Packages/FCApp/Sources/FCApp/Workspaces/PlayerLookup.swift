import Foundation
import FCCore
import FCData

/// Forgiving player search across every active player in the pool.
enum PlayerLookup {
    /// The best fuzzy matches on name or team, skipping `excluding`.
    @MainActor
    static func matches(_ needle: String, in context: LeagueContext, excluding: [String] = [], limit: Int = 6) -> [IndexedPlayer] {
        let query = needle.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return [] }
        let skip = Set(excluding)
        var scored: [(player: IndexedPlayer, score: Int)] = []
        for player in context.players.activePlayers() where player.position != nil && !skip.contains(player.id) {
            let extra: [String] = player.team.map { [$0] } ?? []
            if let score = FuzzyNameMatch.score(query: query, name: player.name, extra: extra) {
                scored.append((player, score))
            }
        }
        scored.sort { a, b in a.score == b.score ? a.player.name < b.player.name : a.score > b.score }
        return scored.prefix(limit).map(\.player)
    }
}
