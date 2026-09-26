import SwiftUI

/// The iPhone's Board: the week at a glance as tiles you pick and order —
/// live score and games up top, the week's decisions, then the season. Each
/// tile opens the screen behind it.
struct BoardView: View {
    let services: AppServices
    @AppStorage("board.layout.v1") private var storedLayout: String?
    @State private var editing = false

    private var layout: BoardLayout { BoardLayout.decode(storedLayout) }

    var body: some View {
        ScrollView {
            BoardGrid(tiles: layout.visible) { tile in
                BoardTileView(tile: tile, services: services)
            }
            .padding(.horizontal)
            .padding(.bottom, 24)
            if layout.visible.isEmpty {
                ContentUnavailableView {
                    Label("No tiles", systemImage: "square.grid.2x2")
                } description: {
                    Text("Every tile is hidden.")
                } actions: {
                    Button("Choose tiles") { editing = true }
                }
            }
        }
        .refreshable { await services.loadIfConfigured(force: true) }
        .navigationTitle("Board")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Edit") { editing = true }
                    .accessibilityIdentifier("board.edit")
            }
        }
        .sheet(isPresented: $editing) {
            BoardEditSheet(layout: layout) { storedLayout = $0.encoded }
                .presentationDetents([.medium, .large])
        }
        .accessibilityIdentifier("board")
    }
}

/// Tiles two to a row: a full tile spans the row, half tiles pair up. Built
/// from stacks rather than a lazy grid so it also renders to an image.
struct BoardGrid<Tile: View>: View {
    let tiles: [BoardTile]
    @ViewBuilder let tile: (BoardTile) -> Tile

    var body: some View {
        VStack(spacing: 12) {
            ForEach(Array(BoardLayout.rows(tiles).enumerated()), id: \.offset) { _, row in
                HStack(alignment: .top, spacing: 12) {
                    ForEach(row) { item in
                        tile(item).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    }
                    if row.count == 1, row[0].width == .half {
                        Color.clear.frame(maxWidth: .infinity, maxHeight: 1)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// Show, hide and reorder the Board's tiles.
struct BoardEditSheet: View {
    @State private var draft: BoardLayout
    let onSave: (BoardLayout) -> Void
    @Environment(\.dismiss) private var dismiss

    init(layout: BoardLayout, onSave: @escaping (BoardLayout) -> Void) {
        _draft = State(initialValue: layout)
        self.onSave = onSave
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(draft.order) { tile in
                        Toggle(isOn: Binding(
                            get: { !draft.hidden.contains(tile) },
                            set: { shown in
                                if shown { draft.hidden.remove(tile) } else { draft.hidden.insert(tile) }
                            }
                        )) {
                            Label {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(tile.title)
                                    Text(tile.blurb).font(.caption).foregroundStyle(.secondary)
                                }
                            } icon: {
                                Image(systemName: tile.systemImage).foregroundStyle(Color.accentColor)
                            }
                        }
                        .accessibilityIdentifier("board.toggle.\(tile.rawValue)")
                    }
                    .onMove { from, to in draft.order.move(fromOffsets: from, toOffset: to) }
                } footer: {
                    Text("Drag to reorder. Hidden tiles stay here to switch back on.")
                }
                Section {
                    Button("Reset to default") { withAnimation(Motion.snappy) { draft = .standard } }
                        .disabled(draft == .standard)
                }
            }
            #if os(iOS)
            .environment(\.editMode, .constant(.active))
            #endif
            .navigationTitle("Board tiles")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { onSave(draft); dismiss() }
                        .accessibilityIdentifier("board.done")
                }
            }
        }
    }
}
