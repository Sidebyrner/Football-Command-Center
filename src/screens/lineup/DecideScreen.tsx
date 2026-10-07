/**
 * Decide — every slot in your lineup as a start call, the close ones first.
 * The port of `DecideView` (Views/Decide/DecideView.swift). Opens one slot's
 * head-to-head, with free agents a tap away; nothing it opens is stored.
 */
import { useState } from 'react'
import { ChevronRight, GitBranch, ListChecks, Lock, Scale } from 'lucide-react'
import type { LeagueContext } from '@models/league/LeagueContext'
import {
  DecideModel, slotCanDecide, slotHasBenchOption, slotIsCloseCall, type DecideSession, type DecideSlot,
} from '@models/lineup/DecideModel'
import { useApp, useModel } from '@ui/app/AppContext'
import { AboutThisData, ScreenHero, ScreenSection } from '@ui/components/Screen'
import { CoverageNote, FreshnessBanner, LoadingPlaceholder } from '@ui/components/State'
import { DecideDialog } from './DecideDialog'
import { LineupHubHeader } from './LineupHubHeader'
import { ConfidenceChip } from './StartVerdictCard'
import { LoadFailure } from './shared'
import './lineup.css'

const HUE = 'var(--hue-lineup)'

export function DecideScreen() {
  const { services } = useApp()
  // Decide is derived from these; observing them keeps it current.
  const sitStart = useModel(services.sitStart)
  useModel(services.matchup)
  useModel(services.waivers)
  useModel(services.discovery)
  const [session, setSession] = useState<DecideSession>()
  const context = sitStart.context
  const decide = services.decide

  let body
  if (context) {
    const slots = decide.orderedSlots()
    const close = slots.filter(slotIsCloseCall)
    const shared = [...DecideModel.sharedPicks(slots)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    body = (
      <>
        <div className="lineup-stack">
          <ScreenHero
            overline="Lineup · Decide"
            icon={Scale}
            answer={close.length === 0 ? 'No close calls' : `${close.length} close call${close.length === 1 ? '' : 's'}`}
            detail={close.length === 0
              ? 'Every slot you can still change has a clear starter this week.'
              : "Slots where the signals don't agree. Tap one to compare, free agents included."}
            tone={close.length === 0 ? 'start' : undefined}
            hue={HUE}
          />
        </div>
        <ScreenSection title="Slots" icon={ListChecks} count={slots.filter(slotCanDecide).length} hue={HUE}>
          <div className="card lineup-card decide-slots">
            {slots.map((slot) => (
              <SlotRow key={slot.index} slot={slot} context={context} onOpen={() => setSession(decide.session(slot))} />
            ))}
            {shared.map(([id, tokens]) => (
              <div key={id} className="lineup-warning decide-shared">
                <GitBranch size={14} color="var(--caution)" aria-hidden />
                <span>{`${context.playerName(id) ?? id} is the pick at ${tokens.join(' and ')}, but he can only fill one. Sit/Start sets the whole lineup at once.`}</span>
              </div>
            ))}
          </div>
        </ScreenSection>
        <AboutThisData>
          <FreshnessBanner provenance={context.provenance} />
          <CoverageNote text="Each call counts head-to-head wins over separate signals — projected, Command Center, this season, last 4, usage (xFP) and game environment, plus floor or ceiling depending on your matchup. Nothing is blended into one score." />
          <CoverageNote text="Game lines come from the schedule file's recorded lines, not live odds. Questionable players are compared on their full value, as in Sit/Start." />
        </AboutThisData>
      </>
    )
  } else if (sitStart.isLoading || sitStart.errorMessage === undefined) {
    body = <LoadingPlaceholder label="Loading your roster…" />
  } else {
    body = <LoadFailure title="Could not load your roster" message={sitStart.errorMessage} onRetry={() => { void sitStart.refresh() }} />
  }

  return (
    <>
      <LineupHubHeader current="decide" />
      {body}
      {session && <DecideDialog session={session} onClose={() => setSession(undefined)} />}
    </>
  )
}

function SlotRow({ slot, context, onOpen }: { slot: DecideSlot; context: LeagueContext; onOpen: () => void }) {
  const incumbent = slot.incumbentID !== undefined ? context.playerName(slot.incumbentID) ?? slot.incumbentID : 'Empty'
  const close = slotIsCloseCall(slot)
  const title = slotHasBenchOption(slot) && slotCanDecide(slot) ? slot.verdict.headline : incumbent
  return (
    <button
      type="button"
      className={`decide-slot${close ? ' close' : ''}`}
      onClick={onOpen}
      disabled={!slotCanDecide(slot)}
      data-testid={`decide.slot.${slot.index}`}
    >
      <span className="slot-token">{slot.token}</span>
      <span className="decide-slot-text">
        <span className="t-body" style={{ fontWeight: close ? 600 : 400 }}>{title}</span>
        <span className="t-meta muted decide-slot-detail">{slotDetail(slot)}</span>
      </span>
      <span className="slot-spacer" />
      {slot.isLocked ? (
        <Lock size={11} className="muted" role="img" aria-label="Locked — game started" />
      ) : (
        <>
          {slotHasBenchOption(slot) && <ConfidenceChip confidence={slot.verdict.confidence} />}
          <ChevronRight size={14} className="tertiary" aria-hidden />
        </>
      )}
    </button>
  )
}

export function slotDetail(slot: DecideSlot): string {
  if (slot.isLocked) return "Kicked off — can't change"
  if (!slotHasBenchOption(slot)) return 'No bench option — tap to check free agents'
  const incumbent = slot.verdict.blocked.find((b) => b.id === slot.incumbentID)
  if (incumbent) return `${incumbent.name}: ${incumbent.reason}`
  const others = slot.candidateIDs.length - 1
  return [slot.verdict.edgeLine, `${others} other option${others === 1 ? '' : 's'}`].filter((x): x is string => x !== undefined).join(' · ')
}
