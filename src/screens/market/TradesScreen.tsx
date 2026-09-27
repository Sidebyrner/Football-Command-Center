/**
 * The Trade Desk — the port of `TradeWizardView`'s `TradeDeskScreen` and its
 * compact desk: four steps (what you need, who has it, build the deal, the
 * pitch), one at a time, with a Back button where the phone pushes views.
 * The screen is at most 760px wide, so the Mac's two-column desk isn't used.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  ArrowLeftRight, ArrowRight, ArrowUpCircle, ArrowUpDown, CalendarX, Check, CheckCircle2, ChevronLeft, ChevronRight,
  Circle, Clock, Copy, ExternalLink, Info, Lock, RotateCcw, Sparkles, TriangleAlert,
} from 'lucide-react'
import { formatFixed } from '@core/numeric'
import {
  injuryBadge, isWindowClosed, lineupDelta, mustDrop, TRADE_STEPS, tradePlayerValue, tradeStepTitle, tradeWindowLabel,
  TradeWizardModel, type DealSide, type PartnerFit, type ShortfallChange, type TradeBasis, type TradeGoal, type TradePlayer,
} from '@models/market/TradeWizardModel'
import { useApp, useModel } from '@ui/app/AppContext'
import { PlayerAvatar, PositionChip, positionColor } from '@ui/components/Player'
import { Callout, FilterChip, StatusLabel } from '@ui/components/Screen'
import { CoverageNote, LoadingPlaceholder } from '@ui/components/State'
import { deltaColor, GradeChip, InjuryBadge, PlayerMenu, SearchField, SectionHeader, SelectMenu } from './shared'
import './market.css'

const HUE = 'var(--hue-market)'
const one = TradeWizardModel.oneDecimal

/** A stable key per desk instance, so a fresh desk resets every step's local state. */
const deskKeys = new WeakMap<TradeWizardModel, number>()
let nextDeskKey = 0
const deskKey = (desk: TradeWizardModel) => {
  let key = deskKeys.get(desk)
  if (key === undefined) { key = ++nextDeskKey; deskKeys.set(desk, key) }
  return key
}

export function TradesScreen() {
  const { services } = useApp()
  const screen = useModel(services.trades)
  const desk = screen.desk
  return (
    <div className="mk-screen" style={{ '--hue': HUE } as CSSProperties} data-testid="trade-wizard">
      <div className="mk-toolbar-row mk-end">
        <button
          type="button"
          className="button mk-small"
          disabled={desk === undefined}
          title="Clear the deal and start from your needs"
          onClick={() => void screen.startOver()}
        >
          <RotateCcw size={15} aria-hidden /> Start over
        </button>
      </div>
      {desk ? (
        <TradeDeskView key={deskKey(desk)} model={desk} />
      ) : screen.errorMessage !== undefined ? (
        <div className="card mk-empty" role="alert">
          <TriangleAlert size={24} color="var(--sit)" aria-hidden />
          <div className="t-section">Could not load your league</div>
          <div className="t-meta muted">{screen.errorMessage}</div>
        </div>
      ) : (
        <LoadingPlaceholder label="Reading every roster…" />
      )}
    </div>
  )
}

// MARK: - The desk

/** One step at a time, like the phone's pushed views; Back never loses what was picked. */
export function TradeDeskView({ model: desk }: { model: TradeWizardModel }) {
  const model = useModel(desk)
  const top = useRef<HTMLDivElement>(null)
  const first = useRef(true)
  useEffect(() => { void model.prepare() }, [model])
  useEffect(() => {
    if (first.current) { first.current = false; return }
    top.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' })
    top.current?.focus?.({ preventScroll: true })
  }, [model.step])

  const index = TRADE_STEPS.indexOf(model.step)
  const previous = index > 0 ? TRADE_STEPS[index - 1] : undefined
  return (
    <div className="mk-stack" ref={top} tabIndex={-1} style={{ outline: 'none' }}>
      <DeskHeader model={model} />
      {previous && (
        <button type="button" className="mk-back t-meta" onClick={() => model.back()}>
          <ChevronLeft size={16} aria-hidden /> {tradeStepTitle(previous)}
        </button>
      )}
      {model.step === 'goal' && <GoalStep model={model} />}
      {model.step === 'partner' && <PartnerStep model={model} />}
      {model.step === 'deal' && <DealStep model={model} />}
      {model.step === 'approach' && <ApproachStep model={model} />}
    </div>
  )
}

