import { useState, useEffect } from 'react'
import { Radio, CheckCircle, Clock, AlertTriangle } from 'lucide-react'

function Stat({ label, value, tone }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[9px] uppercase tracking-wide text-[var(--color-text-faint)]">{label}</span>
      <span className={`text-xs font-semibold tabular-nums ${tone ?? 'text-[var(--color-text)]'}`}>{value}</span>
    </div>
  )
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
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <AlertTriangle size={12} className="text-[var(--color-caution)]" />
        <span className="text-xs text-[var(--color-text-muted)]">Draft sync unavailable: {error}</span>
      </div>
    )
  }
  if (!info) return null

  const complete = info.status === 'complete'
  const onTheClock = picksUntilMyTurn === 0

  return (
    <div
      className={`flex items-center gap-5 px-4 py-2 border-b border-[var(--color-border)] ${
        onTheClock ? 'bg-[var(--color-accent)]/10' : 'bg-[var(--color-surface)]'
      }`}
    >
      <div className="flex items-center gap-1.5">
        {isLive ? (
          <>
            <Radio size={12} className="text-[var(--color-start)] animate-pulse" />
            <span className="text-xs font-semibold text-[var(--color-start)]">Live</span>
          </>
        ) : complete ? (
          <>
            <CheckCircle size={12} className="text-[var(--color-text-faint)]" />
            <span className="text-xs text-[var(--color-text-muted)]">Draft complete</span>
          </>
        ) : (
          <>
            <Clock size={12} className="text-[var(--color-text-faint)]" />
            <span className="text-xs text-[var(--color-text-muted)]">Pre-draft</span>
          </>
        )}
      </div>

      {isLive && (
        <>
          <Stat label="Pick" value={`${currentPick}${teams ? ` · Rd ${currentRound}` : ''}`} />
          {onClockName && <Stat label="On the clock" value={onClockName} />}
          {clockRemaining != null && (
            <Stat
              label="Clock"
              value={formatClock(clockRemaining)}
              tone={clockRemaining <= 30 ? 'text-[var(--color-sit)]' : clockRemaining <= 60 ? 'text-[var(--color-caution)]' : undefined}
            />
          )}
          {userSlot && <Stat label="Your slot" value={userSlot} />}
          {picksUntilMyTurn != null && (
            <Stat
              label="Until you"
              value={onTheClock ? "You're up" : `${picksUntilMyTurn} pick${picksUntilMyTurn === 1 ? '' : 's'}`}
              tone={
                onTheClock ? 'text-[var(--color-accent)]'
                  : picksUntilMyTurn <= 3 ? 'text-[var(--color-caution)]'
                  : undefined
              }
            />
          )}
          {myNextPick != null && !onTheClock && <Stat label="Next pick #" value={myNextPick} />}
        </>
      )}

      {!isLive && picks.length > 0 && <Stat label="Picks made" value={picks.length} />}
    </div>
  )
}
