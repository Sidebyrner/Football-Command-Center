import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, AlertCircle, ChevronDown, Eye, EyeOff, Loader2 } from 'lucide-react'
import useAppStore from '../store/useAppStore'
import { useSleeperUser } from '../hooks/useSleeperUser'
import { useSleeperLeague } from '../hooks/useSleeperLeague'
import { useLeagueScoring } from '../hooks/useLeagueScoring'
import ScoringProfileManager from '../components/eval/ScoringProfileManager'

const CURRENT_SEASON = import.meta.env.VITE_DEFAULT_SEASON || '2026'

function Label({ children, htmlFor }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wide">
      {children}
    </label>
  )
}

function Input({ id, value, onChange, placeholder, type = 'text', disabled = false, className = '', ...rest }) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete="off"
      spellCheck={false}
      {...rest}
      className={`w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-3 py-2 text-sm
        text-[var(--color-text)] placeholder:text-[var(--color-text-faint)]
        focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent
        disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${className}`}
    />
  )
}

function FieldHint({ children }) {
  return <p className="text-xs text-[var(--color-text-faint)] mt-1">{children}</p>
}

function StatusPill({ ok, message }) {
  if (!message) return null
  return (
    <div className={`flex items-center gap-2 text-xs mt-2 ${ok ? 'text-[var(--color-start)]' : 'text-[var(--color-sit)]'}`}>
      {ok ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
      {message}
    </div>
  )
}

export default function Settings() {
  const navigate = useNavigate()
  const store = useAppStore()
  const { fetchUser, loading: userLoading } = useSleeperUser()
  const { fetchLeagues, loading: leagueLoading } = useSleeperLeague()
  const { syncFromLeague } = useLeagueScoring()

  // Form state
  const [username, setUsername] = useState(store.sleeperUsername || '')
  const [resolvedUserId, setResolvedUserId] = useState(store.sleeperUserId || null)
  const [userStatus, setUserStatus] = useState(null) // { ok, message }

  const [leagues, setLeagues] = useState(store.availableLeagues || [])
  const [selectedLeagueId, setSelectedLeagueId] = useState(store.leagueId || '')
  const [leagueStatus, setLeagueStatus] = useState(null)

  const [season, setSeason] = useState(store.season || CURRENT_SEASON)
  const [week, setWeek] = useState(String(store.currentWeek || 1))

  const [oddsKey, setOddsKey] = useState(store.oddsApiKey || '')
  const [showKey, setShowKey] = useState(false)

  const [saved, setSaved] = useState(false)

  // Auto-fetch leagues when userId + season are both known
  useEffect(() => {
    if (resolvedUserId && leagues.length === 0) {
      handleFetchLeagues(resolvedUserId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedUserId])

  async function handleLookupUser() {
    const trimmed = username.trim()
    if (!trimmed) return
    setUserStatus(null)
    setLeagues([])
    setSelectedLeagueId('')
    setLeagueStatus(null)
    setResolvedUserId(null)

    const user = await fetchUser(trimmed)
    if (user) {
      setResolvedUserId(user.user_id)
      setUserStatus({ ok: true, message: `Found: ${user.display_name || user.username} (ID: ${user.user_id})` })
      store.setSleeperUsername(trimmed)
      store.setSleeperUserId(user.user_id)
      handleFetchLeagues(user.user_id)
    } else {
      setUserStatus({ ok: false, message: 'Username not found on Sleeper.' })
    }
  }

  async function handleFetchLeagues(userId) {
    setLeagueStatus(null)
    const data = await fetchLeagues(userId, season)
    if (data.length > 0) {
      setLeagues(data)
      store.setAvailableLeagues(data)
      // Pre-select if we already had a saved leagueId
      if (store.leagueId && data.some((l) => l.league_id === store.leagueId)) {
        setSelectedLeagueId(store.leagueId)
      } else {
        setSelectedLeagueId(data[0].league_id)
      }
      setLeagueStatus({ ok: true, message: `${data.length} league${data.length > 1 ? 's' : ''} found.` })
    } else {
      setLeagueStatus({ ok: false, message: `No NFL leagues found for ${season}.` })
    }
  }

  function handleSave() {
    const parsedWeek = Math.min(18, Math.max(1, parseInt(week, 10) || 1))
    const league = leagues.find((l) => l.league_id === selectedLeagueId)

    store.saveSettings({
      sleeperUserId: resolvedUserId || store.sleeperUserId,
      leagueId: selectedLeagueId || store.leagueId,
      leagueName: league?.name || store.leagueName || '',
      currentWeek: parsedWeek,
      oddsApiKey: oddsKey.trim(),
      season,
    })

    setSaved(true)
    setTimeout(() => {
      setSaved(false)
      navigate('/')
    }, 1200)
  }

  const isFirstRun = !store.isConfigured
  const canSave = (resolvedUserId || store.sleeperUserId) && (selectedLeagueId || store.leagueId)

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex flex-col">
      {/* Top bar */}
      <div className="h-14 flex items-center px-6 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <h1 className="font-display font-semibold text-base text-[var(--color-text)]">Settings</h1>
        {isFirstRun && (
          <span className="ml-3 text-xs px-2 py-0.5 rounded bg-[var(--color-accent)] text-black font-semibold">
            First-time setup
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto px-6 py-10 space-y-8">

          {isFirstRun && (
            <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl p-4 text-sm text-[var(--color-text-muted)]">
              Complete the fields below to connect your Sleeper account before using any other features.
            </div>
          )}

          {/* ── Sleeper Account ── */}
          <section>
            <h2 className="font-display font-semibold text-sm text-[var(--color-text)] mb-4 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-accent)]" />
              Sleeper Account
            </h2>

            <div className="space-y-4">
              <div>
                <Label htmlFor="username">Sleeper Username</Label>
                <div className="flex gap-2">
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. johndoe"
                    onKeyDown={(e) => e.key === 'Enter' && handleLookupUser()}
                    className="flex-1"
                  />
                  <button
                    onClick={handleLookupUser}
                    disabled={userLoading || !username.trim()}
                    className="px-4 py-2 rounded bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]
                      text-black text-sm font-semibold flex items-center gap-2
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]
                      disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {userLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                    Look up
                  </button>
                </div>
                <FieldHint>Your public Sleeper username (not email).</FieldHint>
                <StatusPill {...(userStatus || {})} />
              </div>

              {/* League Selector */}
              {leagues.length > 0 && (
                <div>
                  <Label htmlFor="league">League</Label>
                  <div className="relative">
                    <select
                      id="league"
                      value={selectedLeagueId}
                      onChange={(e) => setSelectedLeagueId(e.target.value)}
                      className="w-full appearance-none bg-[var(--color-surface-2)] border border-[var(--color-border)]
                        rounded px-3 py-2 pr-8 text-sm text-[var(--color-text)]
                        focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
                    >
                      {leagues.map((l) => (
                        <option key={l.league_id} value={l.league_id}>
                          {l.name} ({l.total_rosters} teams)
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)] pointer-events-none" />
                  </div>
                  <StatusPill {...(leagueStatus || {})} />
                </div>
              )}

              {leagueLoading && (
                <div className="flex items-center gap-2 text-xs text-[var(--color-text-faint)]">
                  <Loader2 size={13} className="animate-spin" />
                  Fetching leagues…
                </div>
              )}
            </div>
          </section>

          {/* ── Season & Week ── */}
          <section>
            <h2 className="font-display font-semibold text-sm text-[var(--color-text)] mb-4 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-accent)]" />
              Season & Week
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="season">NFL Season</Label>
                <Input
                  id="season"
                  value={season}
                  onChange={(e) => setSeason(e.target.value)}
                  placeholder="2026"
                />
                <FieldHint>4-digit year (e.g. 2026).</FieldHint>
              </div>
              <div>
                <Label htmlFor="week">Current Week</Label>
                <Input
                  id="week"
                  type="number"
                  value={week}
                  onChange={(e) => setWeek(e.target.value)}
                  placeholder="1"
                />
                <FieldHint>Weeks 1–18.</FieldHint>
              </div>
            </div>
          </section>

          {/* ── League Scoring ── */}
          <section>
            <h2 className="font-display font-semibold text-sm text-[var(--color-text)] mb-4 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-accent)]" />
              League Scoring
            </h2>
            <ScoringProfileManager
              leagueId={selectedLeagueId || store.leagueId}
              leagueName={leagues.find((l) => l.league_id === selectedLeagueId)?.name || store.leagueName}
            />
            <FieldHint>
              Pulled directly from your league on Sleeper. This drives every evaluation score,
              so PPR format and first-down bonuses are applied exactly as your league scores them.
            </FieldHint>
          </section>

          {/* ── Odds API ── */}
          <section>
            <h2 className="font-display font-semibold text-sm text-[var(--color-text)] mb-4 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-accent)]" />
              The Odds API
            </h2>
            <div>
              <Label htmlFor="oddsKey">API Key</Label>
              <div className="relative">
                <Input
                  id="oddsKey"
                  type={showKey ? 'text' : 'password'}
                  value={oddsKey}
                  onChange={(e) => setOddsKey(e.target.value)}
                  placeholder="Paste your key here"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)] hover:text-[var(--color-text)] focus-visible:outline-none"
                  tabIndex={-1}
                >
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <FieldHint>
                Free tier: 500 requests/month. Leave blank to skip odds features.
              </FieldHint>
            </div>
          </section>

          {/* ── Save Button ── */}
          <div className="pt-2">
            <button
              onClick={handleSave}
              disabled={!canSave || saved}
              className="w-full py-2.5 rounded bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]
                text-black font-semibold text-sm flex items-center justify-center gap-2
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]
                disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saved ? (
                <>
                  <CheckCircle size={16} />
                  Saved — redirecting…
                </>
              ) : (
                'Save Settings'
              )}
            </button>
            {!canSave && (
              <p className="text-xs text-[var(--color-text-faint)] text-center mt-2">
                Look up your Sleeper username and select a league first.
              </p>
            )}
          </div>

          {/* Reset link for non-first-run */}
          {!isFirstRun && (
            <div className="text-center pt-2">
              <button
                onClick={() => {
                  store.reset()
                  setLeagues([])
                  setSelectedLeagueId('')
                  setResolvedUserId(null)
                  setUserStatus(null)
                  setLeagueStatus(null)
                }}
                className="text-xs text-[var(--color-text-faint)] hover:text-[var(--color-sit)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] rounded"
              >
                Reset all settings
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
