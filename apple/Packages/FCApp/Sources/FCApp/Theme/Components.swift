import SwiftUI
import FCCore

// MARK: - Cards

/// The standard card: raised off the page on a solid surface with a hairline
/// edge and, in light mode, a soft shadow. A custom `fill` (a tinted card)
/// keeps its colour and drops the lift.
struct CardModifier: ViewModifier {
    var padding: CGFloat = Space.l
    var fill: Color?
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                if let fill {
                    shape.fill(fill)
                } else {
                    shape.fill(Surface.card)
                        .overlay(shape.strokeBorder(Surface.stroke, lineWidth: 0.5))
                        .shadow(color: .black.opacity(colorScheme == .light ? 0.06 : 0), radius: 3, y: 1)
                }
            }
    }
}

extension View {
    func card(padding: CGFloat = Space.l, fill: Color? = nil) -> some View {
        modifier(CardModifier(padding: padding, fill: fill))
    }

    /// A block inside a card: recessed rather than raised.
    func inset(padding: CGFloat = Space.m) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: Radius.small, style: .continuous).fill(Surface.inset))
    }

    /// A verdict card: a raised card with the status colour as a bar down its
    /// leading edge — the colour marks the verdict without flooding the card.
    func callout(_ tone: StatusTone, padding: CGFloat = Space.l) -> some View {
        self.padding(.leading, 4)
            .card(padding: padding)
            .overlay(alignment: .leading) {
                UnevenRoundedRectangle(topLeadingRadius: Radius.card, bottomLeadingRadius: Radius.card,
                                       style: .continuous)
                    .fill(tone.color)
                    .frame(width: 4)
            }
    }
}

/// Card-style press feedback for tappable rows.
struct PressableCardStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
        configuration.label
            .background(
                shape.fill(configuration.isPressed ? Palette.surfaceRaised : Surface.card)
                    .overlay(shape.strokeBorder(Surface.stroke, lineWidth: 0.5))
            )
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(Motion.snappy, value: configuration.isPressed)
            .contentShape(shape)
    }
}

// MARK: - Headers

/// A section title with an optional one-line explanation of what the section is
/// for — every section should be able to say that in a sentence.
///
/// `.primary` sections lead with an icon in the screen's hue and a count;
/// `.reference` sections (sources, caveats) are small and muted.
struct SectionHeader: View {
    enum Tier { case primary, reference }

    let title: String
    var subtitle: String?
    var systemImage: String?
    var count: Int?
    var tier: Tier = .primary
    @Environment(\.hubTint) private var hubTint

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            switch tier {
            case .primary:
                HStack(spacing: Space.s) {
                    if let systemImage {
                        Image(systemName: systemImage)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(hubTint ?? .accentColor)
                            .frame(width: 22)
                    }
                    Text(title).textStyle(.section)
                    if let count {
                        Text("\(count)")
                            .font(.caption.weight(.bold).monospacedDigit())
                            .padding(.horizontal, 7)
                            .padding(.vertical, 1)
                            .background(Capsule().fill(Surface.inset))
                    }
                }
            case .reference:
                Text(title).textStyle(.micro).foregroundStyle(.secondary)
            }
            if let subtitle {
                Text(subtitle)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, tier == .primary && systemImage != nil ? 30 : 0)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Small pieces

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
        StatValue(value: value, label: label, role: .body, tint: tint)
    }
}

/// A number with its label under it: `display` in a hero, `title` in a row
/// of stats, `body` in a pill.
struct StatValue: View {
    let value: String
    let label: String
    var role: TypeRole = .title
    var tint: Color = .primary

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Group {
                if role == .body {
                    Text(value).font(.subheadline.weight(.semibold).monospacedDigit())
                } else {
                    Text(value).textStyle(role)
                }
            }
            .foregroundStyle(tint)
            .contentTransition(.numericText())
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            Text(label)
                .textStyle(.meta)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }
}

/// A status verdict as an icon and a word — colour never carries it alone.
struct StatusLabel: View {
    let tone: StatusTone
    let text: String

    var body: some View {
        Label(text, systemImage: tone.systemImage)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(tone.color)
    }
}

/// One filter or scope chip. Selected is a filled neutral — selection isn't
/// an action, so it doesn't borrow the accent.
struct FilterChip: View {
    let title: String
    var systemImage: String?
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if let systemImage { Image(systemName: systemImage) }
                Text(title).lineLimit(1)
            }
            .font(.footnote.weight(isSelected ? .semibold : .regular))
            .foregroundStyle(isSelected ? Surface.reversed : .primary)
            .padding(.horizontal, Space.m)
            .padding(.vertical, 6)
            .background(Capsule().fill(isSelected ? Color.primary : Surface.inset))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// Chips in a row that scrolls sideways when they don't fit.
struct ChipRow<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Space.s) { content }
                .padding(.vertical, 1)
        }
    }
}

/// A segmented control whose highlight slides between options. Used for the
/// mode pickers on Matchup and Planning so they look and move the same. The
/// selected option is a raised neutral pill, like the system's segments.
struct SlidingPicker<Option: Hashable>: View {
    let options: [Option]
    @Binding var selection: Option
    let label: (Option) -> String
    @Namespace private var highlight

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.self) { option in
                let selected = selection == option
                Button {
                    selection = option
                } label: {
                    Text(label(option))
                        .font(.footnote.weight(selected ? .semibold : .regular))
                        .foregroundStyle(selected ? Color.primary : Color.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background {
                            if selected {
                                Capsule()
                                    .fill(Surface.card)
                                    .shadow(color: .black.opacity(0.12), radius: 2, y: 1)
                                    .matchedGeometryEffect(id: "selection", in: highlight)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(3)
        .background(Capsule().fill(Surface.inset))
        .motion(Motion.snappy, value: selection)
        .sensoryFeedback(.selection, trigger: selection)
    }
}