// MARK: - Header

function DeskHeader({ model }: { model: TradeWizardModel }) {
  const label = tradeWindowLabel(model.window)
  const closed = isWindowClosed(model.window)
  const index = TRADE_STEPS.indexOf(model.step)
  const statsNote = model.primaryBasis === 'production' ? model.context.statsSeasonNote : undefined
  return (
    <section className="hero mk-desk-header" style={{ '--hue': HUE } as CSSProperties} aria-label={`Step ${index + 1} of ${TRADE_STEPS.length}: ${tradeStepTitle(model.step)}`}>
      <div className="hero-overline t-micro"><ArrowLeftRight size={14} strokeWidth={2.5} aria-hidden /> <span>Market · Trade desk</span></div>
      <div className="mk-steps" aria-hidden>
        {TRADE_STEPS.map((s, i) => <span key={s} className={i <= index ? 'on' : ''} />)}
      </div>
      <div className="mk-step-title">
        <h2 className="t-title">{tradeStepTitle(model.step)}</h2>
        <span className="t-meta muted">{`Step ${index + 1} of ${TRADE_STEPS.length}`}</span>
      </div>
      {label !== undefined && (
        <div className="t-meta mk-inline" style={{ fontWeight: 600, color: closed ? 'var(--sit)' : 'var(--text-2)' }}>
          {closed ? <Lock size={14} aria-hidden /> : <Clock size={14} aria-hidden />} {label}
        </div>
      )}
      {model.prefillNote !== undefined && (
        <div className="card mk-pad-s t-meta muted mk-inline"><Info size={14} aria-hidden /> {model.prefillNote}</div>
      )}
      {statsNote !== undefined && <CoverageNote text={statsNote} />}
    </section>
  )
}

// MARK: - Step 1

