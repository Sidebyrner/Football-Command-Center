import SwiftUI
import UniformTypeIdentifiers

/// Something the tray can put on the grid: a panel kind, or a Metric panel
/// already set to one stat.
enum TrayItem: Hashable {
    case panel(PanelKind)
    case metric(PlayerMetric)

    /// What travels in the drag, so a drop from another window still works.
    var token: String {
        switch self {
        case .panel(let kind): return "panel:\(kind.rawValue)"
        case .metric(let metric): return "metric:\(metric.rawValue)"
        }
    }

    init?(token: String) {
        let parts = token.split(separator: ":", maxSplits: 1).map(String.init)
        guard parts.count == 2 else { return nil }
        switch parts[0] {
        case "panel": guard let kind = PanelKind(rawValue: parts[1]) else { return nil }; self = .panel(kind)
        case "metric": guard let metric = PlayerMetric(rawValue: parts[1]) else { return nil }; self = .metric(metric)
        default: return nil
        }
    }

    var kind: PanelKind {
        switch self {
        case .panel(let kind): return kind
        case .metric: return .metric
        }
    }

    var title: String {
        switch self {
        case .panel(let kind): return kind.title
        case .metric(let metric): return metric.label
        }
    }

    var systemImage: String {
        switch self {
        case .panel(let kind): return kind.systemImage
        case .metric(let metric): return metric.systemImage
        }
    }

    var summary: String {
        switch self {
        case .panel(let kind): return kind.summary
        case .metric(let metric): return "\(metric.label) for the clicked player — switch to your compare list or pinned players inside."
        }
    }

    /// A new panel for this item, sized by default and linked Blue when it links.
    func placement(at frame: GridRect) -> PanelPlacement {
        let link: LinkGroup? = (kind.publishesLink || kind.consumesLink) ? .one : nil
        var settings = PanelSettings.default
        if case .metric(let metric) = self {
            settings.extra = ["metric": metric.rawValue, "scope": MetricScope.player.rawValue]
        }
        return PanelPlacement(kind: kind, frame: frame, linkGroup: link, settings: settings)
    }

    /// The tray's sections, in the library's order, with every metric as its own item.
    static let sections: [(String, [TrayItem])] = PanelLibrarySheet.groups.map { title, kinds in
        (title, kinds.map(TrayItem.panel))
    } + [("One metric", PlayerMetric.allCases.map(TrayItem.metric))]
}

/// The panel tray: docked beside the grid while the layout is unlocked, and
/// it stays open. Click an item to drop it in the next free spot, or drag it
/// onto the grid exactly where you want it.
struct PanelTray: View {
    @ObservedObject var router: AppRouter
    let onAdd: (TrayItem) -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                if router.panelTrayExpanded {
                    Text("Panels").font(.subheadline.weight(.semibold))
                    Spacer()
                }
                Button {
                    withAnimation(Motion.snappy) { router.panelTrayExpanded.toggle() }
                } label: {
                    Image(systemName: router.panelTrayExpanded ? "sidebar.trailing" : "square.grid.2x2")
                }
                .buttonStyle(.plain)
                .help(router.panelTrayExpanded ? "Collapse the tray" : "Show the panel tray")
                .accessibilityLabel(router.panelTrayExpanded ? "Collapse the panel tray" : "Show the panel tray")
            }
            .padding(10)
            Divider()
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: router.panelTrayExpanded ? 12 : 6) {
                    if router.panelTrayExpanded {
                        Text("Click to add, or drag onto the grid.")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    ForEach(TrayItem.sections, id: \.0) { title, items in
                        VStack(alignment: .leading, spacing: 2) {
                            if router.panelTrayExpanded {
                                Text(title.uppercased())
                                    .font(.caption2.weight(.bold))
                                    .foregroundStyle(.secondary)
                                    .padding(.bottom, 2)
                            }
                            ForEach(items, id: \.self) { item in
                                tile(item)
                            }
                        }
                    }
                }
                .padding(10)
            }
        }
        .frame(width: router.panelTrayExpanded ? 230 : 52)
        .background(.regularMaterial)
        .overlay(alignment: .leading) { Divider() }
        .accessibilityIdentifier("workspace.tray")
    }

    private func tile(_ item: TrayItem) -> some View {
        Button {
            onAdd(item)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: item.systemImage)
                    .font(.subheadline)
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 26, height: 26)
                    .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(Color.accentColor.opacity(0.12)))
                if router.panelTrayExpanded {
                    Text(item.title)
                        .font(.caption.weight(.medium))
                        .lineLimit(1)
                        .foregroundStyle(.primary)
                    Spacer(minLength: 0)
                    Image(systemName: "plus")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.tertiary)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(PanelRowStyle())
        .help(item.summary)
        .accessibilityLabel("Add \(item.title)")
        .accessibilityIdentifier("tray.\(item.token)")
        .onDrag {
            router.trayDrag = item
            return NSItemProvider(object: item.token as NSString)
        }
    }
}

/// Drops from the tray onto the grid: a ghost where the panel would land and
/// the others pushed aside while hovering, then the panel placed on drop.
struct GridDropDelegate: DropDelegate {
    let cellWidth: CGFloat
    let panels: [PanelPlacement]
    let item: () -> TrayItem?
    @Binding var hover: WorkspaceGridView.InsertState?
    let onDrop: (PanelPlacement) -> Void

    func validateDrop(info: DropInfo) -> Bool {
        info.hasItemsConforming(to: [UTType.plainText, UTType.text]) || item() != nil
    }

    func dropEntered(info: DropInfo) { update(info) }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        update(info)
        return DropProposal(operation: .copy)
    }

    func dropExited(info: DropInfo) {
        hover = nil
    }

    func performDrop(info: DropInfo) -> Bool {
        defer { hover = nil }
        if let hover {
            onDrop(hover.panel)
            return true
        }
        // A drop we didn't see hovering — read the token.
        guard let provider = info.itemProviders(for: [UTType.plainText, UTType.text]).first else { return false }
        let rect = self.rect(at: info.location, size: TrayItem.panel(.news).kind.defaultSize)
        _ = provider.loadObject(ofClass: NSString.self) { object, _ in
            guard let token = object as? String, let item = TrayItem(token: token) else { return }
            Task { @MainActor in
                var frame = rect
                frame.w = min(item.kind.defaultSize.w, WorkspaceGeometry.columns - frame.x)
                frame.h = item.kind.defaultSize.h
                onDrop(item.placement(at: frame))
            }
        }
        return true
    }

    private func update(_ info: DropInfo) {
        guard let item = item() else { return }
        let rect = self.rect(at: info.location, size: item.kind.defaultSize)
        guard hover?.panel.frame != rect || hover?.item != item else { return }
        let panel = hover.map { existing -> PanelPlacement in
            var next = existing.panel
            next.frame = rect
            return next
        } ?? item.placement(at: rect)
        let preview = WorkspaceGeometry.inserting(panel, at: rect, into: panels)
        hover = WorkspaceGridView.InsertState(item: item, panel: panel, preview: preview)
    }

    /// The panel's top-left corner at the cell under the pointer, kept on the grid.
    private func rect(at location: CGPoint, size: GridSize) -> GridRect {
        let cell = WorkspaceGeometry.cell(at: location, cellWidth: cellWidth)
        let w = min(size.w, WorkspaceGeometry.columns)
        return GridRect(x: min(cell.x, WorkspaceGeometry.columns - w), y: cell.y, w: w, h: size.h)
    }
}
