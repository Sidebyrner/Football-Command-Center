import SwiftUI
import FCCore

/// The standard card: padded, rounded, on the surface colour.
struct CardModifier: ViewModifier {
    var padding: CGFloat = 14
    var fill: Color = Palette.surface

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(fill))
    }
}

extension View {
    func card(padding: CGFloat = 14, fill: Color = Palette.surface) -> some View {
        modifier(CardModifier(padding: padding, fill: fill))
    }
}

/// A section title with an optional one-line explanation of what the section is
/// for — every section should be able to say that in a sentence.
struct SectionHeader: View {
    let title: String
    var subtitle: String?
    var systemImage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let systemImage {
                Label(title, systemImage: systemImage)
                    .font(.headline)
            } else {
                Text(title).font(.headline)
            }
            if let subtitle {
                Text(subtitle)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A position badge in the position's colour.
struct PositionChip: View {
    let position: Position?
    var label: String?

    var body: some View {
        Text(label ?? position?.rawValue ?? "?")
            .font(.caption2.weight(.bold))
            .foregroundStyle(Palette.position(position))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Capsule().fill(Palette.position(position).opacity(0.16)))
            .lineLimit(1)
            .fixedSize()
    }
}

/// A small labelled number.
struct StatPill: View {
    let label: String
    let value: String
    var tint: Color = .primary

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value)
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .foregroundStyle(tint)
                .contentTransition(.numericText())
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}
