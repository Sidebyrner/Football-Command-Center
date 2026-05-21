import { useRef, useState } from 'react'
import { Upload, CheckCircle, AlertTriangle, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import useScoringProfileStore from '../../store/useScoringProfileStore'

export default function ScoringProfileManager() {
  const { activeProfile, uploadError, uploading, uploadScoringFile, resetToDefault } =
    useScoringProfileStore()
  const fileInputRef = useRef(null)
  const [expanded, setExpanded] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const result = uploadScoringFile(text, file.name)
    setUploadResult(result)
    e.target.value = ''
  }

  const isDefault = activeProfile.id === 'default-2026'

  return (
    <div className="border border-[var(--color-border)] rounded bg-[var(--color-surface-2)]">
      {/* Header row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)]">
            Scoring Profile
          </span>
          <span className="text-xs text-[var(--color-text-muted)] truncate max-w-[160px]">
            {activeProfile.name}
          </span>
          {!isDefault && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
              CUSTOM
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp size={14} className="text-[var(--color-text-faint)] flex-shrink-0" />
        ) : (
          <ChevronDown size={14} className="text-[var(--color-text-faint)] flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-[var(--color-border)]">
          {/* Profile info */}
          <div className="pt-2 space-y-1">
            {activeProfile.uploadedAt && (
              <p className="text-[10px] text-[var(--color-text-faint)]">
                Uploaded {new Date(activeProfile.uploadedAt).toLocaleString()}
              </p>
            )}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-[var(--color-text-muted)]">
              <span>Pass TD: <b className="text-[var(--color-text)]">{activeProfile.passingTD}</b></span>
              <span>INT: <b className="text-[var(--color-sit)]">{activeProfile.interception}</b></span>
              <span>Pass FD: <b className="text-[var(--color-text)]">+{activeProfile.passingFirstDown}</b></span>
              <span>Incomp: <b className="text-[var(--color-sit)]">{activeProfile.incompletion}</b></span>
              <span>Rush FD: <b className="text-[var(--color-text)]">+{activeProfile.rushingFirstDown}</b></span>
              <span>Rec FD: <b className="text-[var(--color-text)]">+{activeProfile.receivingFirstDown}</b></span>
              <span>Reception: <b className="text-[var(--color-text)]">{activeProfile.receptionPoints || 'None (non-PPR)'}</b></span>
              <span>FG 60+: <b className="text-[var(--color-accent)]">{activeProfile.fg60plus}</b></span>
            </div>
          </div>

          {/* Upload errors */}
          {uploadError && uploadError.length > 0 && (
            <div className="rounded bg-[var(--color-sit)]/10 border border-[var(--color-sit)]/30 px-2 py-1.5">
              <div className="flex items-center gap-1 mb-1">
                <AlertTriangle size={11} className="text-[var(--color-sit)]" />
                <span className="text-[10px] font-semibold text-[var(--color-sit)]">
                  {uploadError.length} parse warning{uploadError.length > 1 ? 's' : ''}
                </span>
              </div>
              <ul className="space-y-0.5">
                {uploadError.slice(0, 4).map((e, i) => (
                  <li key={i} className="text-[10px] text-[var(--color-text-muted)]">{e}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Success message */}
          {uploadResult?.success && (
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-start)]">
              <CheckCircle size={11} />
              Profile applied — evaluations recalculated
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded bg-[var(--color-accent)] text-black font-semibold hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
            >
              <Upload size={11} />
              {uploading ? 'Parsing…' : 'Upload Scoring File'}
            </button>

            {!isDefault && (
              <button
                onClick={() => { resetToDefault(); setUploadResult(null) }}
                className="flex items-center gap-1 text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text)] transition-colors"
              >
                <RefreshCw size={11} />
                Reset default
              </button>
            )}
          </div>

          <p className="text-[10px] text-[var(--color-text-faint)]">
            Upload a CSV or text file with one rule per line: <code className="opacity-70">event_name, value</code>
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt"
            onChange={handleFile}
            className="sr-only"
          />
        </div>
      )}
    </div>
  )
}
