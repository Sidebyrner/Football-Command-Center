import SwiftUI
import FCCore

/// The Waiver Board's top rows, ranked the way the board is sorted. The
/// position filter is the panel's own, so the board is left alone.
struct WaiverTargetsPanel: View {
    @ObservedObject var model: WaiverBoardModel
    let rows: Int
    let position: Position?

    private var shown: [WaiverRow] {
        let filtered = position.map { p in model.rows.filter { $0.position == p } } ?? model.rows
        return Array(filtered.prefix(rows))
    }

    var body: some View {
        PanelGate(hasContext: model.context != nil, isLoading: model.isLoading, error: model.errorMessage) {
            if shown.isEmpty {
                PanelMessage(style: .empty, text: "Nobody matches on the Waiver Board right now.")
            } else {
                PanelScroll {
                    ForEach(shown) { row in
                        PanelPlayerRow(
                            playerID: row.id, name: row.name, position: row.position,
                            detail: [row.position.rawValue, row.team, row.opponent].compactMap { $0 }.joined(separator: " · "),
                            badge: row.injuryTag.flatMap(Self.badge),
                            chip: row.availability == .freeAgent ? nil : row.availability.label
                        ) {
                            VStack(alignment: .trailing, spacing: 0) {
                                Text(value(row)).font(.caption.weight(.semibold).monospacedDigit())
                                Text(model.sort.unit).font(.caption2).foregroundStyle(.tertiary)
                            }
                        }
                        .panelPlayerTap(row.id, context: model.context)
                    }
                    PanelFootnote(text: "Ranked by \(model.sort.label.lowercased())\(position.map { " · \($0.rawValue) only" } ?? "").")
                }
            }
        }
    }

    private func value(_ row: WaiverRow) -> String {
        guard let value = row.value(model.sort) else { return "—" }
        if model.sort.isPercent { return "\(Int((value * 100).rounded()))%" }
        if model.sort == .trending { return "\(Int(value))" }
        if model.sort == .projectedOverLine { return PanelFormat.signed(value) }
        return PanelFormat.points(value)
    }

    static func badge(_ tag: String) -> String? {
        switch tag.uppercased() {
        case "QUESTIONABLE": return "Q"
        case "": return nil
        default: return StartAvailability.unavailableTags[tag.uppercased()]
        }
    }
}

/// A stream's top rows against the starter it would replace.
struct StreamPanel<Kind: StreamKind>: View {
    @ObservedObject var model: StreamScreenModel<Kind>
    let spec: StreamScreenSpec<Kind>
    let rows: Int

    var body: some View {
        PanelGate(hasContext: model.context != nil, isLoading: model.isLoading, error: model.errorMessage) {
            let shown = Array(model.rows.prefix(rows))
            if shown.isEmpty {
                PanelMessage(style: .empty, text: "No \(Kind.playerNoun)s to stream yet this week.")
            } else {
                PanelScroll {
                    if let incumbent = model.report?.incumbent {
                        HStack(spacing: 6) {
                            Text("To beat").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                            Text(incumbent.name).font(.caption.weight(.semibold)).lineLimit(1)
                            Spacer()
                            Text(StreamFormat.one(incumbent.expPts)).font(.caption.monospacedDigit())
                        }
                        .padding(.horizontal, 6)
                        .padding(.vertical, 4)
                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Palette.surface))
                    }
                    let top = (shown.map(\.ceilingP75).max() ?? 0) * 1.05
                    ForEach(Array(shown.enumerated()), id: \.element.id) { index, row in
                        VStack(alignment: .leading, spacing: 4) {
                            PanelPlayerRow(
                                playerID: row.playerID, name: row.name, position: row.platform,
                                detail: "\(row.roleLabel) · \(row.team) \(row.opponent)",
                                badge: injuryBadge(row)
                            ) {
                                VStack(alignment: .trailing, spacing: 0) {
                                    Text(StreamFormat.one(row.expPts)).font(.caption.weight(.bold).monospacedDigit())
                                    if let gain = row.expGain {
                                        Text(PanelFormat.signed(gain))
                                            .font(.caption2.monospacedDigit())
                                            .foregroundStyle(gain >= 0 ? Palette.start : Palette.sit)
                                    }
                                }
                            }
                            StreamRangeBar(floor: row.floorP25, expected: row.expPts, ceiling: row.ceilingP75,
                                           scaleMax: top, tint: Palette.position(row.platform))
                                .padding(.leading, 34)
                        }
                        .panelPlayerTap(row.playerID, context: model.context)
                        .accessibilityLabel("\(index + 1). \(row.name), \(StreamFormat.one(row.expPts)) expected points")
                    }
                    PanelFootnote(text: "Using the \(spec.title) screen's filters and risk mode.")
                }
            }
        }
    }

    private func injuryBadge(_ row: Kind.Projection) -> String? {
        if let id = row.playerID, let context = model.context,
           let badge = StartAvailability.of(id, context: context).badge {
            return badge
        }
        switch row.practice {
        case .Q: return "Q"
        case .D: return "Doubtful"
        case .OUT: return "Out"
        case .IR: return "IR"
        default: return nil
        }
    }
}

