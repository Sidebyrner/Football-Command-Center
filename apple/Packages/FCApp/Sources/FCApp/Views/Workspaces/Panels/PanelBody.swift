import SwiftUI
import FCCore

/// The panel registry: each kind drawn from the same model instance its full
/// screen uses, so a panel never loads anything on its own.
struct PanelBody: View {
    let kind: PanelKind
    let settings: PanelSettings
    let services: AppServices

    static func defaultRows(_ kind: PanelKind) -> Int {
        switch kind {
        case .waiverTargets: return 8
        case .standings: return 12
        case .news: return 6
        default: return 5
        }
    }

    private var rows: Int { settings.topN ?? Self.defaultRows(kind) }

    var body: some View {
        switch kind {
        case .lineupReadiness:
            LineupReadinessPanel(model: services.dashboard)
        case .sitStart:
            SitStartPanel(model: services.sitStart)
        case .matchupScore:
            MatchupScorePanel(model: services.matchup)
        case .injuries:
            InjuriesPanel(model: services.injuries, rows: rows)
        case .waiverTargets:
            WaiverTargetsPanel(model: services.waivers, rows: rows, position: settings.positionFilter.flatMap(Position.init(rawValue:)))
        case .tradePartners:
            TradePartnersPanel(screen: services.trades, rows: rows)
        case .byeWeeks:
            ByeWeeksPanel(dashboard: services.dashboard, planning: services.planning)
        case .idpStream:
            StreamPanel(model: services.idpStream, spec: IDPStreamView.spec, rows: rows)
        case .wrStream:
            StreamPanel(model: services.wrStream, spec: WRStreamView.spec, rows: rows)
        case .rbStream:
            StreamPanel(model: services.rbStream, spec: RBStreamView.spec, rows: rows)
        case .news:
            NewsPanel(model: services.dashboard, rows: rows)
        case .standings:
            StandingsPanel(model: services.dashboard, rows: rows)
        case .playerCard:
            PlayerCardPanel(dashboard: services.dashboard, services: services)
        }
    }
}

// MARK: - Shared panel pieces

/// Scrolling content with the panel's standard inset.
struct PanelScroll<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.workspaceStaticWidth) private var staticWidth

    var body: some View {
        let stack = VStack(alignment: .leading, spacing: 8) {
            content
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        if staticWidth != nil {
            stack.frame(minHeight: 0, maxHeight: .infinity, alignment: .top).clipped()
        } else {
            ScrollView(.vertical) { stack }
        }
    }
}

/// Loading, failed, or not enough to show — sized for a panel, not a screen.
struct PanelMessage: View {
    enum Style { case loading, error, empty }
    let style: Style
    let text: String

    var body: some View {
        VStack(spacing: 8) {
            switch style {
            case .loading:
                ProgressView().controlSize(.small)
            case .error:
                Image(systemName: "exclamationmark.triangle").foregroundStyle(Palette.caution)
            case .empty:
                Image(systemName: "checkmark.circle").foregroundStyle(.tertiary)
            }
            Text(text)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The state every panel starts in: nothing until its model has a context.
struct PanelGate<Content: View>: View {
    let hasContext: Bool
    let isLoading: Bool
    let error: String?
    @ViewBuilder let content: Content

    var body: some View {
        if hasContext {
            content
        } else if let error, !isLoading {
            PanelMessage(style: .error, text: error)
        } else {
            PanelMessage(style: .loading, text: "Loading…")
        }
    }
}

/// A small caption line under a panel's rows — the basis, a count, a hint.
struct PanelFootnote: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption2)
            .foregroundStyle(.tertiary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 2)
    }
}

/// A compact player line: avatar, name with badges, a detail line, and a
/// number on the right.
struct PanelPlayerRow<Trailing: View>: View {
    let playerID: String?
    let name: String
    let position: Position?
    var detail: String? = nil
    var badge: String? = nil
    var chip: String? = nil
    @ViewBuilder let trailing: Trailing

    var body: some View {
        HStack(spacing: 8) {
            PlayerAvatar(sleeperID: playerID, name: name, position: position, size: 26)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text(name)
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                    if let badge { InjuryBadge(label: badge) }
                    if let chip {
                        Text(chip)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                if let detail {
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing
        }
        .foregroundStyle(.primary)
    }
}

enum PanelFormat {
    static func points(_ value: Double?) -> String {
        guard let value else { return "—" }
        return value.formatted(.number.precision(.fractionLength(1)))
    }

    static func signed(_ value: Double) -> String {
        (value >= 0 ? "+" : "") + value.formatted(.number.precision(.fractionLength(1)))
    }
}
