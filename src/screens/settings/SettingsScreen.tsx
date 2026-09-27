/**
 * Setup and settings — the port of `SettingsView`: username, then league, then
 * which team is yours; accent colour; the optional relay. Web additions: try
 * the demo league, and export/import your setup between devices.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, Download, FlaskConical, Palette, Server, Upload, UserRound } from 'lucide-react'
import { ACCENT_THEMES, ACCENT_THEME_HEX, accentThemeLabel, accentThemeSharedStatus, isConfigured } from '@models/settings/AppSettings'
import { ScreenHero, ScreenSection } from '@ui/components/Screen'
import { useApp, useModel } from '@ui/app/AppContext'
import { enterDemo, leaveDemo } from '@ui/app/createServices'
import { applyImport, buildExport, downloadExport } from '@ui/app/exportImport'
import { useTheme } from '@ui/theme'
import './settings.css'

export function SettingsScreen() {
  const { services, demo, openScreen } = useApp()
  const model = useModel(services.settingsModel)
  const configured = isConfigured(model.settings)
  const hue = 'var(--hue-team)'

  const finishSetup = async () => {
    await services.loadIfConfigured(true)
    openScreen('board')
  }

  return (
    <>
      <ScreenHero
        overline="Settings"
        icon={UserRound}
        answer={demo ? 'You’re in the demo league' : configured ? 'Your league is connected' : 'Connect your Sleeper league'}
        detail={demo
          ? 'A generated league, frozen on Sunday of week 7 2025, so you can try every screen. Nothing you do here touches a real league.'
          : 'Sleeper’s API is public — no password, and nothing to authorise.'}
        hue={hue}
      />

      {demo ? (
        <ScreenSection title="Demo" icon={FlaskConical} hue={hue}>
          <div className="card settings-card">
            <p className="t-body">Leave the demo to connect your own league.</p>
            <button type="button" className="button primary" onClick={() => { leaveDemo(); location.assign(`${import.meta.env.BASE_URL}settings`) }}>Leave the demo</button>
          </div>
        </ScreenSection>
      ) : (
        <SleeperSetup onReady={finishSetup} />
      )}

      <AppearanceSection />
      {!demo && <RelaySection />}
      {!demo && <ExportSection />}

      {!demo && configured && (
        <div className="settings-footer">
          <button type="button" className="button danger" onClick={() => model.changeLeague()}>Switch league</button>
        </div>
      )}
    </>
  )
}

function SleeperSetup({ onReady }: { onReady: () => void }) {
  const { services } = useApp()
  const model = useModel(services.settingsModel)
  const hue = 'var(--hue-team)'

  // Like the native `.onChange(of: stage)`: setup is done when the stage
  // reaches ready — by picking a team, or when the league's roster is found
  // from the username and picked automatically.
  const previousStage = useRef(model.stage)
  useEffect(() => {
    if (model.stage === 'ready' && previousStage.current !== 'ready') onReady()
    previousStage.current = model.stage
  }, [model.stage, onReady])

  const lookUp = (e: FormEvent) => {
    e.preventDefault()
    void model.lookUpUser()
  }

  return (
    <>
      <ScreenSection title="Sleeper" icon={UserRound} hue={hue} subtitle="Sleeper's API is public — no password, and nothing to authorise.">
        <form className="card settings-card" onSubmit={lookUp}>
          <label className="field">
            <span className="t-meta muted">Sleeper username</span>
            <input
              value={model.username}
              onChange={(e) => { model.username = e.target.value }}
              autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              placeholder="Sleeper username"
            />
          </label>
          <div className="row">
            <button type="submit" className="button primary" disabled={model.username.trim() === '' || model.isWorking}>
              {model.isWorking ? 'Looking…' : 'Find my leagues'}
            </button>
            {model.stage === 'needsUsername' && (
              <button type="button" className="button" onClick={() => { enterDemo(); location.assign(`${import.meta.env.BASE_URL}board?demo`) }}>
                No league? Try the demo
              </button>
            )}
          </div>
        </form>
      </ScreenSection>

      {model.leagues.length > 0 && (
        <ScreenSection title="League" hue={hue}>
          <div className="card list">
            {model.leagues.map((league) => (
              <button key={league.leagueID} type="button" className="list-row" onClick={() => void model.selectLeague(league)}>
                <span>
                  <span className="t-body">{league.name ?? league.leagueID}</span>
                  {league.totalRosters !== undefined && <span className="t-meta muted"> · {league.totalRosters} teams</span>}
                </span>
                {model.settings.leagueID === league.leagueID && <Check size={18} color="var(--accent)" aria-label="Selected" />}
              </button>
            ))}
          </div>
        </ScreenSection>
      )}

      {model.stage === 'pickingTeam' && model.teams.length > 0 && (
        <ScreenSection title="Which team is yours?" hue={hue}>
          <div className="card list">
            {model.teams.map((team) => (
              <button key={team.rosterID} type="button" className="list-row" onClick={() => model.selectTeam(team.rosterID)}>
                <span className="t-body">{team.manager}</span>
                {model.settings.rosterID === team.rosterID && <Check size={18} color="var(--accent)" aria-label="Selected" />}
              </button>
            ))}
          </div>
        </ScreenSection>
      )}

      {model.errorMessage && <div className="card t-meta" role="alert" style={{ color: 'var(--sit)' }}>{model.errorMessage}</div>}
    </>
  )
}

function AppearanceSection() {
  const { services } = useApp()
  const model = useModel(services.settingsModel)
  const { preference, setPreference } = useTheme()
  const theme = model.settings.accentTheme
  const status = accentThemeSharedStatus(theme)
  return (
    <ScreenSection
      title="Appearance" icon={Palette} hue="var(--hue-team)"
      subtitle={status
        ? `${accentThemeLabel(theme)} — shares a color with ${status}, so buttons can look like verdicts.`
        : `${accentThemeLabel(theme)} — for buttons and links. Each tab keeps its own hue.`}
    >
      <div className="card settings-card">
        <div className="swatches" role="radiogroup" aria-label="Accent color">
          {ACCENT_THEMES.map((t) => (
            <button
              key={t} type="button" role="radio" aria-checked={t === theme} aria-label={accentThemeLabel(t)}
              className={`swatch${t === theme ? ' selected' : ''}`}
              style={{ background: ACCENT_THEME_HEX[t], borderColor: ACCENT_THEME_HEX[t] }}
              onClick={() => model.setAccentTheme(t)}
            >
              {t === theme && <Check size={14} color="white" strokeWidth={3} aria-hidden />}
            </button>
          ))}
        </div>
        <div className="segmented" role="radiogroup" aria-label="Appearance">
          {(['system', 'light', 'dark'] as const).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={preference === p} className={preference === p ? 'on' : ''} onClick={() => setPreference(p)}>
              {p === 'system' ? 'Match device' : p === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
      </div>
    </ScreenSection>
  )
}

function RelaySection() {
  const { services } = useApp()
  const model = useModel(services.settingsModel)
  const [url, setURL] = useState(model.settings.relayBaseURL ?? '')
  const [token, setToken] = useState('')
  const saveURL = (e: FormEvent) => {
    e.preventDefault()
    if (model.setRelayURLText(url)) services.setRelay(services.settingsModel.settings.relayBaseURL)
  }
  const saveToken = () => {
    if (!token) return
    model.setRelayToken(token)
    setToken('')
  }
  return (
    <ScreenSection
      title="Relay (optional)" icon={Server} hue="var(--hue-team)"
      subtitle="Your own relay server adds news about your players and polishes trade pitches on your own AI. The token is the RELAY_TOKEN set on the server, kept in this browser only. Everything else works without it."
    >
      <form className="card settings-card" onSubmit={saveURL}>
        <label className="field">
          <span className="t-meta muted">Relay address</span>
          <input value={url} onChange={(e) => setURL(e.target.value)} onBlur={saveURL} placeholder="relay.example.com" inputMode="url" autoCapitalize="none" spellCheck={false} />
        </label>
        {model.relayError && <div className="t-meta" style={{ color: 'var(--sit)' }}>{model.relayError}</div>}
        <label className="field">
          <span className="t-meta muted">Token</span>
          <div className="row">
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off"
              placeholder={model.hasRelayToken ? 'Token saved — enter a new one to replace it' : 'Relay token'} />
            {token ? <button type="button" className="button" onClick={saveToken}>Save</button>
              : model.hasRelayToken ? <button type="button" className="button danger" onClick={() => model.setRelayToken('')}>Remove</button> : null}
          </div>
        </label>
      </form>
    </ScreenSection>
  )
}

function ExportSection() {
  const input = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string }>()
  const onFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const count = applyImport(await file.text())
      setMessage({ ok: true, text: `Restored ${count} saved item${count === 1 ? '' : 's'}. Reloading…` })
      setTimeout(() => location.reload(), 800)
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) })
    }
  }
  return (
    <ScreenSection title="Move to another device" icon={Download} hue="var(--hue-team)"
      subtitle="Everything saves in this browser. Export a file to carry your league, Board layout, workspaces and stream edits to another browser. The relay token stays behind.">
      <div className="card settings-card">
        <div className="row">
          <button type="button" className="button" onClick={() => downloadExport(buildExport())}><Download size={15} aria-hidden /> Export</button>
          <button type="button" className="button" onClick={() => input.current?.click()}><Upload size={15} aria-hidden /> Import</button>
          <input ref={input} type="file" accept="application/json,.json" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
        {message && <div className="t-meta" style={{ color: message.ok ? 'var(--start)' : 'var(--sit)' }}>{message.text}</div>}
      </div>
    </ScreenSection>
  )
}