/// Teams whose spare players fit your need, from the Trade Desk. Linked, it
/// follows a clicked player ("Trade for…") or team (picked out in the list).
struct TradePartnersPanel: View {
    @ObservedObject var screen: TradeDeskScreenModel
    let rows: Int

    var body: some View {
        if let desk = screen.desk {
            TradePartnersPanelContent(desk: desk, rows: rows)
        } else if let error = screen.errorMessage, !screen.isLoading {
            PanelMessage(style: .error, text: error)
        } else {
            PanelMessage(style: .loading, text: "Loading…")
        }
    }
}

private struct TradePartnersPanelContent: View {
    @ObservedObject var desk: TradeWizardModel
    let rows: Int
    @EnvironmentObject private var linkBus: LinkBus
    @Environment(\.panelLinkGroup) private var linkGroup
    @Environment(\.linkPublish) private var publish
    @Environment(\.openTrade) private var openTrade
    @Environment(\.openScreen) private var openScreen
    /// The panel's own choice of need, so browsing here never moves the Trades screen.
    @State private var goalID: String?
    @State private var fits: [PartnerFit] = []

    private var linked: LinkedSelection? { linkBus.selection(for: linkGroup) }

    private var goal: TradeGoal? {
        desk.goals.first { $0.id == goalID } ?? desk.goals.first
    }

