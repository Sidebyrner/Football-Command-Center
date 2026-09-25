import Foundation

/// Where the workspace library is kept.
public protocol WorkspacePersistence: Sendable {
    /// `nil` when nothing has been saved yet. Throws when a file exists but
    /// can't be read, so the store can set it aside rather than overwrite it.
    func load() throws -> WorkspaceLibrary?
    func save(_ library: WorkspaceLibrary) throws
    /// Keeps an unreadable file for inspection instead of losing it.
    func setAside()
}

/// One JSON file under Application Support — not `AppSettings`: the library is
/// nested and grows, and a bad decode here must never cost the league
/// selection stored there.
public struct FileWorkspacePersistence: WorkspacePersistence {
    public let fileURL: URL

    public init(directory: URL? = nil) {
        let base = directory ?? (FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory)
            .appendingPathComponent("FantasyCommandCenter", isDirectory: true)
            .appendingPathComponent("Workspaces", isDirectory: true)
        fileURL = base.appendingPathComponent("library.json")
    }

    public func load() throws -> WorkspaceLibrary? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        let data = try Data(contentsOf: fileURL)
        return try JSONDecoder().decode(WorkspaceLibrary.self, from: data)
    }

    public func save(_ library: WorkspaceLibrary) throws {
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(library).write(to: fileURL, options: .atomic)
    }

    public func setAside() {
        let aside = fileURL.deletingLastPathComponent().appendingPathComponent("library.corrupt.json")
        try? FileManager.default.removeItem(at: aside)
        try? FileManager.default.moveItem(at: fileURL, to: aside)
    }
}

/// For the demo league and tests: starts from the presets every launch.
public final class InMemoryWorkspacePersistence: WorkspacePersistence, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: WorkspaceLibrary?

    public init(_ library: WorkspaceLibrary? = nil) {
        stored = library
    }

    public func load() throws -> WorkspaceLibrary? {
        lock.lock(); defer { lock.unlock() }
        return stored
    }

    public func save(_ library: WorkspaceLibrary) throws {
        lock.lock(); defer { lock.unlock() }
        stored = library
    }

    public func setAside() {}
}

/// The user's workspaces. Every edit goes through here and is saved.
@MainActor
public final class WorkspaceStore: ObservableObject {
    @Published public private(set) var library: WorkspaceLibrary
    private let persistence: WorkspacePersistence
    private var pendingSave: Task<Void, Never>?

    public init(persistence: WorkspacePersistence) {
        self.persistence = persistence
        let loaded: WorkspaceLibrary?
        do {
            loaded = try persistence.load()
        } catch {
            persistence.setAside()
            loaded = nil
        }
        if var loaded {
            for index in loaded.workspaces.indices {
                loaded.workspaces[index].panels = WorkspaceGeometry.repaired(loaded.workspaces[index].panels)
            }
            library = loaded
        } else {
            library = WorkspacePresets.defaultLibrary()
            try? persistence.save(library)
        }
    }

    public var workspaces: [Workspace] { library.workspaces }

    public func workspace(id: UUID) -> Workspace? {
        library.workspaces.first { $0.id == id }
    }

    @discardableResult
    public func addEmpty(name: String = "New workspace") -> Workspace {
        let workspace = Workspace(name: uniqueName(name))
        library.workspaces.append(workspace)
        saveNow()
        return workspace
    }

    @discardableResult
    public func add(preset: WorkspacePreset) -> Workspace {
        var workspace = preset.makeWorkspace()
        workspace.name = uniqueName(preset.name)
        library.workspaces.append(workspace)
        saveNow()
        return workspace
    }

    public func rename(_ id: UUID, to name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        update(id) { $0.name = trimmed }
        flush()
    }

    public func setIcon(_ id: UUID, to icon: String) {
        update(id) { $0.icon = icon }
        flush()
    }

    @discardableResult
    public func duplicate(_ id: UUID) -> Workspace? {
        guard let index = library.workspaces.firstIndex(where: { $0.id == id }) else { return nil }
        var copy = library.workspaces[index]
        copy.id = UUID()
        copy.name = uniqueName(copy.name + " copy")
        copy.panels = copy.panels.map { var p = $0; p.id = UUID(); return p }
        library.workspaces.insert(copy, at: index + 1)
        saveNow()
        return copy
    }

    public func delete(_ id: UUID) {
        library.workspaces.removeAll { $0.id == id }
        saveNow()
    }

    public func move(fromOffsets source: IndexSet, toOffset destination: Int) {
        library.workspaces.move(fromOffsets: source, toOffset: destination)
        saveNow()
    }

    public func resetToPreset(_ id: UUID) {
        guard let presetID = workspace(id: id)?.presetID, let preset = WorkspacePresets.preset(id: presetID) else { return }
        update(id) { $0.panels = preset.panels() }
        flush()
    }

    /// Any change to one workspace. Saves are debounced, so a burst of edits
    /// (a drag, a resize) writes once.
    public func update(_ id: UUID, _ mutate: (inout Workspace) -> Void) {
        guard let index = library.workspaces.firstIndex(where: { $0.id == id }) else { return }
        mutate(&library.workspaces[index])
        scheduleSave()
    }

    /// Writes any pending change now.
    public func flush() {
        pendingSave?.cancel()
        pendingSave = nil
        saveNow()
    }

    private func scheduleSave() {
        pendingSave?.cancel()
        pendingSave = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard !Task.isCancelled else { return }
            self?.saveNow()
        }
    }

    private func saveNow() {
        try? persistence.save(library)
    }

    private func uniqueName(_ base: String) -> String {
        let names = Set(library.workspaces.map(\.name))
        guard names.contains(base) else { return base }
        var n = 2
        while names.contains("\(base) \(n)") { n += 1 }
        return "\(base) \(n)"
    }
}
