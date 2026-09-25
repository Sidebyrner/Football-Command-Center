import SwiftUI

/// The desktop sidebar: the fixed screens grouped by section, with the user's
/// workspaces as their own section — each one a row, like a saved layout tab
/// on a trading desk.
struct SidebarView: View {
    @ObservedObject var router: AppRouter
    @ObservedObject var store: WorkspaceStore
    @State private var renaming: Workspace?
    @State private var renameText = ""
    @State private var deleting: Workspace?

    /// `List(selection:)` wants an optional; the sidebar must never clear the
    /// selection and leave an empty detail pane.
    private var selection: Binding<SidebarItem?> {
        Binding(
            get: { router.selection },
            set: { newValue in
                guard let newValue else { return }
                if let id = newValue.workspaceID { router.open(workspace: id) } else { router.selection = newValue }
            }
        )
    }

    var body: some View {
        List(selection: selection) {
            ForEach(SidebarSection.allCases) { section in
                if section == .workspaces {
                    workspacesSection
                } else {
                    let screens = RootView.Screen.sidebarCases.filter { $0.section == section }
                    if !screens.isEmpty {
                        Section(section.rawValue) {
                            ForEach(screens) { screen in
                                NavigationLink(value: SidebarItem.screen(screen)) {
                                    Label(screen.rawValue, systemImage: screen.systemImage)
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Command Center")
        .alert("Rename workspace", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $renameText)
            Button("Cancel", role: .cancel) { renaming = nil }
            Button("Rename") {
                if let renaming { store.rename(renaming.id, to: renameText) }
                renaming = nil
            }
        }
        .confirmationDialog(
            "Delete “\(deleting?.name ?? "")”?",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete workspace", role: .destructive) {
                if let deleting { delete(deleting) }
                deleting = nil
            }
        } message: {
            Text("Its layout is removed. The screens and your league data aren't affected.")
        }
    }

    private var workspacesSection: some View {
        Section {
            ForEach(store.workspaces) { workspace in
                NavigationLink(value: SidebarItem.workspace(workspace.id)) {
                    Label(workspace.name, systemImage: workspace.icon)
                }
                .contextMenu { menu(for: workspace) }
            }
            .onMove { store.move(fromOffsets: $0, toOffset: $1) }
            if store.workspaces.isEmpty {
                newWorkspaceMenu {
                    Label("Add a workspace", systemImage: "plus.rectangle.on.rectangle")
                        .foregroundStyle(.secondary)
                }
            }
        } header: {
            HStack {
                Text(SidebarSection.workspaces.rawValue)
                Spacer()
                newWorkspaceMenu {
                    Image(systemName: "plus")
                        .font(.caption.weight(.semibold))
                }
                .help("New workspace")
                .accessibilityLabel("New workspace")
            }
        }
    }

    private func newWorkspaceMenu<Label: View>(@ViewBuilder label: () -> Label) -> some View {
        Menu {
            Button {
                let workspace = store.addEmpty()
                router.open(workspace: workspace.id)
                router.workspaceEditing = true
                router.showPanelLibrary = true
            } label: {
                SwiftUI.Label("Empty workspace", systemImage: "square.dashed")
            }
            Section("From a preset") {
                ForEach(WorkspacePresets.all) { preset in
                    Button {
                        let workspace = store.add(preset: preset)
                        router.open(workspace: workspace.id)
                    } label: {
                        SwiftUI.Label(preset.name, systemImage: preset.icon)
                    }
                }
            }
        } label: {
            label()
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
    }

    @ViewBuilder
    private func menu(for workspace: Workspace) -> some View {
        Button("Rename…") {
            renameText = workspace.name
            renaming = workspace
        }
        Button("Duplicate") {
            if let copy = store.duplicate(workspace.id) { router.open(workspace: copy.id) }
        }
        if let presetID = workspace.presetID, let preset = WorkspacePresets.preset(id: presetID) {
            Button("Reset to “\(preset.name)” layout") { store.resetToPreset(workspace.id) }
        }
        Divider()
        Button("Delete…", role: .destructive) { deleting = workspace }
    }

    private func delete(_ workspace: Workspace) {
        if router.selection == .workspace(workspace.id) { router.open(.dashboard) }
        store.delete(workspace.id)
    }
}
