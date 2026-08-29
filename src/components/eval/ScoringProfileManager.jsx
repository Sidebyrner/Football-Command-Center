import { useRef, useState } from 'react'
import { Upload, CheckCircle, AlertTriangle, RefreshCw, ChevronDown, ChevronUp, Download, Loader2 } from 'lucide-react'
import useScoringProfileStore from '../../store/useScoringProfileStore'
import { useLeagueScoring } from '../../hooks/useLeagueScoring'

function Row({ label, value, tone }) {
  return (
    <span className="text-[11px] text-[var(--color-text-muted)]">
      {label}: <b className={tone ?? 'text-[var(--color-text)]'}>{value}</b>
    </span>
  )
}

/**
 * Scoring rules panel.
 *
 * Order of truth: the league's own settings from Sleeper > a manually uploaded
 * file > the built-in default. The default is a guess and is labelled as one.
 */
export default function ScoringProfileManager({ leagueId, leagueName }) {
  const {
    activeProfile, uploadError, uploading, uploadScoringFile, resetToDefault,
    pprFormat, unmappedRules, syncedAt, syncError,
  } = useScoringProfileStore()
  const { syncFromLeague, loading: syncing } = useLeagueScoring()

  const fileInputRef = useRef(null)
  const [expanded, setExpanded] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setUploadResult(uploadScoringFile(text, file.name))
    e.target.value = ''
  }

  const isDefault = activeProfile.id === 'default-2026'
  const fromSleeper = activeProfile.source === 'sleeper'

  return (
    <div className="border border-[var(--color-border)] rounded bg-[var(--color-surface-2)]">
      <div className="flex items-center justify-between px-3 py-2.5 gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-[var(--color-text)] truncate">
              {activeProfile.name}
            </span>
            {fromSleeper && (
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[var(--color-start)]/15 text-[var(--color-start)]">
                FROM LEAGUE
              </span>
            )}
            {isDefault && (
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[var(--color-caution)]/15 text-[var(--color-caution)]">
                ASSUMED DEFAULT
              </span>
            )}
          </div>

          {/* The single most consequential rule in the whole profile. */}
          {pprFormat && (
            <p className="text-[11px] text-[var(--color-accent)] font-semibold mt-1">
              {pprFormat.label}
            </p>
          )}
          {isDefault && (
            <p className="text-[10px] text-[var(--color-caution)] mt-1 leading-relaxed">
              These are built-in assumptions, not your league's rules. Pull them from Sleeper.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {leagueId && (
            <button
              onClick={() => syncFromLeague(leagueId, leagueName)}
              disabled={syncing}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded bg-[var(--color-accent)] text-black font-semibold hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            >
              {syncing ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
              {syncing ? 'Pulling…' : fromSleeper ? 'Re-sync' : 'Pull from Sleeper'}
            </button>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse scoring detail' : 'Expand scoring detail'}
            className="text-[var(--color-text-faint)] hover:text-[var(--color-text)] transition-colors"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {syncError && (
        <div className="mx-3 mb-2 flex items-start gap-1.5 rounded bg-[var(--color-sit)]/10 border border-[var(--color-sit)]/30 px-2 py-1.5">
          <AlertTriangle size={11} className="text-[var(--color-sit)] flex-shrink-0 mt-px" />
          <span className="text-[10px] text-[var(--color-text-muted)]">{syncError}</span>
        </div>
      )}

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-[var(--color-border)]">
          <div className="pt-2.5 grid grid-cols-2 gap-x-4 gap-y-1">
            <Row label="Pass TD" value={activeProfile.passingTD} />
            <Row label="INT" value={activeProfile.interception} tone="text-[var(--color-sit)]" />
            <Row label="Pass yds/pt" value={activeProfile.passingYardsPerPoint} />
            <Row label="Rush yds/pt" value={activeProfile.rushingYardsPerPoint} />
            <Row label="Rec yds/pt" value={activeProfile.receivingYardsPerPoint} />
            <Row label="Per reception" value={activeProfile.receptionPoints || 'none'} />
            <Row label="Pass 1st down" value={`+${activeProfile.passingFirstDown}`} />
            <Row label="Rush 1st down" value={`+${activeProfile.rushingFirstDown}`} />
            <Row label="Rec 1st down" value={`+${activeProfile.receivingFirstDown}`} />
            <Row label="Incompletion" value={activeProfile.incompletion} tone="text-[var(--color-sit)]" />
            <Row label="FG 50-59" value={activeProfile.fg50to59} />
            <Row label="FG 60+" value={activeProfile.fg60plus} tone="text-[var(--color-accent)]" />
          </div>

          {syncedAt && (
            <p className="text-[10px] text-[var(--color-text-faint)]">
              Synced from Sleeper {new Date(syncedAt).toLocaleString()}
            </p>
          )}

          {/* Admit what we pulled but do not model, rather than implying fidelity. */}
          {unmappedRules?.length > 0 && (
            <div className="rounded bg-[var(--color-surface)] border border-[var(--color-border)] px-2 py-1.5">
              <p className="text-[10px] text-[var(--color-text-muted)] leading-relaxed">
                <b className="text-[var(--color-caution)]">{unmappedRules.length} league rule
                {unmappedRules.length > 1 ? 's' : ''}</b> not used by the evaluation model:{' '}
                <span className="text-[var(--color-text-faint)]">{unmappedRules.join(', ')}</span>
              </p>
            </div>
          )}

          {uploadError?.length > 0 && (
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

          {uploadResult?.success && (
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-start)]">
              <CheckCircle size={11} />
              Profile applied — evaluations recalculated
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-50"
            >
              <Upload size={11} />
              {uploading ? 'Parsing…' : 'Upload file instead'}
            </button>
            {!isDefault && (
              <button
                onClick={() => { resetToDefault(); setUploadResult(null) }}
                className="flex items-center gap-1 text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text)] transition-colors"
              >
                <RefreshCw size={11} />
                Reset
              </button>
            )}
          </div>

          <p className="text-[10px] text-[var(--color-text-faint)]">
            Manual upload is for leagues Sleeper cannot describe. One rule per line:{' '}
            <code className="opacity-70">event_name, value</code>
          </p>

          <input ref={fileInputRef} type="file" accept=".csv,.txt" onChange={handleFile} className="sr-only" />
        </div>
      )}
    </div>
  )
}
