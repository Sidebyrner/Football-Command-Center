import SwiftUI

/// A small pulsing dot for a game that may be in progress. Static under Reduce
/// Motion — the colour alone still says "live".
struct LiveDot: View {
    var size: CGFloat = 7
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Image(systemName: "circle.fill")
            .font(.system(size: size))
            .foregroundStyle(Palette.sit)
            .symbolEffect(.pulse, options: .repeating, isActive: !reduceMotion)
            .accessibilityLabel("Game in progress")
    }
}

/// "LIVE" badge for a scoreboard.
struct LiveBadge: View {
    var body: some View {
        HStack(spacing: 4) {
            LiveDot(size: 6)
            Text("LIVE")
                .font(.caption2.weight(.bold))
                .kerning(0.8)
        }
        .foregroundStyle(Palette.sit)
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(Capsule().fill(Palette.sit.opacity(0.12)))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Games in progress")
    }
}

enum KickoffText {
    /// "4:25 PM" — a slot that hasn't played yet, shown as when it will.
    static func time(_ date: Date) -> String {
        date.formatted(.dateTime.hour().minute())
    }
}
