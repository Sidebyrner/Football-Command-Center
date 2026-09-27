import { hubFor, hubTitle, segmentLabel, screenTitle, type Screen } from '@models/navigation/screens'
import { AboutThisData, ScreenHero, ScreenSection } from '@ui/components/Screen'
import { hueForScreen } from '@ui/hues'
import { screenIcon } from '@ui/icons'
import { Sparkles } from 'lucide-react'

/** What each screen will answer once its engine is ported — Release 1. */
const promise: Partial<Record<Screen, string>> = {
  board: 'Your week at a glance: live score, your players’ games, readiness, injuries, the best streams and the top pickup.',
  dashboard: 'Record, rank and streak; what to fix before kickoff; standings, bench points and weekly scoring.',
  sitStart: 'The best lineup on the basis you choose, what each swap is worth, and where the measures disagree.',
  matchup: 'Every slot against your opponent’s, live during games.',
  injuries: 'Starters ruled out, questionable players, the fill-ins behind every injury, and rivals who are short.',
  discovery: 'Every free agent at the positions your league starts, with a page per player.',
  waivers: 'Free agents ranked on one named measure, priced by your league’s waiver rules and FAAB.',
  trades: 'A four-step trade builder: your need, who has it, a deal that works for both, and the pitch.',
  planning: 'The weeks you can’t field a full lineup, and how to fix them before they arrive.',
  qbStream: 'The best quarterback to stream against your starter, in your scoring.',
  rbStream: 'The best running back to stream against your starter, in your scoring.',
  wrStream: 'The best receiver to stream against your starter, in your scoring.',
  kStream: 'The best kicker to stream, with wind and game environment.',
  dstStream: 'The best defense to stream against your starter.',
  idpStream: 'The best individual defensive player to stream.',
  settings: '',
}

export function Placeholder({ screen }: { screen: Screen }) {
  const hub = hubFor(screen)
  const hue = hueForScreen(screen)
  return (
    <>
      <ScreenHero
        overline={hub === 'board' || hub === 'team' ? hubTitle[hub] : `${hubTitle[hub]} · ${segmentLabel(screen)}`}
        icon={screenIcon[screen]}
        answer={screenTitle[screen]}
        detail={promise[screen]}
        hue={hue}
      />
      <ScreenSection title="Coming in Release 1" icon={Sparkles} hue={hue}>
        <div className="card t-body muted">
          This screen is being ported from the iPhone and Mac app, with the same engine checked against the same test data.
        </div>
      </ScreenSection>
      <AboutThisData>
        <span>Sleeper’s public API, nflverse and ffopportunity — the same sources as the native app.</span>
      </AboutThisData>
    </>
  )
}
