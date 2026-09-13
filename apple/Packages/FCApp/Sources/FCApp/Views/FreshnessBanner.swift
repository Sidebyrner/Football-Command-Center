import SwiftUI
import FCData

/// The one place freshness gets rendered, so every screen says it the same way.
public struct FreshnessBanner: View {
    let provenance: Provenance

    public init(provenance: Provenance) {
        self.provenance = provenance
    }

    public var body: some View {
        if let label = Freshness.label(for: provenance) {
            HStack(spacing: 6) {
                Image(systemName: Freshness.isDegraded(provenance)
                    ? "exclamationmark.triangle.fill"
                    : "clock")
                    .imageScale(.small)
                Text(label)
                    .font(.footnote)
            }
            .foregroundStyle(Freshness.isDegraded(provenance) ? Palette.caution : Color.secondary)
            .accessibilityElement(children: .combine)
        }
    }
}

/// A short, non-alarming note for a position the data simply does not cover.
/// It is a statement of scope, not an error, and is styled accordingly (§3.2).
public struct CoverageNote: View {
    let text: String

    public init(text: String) {
        self.text = text
    }

    public var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "info.circle")
                .imageScale(.small)
                .foregroundStyle(.secondary)
            Text(text)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 4)
    }
}
