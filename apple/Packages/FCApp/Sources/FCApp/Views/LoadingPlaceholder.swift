import SwiftUI

/// Placeholder cards shaped like real content, shown while a screen has nothing
/// to show yet.
///
/// Replaces the centred spinner, which swapped the whole screen for a small view
/// and back — so every load made the layout jump. These occupy roughly the space
/// the content will, and shimmer rather than spin.
struct LoadingPlaceholder: View {
    var label: String = "Loading…"
    var cards: Int = 4

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: CGFloat = -1

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(0..<cards, id: \.self) { index in
                VStack(alignment: .leading, spacing: 8) {
                    Text("Placeholder player name")
                        .font(.subheadline.weight(.semibold))
                    Text("Team vs opponent · implied total")
                        .font(.caption)
                    Text(index.isMultiple(of: 2) ? "Season line and recent form" : "Short line")
                        .font(.caption2)
                }
                .redacted(reason: .placeholder)
                .card()
            }
        }
        .overlay {
            if !reduceMotion {
                GeometryReader { geometry in
                    LinearGradient(
                        colors: [.clear, Color.white.opacity(0.35), .clear],
                        startPoint: .leading, endPoint: .trailing
                    )
                    .frame(width: geometry.size.width * 0.6)
                    .offset(x: phase * geometry.size.width)
                    .blendMode(.plusLighter)
                }
                .clipped()
                .allowsHitTesting(false)
            }
        }
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.linear(duration: 1.3).repeatForever(autoreverses: false)) {
                phase = 1.4
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
}

/// A refresh that failed while older content is still on screen: say so above
/// the content instead of replacing it.
struct InlineErrorBanner: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.arrow.triangle.2.circlepath")
                .foregroundStyle(Palette.caution)
            VStack(alignment: .leading, spacing: 2) {
                Text("Couldn't refresh — showing what was loaded before")
                    .font(.footnote.weight(.semibold))
                Text(message)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .card(padding: 10, fill: Palette.caution.opacity(0.12))
    }
}
