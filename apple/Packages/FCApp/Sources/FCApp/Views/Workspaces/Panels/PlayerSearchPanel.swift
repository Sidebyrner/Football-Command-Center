import SwiftUI
import FCCore
import FCData

/// A slim search down the side of a board: click a result to light up the
/// linked panels with him, ＋ (or ⌘-click) to add him to the colour's
/// comparison. The compared players stay pinned at the top.
struct PlayerSearchPanel: View {
    let services: AppServices
    let rows: Int
    @EnvironmentObject private var linkBus: LinkBus
    @Environment(\.panelLinkGroup) private var group
    @Environment(\.linkPublish) private var publish
    @State private var query = ""

    var body: some View {
        PlayerSearchContent(discovery: services.discovery, rows: rows, group: group,
                            compared: linkBus.compareList(for: group),
                            focused: linkBus.selection(for: group)?.playerID,
                            canAdd: linkBus.canAddToCompare(in: group),
                            publish: publish, query: $query)
    }
}

private struct PlayerSearchContent: View {
    @ObservedObject var discovery: DiscoveryModel
    let rows: Int
    let group: LinkGroup?
    let compared: [String]
    let focused: String?
    let canAdd: Bool
    let publish: LinkPublishAction
    @Binding var query: String

    var body: some View {
        if let context = discovery.context {
            VStack(alignment: .leading, spacing: 6) {
                field
                if group == nil {
                    Text("Pick a link colour so clicks reach other panels.")
                        .font(.caption2)
                        .foregroundStyle(Palette.caution)
                        .padding(.horizontal, 8)
                }
                PanelScroll {
                    if !compared.isEmpty { comparedList(context) }
                    let results = PlayerLookup.matches(query, in: context, limit: rows)
                    if query.trimmingCharacters(in: .whitespaces).isEmpty {
                        Text(compared.isEmpty ? "Type a name. Click to focus, ＋ to compare." : "Type to add more.")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    } else if results.isEmpty {
                        Text("No player matches.").font(.caption2).foregroundStyle(.secondary)
                    }
                    ForEach(results, id: \.id) { player in
                        resultRow(player, context: context)
                    }
                }
            }
            .padding(.top, 8)
        } else {
            PanelMessage(style: .loading, text: "Loading…")
        }
    }

    private var field: some View {
        HStack(spacing: 5) {
            Image(systemName: "magnifyingglass").font(.caption).foregroundStyle(.secondary)
            TextField("Search", text: $query)
                .textFieldStyle(.plain)
                .font(.caption)
            if !query.isEmpty {
                Button { query = "" } label: {
                    Image(systemName: "xmark.circle.fill").font(.caption).foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 5)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Palette.surface))
        .padding(.horizontal, 8)
    }

    private func comparedList(_ context: LeagueContext) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("COMPARING").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
            ForEach(Array(compared.enumerated()), id: \.element) { offset, id in
                HStack(spacing: 5) {
                    Circle().fill(ChartPalette.color(offset)).frame(width: 7, height: 7)
                    Text(StreamFormat.shortName(context.playerName(id) ?? id))
                        .font(.caption.weight(id == focused ? .bold : .medium))
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .panelPlayerTap(id, context: context)
                    Button {
                        publish(.removeCompare(id))
                    } label: {
                        Image(systemName: "xmark.circle.fill").font(.caption).foregroundStyle(.tertiary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove \(context.playerName(id) ?? id) from compare")
                }
            }
        }
        .padding(6)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Palette.surface))
    }

    private func resultRow(_ player: IndexedPlayer, context: LeagueContext) -> some View {
        let comparing = compared.contains(player.id)
        return HStack(spacing: 4) {
            HStack(spacing: 6) {
                PlayerAvatar(sleeperID: player.id, name: player.name, position: player.position, size: 22)
                VStack(alignment: .leading, spacing: 0) {
                    Text(StreamFormat.shortName(player.name))
                        .font(.caption.weight(player.id == focused ? .bold : .semibold))
                        .lineLimit(1)
                    Text([player.position?.rawValue, player.team].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .panelPlayerTap(player.id, context: context)
            .help(player.name)
            if group != nil {
                Button {
                    publish(comparing ? .removeCompare(player.id) : .addCompare(player.id))
                } label: {
                    Image(systemName: comparing ? "checkmark.circle.fill" : "plus.circle")
                        .foregroundStyle(comparing ? Color.accentColor : .secondary)
                }
                .buttonStyle(.plain)
                .disabled(!comparing && !canAdd)
                .help(comparing ? "Remove from compare" : "Add to compare")
                .accessibilityLabel(comparing ? "Remove \(player.name) from compare" : "Add \(player.name) to compare")
            }
        }
    }
}
