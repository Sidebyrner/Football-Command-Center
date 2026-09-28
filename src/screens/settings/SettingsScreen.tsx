/**
 * Setup and settings — the port of `SettingsView`: username, then league, then
 * which team is yours; accent colour; the optional relay. Web additions: try
 * the demo league, export/import your setup between devices, and the beta
 * signup and feedback forms.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { Check, Download, FlaskConical, MessageSquareHeart, Palette, Server, Upload, UserRound } from 'lucide-react'
import { ACCENT_THEMES, ACCENT_THEME_HEX, accentThemeLabel, accentThemeSharedStatus, isConfigured } from '@models/settings/AppSettings'
import { ScreenHero, ScreenSection } from '@ui/components/Screen'
import { useApp, useModel } from '@ui/app/AppContext'
import { enterDemo, leaveDemo } from '@ui/app/createServices'
import { applyImport, buildExport, downloadExport } from '@ui/app/exportImport'
import { looksLikeEmail, submitBetaForm } from '@ui/app/betaForms'
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

      <BetaSection />
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

const DEVICES = ['iPhone', 'iPad', 'Mac'] as const
const FEEDBACK_KINDS = ['Idea', 'Bug', 'Other'] as const
type Sent = { ok: boolean; text: string }

/** Join the TestFlight beta, or tell us what to fix. Linked from the top bar as /settings#beta. */
function BetaSection() {
  const { demo } = useApp()
  const anchor = useRef<HTMLDivElement>(null)
  const { hash, key } = useLocation()
  useEffect(() => {
    if (hash === '#beta') anchor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [hash, key])
  return (
    <div id="beta" ref={anchor} className="beta-anchor">
      <ScreenSection title="Beta" icon={MessageSquareHeart} hue="var(--hue-team)"
        subtitle="The iPhone, iPad and Mac app is coming to TestFlight. Leave your email to get an invite, or send feedback on the web version.">
        <BetaSignup />
        <BetaFeedback demo={demo} />
      </ScreenSection>
    </div>
  )
}

function BetaSignup() {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [devices, setDevices] = useState<string[]>(['iPhone'])
  const [bot, setBot] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<Sent>()
  const toggle = (d: string) => setDevices((all) => all.includes(d) ? all.filter((x) => x !== d) : [...all, d])
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!looksLikeEmail(email)) { setSent({ ok: false, text: 'That email doesn’t look right.' }); return }
    setSending(true)
    try {
      await submitBetaForm('beta-signup', { email: email.trim(), name: name.trim(), devices: devices.join(', '), 'bot-field': bot })
      setSent({ ok: true, text: 'You’re on the list. The TestFlight invite will come to that email.' })
      setEmail(''); setName('')
    } catch (err) {
      setSent({ ok: false, text: err instanceof Error ? err.message : String(err) })
    } finally {
      setSending(false)
    }
  }
  return (
    <form className="card settings-card" onSubmit={submit} name="beta-signup">
      <div className="t-section">Get the TestFlight invite</div>
      <label className="field">
        <span className="t-meta muted">Email (the one on your Apple Account works best)</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="you@example.com" />
      </label>
      <label className="field">
        <span className="t-meta muted">Name (optional)</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="First name" />
      </label>
      <div className="field">
        <span className="t-meta muted">Which devices?</span>
        <div className="chips" role="group" aria-label="Devices">
          {DEVICES.map((d) => (
            <button key={d} type="button" aria-pressed={devices.includes(d)} className={`chip${devices.includes(d) ? ' on' : ''}`} onClick={() => toggle(d)}>
              {devices.includes(d) && <Check size={13} strokeWidth={3} aria-hidden />}{d}
            </button>
          ))}
        </div>
      </div>
      <Honeypot value={bot} onChange={setBot} />
      <div className="row">
        <button type="submit" className="button primary" disabled={sending || email.trim() === ''}>{sending ? 'Sending…' : 'Join the beta'}</button>
      </div>
      {sent && <div className="t-meta" role="status" style={{ color: sent.ok ? 'var(--start)' : 'var(--sit)' }}>{sent.text}</div>}
    </form>
  )
}

function BetaFeedback({ demo }: { demo: boolean }) {
  const [kind, setKind] = useState<(typeof FEEDBACK_KINDS)[number]>('Idea')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [bot, setBot] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<Sent>()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (email.trim() && !looksLikeEmail(email)) { setSent({ ok: false, text: 'That email doesn’t look right — or leave it blank.' }); return }
    setSending(true)
    try {
      const context = `${demo ? 'demo league' : 'own league'} · ${window.innerWidth}×${window.innerHeight} · ${navigator.userAgent}`
      await submitBetaForm('beta-feedback', { kind, message: message.trim(), email: email.trim(), context, 'bot-field': bot })
      setSent({ ok: true, text: 'Thanks — got it.' })
      setMessage('')
    } catch (err) {
      setSent({ ok: false, text: err instanceof Error ? err.message : String(err) })
    } finally {
      setSending(false)
    }
  }
  return (
    <form className="card settings-card" onSubmit={submit} name="beta-feedback">
      <div className="t-section">Send feedback</div>
      <div className="segmented" role="radiogroup" aria-label="Kind of feedback">
        {FEEDBACK_KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k}</button>
        ))}
      </div>
      <label className="field">
        <span className="t-meta muted">{kind === 'Bug' ? 'What happened, and on which screen?' : 'What’s on your mind?'}</span>
        <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} required maxLength={4000} />
      </label>
      <label className="field">
        <span className="t-meta muted">Email, if you’d like a reply (optional)</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="you@example.com" />
      </label>
      <Honeypot value={bot} onChange={setBot} />
      <div className="row">
        <button type="submit" className="button primary" disabled={sending || message.trim() === ''}>{sending ? 'Sending…' : 'Send feedback'}</button>
      </div>
      {sent && <div className="t-meta" role="status" style={{ color: sent.ok ? 'var(--start)' : 'var(--sit)' }}>{sent.text}</div>}
    </form>
  )
}

/** Hidden from people; bots that fill every field get their post dropped by Netlify. */
function Honeypot({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="honeypot" aria-hidden>
      Leave this empty
      <input name="bot-field" tabIndex={-1} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}
