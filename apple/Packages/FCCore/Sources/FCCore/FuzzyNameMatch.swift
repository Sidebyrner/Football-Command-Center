import Foundation

/// Forgiving player-name search: every word typed must land on some word of
/// the player's name or team, in any order, by prefix, containment or a small
/// typo. "cedric grey", "gray ten" and "bolten" all find their player.
///
/// Pure and cheap enough to run over the whole defensive pool per keystroke.
public enum FuzzyNameMatch {
    /// A score for how well `query` matches, higher is better; `nil` when any
    /// typed word matches nothing.
    public static func score(query: String, name: String, extra: [String] = []) -> Int? {
        let wanted = words(query)
        guard !wanted.isEmpty else { return nil }
        let targets = words(name) + extra.flatMap(words)
        guard !targets.isEmpty else { return nil }
        var total = 0
        for word in wanted {
            guard let best = targets.compactMap({ wordScore(word, $0) }).max() else { return nil }
            total += best
        }
        return total
    }

    /// Lowercased letters-and-digits words; apostrophes and hyphens join
    /// ("D'Anthony" → "danthony", "Smith-Njigba" → "smithnjigba") and dots drop
    /// ("A.J." → "aj"), so punctuation never costs a match.
    static func words(_ text: String) -> [String] {
        text.lowercased()
            .replacingOccurrences(of: "'", with: "")
            .replacingOccurrences(of: "’", with: "")
            .replacingOccurrences(of: ".", with: "")
            .replacingOccurrences(of: "-", with: "")
            .split { !$0.isLetter && !$0.isNumber }
            .map(String.init)
    }

    /// 4 exact, 3 prefix, 2 contained, 1 within typo distance.
    static func wordScore(_ typed: String, _ target: String) -> Int? {
        if typed == target { return 4 }
        if target.hasPrefix(typed) { return 3 }
        if typed.count >= 3, target.contains(typed) { return 2 }
        let allowed = typed.count >= 8 ? 2 : typed.count >= 4 ? 1 : 0
        guard allowed > 0 else { return nil }
        // Compare against the whole word and against a same-length prefix, so
        // a typo in a partly typed name still matches ("smtih" → "smith…").
        let prefix = String(target.prefix(typed.count))
        if editDistance(typed, target, limit: allowed) <= allowed { return 1 }
        if prefix.count == typed.count, editDistance(typed, prefix, limit: allowed) <= allowed { return 1 }
        return nil
    }

    /// Damerau–Levenshtein (adjacent transpositions count once), stopping early
    /// once every path exceeds `limit`.
    static func editDistance(_ a: String, _ b: String, limit: Int) -> Int {
        let a = Array(a), b = Array(b)
        if abs(a.count - b.count) > limit { return limit + 1 }
        if a.isEmpty { return b.count }
        if b.isEmpty { return a.count }
        var previous2 = [Int](repeating: 0, count: b.count + 1)
        var previous = Array(0...b.count)
        var current = [Int](repeating: 0, count: b.count + 1)
        for i in 1...a.count {
            current[0] = i
            var rowMin = current[0]
            for j in 1...b.count {
                let cost = a[i - 1] == b[j - 1] ? 0 : 1
                var value = min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
                if i > 1, j > 1, a[i - 1] == b[j - 2], a[i - 2] == b[j - 1] {
                    value = min(value, previous2[j - 2] + 1)
                }
                current[j] = value
                rowMin = min(rowMin, value)
            }
            if rowMin > limit { return limit + 1 }
            (previous2, previous, current) = (previous, current, previous2)
        }
        return previous[b.count]
    }
}