function GoalStep({ model }: { model: TradeWizardModel }) {
  const { openScreen } = useApp()
  const [query, setQuery] = useState('')
  return (
    <div className="mk-stack">
      <PlayerSearch model={model} query={query} setQuery={setQuery} />
      {query === '' && (
        <>
          {isWindowClosed(model.window) && (
            <Callout tone="sit">
              <span className="t-body mk-inline" style={{ color: 'var(--sit)' }}>
                <Lock size={15} aria-hidden /> Trades are closed for the season. You can still look around.
              </span>
            </Callout>
          )}
          {model.goals.length === 0 ? (
            <div className="card mk-stack-tight">
              <StatusLabel tone="start">No short weeks and no starter below the start line.</StatusLabel>
              <button type="button" className="mk-link t-meta" onClick={() => openScreen('waivers')}>Browse the Waiver Board instead</button>
            </div>
          ) : (
            <>
              <SectionHeader title="From your roster" subtitle="Weeks you can't fill, and starters below the league's start line — superflex counted." />
              {model.goals.map((goal, offset) => (
                <button key={goal.id} type="button" className="mk-select-card" data-testid={`trade-goal-${offset}`}
                  aria-pressed={model.goal?.id === goal.id} onClick={() => model.chooseGoal(goal)}>
                  <GoalRow goal={goal} />
                </button>
              ))}
            </>
          )}
          <SectionHeader title="Or pick a position" subtitle="Shows every rival with a spare player there." />
          <div className="mk-position-grid">
            {model.pickablePositions.map((p) => (
              <button key={p} type="button" className="mk-position-button"
                style={{ color: positionColor(p), background: `color-mix(in srgb, ${positionColor(p)} 14%, transparent)` }}
                aria-label={`Any ${p}`} title={`Shows every rival with a spare ${p}`}
                onClick={() => model.choosePosition(p)}>
                {p}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function GoalRow({ goal }: { goal: TradeGoal }) {
  const upgrade = goal.weeks.length === 0
  return (
    <span className="mk-goal-row">
      {upgrade
        ? <ArrowUpCircle size={22} color="var(--accent)" aria-hidden />
        : <CalendarX size={22} color="var(--caution)" aria-hidden />}
      <span className="mk-row-text">
        <span className="t-body" style={{ fontWeight: 600 }}>{goal.title}</span>
        <span className="t-meta muted">{goal.detail}</span>
      </span>
      <ChevronRight size={16} className="faint" aria-hidden />
    </span>
  )
}

/** Find any player on any rival's roster and go straight to a deal for him. */
function PlayerSearch({ model, query, setQuery }: { model: TradeWizardModel; query: string; setQuery: (q: string) => void }) {
  const results = query === '' ? [] : model.search(query)
  return (
    <div className="mk-stack-tight">
      <SearchField value={query} onChange={setQuery} placeholder="Find a player on any team" />
      {query !== '' && results.length === 0 && (
        <p className="t-meta muted">{`Nobody on a rival's roster matches “${query}”.`}</p>
      )}
      {results.length > 0 && (
        <div className="card mk-list-plain">
          {results.map((result) => {
            const p = result.player
            const badge = injuryBadge(p)
            const value = tradePlayerValue(p, model.primaryBasis)
            return (
              <button key={p.id} type="button" className="mk-search-result"
                title={`Starts a deal with ${result.rival.manager} for ${p.name}`}
                onClick={() => { model.target(result); setQuery('') }}>
                <PlayerAvatar sleeperID={p.id} name={p.name} position={p.position} size={30} />
                <span className="mk-row-text">
                  <span className="mk-row-title">
                    <span className="mk-name">{p.name}</span>
                    {badge && <InjuryBadge label={badge} />}
                  </span>
                  <span className="t-meta muted mk-ellipsis">{`${p.position ?? '?'} · ${p.team ?? 'FA'} · ${result.rival.manager}`}</span>
                </span>
                {value !== undefined && <span className="mk-value">{one(value)}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// MARK: - Step 2

function PartnerStep({ model }: { model: TradeWizardModel }) {
  const { openScreen } = useApp()
  return (
    <div className="mk-stack">
      {model.goal && (
        <div className="mk-stack-tight">
          <div className="t-section">{model.goal.title}</div>
          <div className="t-meta muted">{model.goal.detail}</div>
        </div>
      )}
      {model.partners.length === 0 ? (
        <div className="card mk-stack-tight">
          <p className="t-body muted">No rival has a spare player who fits. Try another need, search for a player, or check waivers.</p>
          <button type="button" className="mk-link t-meta" onClick={() => openScreen('waivers')}>Open the Waiver Board</button>
        </div>
      ) : (
        <>
          <p className="t-meta muted">{TradeWizardModel.partnerSortRule}</p>
          {model.partners.map((fit, offset) => (
            <button key={fit.rival.rosterID} type="button" className="mk-select-card" data-testid={`trade-partner-${offset}`}
              aria-pressed={model.partner?.rival.rosterID === fit.rival.rosterID} onClick={() => model.choosePartner(fit)}>
              <PartnerCard fit={fit} />
            </button>
          ))}
        </>
      )}
    </div>
  )
}

function PartnerCard({ fit }: { fit: PartnerFit }) {
  const [kind, tint] = fit.kind === 'mutual' ? ['Both ways', 'var(--start)']
    : fit.kind === 'oneWay' ? ['One way', 'var(--text-2)'] : ['Your pick', 'var(--accent)']
  const letter = fit.grade?.letter
  const shown = fit.theirOffer.slice(0, 3)
  return (
    <span className="mk-stack-tight" style={{ width: '100%' }}>
      <span className="mk-row-title">
        <span className="t-section mk-ellipsis">{fit.rival.manager}</span>
        {letter !== undefined && <GradeChip letter={letter} />}
        <span style={{ flex: 1 }} />
        <span className="mk-kind t-micro" style={{ color: tint, background: `color-mix(in srgb, ${tint} 14%, transparent)` }}>{kind}</span>
      </span>
      <span className="mk-avatars" aria-hidden>
        {shown.map((p) => <PlayerAvatar key={p.id} sleeperID={p.id} name={p.name} position={p.position} size={30} />)}
      </span>
      <span className="t-meta muted clamp-2">
        {shown.map((p) => p.name).join(', ') + (fit.theirOffer.length > 3 ? ` +${fit.theirOffer.length - 3} more` : '')}
      </span>
      {fit.facts.map((fact) => (
        <span key={fact} className="mk-fact t-meta"><Check size={12} strokeWidth={3} color="var(--accent)" aria-hidden /> <span>{fact}</span></span>
      ))}
    </span>
  )
}

// MARK: - Step 3

function DealStep({ model }: { model: TradeWizardModel }) {
  const closed = isWindowClosed(model.window)
  return (
    <div className="mk-stack">
      <BasisPicker model={model} />
      <DealComparison model={model} />
      {model.partner && (
        <PlayerPicker
          title="You get"
          identifier="trade-get"
          subtitle={`From ${model.partner.rival.manager}. Spare players first, IR last.`}
          players={model.theirPlayers}
          selected={model.receiving}
          model={model}
          toggle={(id) => model.toggleReceiving(id)}
        />
      )}
      <PlayerPicker
        title="You send"
        identifier="trade-send"
        subtitle="Your spare players first, IR last."
        players={model.yourPlayers}
        selected={model.sending}
        model={model}
        toggle={(id) => model.toggleSending(id)}
      />
      <EffectsCard model={model} />
      <button type="button" className="button primary mk-wide" disabled={!model.canApproach} data-testid="trade-continue"
        onClick={() => model.advanceToApproach()}>
        {closed ? 'Trades are closed' : 'Write the pitch'}
      </button>
      {!closed && !model.canApproach && <p className="t-meta muted">Pick at least one player on each side.</p>}
    </div>
  )
}

function BasisPicker({ model }: { model: TradeWizardModel }) {
  const hint = model.hint(model.basis)
  const options = model.availableBases.includes(model.basis) ? model.availableBases : [model.basis, ...model.availableBases]
  return (
    <div className="mk-stack-tight">
      <div className="mk-toolbar-row">
        <span className="t-meta muted" style={{ fontWeight: 600 }}>Compare on</span>
        <SelectMenu<TradeBasis>
          value={model.basis}
          options={options}
          label={(b) => model.label(b)}
          onChange={(b) => { model.basis = b }}
          ariaLabel="Basis"
          icon={<ArrowUpDown size={14} aria-hidden />}
        />
      </div>
      <p className="t-meta muted">{hint.slice(0, 1).toUpperCase() + hint.slice(1) + '.'}</p>
    </div>
  )
}

/**
 * Both teams side by side: what each gets, what happens to each best lineup,
 * grade, roster room and playoff weeks. The lineup change is the fairness
 * signal; the raw totals are context.
 */
function DealComparison({ model }: { model: TradeWizardModel }) {
  const effects = model.effects
  return (
    <div className="card mk-stack">
      <div className="mk-sides">
        <DealSideView title="You" side={effects.you} gets={model.receiving} model={model} />
        <div className="mk-divider" aria-hidden />
        <DealSideView title={model.partner?.rival.manager ?? 'Them'} side={effects.them} gets={model.sending} model={model} />
      </div>
      <BalanceBar you={lineupDelta(effects.you)} them={lineupDelta(effects.them)} />
      <p className="t-meta faint">{`Best lineup this week on ${model.label(model.basis).toLowerCase()}, healthy players with a value only.`}</p>
    </div>
  )
}

function DealSideView({ title, side, gets, model }: { title: string; side: DealSide; gets: ReadonlySet<string>; model: TradeWizardModel }) {
  const delta = lineupDelta(side)
  const before = side.gradeBefore?.letter
  const after = side.gradeAfter?.letter
  const total = model.total(gets)
  const drop = mustDrop(side)
  return (
    <div className="mk-side">
      <div className="mk-row-title">
        <span className="t-body mk-ellipsis" style={{ fontWeight: 700 }}>{title}</span>
        {before !== undefined && <GradeChip letter={before} />}
        {before !== undefined && after !== undefined && after !== before && (
          <><ArrowRight size={12} className="muted" aria-label="to" /><GradeChip letter={after} /></>
        )}
      </div>
      <div className="mk-inline" style={{ alignItems: 'baseline' }}>
        <span className="t-title" style={{ color: deltaColor(delta) }}>{delta !== undefined ? (delta >= 0 ? '+' : '') + one(delta) : '—'}</span>
        <span className="t-meta muted">lineup</span>
      </div>
      {side.lineupBefore !== undefined && (
        <span className="t-meta muted">{`${one(side.lineupBefore)} → ${side.lineupAfter !== undefined ? one(side.lineupAfter) : '—'}`}</span>
      )}
      {total && (
        <span className="t-meta muted">
          {`Gets ${one(total.value)} in value${total.counted < total.of ? ` (${total.counted} of ${total.of} valued)` : ''}`}
        </span>
      )}
      <span className="t-meta" style={{ color: drop > 0 ? 'var(--caution)' : 'var(--text-2)' }}>
        {drop > 0 ? `Must drop ${drop}` : `Roster ${side.rosterAfter}/${side.rosterLimit}`}
      </span>
      {(side.playoffShortBefore > 0 || side.playoffShortAfter > 0) && (
        <span className="t-meta" style={{
          color: side.playoffShortAfter > side.playoffShortBefore ? 'var(--sit)'
            : side.playoffShortAfter < side.playoffShortBefore ? 'var(--start)' : 'var(--text-2)',
        }}>
          {`Playoff weeks short: ${side.playoffShortBefore} → ${side.playoffShortAfter}`}
        </span>
      )}
    </div>
  )
}

/** Who the deal favours this week, from the two lineup changes. */
function BalanceBar({ you, them }: { you?: number; them?: number }) {
  if (you === undefined || them === undefined) return null
  const difference = you - them
  const scale = Math.max(Math.abs(you), Math.abs(them), 1)
  const lean = Math.max(-1, Math.min(1, difference / (2 * scale)))
  const even = Math.abs(difference) < 1
  const color = even ? 'var(--accent)' : difference > 0 ? 'var(--start)' : 'var(--caution)'
  const text = even ? 'Even this week'
    : difference > 0 ? `Favours you by ${one(difference)} this week`
    : `Favours them by ${one(-difference)} this week — an easier yes for them`
  const spoken = even ? 'Even this week'
    : difference > 0 ? `Favours you by ${one(difference)} points this week`
    : `Favours them by ${one(-difference)} points this week`
  return (
    <div className="mk-stack-tight" role="img" aria-label={spoken}>
      <div className="mk-balance" aria-hidden>
        <span className="mk-balance-mid" />
        <span className="mk-balance-dot" style={{ left: `calc(${50 + lean * 50}% - 7px)`, background: color }} />
      </div>
      <span className="t-meta" style={{ fontWeight: 600, color: even ? 'var(--text)' : color }} aria-hidden>{text}</span>
    </div>
  )
}

function PlayerPicker(props: {
  title: string
  identifier: string
  subtitle: string
  players: TradePlayer[]
  selected: ReadonlySet<string>
  model: TradeWizardModel
  toggle: (id: string) => void
}) {
  const { title, identifier, subtitle, players, selected, model, toggle } = props
  const [position, setPosition] = useState<TradePlayer['position']>()
  const [showAll, setShowAll] = useState(false)
  const positions: NonNullable<TradePlayer['position']>[] = []
  for (const p of players) if (p.position !== undefined && !positions.includes(p.position)) positions.push(p.position)
  const filtered = players.filter((p) => position === undefined || p.position === position || selected.has(p.id))
  const shown = showAll || position !== undefined ? filtered : filtered.slice(0, 12)
  return (
    <div className="card mk-stack-tight">
      <SectionHeader title={title} subtitle={subtitle} />
      <div className="mk-chips" role="group" aria-label={`${title}: position`}>
        <FilterChip label="All" selected={position === undefined} onClick={() => setPosition(undefined)} />
        {positions.map((p) => (
          <FilterChip key={p} label={p} selected={position === p} onClick={() => setPosition(position === p ? undefined : p)} />
        ))}
      </div>
      {shown.map((player, index) => {
        const isSelected = selected.has(player.id)
        return (
          <div key={player.id} className="mk-picker-row">
            <button type="button" className="mk-picker-main" data-testid={`${identifier}-${index}`}
              aria-pressed={isSelected} aria-label={accessibilityLabel(player, model)} onClick={() => toggle(player.id)}>
              <PickerRow player={player} isSelected={isSelected} value={tradePlayerValue(player, model.basis)} basis={model.basis} />
            </button>
            <PlayerMenu playerID={player.id} context={model.context} name={player.name} />
          </div>
        )
      })}
      {position === undefined && !showAll && players.length > 12 && (
        <button type="button" className="mk-link t-meta" onClick={() => setShowAll(true)}>{`Show all ${players.length}`}</button>
      )}
    </div>
  )
}

const roleLabel = (p: TradePlayer) => (p.isReserve ? 'IR slot' : p.isSurplus ? 'spare' : p.isStarter ? 'starter' : 'bench')

function accessibilityLabel(player: TradePlayer, model: TradeWizardModel): string {
  const parts = [player.name, player.position ?? '']
  const badge = injuryBadge(player)
  if (badge) parts.push(badge)
  const value = tradePlayerValue(player, model.basis)
  if (value !== undefined) parts.push(`${one(value)} ${model.label(model.basis)}`)
  parts.push(player.isReserve ? 'on IR' : player.isSurplus ? 'spare' : player.isStarter ? 'starter' : 'bench')
  return parts.filter((p) => p !== '').join(', ')
}

function PickerRow({ player, isSelected, value, basis }: { player: TradePlayer; isSelected: boolean; value?: number; basis: TradeBasis }) {
  const badge = injuryBadge(player)
  return (
    <span className="mk-waiver-row">
      {isSelected
        ? <CheckCircle2 size={22} color="var(--accent)" aria-hidden />
        : <Circle size={22} className="muted" aria-hidden />}
      <PlayerAvatar sleeperID={player.id} name={player.name} position={player.position} size={30} />
      <span className="mk-row-text">
        <span className="mk-row-title">
          <span className="mk-name" style={{ fontWeight: 500 }}>{player.name}</span>
          {badge && <InjuryBadge label={badge} />}
        </span>
        <span className="mk-row-title">
          <PositionChip position={player.position} />
          {player.team && <span className="t-meta muted">{player.team}</span>}
          <span className="t-meta" style={{ color: player.isSurplus ? 'var(--start)' : 'var(--text-2)' }}>{roleLabel(player)}</span>
        </span>
      </span>
      {value !== undefined ? (
        <span className="mk-value" style={{ color: basis === 'overStartLine' ? deltaColor(value) : 'var(--text)' }}>
          {formatFixed(value, 1, { sign: basis === 'overStartLine' })}
        </span>
      ) : (
        <span className="t-meta faint">—</span>
      )}
    </span>
  )
}

function EffectsCard({ model }: { model: TradeWizardModel }) {
  const effects = model.effects
  const rival = model.partner?.rival.manager ?? 'Them'
  return (
    <div className="card mk-stack-tight">
      <SectionHeader title="What it does" subtitle="Computed on both rosters as they'd be after the trade. IR slots don't count as depth." />
      {effects.yourWeeks.length === 0 && effects.theirWeeks.length === 0 && (
        <p className="t-meta muted">Neither team has a short week before or after.</p>
      )}
      {effects.yourWeeks.length > 0 && <ShortfallRows title="Your short weeks" changes={effects.yourWeeks} />}
      {effects.theirWeeks.length > 0 && <ShortfallRows title={`${rival}'s short weeks`} changes={effects.theirWeeks} />}
      {effects.yourGains.length > 0 && <Gains title="For you" items={effects.yourGains} />}
      {effects.theirGains.length > 0 && <Gains title={`For ${rival}`} items={effects.theirGains} />}
      {effects.warnings.map((w) => (
        <span key={w} className="mk-fact t-meta" style={{ color: 'var(--caution)' }}><TriangleAlert size={13} aria-hidden /> <span>{w}</span></span>
      ))}
    </div>
  )
}

function Gains({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mk-stack-tight" style={{ gap: 3 }}>
      <span className="t-meta" style={{ fontWeight: 600 }}>{title}</span>
      {items.map((g) => (
        <span key={g} className="mk-fact t-meta" style={{ color: 'var(--start)' }}><CheckCircle2 size={13} aria-hidden /> <span>{g}</span></span>
      ))}
    </div>
  )
}

function ShortfallRows({ title, changes }: { title: string; changes: ShortfallChange[] }) {
  return (
    <div className="mk-stack-tight" style={{ gap: 4 }}>
      <span className="t-meta" style={{ fontWeight: 600 }}>{title}</span>
      <div className="mk-shortfalls">
        {changes.map((c) => (
          <span key={c.week} className="mk-shortfall" role="img" aria-label={`Week ${c.week}: ${c.before} short before, ${c.after} after`}>
            <span className="t-micro muted">W{c.week}</span>
            <span className="t-meta mk-inline" style={{ gap: 2 }}>
              <span className="muted">{c.before}</span>
              <ArrowRight size={9} strokeWidth={3} aria-hidden />
              <span style={{ fontWeight: 700, color: c.after < c.before ? 'var(--start)' : c.after > c.before ? 'var(--sit)' : 'var(--text)' }}>{c.after}</span>
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

// MARK: - Step 4

function ApproachStep({ model }: { model: TradeWizardModel }) {
  const [copied, setCopied] = useState(0)
  const [showOriginal, setShowOriginal] = useState(false)
  const rewritten = model.polishedPitch !== undefined && !showOriginal
  const shown = rewritten ? model.polishedPitch! : model.pitch
  const copy = async () => {
    try { await navigator.clipboard.writeText(shown) } catch { /* the text is selectable either way */ }
    setCopied((n) => n + 1)
  }
  return (
    <div className="mk-stack">
      <div className="card mk-stack-tight">
        <div className="mk-toolbar-row">
          <span className="t-meta" style={{ fontWeight: 600, color: rewritten ? 'var(--accent)' : 'var(--text-2)' }}>
            {rewritten ? 'Rewritten by your local model' : 'Your pitch'}
          </span>
          <span style={{ flex: 1 }} />
          {model.polishedPitch !== undefined && (
            <button type="button" className="mk-link t-meta" onClick={() => setShowOriginal((v) => !v)}>
              {showOriginal ? 'Show rewrite' : 'Show original'}
            </button>
          )}
        </div>
        <p className="t-body mk-pitch" data-testid="trade-pitch" aria-live="polite">{shown}</p>
        {rewritten && <p className="t-meta muted">Built only from the facts below. Read it before you send it.</p>}
      </div>
      <div className="mk-button-row">
        <button type="button" className="button mk-grow" onClick={() => void copy()}>
          {copied > 0 ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />} {copied > 0 ? 'Copied' : 'Copy'}
        </button>
        {model.hasRelay && (
          <button type="button" className="button mk-grow" disabled={model.isPolishing} onClick={() => void model.polishPitch()}>
            {model.isPolishing
              ? <span role="status" aria-label="Polishing">…</span>
              : <><Sparkles size={15} aria-hidden /> Polish with my AI</>}
          </button>
        )}
      </div>
      {model.polishError !== undefined && (
        <span className="mk-fact t-meta" style={{ color: 'var(--caution)' }}><TriangleAlert size={13} aria-hidden /> <span>{model.polishError}</span></span>
      )}
      {model.sleeperLink !== undefined && (
        <a className="button primary mk-wide" href={model.sleeperLink} target="_blank" rel="noreferrer">
          <ExternalLink size={16} aria-hidden /> Open in Sleeper
        </a>
      )}
      <p className="t-meta muted">Sleeper doesn't let other apps send offers. Propose the trade there, then paste this message into the trade.</p>
      <div className="card mk-stack-tight">
        <SectionHeader title="The facts it uses" subtitle="Only what helps them say yes — your own reasons stay with you." />
        {model.pitchFacts.map((fact) => (
          <span key={fact} className="mk-fact t-meta"><Check size={12} strokeWidth={3} color="var(--accent)" aria-hidden /> <span>{fact}</span></span>
        ))}
      </div>
    </div>
  )
}