    var body: some View {
        PanelScroll {
            if desk.window.isClosed {
                PanelMessage(style: .empty, text: desk.window.label ?? "The trade deadline has passed.")
            } else {
                linkedPlayer
                if desk.goals.isEmpty {
                    Text("No clear needs on your roster — search any player from the Trades screen.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    goals
                    if fits.isEmpty {
                        Text("No team has a spare player that fits.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(fits.prefix(rows)) { fit in partnerRow(fit) }
                    }
                }
                if let label = desk.window.label {
                    PanelFootnote(text: label + ".")
                }
            }
        }
    }

    /// "Trade for…" or "Offer…" for whoever is selected in a linked panel.
    @ViewBuilder
    private var linkedPlayer: some View {
        if let id = linked?.playerID, let name = desk.context.playerName(id) {
            let availability = desk.context.availability(ofSleeperID: id)
            let prefill: TradeWizardPrefill? = {
                switch availability {
                case .rivalBench(let rosterID, _), .rivalStarter(let rosterID, _):
                    return TradeWizardPrefill(positions: desk.context.position(id).map { [$0] },
                                              rivalRosterID: rosterID, theirPlayerID: id)
                case .mine:
                    return TradeWizardPrefill(myPlayerID: id)
                default:
                    return nil
                }
            }()
            if let prefill {
                Button {
                    openTrade(prefill)
                } label: {
                    HStack(spacing: 8) {
                        PlayerAvatar(sleeperID: id, name: name, position: desk.context.position(id), size: 26)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(availability == .mine ? "Offer \(name)" : "Trade for \(name)")
                                .font(.caption.weight(.semibold))
                            Text(availability.label).font(.caption2).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "arrow.right.circle.fill").foregroundStyle(Color.accentColor)
                    }
                    .padding(8)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.accentColor.opacity(0.10)))
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressableStyle(scale: 0.98))
            }
        }
    }

    /// Your needs as chips that wrap, the chosen one filled.
    private var goals: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 6, alignment: .leading)], alignment: .leading, spacing: 6) {
            ForEach(desk.goals.prefix(6)) { option in
                let selected = option.id == goal?.id
                Button {
                    goalID = option.id
                } label: {
                    Text(option.title)
                        .font(.caption2.weight(selected ? .bold : .regular))
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .foregroundStyle(selected ? Color.accentColor : .primary)
                        .background(Capsule().fill(selected ? Color.accentColor.opacity(0.16) : Palette.surface))
                }
                .buttonStyle(.plain)
                .help(option.detail)
            }
        }
        .task(id: "\(goal?.id ?? "-")|\(desk.goals.count)") {
            fits = goal.map(desk.previewPartners(for:)) ?? []
        }
    }

    private func partnerRow(_ fit: PartnerFit) -> some View {
        let highlighted = linked?.rosterID == fit.rival.rosterID
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(fit.rival.manager).font(.caption.weight(.semibold)).lineLimit(1)
                if let letter = fit.grade?.letter { GradeChip(letter: letter) }
                Spacer()
                Button("Open deal") {
                    if let goal { desk.choose(goal: goal) }
                    desk.choose(partner: fit)
                    openScreen(.trades)
                }
                .font(.caption2.weight(.semibold))
                .buttonStyle(.borderless)
            }
            ForEach(fit.theirOffer.prefix(2)) { player in
                PanelPlayerRow(playerID: player.id, name: player.name, position: player.position,
                               detail: player.team, badge: player.injuryBadge) {
                    Text(PanelFormat.points(desk.value(player.id, desk.basis)))
                        .font(.caption.monospacedDigit())
                }
                .panelPlayerTap(player.id, context: desk.context)
            }
        }
        .padding(8)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(highlighted ? (linkGroup?.color ?? .accentColor).opacity(0.14) : Palette.surface)
        )
        .contentShape(Rectangle())
        .onTapGesture { publish(.team(fit.rival.rosterID)) }
    }
}

/// Everything on one player, following whoever was clicked in a panel of the
/// same link colour.
struct PlayerCardPanel: View {
    @ObservedObject var dashboard: DashboardModel
    let services: AppServices
    @EnvironmentObject private var linkBus: LinkBus
    @Environment(\.panelLinkGroup) private var linkGroup

    var body: some View {
        if let group = linkGroup {
            if let id = linkBus.selection(for: group)?.playerID, let context = dashboard.context {
                let model = services.playerCard(id, context: context)
                PlayerCardView(model: model)
                    .id(id)
                    .task(id: id) { await model.load() }
            } else if dashboard.context == nil {
                PanelMessage(style: .loading, text: "Loading…")
            } else {
                emptyState(group)
            }
        } else {
            PanelMessage(style: .empty, text: "Pick a link colour on this panel, then click a player in a panel of the same colour.")
        }
    }

    private func emptyState(_ group: LinkGroup) -> some View {
        VStack(spacing: 8) {
            Image(systemName: "hand.point.up.left")
                .font(.title2)
                .foregroundStyle(group.color)
            Text("Click a player in any \(group.name.lowercased()) panel")
                .font(.caption.weight(.semibold))
            Text("This card follows your clicks.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}
