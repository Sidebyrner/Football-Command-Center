/**
 * The game-context editor every stream shares the shape of — the port of
 * `StreamContextListView` (and of the RB/WR/IDP context editors, which are
 * the same list): import a context file, reset every edit, the teams playing
 * this week (tap one to edit it), and the per-player edits.
 */
import { useRef, useState, type ReactNode } from 'react'
import { Download, RotateCcw } from 'lucide-react'
import type { StreamKindTypes } from '@models/streams/StreamKind'
import type { StreamScreenModel } from '@models/streams/StreamScreenModel'
import { useModel } from '@ui/app/AppContext'
import { sourceBadge } from './format'
import { FormSection, Sheet } from './parts'
import type { StreamContextSource } from '@models/streams/StreamKind'

export function StreamContextListView<K extends StreamKindTypes>({ model: source, footer, row, editor, onClose }: {
  model: StreamScreenModel<K>
  footer: string
  row: (team: K['Team']) => ReactNode
  editor: (team: K['Team'], onClose: () => void) => ReactNode
  onClose: () => void
}) {
  const model = useModel(source)
  const [importMessage, setImportMessage] = useState<string>()
  const [editing, setEditing] = useState<K['Team']>()
  const fileRef = useRef<HTMLInputElement>(null)

  const handleImport = async (file: File | undefined) => {
    if (!file) return
    try {
      const counts = await model.importContext(await file.text())
      setImportMessage(`Imported ${counts.teams} teams and ${counts.players} player edits from ${file.name}.`)
    } catch (error) {
      setImportMessage(`Import failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const teams = Object.values(model.teams).sort((a, b) => (a.team < b.team ? -1 : a.team > b.team ? 1 : 0))
  const playerEdits = Object.keys(model.overrides.players).sort()
  const hasEdits = Object.keys(model.overrides.teams).length > 0 || playerEdits.length > 0

  return (
    <Sheet title="Game context" onClose={onClose} trailing={[{ label: 'Done', primary: true, onClick: onClose }]}>
      <FormSection footer={footer}>
        <button type="button" className="stream-form-row stream-link-row" onClick={() => fileRef.current?.click()}>
          <Download size={16} aria-hidden /> Import context JSON…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="stream-vh"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => { void handleImport(e.target.files?.[0]) }}
        />
        {importMessage !== undefined && <p className="stream-form-row t-meta muted" role="status">{importMessage}</p>}
        {hasEdits && (
          <button type="button" className="stream-form-row stream-link-row destructive" onClick={() => { void model.resetAllOverrides() }}>
            <RotateCcw size={16} aria-hidden /> Reset every edit this week
          </button>
        )}
      </FormSection>

      <FormSection header="Teams playing">
        {teams.map((team) => (
          <button key={team.team} type="button" className="stream-form-row stream-team-row" onClick={() => setEditing(team)}>
            {row(team)}
          </button>
        ))}
      </FormSection>

      {playerEdits.length > 0 && (
        <FormSection header="Player edits">
          {playerEdits.map((id) => (
            <div key={id} className="stream-form-row stream-edit-row">
              <span className="t-body">{model.context?.playerName(id) ?? id}</span>
              <button type="button" className="stream-mini-button" onClick={() => { void model.setPlayerOverride(undefined, id) }}>Clear</button>
            </div>
          ))}
        </FormSection>
      )}

      {editing !== undefined && editor(editing, () => setEditing(undefined))}
    </Sheet>
  )
}

/** "Auto", "No line" or who edited it — the badge on a context row. */
export function StreamSourceBadge({ sources }: { sources: StreamContextSource[] }) {
  const { label, edited } = sourceBadge(sources)
  return <span className={`stream-source-badge${edited ? ' edited' : ''}`}>{label}</span>
}

/** The two-line team row every stream's context list uses. */
export function TeamRow({ team, opponent, trailing, details, sources }: {
  team: string; opponent: string; trailing: ReactNode; details: ReactNode; sources: StreamContextSource[]
}) {
  return (
    <span className="stream-team-row-body">
      <span className="stream-team-line">
        <span className="t-body stream-strong">{team}</span>
        <span className="t-meta muted">{opponent}</span>
        <span className="stream-grow" />
        <span className="t-meta stream-num">{trailing}</span>
      </span>
      <span className="stream-team-line t-micro muted stream-plain">
        {details}
        <span className="stream-grow" />
        <StreamSourceBadge sources={sources} />
      </span>
    </span>
  )
}
