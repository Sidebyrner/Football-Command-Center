import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Settings as SettingsIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { hubs, hubScreens, hubTitle, hubFor, segmentLabel, type Screen } from '@models/navigation/screens'
import { shortLabel, trailLabel } from '@models/navigation/NavigationHistory'
import { SegmentBar } from '@ui/components/Screen'
import { hubIcon, screenIcon } from '@ui/icons'
import { hueForHub, hueForScreen } from '@ui/hues'
import { useTheme } from '@ui/theme'
import { useNavigation, useNavigationSync } from './navigationStore'
import './shell.css'

/**
 * The app's frame. Phones get the five tabs along the bottom and a back pill
 * at the top-left; wider screens a sidebar and back/forward buttons. Each
 * hub's segments sit under the title.
 */
export function Shell({ children, accent, overlay }: { children: (screen: Screen) => ReactNode; accent?: string; overlay?: ReactNode }) {
  const screen = useNavigationSync() ?? 'board'
  const { resolved } = useTheme()
  const hub = hubFor(screen)
  const hue = hueForScreen(screen)

  return (
    <div className="fcc shell" data-theme={resolved} style={{ '--screen-hue': hue, ...(accent ? { '--accent': accent } : {}) } as CSSProperties}>
      <Sidebar current={screen} />
      <div className="shell-main">
        <TopBar screen={screen} />
        {hubScreens[hub].length > 1 && <Segments screen={screen} />}
        <main className="shell-content">{children(screen)}</main>
      </div>
      <TabBar current={screen} />
      {overlay}
    </div>
  )
}

function TopBar({ screen }: { screen: Screen }) {
  const { router, goForward } = useNavigation()
  return (
    <header className="topbar">
      <div className="topbar-leading">
        <BackPill />
        {router.canGoForward && (
          <button type="button" className="icon-button wide-only" onClick={goForward} aria-label="Forward"
            title={router.history.next ? `Forward to ${trailLabel(router.history.next)}` : 'Forward'}>
            <ChevronRight size={18} />
          </button>
        )}
      </div>
      <h1 className="t-title topbar-title">{screen === 'dashboard' ? 'My Team' : segmentOrTitle(screen)}</h1>
      <Link to="/settings" className="icon-button" aria-label="Settings" title="Settings">
        <SettingsIcon size={18} />
      </Link>
    </header>
  )
}

function segmentOrTitle(screen: Screen): string {
  return hubScreens[hubFor(screen)].length > 1 && segmentLabel(screen).length <= 4
    ? `${hubTitle[hubFor(screen)]} · ${segmentLabel(screen)}`
    : segmentLabel(screen)
}

/**
 * "‹ Board" in the previous screen's hue: a tap goes back, holding it (or a
 * right-click) shows everywhere you've been.
 */
function BackPill() {
  const { router, goBack, goBackTo } = useNavigation()
  const [open, setOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const held = useRef(false)
  const previous = router.history.previous
  useEffect(() => () => window.clearTimeout(timer.current), [])
  if (!previous) return null
  const hue = previous.kind === 'screen' ? hueForScreen(previous.screen) : 'var(--accent)'
  const trail = router.history.back.map((place, index) => ({ place, index })).reverse()

  return (
    <div className="backpill-wrap">
      <button
        type="button"
        className="backpill"
        style={{ color: hue, background: `color-mix(in srgb, ${hue} 14%, transparent)` }}
        aria-label={`Back to ${trailLabel(previous)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={() => {
          held.current = false
          timer.current = window.setTimeout(() => { held.current = true; setOpen(true) }, 450)
        }}
        onPointerUp={() => window.clearTimeout(timer.current)}
        onPointerLeave={() => window.clearTimeout(timer.current)}
        onContextMenu={(e) => { e.preventDefault(); setOpen(true) }}
        onClick={() => { if (!held.current) goBack() }}
      >
        <ChevronLeft size={16} strokeWidth={2.6} aria-hidden />
        <span>{shortLabel(previous)}</span>
      </button>
      {open && (
        <>
          <div className="menu-scrim" onClick={() => setOpen(false)} />
          <div className="menu card" role="menu" aria-label="Go back to">
            <div className="t-micro muted menu-heading">Go back to</div>
            {trail.map(({ place, index }) => {
              const Icon = place.kind === 'screen' ? screenIcon[place.screen] : hubIcon.board
              return (
                <button key={index} type="button" role="menuitem" className="menu-item t-body"
                  onClick={() => { setOpen(false); goBackTo(index) }}>
                  <Icon size={16} aria-hidden /> {trailLabel(place)}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function Segments({ screen }: { screen: Screen }) {
  const { open } = useNavigation()
  const hub = hubFor(screen)
  return (
    <div className="segments-bar">
      <SegmentBar options={hubScreens[hub]} value={screen} label={segmentLabel} onChange={open} ariaLabel={`${hubTitle[hub]} sections`} />
    </div>
  )
}

function TabBar({ current }: { current: Screen }) {
  const { selectHub } = useNavigation()
  const active = hubFor(current)
  return (
    <nav className="tabbar" aria-label="Tabs">
      {hubs.map((hub) => {
        const Icon = hubIcon[hub]
        const on = hub === active
        return (
          <button key={hub} type="button" className={`tab${on ? ' tab-on' : ''}`} aria-current={on ? 'page' : undefined}
            style={on ? { color: hueForScreen(current) } : undefined} onClick={() => selectHub(hub)}>
            <Icon size={22} strokeWidth={on ? 2.4 : 2} aria-hidden />
            <span>{hubTitle[hub]}</span>
          </button>
        )
      })}
    </nav>
  )
}

function Sidebar({ current }: { current: Screen }) {
  const { open } = useNavigation()
  return (
    <nav className="sidebar" aria-label="Sections">
      <div className="sidebar-title t-section">Command Center</div>
      {hubs.map((hub) => (
        <div key={hub} className="sidebar-group">
          <div className="t-micro muted sidebar-heading">{hubTitle[hub]}</div>
          {hubScreens[hub].map((s) => {
            const Icon = screenIcon[s]
            const on = s === current
            return (
              <button key={s} type="button" className={`sidebar-row t-body${on ? ' sidebar-row-on' : ''}`}
                aria-current={on ? 'page' : undefined} onClick={() => open(s)}>
                <Icon size={17} color={on ? '#fff' : (hub === 'streams' ? hueForScreen(s) : hueForHub(hub))} aria-hidden />
                {s === 'dashboard' ? 'My Team' : segmentLabel(s).length <= 4 ? `${segmentLabel(s)} Stream` : segmentLabel(s)}
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
