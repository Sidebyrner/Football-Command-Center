import SwiftUI

/// The top of a screen: where you are, and the one answer the screen exists
/// to give. A band in the screen's hue — the thing that makes Lineup look
/// like Lineup and not like Market.
struct ScreenHero<Trailing: View>: View {
    /// "LINEUP · SIT/START"
    let overline: String
    let systemImage: String
    /// The answer, big: "Lineup set", "1 swap".
    let answer: String
    /// One line of why.
    var detail: String?
    var stats: [(value: String, label: String)] = []
    var tone: StatusTone?
    @ViewBuilder var trailing: Trailing
    @Environment(\.hubTint) private var hubTint

    private var tint: Color { hubTint ?? .accentColor }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.m) {
            HStack(spacing: 6) {
                Image(systemName: systemImage).font(.caption.weight(.bold))
                Text(overline).textStyle(.micro)
                Spacer(minLength: 0)
                trailing
            }
            .foregroundStyle(tint)
            VStack(alignment: .leading, spacing: Space.xs) {
                HStack(alignment: .firstTextBaseline, spacing: Space.s) {
                    if let tone {
                        Image(systemName: tone.systemImage)
                            .font(.title2.weight(.semibold))
                            .foregroundStyle(tone.color)
                    }
                    Text(answer)
                        .textStyle(.display)
                        .lineLimit(2)
                        .minimumScaleFactor(0.6)
                        .contentTransition(.numericText())
                }
                if let detail {
                    Text(detail)
                        .textStyle(.body)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if !stats.isEmpty {
                HStack(alignment: .top, spacing: Space.xl) {
                    ForEach(Array(stats.enumerated()), id: \.offset) { _, stat in
                        StatValue(value: stat.value, label: stat.label, role: .title)
                    }
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(Space.l + 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ScreenHeroBackground(tint: tint))
        .accessibilityElement(children: .combine)
    }
}

extension ScreenHero where Trailing == EmptyView {
    init(overline: String, systemImage: String, answer: String, detail: String? = nil,
         stats: [(value: String, label: String)] = [], tone: StatusTone? = nil) {
        self.init(overline: overline, systemImage: systemImage, answer: answer, detail: detail,
                  stats: stats, tone: tone) { EmptyView() }
    }
}

/// The hero's band: the hue washing down into the card surface.
struct ScreenHeroBackground: View {
    let tint: Color
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Radius.hero, style: .continuous)
        shape
            .fill(Surface.card)
            .overlay(shape.fill(LinearGradient(
                colors: [tint.opacity(colorScheme == .dark ? 0.32 : 0.20), tint.opacity(0.04)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )))
            .overlay(shape.strokeBorder(tint.opacity(0.25), lineWidth: 1))
    }
}

/// Where the numbers come from and what they leave out — kept, but folded at
/// the bottom of a screen so the answer and evidence come first.
struct AboutThisData<Content: View>: View {
    @ViewBuilder let content: Content
    @State private var open = false

    var body: some View {
        DisclosureGroup(isExpanded: $open.animation(Motion.snappy)) {
            VStack(alignment: .leading, spacing: Space.xs) { content }
                .padding(.top, Space.s)
        } label: {
            Label("About this data", systemImage: "info.circle")
                .textStyle(.meta)
                .foregroundStyle(.secondary)
        }
        .tint(.secondary)
        .accessibilityIdentifier("about.data")
    }
}

/// A screen's frame: a hero, then its sections with room between them, then
/// the reference block, on the recessed page.
struct ScreenScaffold<Hero: View, Content: View, About: View>: View {
    @ViewBuilder let hero: Hero
    @ViewBuilder let content: Content
    @ViewBuilder let about: About

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.tier) {
                hero
                VStack(alignment: .leading, spacing: Space.tier) { content }
                AboutThisData { about }
            }
            .padding(.horizontal, Space.l)
            .padding(.vertical, Space.m)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Surface.page.ignoresSafeArea())
    }
}

/// A section: its header, then its content with the in-section spacing.
struct ScreenSection<Content: View>: View {
    let title: String
    var subtitle: String?
    var systemImage: String?
    var count: Int?
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: Space.m) {
            SectionHeader(title: title, subtitle: subtitle, systemImage: systemImage, count: count)
            content
        }
    }
}
