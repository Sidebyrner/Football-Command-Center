import SwiftUI
#if os(macOS)
import AppKit
#endif

/// One panel on the grid: a title bar (what it is, its link colour, its
/// options, a way into the full screen) over the panel's content.
struct PanelHost: View {
    struct Actions {
        let select: () -> Void
        let remove: () -> Void
        let setLinkGroup: (LinkGroup?) -> Void
        let setSettings: (PanelSettings) -> Void
        let moveChanged: (CGSize) -> Void
        let resizeChanged: (CGSize) -> Void
        let dragEnded: () -> Void
        /// dx, dy, dw, dh in cells.
        let nudge: (Int, Int, Int, Int) -> Void
    }

    let placement: PanelPlacement
    let editing: Bool
    let isSelected: Bool
    let services: AppServices
    let actions: Actions

    @Environment(\.openScreen) private var openScreen
    #if os(macOS)
    @State private var cursorPushed = false
    #endif

    private var kind: PanelKind { placement.kind }

    var body: some View {
        VStack(spacing: 0) {
            titleBar
            Divider().opacity(0.6)
            PanelBody(kind: kind, settings: placement.settings, services: services)
                .environment(\.inWorkspacePanel, true)
                .environment(\.panelLinkGroup, placement.linkGroup)
                .environment(\.linkPublish, LinkPublishAction(group: placement.linkGroup) { [linkBus = services.linkBus] change in
                    if let group = placement.linkGroup { linkBus.publish(change, to: group) }
                })
                .environment(\.panelCompare, compareAction)
                .environment(\.panelSettingsUpdate, PanelSettingsUpdate(settings: placement.settings, apply: actions.setSettings))
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                // Unlocked, the content is inert so a drag always means "move".
                .allowsHitTesting(!editing)
                .opacity(editing ? 0.75 : 1)
        }
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(.background))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(border, lineWidth: isSelected ? 2 : 1)
        )
        .overlay(alignment: .bottomTrailing) {
            if editing { resizeHandle }
        }
        .shadow(color: .black.opacity(0.05), radius: 4, y: 1)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(kind.title)
        .accessibilityIdentifier("workspace.panel.\(kind.rawValue)")
        .accessibilityActions { if editing { editingAccessibilityActions } }
    }

    /// A Metric panel is titled by its metric.
    private var title: String {
        if kind == .metric, let metric = placement.settings.extra["metric"].flatMap(PlayerMetric.init(rawValue:)) {
            return metric.label
        }
        return kind.title
    }

    /// The link colour's compare list, for every row in this panel.
    private var compareAction: PanelCompareAction {
        guard let group = placement.linkGroup else { return .none }
        let bus = services.linkBus
        return PanelCompareAction(
            group: group,
            isComparing: { bus.isComparing($0, in: group) },
            canAdd: { bus.canAddToCompare(in: group) },
            toggle: { id in
                bus.publish(bus.isComparing(id, in: group) ? .removeCompare(id) : .addCompare(id), to: group)
            }
        )
    }

    private var border: Color {
        if isSelected { return .accentColor }
        if let group = placement.linkGroup { return group.color.opacity(0.45) }
        return Color.secondary.opacity(0.18)
    }

    // MARK: - Title bar

    private var titleBar: some View {
        HStack(spacing: 8) {
            if editing {
                Image(systemName: "line.3.horizontal")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            Image(systemName: kind.systemImage)
                .font(.subheadline)
                .foregroundStyle(placement.linkGroup?.color ?? .secondary)
                .frame(width: 18)
            Text(title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
            Spacer(minLength: 4)
            if kind.publishesLink || kind.consumesLink {
                LinkSwatch(group: placement.linkGroup, onChange: actions.setLinkGroup)
            }
            if editing {
                Button(role: .destructive, action: actions.remove) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.body)
                        .symbolRenderingMode(.hierarchical)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help("Remove panel")
                .accessibilityLabel("Remove \(kind.title)")
            } else {
                PanelOptionsMenu(kind: kind, settings: placement.settings, onChange: actions.setSettings)
                if let screen = kind.fullScreen {
                    Button { openScreen(screen) } label: {
                        Image(systemName: "arrow.up.forward.square")
                            .font(.body)
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .help("Open \(screen.rawValue)")
                    .accessibilityLabel("Open \(screen.rawValue)")
                }
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 38)
        .background(editing ? Color.primary.opacity(0.03) : .clear)
        .contentShape(Rectangle())
        .onTapGesture { if editing { actions.select() } }
        .gesture(editing ? moveGesture : nil)
        #if os(macOS)
        .onHover { inside in
            if inside, editing, !cursorPushed {
                NSCursor.openHand.push()
                cursorPushed = true
            } else if !inside, cursorPushed {
                NSCursor.pop()
                cursorPushed = false
            }
        }
        .onChange(of: editing) { _, now in
            if !now, cursorPushed {
                NSCursor.pop()
                cursorPushed = false
            }
        }
        #endif
    }

    private var moveGesture: some Gesture {
        DragGesture(minimumDistance: 3, coordinateSpace: .named(WorkspaceGridView.coordinateSpace))
            .onChanged { actions.moveChanged($0.translation) }
            .onEnded { _ in actions.dragEnded() }
    }

    // MARK: - Resize

    private var resizeHandle: some View {
        Image(systemName: "arrow.down.right")
            .font(.caption2.weight(.bold))
            .foregroundStyle(.white)
            .frame(width: 20, height: 20)
            .background(Circle().fill(Color.accentColor))
            .padding(6)
            .contentShape(Rectangle().inset(by: -6))
            .gesture(
                DragGesture(minimumDistance: 2, coordinateSpace: .named(WorkspaceGridView.coordinateSpace))
                    .onChanged { actions.resizeChanged($0.translation) }
                    .onEnded { _ in actions.dragEnded() }
            )
            .help("Drag to resize")
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var editingAccessibilityActions: some View {
        Button("Move left") { actions.nudge(-1, 0, 0, 0) }
        Button("Move right") { actions.nudge(1, 0, 0, 0) }
        Button("Move up") { actions.nudge(0, -1, 0, 0) }
        Button("Move down") { actions.nudge(0, 1, 0, 0) }
        Button("Wider") { actions.nudge(0, 0, 1, 0) }
        Button("Narrower") { actions.nudge(0, 0, -1, 0) }
        Button("Taller") { actions.nudge(0, 0, 0, 1) }
        Button("Shorter") { actions.nudge(0, 0, 0, -1) }
        Button("Remove") { actions.remove() }
    }
}

/// The link colour, like a trading desk's grouping block: panels of one colour
/// follow the same player. Always visible, even when the layout is locked.
struct LinkSwatch: View {
    let group: LinkGroup?
    let onChange: (LinkGroup?) -> Void

    var body: some View {
        Menu {
            Section("Link colour") {
                ForEach(LinkGroup.allCases) { option in
                    Button {
                        onChange(option)
                    } label: {
                        Label(option.name, systemImage: option == group ? "checkmark.circle.fill" : "circle.fill")
                    }
                }
            }
            Button {
                onChange(nil)
            } label: {
                Label("Not linked", systemImage: group == nil ? "checkmark" : "circle.slash")
            }
        } label: {
            ZStack {
                Circle()
                    .fill(group?.color ?? .clear)
                Circle()
                    .strokeBorder(group == nil ? Color.secondary.opacity(0.6) : Color.white.opacity(0.6),
                                  style: StrokeStyle(lineWidth: 1.5, dash: group == nil ? [2, 2] : []))
            }
            .frame(width: 14, height: 14)
            .padding(4)
            .contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .help(group.map { "Linked: \($0.name). Panels of the same colour follow one player." }
              ?? "Not linked. Pick a colour to make this panel follow, or drive, other panels.")
        .accessibilityLabel(group.map { "Link colour \($0.name)" } ?? "Not linked")
    }
}

/// Per-panel options: how many rows, and a position filter where it helps.
/// They live on the panel, never on the shared model, so the full screen is
/// unaffected.
struct PanelOptionsMenu: View {
    let kind: PanelKind
    let settings: PanelSettings
    let onChange: (PanelSettings) -> Void

    private var rowChoices: [Int]? {
        switch kind {
        case .injuries, .waiverTargets, .idpStream, .wrStream, .rbStream, .qbStream, .dstStream, .kStream, .news, .standings, .tradePartners:
            return [3, 5, 8, 12]
        case .discovery: return [8, 12, 20, 40]
        case .gameLog, .trendChart, .compare, .metric: return [4, 6, 8, 12]
        case .playerNews: return [3, 5, 8]
        default:
            return nil
        }
    }

    private var rowsLabel: String {
        switch kind {
        case .gameLog, .trendChart, .compare, .metric: return "Last games"
        default: return "Rows"
        }
    }

    private var positionChoices: [String]? {
        switch kind {
        case .waiverTargets: return ["QB", "RB", "WR", "TE", "K", "DEF"]
        case .discovery: return ["QB", "RB", "WR", "TE", "K", "DEF", "LB", "DL", "DB"]
        default: return nil
        }
    }

    private var metricChoices: [PlayerMetric]? { kind == .trendChart ? PlayerMetric.allCases : nil }
    private var sortChoices: [DiscoverySort]? { kind == .discovery ? DiscoverySort.all : nil }

    var body: some View {
        if rowChoices != nil || positionChoices != nil || metricChoices != nil || sortChoices != nil {
            Menu {
                if let metricChoices {
                    Picker("Chart", selection: Binding(
                        get: { TrendComparison.metric(storedAs: settings.extra["metric"]) ?? .fantasyPoints },
                        set: { var next = settings; next.extra["metric"] = $0.rawValue; onChange(next) }
                    )) {
                        ForEach(metricChoices) { Text($0.label).tag($0) }
                    }
                }
                if let sortChoices {
                    Picker("Sort", selection: Binding(
                        get: { settings.extra["sort"] ?? "" },
                        set: { var next = settings; next.extra["sort"] = $0.isEmpty ? nil : $0; onChange(next) }
                    )) {
                        Text("Follow the list").tag("")
                        ForEach(sortChoices) { Text($0.label).tag($0.storageKey) }
                    }
                }
                if let rowChoices {
                    Picker(rowsLabel, selection: Binding(
                        get: { settings.topN ?? PanelBody.defaultRows(kind) },
                        set: { var next = settings; next.topN = $0; onChange(next) }
                    )) {
                        ForEach(rowChoices, id: \.self) { Text(rowsLabel == "Rows" ? "\($0) rows" : "Last \($0)").tag($0) }
                    }
                }
                if let positionChoices {
                    Picker("Position", selection: Binding(
                        get: { settings.positionFilter ?? "" },
                        set: { var next = settings; next.positionFilter = $0.isEmpty ? nil : $0; onChange(next) }
                    )) {
                        Text("All positions").tag("")
                        ForEach(positionChoices, id: \.self) { Text($0).tag($0) }
                    }
                }
            } label: {
                Image(systemName: "slider.horizontal.3")
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .help("Panel options")
            .accessibilityLabel("\(kind.title) options")
        }
    }
}
