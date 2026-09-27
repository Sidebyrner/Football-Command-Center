import { useState, useEffect } from 'react'
import { Radio, CheckCircle, Clock, AlertTriangle } from 'lucide-react'
import { StatValue } from '@ui/components/Screen'

function Stat({ label, value, tone }) {
  return <StatValue value={String(value)} label={label} tint={tone} />
}

/**
 * Ticks down between polls from pickStartedAt (a client-side approximation —
 * see useLiveDraft.js). Purely local display state; never drives a fetch.
 */
function usePickClock(pickStartedAt, pickTimerSeconds) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!pickTimerSeconds) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [pickTimerSeconds])
  if (!pickTimerSeconds) return null
  const elapsed = Math.floor((now - pickStartedAt) / 1000)
  return Math.max(0, pickTimerSeconds - elapsed)
}

function formatClock(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Live draft state. Only rendered when a draft exists for the league.
 * The headline number is "picks until you're up" — the one thing you need
 * mid-draft that Sleeper's own board does not put next to your research.
 */
export default function DraftStatusBar({ draft }) {
  const {
    isLive, draft: info, error, currentPick, currentRound, teams,
    picksUntilMyTurn, myNextPick, userSlot, picks,
    onClockName, pickTimerSeconds, pickStartedAt,
  } = draft

  const clockRemaining = usePickClock(pickStartedAt, pickTimerSeconds)

  if (error) {
    return (
      <div className="card dd-callout-row t-meta" role="status">
        <AlertTriangle size={14} color="var(--caution)" aria-hidden />
        <span className="muted">Draft sync unavailable: {error}</span>
      </div>
    )
  }
  if (!info) return null

  const complete = info.status === 'complete'
  const onTheClock = picksUntilMyTurn === 0

  return (
    <section className={`card dd-status${onTheClock ? ' on-clock' : ''}`} aria-label="Draft status">
      <div className="dd-status-state t-body">
        {isLive ? (
          <>
            <Radio size={15} color="var(--start)" className="dd-pulse" aria-hidden />
            <span style={{ color: 'var(--start)' }}>Live</span>
          </>
        ) : complete ? (
          <>
            <CheckCircle size={15} color="var(--text-3)" aria-hidden />
            <span className="muted">Draft complete</span>
          </>
        ) : (
          <>
            <Clock size={15} color="var(--text-3)" aria-hidden />
            <span className="muted">Pre-draft</span>
          </>
        )}
      </div>

      {isLive && (
        <>
          <Stat label="Pick" value={`${currentPick}${teams ? ` · Rd ${currentRound}` : ''}`} />
          {onClockName && <Stat label="On the clock" value={onClockName} />}
          {clockRemaining != null && (
            <Stat
              label={clockRemaining <= 60 ? 'Clock · running low' : 'Clock'}
              value={formatClock(clockRemaining)}
              tone={clockRemaining <= 30 ? 'var(--sit)' : clockRemaining <= 60 ? 'var(--caution)' : undefined}
            />
          )}
          {userSlot && <Stat label="Your slot" value={userSlot} />}
          {picksUntilMyTurn != null && (
            <Stat
              label="Until you"
              value={onTheClock ? "You're up" : `${picksUntilMyTurn} pick${picksUntilMyTurn === 1 ? '' : 's'}`}
              tone={
                onTheClock ? 'var(--accent)'
                  : picksUntilMyTurn <= 3 ? 'var(--caution)'
                  : undefined
              }
            />
          )}
          {myNextPick != null && !onTheClock && <Stat label="Next pick #" value={myNextPick} />}
        </>
      )}

      {!isLive && picks.length > 0 && <Stat label="Picks made" value={picks.length} />}
    </section>
  )
}
