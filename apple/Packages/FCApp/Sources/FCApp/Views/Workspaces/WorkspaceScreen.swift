import SwiftUI

/// A workspace: the user's own arrangement of panels, with a lock so a
/// finished layout can't be nudged by accident.
struct WorkspaceScreen: View {
    let workspaceID: UUID
    @ObservedObject var store: WorkspaceStore
    @ObservedObject var router: AppRouter
    let services: AppServices

    @State private var renaming = false
    @State private var renameText = ""
    @State private var confirmingDelete = false

    var body: some View {
        if let workspace = store.workspace(id: workspaceID) {
            content(workspace)
        } else {
            ContentUnavailableView("Workspace removed", systemImage: "square.dashed",
                                   description: Text("Pick another from the sidebar, or make a new one."))
        }
    }

    @ViewBuilder
    private func content(_ workspace: Workspace) -> some View {
        Group {
            if workspace.panels.isEmpty {
                emptyState(workspace)
            } else {
                WorkspaceGridView(
                    workspace: workspace,
                    editing: router.workspaceEditing,
                    services: services,
                    selectedPanelID: $router.selectedPanelID,
                    onUpdate: { mutate in store.update(workspaceID, mutate) }
                )
            }
        }
        .navigationTitle(workspace.name)
        .toolbar { toolbar(workspace) }
        .sheet(isPresented: $router.showPanelLibrary) {
            PanelLibrarySheet(existing: Set(workspace.panels.map(\.kind))) { kind in add(kind) }
        }
        #if os(macOS)
        .onDeleteCommand {
            guard router.workspaceEditing, let id = router.selectedPanelID else { return }
            withAnimation(Motion.snappy) { store.update(workspaceID) { $0.panels.removeAll { $0.id == id } } }
            router.selectedPanelID = nil
        }
        #endif
        .onDisappear { store.flush() }
        .alert("Rename workspace", isPresented: $renaming) {
            TextField("Name", text: $renameText)
            Button("Cancel", role: .cancel) {}
            Button("Rename") { store.rename(workspaceID, to: renameText) }
        }
        .confirmationDialog("Delete “\(workspace.name)”?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete workspace", role: .destructive) {
                router.open(.dashboard)
                store.delete(workspaceID)
            }
        } message: {
            Text("Its layout is removed. The screens and your league data aren't affected.")
        }
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private func toolbar(_ workspace: Workspace) -> some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            if router.workspaceEditing {
                Button {
                    router.showPanelLibrary = true
                } label: {
                    Label("Add panel", systemImage: "plus.rectangle.on.rectangle")
                }
                .accessibilityIdentifier("workspace.addPanel")
                .help("Add a panel (⇧⌘A)")
            }
            Button {
                toggleEditing()
            } label: {
                if router.workspaceEditing {
                    Label("Done", systemImage: "lock.open.fill")
                } else {
                    Label("Edit layout", systemImage: "lock.fill")
                }
            }
            .help(router.workspaceEditing ? "Lock the layout (⌘E)" : "Unlock to move, resize and add panels (⌘E)")
            .accessibilityIdentifier("workspace.edit")
            Menu {
                Button {
                    withAnimation(Motion.snappy) {
                        store.update(workspaceID) { $0.panels = WorkspaceGeometry.compacted($0.panels) }
                    }
                } label: {
                    Label("Tidy up", systemImage: "rectangle.3.group")
                }
                .disabled(workspace.panels.isEmpty)
                if let presetID = workspace.presetID, let preset = WorkspacePresets.preset(id: presetID) {
                    Button {
                        withAnimation(Motion.snappy) { store.resetToPreset(workspaceID) }
                    } label: {
                        Label("Reset to “\(preset.name)” layout", systemImage: "arrow.counterclockwise")
                    }
                }
                Divider()
                Button {
                    renameText = workspace.name
                    renaming = true
                } label: {
                    Label("Rename…", systemImage: "pencil")
                }
                Menu {
                    ForEach(Self.icons, id: \.self) { icon in
                        Button {
                            store.setIcon(workspaceID, to: icon)
                        } label: {
                            Label(icon == workspace.icon ? "Current" : " ", systemImage: icon)
                        }
                    }
                } label: {
                    Label("Icon", systemImage: workspace.icon)
                }
                Button {
                    if let copy = store.duplicate(workspaceID) { router.open(workspace: copy.id) }
                } label: {
                    Label("Duplicate", systemImage: "plus.square.on.square")
                }
                Divider()
                Button(role: .destructive) {
                    confirmingDelete = true
                } label: {
                    Label("Delete…", systemImage: "trash")
                }
            } label: {
                Label("Workspace", systemImage: "ellipsis.circle")
            }
        }
    }

    static let icons = [
        "square.grid.2x2", "sportscourt", "tray.and.arrow.down", "arrow.triangle.swap", "chart.bar.xaxis",
        "calendar", "star", "bolt", "flame", "shield.lefthalf.filled", "list.bullet.rectangle", "binoculars",
    ]

    private func toggleEditing() {
        withAnimation(Motion.snappy) {
            router.workspaceEditing.toggle()
            if !router.workspaceEditing {
                router.selectedPanelID = nil
                store.flush()
            }
        }
    }

    // MARK: - Empty

    private func emptyState(_ workspace: Workspace) -> some View {
        ContentUnavailableView {
            Label("An empty workspace", systemImage: "square.grid.2x2")
        } description: {
            Text("Add the panels you want to watch together — your lineup, a stream, the Player Card — and arrange them your way.")
        } actions: {
            Button {
                router.workspaceEditing = true
                router.showPanelLibrary = true
            } label: {
                Label("Add a panel", systemImage: "plus.rectangle.on.rectangle")
            }
            .buttonStyle(.borderedProminent)
            Menu("Start from a preset") {
                ForEach(WorkspacePresets.all) { preset in
                    Button {
                        withAnimation(Motion.snappy) {
                            store.update(workspaceID) {
                                $0.panels = preset.panels()
                                $0.presetID = preset.id
                            }
                        }
                    } label: {
                        Label(preset.name, systemImage: preset.icon)
                    }
                }
            }
            .fixedSize()
        }
    }

    private func add(_ kind: PanelKind) {
        withAnimation(Motion.snappy) {
            var added: UUID?
            store.update(workspaceID) { workspace in
                let frame = WorkspaceGeometry.firstFreeSlot(size: kind.defaultSize, in: workspace.panels)
                let link: LinkGroup? = (kind.publishesLink || kind.consumesLink) ? .one : nil
                let panel = PanelPlacement(kind: kind, frame: frame, linkGroup: link)
                workspace.panels.append(panel)
                added = panel.id
            }
            router.selectedPanelID = added
        }
    }
}

