import Foundation

/// Recently opened Player Cards, so a linked panel flicking between players
/// doesn't rebuild and refetch each one. Cleared when the league reloads.
@MainActor
public final class PlayerCardCache {
    public let capacity: Int
    private var models: [String: PlayerCardModel] = [:]
    /// Most recent last.
    private var order: [String] = []

    public init(capacity: Int = 12) {
        self.capacity = capacity
    }

    public var count: Int { models.count }

    public func model(for id: String, make: () -> PlayerCardModel) -> PlayerCardModel {
        if let cached = models[id] {
            touch(id)
            return cached
        }
        let model = make()
        models[id] = model
        order.append(id)
        while order.count > capacity {
            models[order.removeFirst()] = nil
        }
        return model
    }

    public func removeAll() {
        models.removeAll()
        order.removeAll()
    }

    private func touch(_ id: String) {
        order.removeAll { $0 == id }
        order.append(id)
    }
}