/// Every panel, what it shows, and Add. Panels already on the workspace are
/// marked but can be added again — two stream panels on different filters is fine.
struct PanelLibrarySheet: View {
    let existing: Set<PanelKind>
    let onAdd: (PanelKind) -> Void
    @Environment(\.dismiss) private var dismiss

    private let groups: [(String, [PanelKind])] = [
        ("This week", [.lineupReadiness, .sitStart, .matchupScore, .injuries]),
        ("Market", [.waiverTargets, .tradePartners, .idpStream, .wrStream, .rbStream]),
        ("Season", [.byeWeeks, .standings, .news]),
        ("Players", [.playerCard]),
    ]

    var body: some View {
        NavigationStack {
            List {
                ForEach(groups, id: \.0) { title, kinds in
                    Section(title) {
                        ForEach(kinds) { kind in row(kind) }
                    }
                }
            }
            .navigationTitle("Add a panel")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 460, minHeight: 520)
        #endif
    }

    private func row(_ kind: PanelKind) -> some View {
        HStack(spacing: 12) {
            Image(systemName: kind.systemImage)
                .font(.title3)
                .foregroundStyle(Color.accentColor)
                .frame(width: 32, height: 32)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.accentColor.opacity(0.12)))
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(kind.title).font(.subheadline.weight(.semibold))
                    if existing.contains(kind) {
                        Text("On this workspace")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                Text(kind.summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Button {
                onAdd(kind)
                dismiss()
            } label: {
                Text("Add")
            }
            .buttonStyle(.bordered)
            .accessibilityLabel("Add \(kind.title)")
            .accessibilityIdentifier("library.add.\(kind.rawValue)")
        }
        .padding(.vertical, 4)
    }
}
