/**
 * The Player Card — a port of FCApp `PlayerCardView` (Views/Players). Four
 * tabs as on the phone: Overview (status, news, and the rest-of-season
 * schedule from the workspace `SchedulePanel`), Log, Projections and Grade.
 * The header carries the context-menu actions the phone offers on a player:
 * "Trade for…" / "Offer in trade" and "Copy name".
 */
import { teamLink } from '@models/league/GameDayWindow'
import { providerLabel } from '@data/LeagueDataSource'
import { useMemo, useState, type CSSProperties } from 'react'
import {
  ArrowLeftRight, CalendarDays, Copy, Cross, ExternalLink, Newspaper,
} from 'lucide-react'
import { PROJECTION_SOURCE_LABEL } from '@core/CommandCenterProjection'
import { PRACTICE_PHRASE } from '@core/InSeasonFiles'
import {
  GRADE_KEY, GRADE_METRIC_LABEL, SITUATION, SITUATION_METRICS, THIN_COVERAGE,
  gradeTier, isThin, topFactors,
} from '@core/PlayerGrade'
import { newsID, newsPublishedAt, newsSourceLabel } from '@data/insightsModels'
import { availabilityLabel } from '@models/league/LeagueContext'
import { PlayerSchedule, type PlayerSchedule as Schedule, type PlayerScheduleWeek } from '@models/market/PlayerSchedule'
import type { TradeWizardPrefill } from '@models/market/TradeWizardModel'
import type { PlayerCardModel, PlayerLogWeek, PlayerStatus } from '@models/player/PlayerCardModel'
import { DefenseLookup, defenseSourceLabel } from '@models/player/DefenseLookup'
import { useApp, useModel } from '@ui/app/AppContext'
import { PlayerAvatar, PositionChip, SlidingPicker, StatPill } from '@ui/components/Player'
import { ScreenSection } from '@ui/components/Screen'
import './playerCard.css'

const TABS = ['overview', 'log', 'projections', 'grade'] as const
export type PlayerCardTab = (typeof TABS)[number]
type Tab = PlayerCardTab
const TAB_LABEL: Record<Tab, string> = { overview: 'Overview', log: 'Log', projections: 'Projections', grade: 'Grade' }

const SECONDARY = 'var(--text-2)'
const ACCENT = 'var(--accent)'

/** Swift `.number.precision(.fractionLength(n))`. */
const fmt = (x: number, digits = 1) => x.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const fmtOpt = (x: number | undefined, digits = 1) => (x === undefined ? '—' : fmt(x, digits))
/** Swift `Int(x * 100)` — truncates. */
const pct100 = (x: number) => Math.trunc(x * 100)


export function PlayerCardView({ model, initialTab = 'overview' }: { model: PlayerCardModel; initialTab?: PlayerCardTab }) {
  const card = useModel(model)
  const [tab, setTab] = useState<Tab>(initialTab)
  return (
    <div className="pc">
      <Header model={card} />
      <SlidingPicker options={TABS} value={tab} onChange={setTab} label={(t) => TAB_LABEL[t]} ariaLabel="Player card section" />
      <div className="pc-tab" key={tab}>
        {tab === 'overview' && <Overview model={card} />}
        {tab === 'log' && <LogSection model={card} />}
        {tab === 'projections' && <ProjectionsSection model={card} />}
        {tab === 'grade' && <GradeSection model={card} />}
      </div>
    </div>
  )
}

// MARK: - Header

function Header({ model }: { model: PlayerCardModel }) {
  const { status, context } = model
  const leagueID = context.league.leagueID
  const subtitle = status
    ? [model.team, status.opponent !== undefined ? `vs ${status.opponent} this week` : undefined, availabilityLabel(status.availability)]
        .filter((x): x is string => x !== undefined).join(' · ')
    : undefined
  return (
    <header className="pc-header">
      <div className="pc-header-row">
        <PlayerAvatar sleeperID={model.id} name={model.name} position={model.position} size={56} />
        <div className="pc-header-text">
          <div className="pc-name-line">
            <h2 className="t-title pc-name">{model.name}</h2>
            <PositionChip position={model.position} />
          </div>
          {subtitle && <div className="t-meta muted">{subtitle}</div>}
        </div>
        {leagueID !== '' && (
          <a className="pc-link t-meta" href={teamLink(context)} target="_blank" rel="noreferrer">
            <ExternalLink size={13} aria-hidden /> {providerLabel(context.provider)}
          </a>
        )}
      </div>
      <Actions model={model} />
    </header>
  )
}

/** The phone's context-menu actions on a player: trade and copy. */
function Actions({ model }: { model: PlayerCardModel }) {
  const { openTrade } = useApp()
  const [copied, setCopied] = useState(false)
  const availability = model.status?.availability ?? model.context.availabilityOf(model.id)
  let trade: { label: string; prefill: TradeWizardPrefill } | undefined
  switch (availability.kind) {
    case 'rivalStarter': case 'rivalBench':
      trade = {
        label: 'Trade for…',
        prefill: {
          positions: model.position !== undefined ? new Set([model.position]) : undefined,
          rivalRosterID: availability.rosterID,
          theirPlayerID: model.id,
        },
      }
      break
    case 'mine':
      trade = { label: 'Offer in trade', prefill: { myPlayerID: model.id } }
      break
    case 'freeAgent':
      break
  }
  const copy = () => {
    const text = model.context.playerName(model.id) ?? model.id
    void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {})
  }
  return (
    <div className="pc-actions">
      {trade && (
        <button type="button" className="button pc-action" onClick={() => openTrade(trade.prefill)}>
          <ArrowLeftRight size={15} aria-hidden /> {trade.label}
        </button>
      )}
      <button type="button" className="button pc-action" onClick={copy}>
        <Copy size={15} aria-hidden /> {copied ? 'Copied' : 'Copy name'}
      </button>
      <span className="pc-visually-hidden" aria-live="polite">{copied ? 'Name copied' : ''}</span>
    </div>
  )
}

// MARK: - Overview

function Overview({ model }: { model: PlayerCardModel }) {
  const status = model.status
  const relative = useMemo(() => new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' }), [])
  return (
    <>
      {status && (
        <div className="card pc-card">
          <ScreenSection title="Status" icon={Cross}>
            <div className="pc-rows">
              <Row label="Injury" value={injuryText(status)}
                tint={status.sleeperTag === undefined && status.report?.designation === undefined ? SECONDARY : 'var(--caution)'} />
              <Row label="Depth chart"
                value={status.depthRank !== undefined ? `#${status.depthRank + 1} at ${model.position ?? ''}` : 'not listed'}
                source="official, nflverse" />
              <Row label="Bye" value={status.byeWeek !== undefined ? `Week ${status.byeWeek}` : '—'} />
              {status.impliedTotal !== undefined && (
                <Row label="Team total" value={`${status.impliedTotal.toFixed(1)} implied`} source="recorded closing line" />
              )}
            </div>
          </ScreenSection>
        </div>
      )}
      <div className="card pc-card">
        <ScreenSection title="News" icon={Newspaper}>
          {model.news.length === 0 && (
            <p className="t-meta muted pc-p">{model.newsUnavailable ? 'News could not be loaded.' : 'No recent news.'}</p>
          )}
          {model.news.slice(0, 5).map((item) => {
            const published = newsPublishedAt(item)
            const meta = [newsSourceLabel(item), published ? relativeDate(published, relative) : undefined]
              .filter((x): x is string => x !== undefined).join(' · ')
            return (
              <article className="pc-news" key={newsID(item)}>
                {item.metadata?.title && <h4 className="pc-news-title">{item.metadata.title}</h4>}
                {item.metadata?.description && <p className="t-meta pc-p">{item.metadata.description}</p>}
                {item.metadata?.analysis && <p className="t-meta muted pc-p">{item.metadata.analysis}</p>}
                <div className="pc-caption2 faint">{meta}</div>
              </article>
            )
          })}
        </ScreenSection>
      </div>
      <ScheduleCard model={model} />
    </>
  )
}

function injuryText(status: PlayerStatus): string {
  const parts: string[] = []
  if (status.report?.designation !== undefined) parts.push(status.report.designation)
  else if (status.sleeperTag !== undefined) parts.push(status.sleeperTag)
  const injury = status.report?.injury ?? status.bodyPart
  if (injury !== undefined) parts.push(injury)
  if (status.report?.practice !== undefined) parts.push(PRACTICE_PHRASE[status.report.practice])
  return parts.length === 0 ? 'No designation' : parts.join(' · ')
}

/** Swift `.relative(presentation: .named)`. */
function relativeDate(date: Date, format: Intl.RelativeTimeFormat): string {
  const seconds = (date.getTime() - Date.now()) / 1000
  const abs = Math.abs(seconds)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60],
  ]
  for (const [unit, size] of units) if (abs >= size) return format.format(Math.round(seconds / size), unit)
  return format.format(Math.round(seconds), 'second')
}

function Row({ label, value, source, tint }: { label: string; value: string; source?: string; tint?: string }) {
  return (
    <div className="pc-row">
      <div className="t-meta muted pc-row-label">{label}</div>
      <div>
        <div className="pc-subheadline" style={tint ? { color: tint } : undefined}>{value}</div>
        {source && <div className="pc-caption2 faint">{source}</div>}
      </div>
    </div>
  )
}

// MARK: - Schedule (the workspace SchedulePanel)

function ScheduleCard({ model }: { model: PlayerCardModel }) {
  const schedule = useMemo(
    () => PlayerSchedule.build(model.id, model.context, DefenseLookup.build(model.context)),
    [model.id, model.context],
  )
  return (
    <div className="card pc-card">
      <ScreenSection title="Schedule" icon={CalendarDays} subtitle="His remaining games, lines and how soft each defense is.">
        {schedule.weeks.length === 0 ? (
          <p className="t-meta muted pc-p">The regular season is over.</p>
        ) : (
          <>
            <Strength schedule={schedule} />
            <div className="pc-table-wrap">
              <table className="pc-table">
                <thead>
                  <tr>
                    <th scope="col" className="lead">Wk</th>
                    <th scope="col" className="lead">Opp</th>
                    <th scope="col" className="wide">Spread</th>
                    <th scope="col" className="wide">Total</th>
                    <th scope="col">Implied</th>
                    <th scope="col">Def rank</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.weeks.map((week) => (
                    <ScheduleRow key={week.week} week={week} current={week.week === schedule.currentWeek} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="pc-caption2 faint pc-p">{scheduleFootnote(schedule)}</p>
          </>
        )}
      </ScreenSection>
    </div>
  )
}

function Strength({ schedule }: { schedule: Schedule }) {
  const sos = schedule.strengthOfSchedule
  if (sos === undefined) {
    return <div className="inset t-meta muted">Not enough defense data yet for a strength of schedule.</div>
  }
  const tint = sos >= 1.05 ? 'var(--start)' : sos <= 0.95 ? 'var(--sit)' : 'var(--text)'
  const verdict = sos >= 1.05 ? 'Softer than average' : sos <= 0.95 ? 'Tougher than average' : 'About average'
  return (
    <div className="inset pc-strength">
      <div>
        <div className="pc-sos" style={{ color: tint }}>{sos.toFixed(2)}×</div>
        <div className="pc-caption2 muted">rest-of-season SoS</div>
      </div>
      <div className="t-meta pc-strong" style={{ color: tint }}>{verdict}</div>
      <div className="pc-spacer" />
      <div className="pc-caption2 faint">{schedule.strengthOfScheduleGames} games</div>
    </div>
  )
}

function ScheduleRow({ week, current }: { week: PlayerScheduleWeek; current: boolean }) {
  const cls = current ? 'current' : undefined
  if (week.isBye) {
    return (
      <tr className={cls} aria-current={current ? 'true' : undefined}>
        <td className="lead">{week.week}</td>
        <td className="lead faint">BYE</td>
        <td className="wide" /><td className="wide" /><td /><td />
      </tr>
    )
  }
  const soft = (week.defenseVsAverage ?? 0) >= 0
  return (
    <tr className={cls} aria-current={current ? 'true' : undefined}>
      <td className="lead">{week.week}</td>
      <td className="lead">{week.opponent !== undefined ? (week.isHome === false ? '@' : '') + week.opponent : '—'}</td>
      <td className="wide muted">{week.spread !== undefined ? `${week.spread >= 0 ? '+' : ''}${week.spread.toFixed(1)}` : '—'}</td>
      <td className="wide muted">{week.total !== undefined ? week.total.toFixed(1) : '—'}</td>
      <td>{week.impliedTotal !== undefined ? week.impliedTotal.toFixed(1) : '—'}</td>
      <td>
        {week.defenseRank !== undefined
          ? <span style={{ color: soft ? 'var(--start)' : 'var(--sit)' }} title={soft ? 'Softer than average' : 'Tougher than average'}>#{week.defenseRank}</span>
          : <span className="faint">—</span>}
      </td>
    </tr>
  )
}

function scheduleFootnote(schedule: Schedule): string {
  const parts: string[] = []
  const last = schedule.coveredWeeks[schedule.coveredWeeks.length - 1]
  if (last !== undefined) {
    const final = schedule.weeks[schedule.weeks.length - 1]?.week ?? last
    parts.push(last >= final ? PlayerSchedule.linesLabel : `${PlayerSchedule.linesLabel} through week ${last}; later weeks have no line yet`)
  } else {
    parts.push('No recorded lines for his remaining games yet')
  }
  parts.push(`Def rank: 1 is the softest vs ${schedule.position ?? 'his position'}`)
  if (schedule.defenseSource) parts.push(defenseSourceLabel(schedule.defenseSource))
  return parts.join('. ') + '.'
}

// MARK: - Log

function LogSection({ model }: { model: PlayerCardModel }) {
  return (
    <div className="card pc-card">
      <ScreenSection title="This season" subtitle="Points in your scoring from Sleeper's lines; snaps and expected points from nflverse.">
        {model.log.length === 0 && <p className="t-meta muted pc-p">No games recorded this season.</p>}
        {model.log.length > 0 && <LogChart log={model.log} />}
        <ul className="pc-list">
          {model.log.map((week) => (
            <li className="pc-log-row" key={week.week}>
              <span className="pc-week">W{week.week}</span>
              <span className="t-meta pc-opp">{week.opponent !== undefined ? `vs ${week.opponent}` : '—'}</span>
              <span className="pc-pills">
                {week.snapShare !== undefined && <Mini label="snaps" value={`${Math.round(week.snapShare * 100)}%`} tint={SECONDARY} />}
                {week.targets !== undefined && week.targets > 0 && <Mini label="tgt" value={String(week.targets)} tint={SECONDARY} />}
                {week.rushAttempts !== undefined && week.rushAttempts > 0 && <Mini label="att" value={String(week.rushAttempts)} tint={SECONDARY} />}
                {week.expectedPoints !== undefined && <Mini label="xFP" value={fmt(week.expectedPoints)} tint={SECONDARY} />}
                {week.projected !== undefined && <Mini label="proj" value={fmt(week.projected)} tint={SECONDARY} />}
                <Mini label="pts" value={fmtOpt(week.points)} />
              </span>
            </li>
          ))}
        </ul>
      </ScreenSection>
    </div>
  )
}

/** Swift Charts' place: points by week as bars, Rotowire's projection as a tick. */
function LogChart({ log }: { log: PlayerLogWeek[] }) {
  const weeks = [...log].sort((a, b) => a.week - b.week)
  const values = weeks.flatMap((w) => [w.points ?? 0, w.projected ?? 0])
  const top = Math.max(1, ...values)
  const bottom = Math.min(0, ...values)
  const width = 320
  const height = 120
  const pad = { top: 8, bottom: 18, left: 4, right: 4 }
  const plotH = height - pad.top - pad.bottom
  const slot = (width - pad.left - pad.right) / weeks.length
  const barW = Math.max(4, Math.min(24, slot * 0.6))
  const y = (v: number) => pad.top + ((top - v) / (top - bottom)) * plotH
  const zero = y(0)
  const summary = 'Points by week: ' + weeks
    .map((w) => `week ${w.week} ${w.points !== undefined ? fmt(w.points) : 'no line'}${w.projected !== undefined ? ` (projected ${fmt(w.projected)})` : ''}`)
    .join(', ') + '.'
  return (
    <figure className="pc-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary} preserveAspectRatio="none">
        <line x1={pad.left} x2={width - pad.right} y1={zero} y2={zero} className="pc-chart-axis" />
        {weeks.map((w, i) => {
          const cx = pad.left + slot * (i + 0.5)
          const pts = w.points
          return (
            <g key={w.week}>
              {pts !== undefined && (
                <rect x={cx - barW / 2} width={barW} y={Math.min(y(pts), zero)} height={Math.max(1, Math.abs(y(pts) - zero))}
                  rx={2} className="pc-chart-bar" />
              )}
              {w.projected !== undefined && (
                <line x1={cx - barW / 2 - 2} x2={cx + barW / 2 + 2} y1={y(w.projected)} y2={y(w.projected)} className="pc-chart-proj" />
              )}
              <text x={cx} y={height - 5} textAnchor="middle" className="pc-chart-label">{w.week}</text>
            </g>
          )
        })}
      </svg>
      <figcaption className="pc-caption2 muted pc-chart-legend">
        <span><i className="pc-key pc-key-bar" aria-hidden /> points</span>
        <span><i className="pc-key pc-key-proj" aria-hidden /> Rotowire projection</span>
      </figcaption>
    </figure>
  )
}

function Mini({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <span className="pc-mini">
      <span className="pc-mini-value" style={tint ? { color: tint } : undefined}>{value}</span>
      <span className="pc-mini-label">{label}</span>
    </span>
  )
}

// MARK: - Projections

function ProjectionsSection({ model }: { model: PlayerCardModel }) {
  const projection = model.commandCenter
  const summary = model.calibrationSummary
  return (
    <>
      <div className="card pc-card">
        <ScreenSection title="This week" subtitle="Two separate projections. Neither is blended into the other.">
          <div className="pc-stats">
            <StatPill label={model.context.inSeason.projectionSourceLabel ?? 'Rotowire via Sleeper'} value={fmtOpt(model.rotowireThisWeek)} />
            <StatPill label={PROJECTION_SOURCE_LABEL} value={fmtOpt(projection?.weekly)} tint={ACCENT} />
            {projection?.restOfSeasonPerGame !== undefined && (
              <StatPill label="rest of season /gm" value={fmt(projection.restOfSeasonPerGame)} tint={ACCENT} />
            )}
          </div>
          {projection?.note && <p className="t-meta muted pc-p">{projection.note}</p>}
          {projection && projection.factors.length > 0 && (
            <dl className="pc-factors">
              {projection.factors.map((factor) => (
                <div className="pc-factor" key={factor.name}>
                  <dt className="t-meta pc-strong">{factor.name}</dt>
                  <dd className="t-meta pc-mono pc-factor-value">
                    {factor.name === 'Pace' ? fmt(factor.value, 1) : '×' + fmt(factor.value, 2)}
                  </dd>
                  <dd className="pc-caption2 muted pc-factor-detail">{factor.detail}</dd>
                </div>
              ))}
            </dl>
          )}
        </ScreenSection>
      </div>
      <div className="card pc-card">
        <ScreenSection title="How each has done"
          subtitle="Past weeks this season. Command Center is rebuilt from the weeks before each game, without the matchup term.">
          {model.calibration.length === 0 ? (
            <p className="t-meta muted pc-p">No completed games to check against yet.</p>
          ) : (
            <>
              {summary && (
                <div className="pc-stats">
                  <StatPill label="Rotowire avg miss" value={fmtOpt(summary.rotowireError)} />
                  <StatPill label="Command Center avg miss" value={fmtOpt(summary.commandCenterError)} tint={ACCENT} />
                  <StatPill label="games" value={String(summary.weeks)} tint={SECONDARY} />
                </div>
              )}
              <ul className="pc-list">
                {model.calibration.map((week) => (
                  <li className="pc-log-row" key={week.week}>
                    <span className="pc-week">W{week.week}</span>
                    <span className="pc-pills">
                      <Mini label="Rotowire" value={fmtOpt(week.rotowire)} tint={SECONDARY} />
                      <Mini label="CC" value={fmtOpt(week.commandCenter)} tint={SECONDARY} />
                      <Mini label="actual" value={fmt(week.actual)} />
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </ScreenSection>
      </div>
    </>
  )
}

// MARK: - Grade

function GradeSection({ model }: { model: PlayerCardModel }) {
  const grade = model.grade
  const weighted = model.weighted
  return (
    <>
      <div className="card pc-card">
        <div className="pc-grade-head">
          <ScreenSection title="Cohort grade"
            subtitle={`Percentile against ${model.position ?? 'his position'} players with real snaps this season, weighted for your scoring.`}>
            {null}
          </ScreenSection>
          <GradeBadge score={grade?.score} thin={grade ? isThin(grade) : true} />
        </div>
        {grade ? (
          <div className="pc-stack">
            <p className="t-meta pc-p" style={{ color: isThin(grade) ? 'var(--caution)' : SECONDARY }}>
              {`${gradeTier(grade) ?? 'No tier'} · ${pct100(grade.coverage)}% of the model's weight had data`}
            </p>
            <ul className="pc-list">
              {topFactors(grade).map((factor) => (
                <li className="pc-bar-row" key={factor.metric}>
                  <span className="t-meta">{GRADE_METRIC_LABEL[factor.metric]}</span>
                  <span className="pc-spacer" />
                  <progress className="pc-progress" value={factor.percentile} max={1} aria-label={`${GRADE_METRIC_LABEL[factor.metric]} percentile`} />
                  <span className="t-meta pc-mono pc-num">{pct100(factor.percentile)}</span>
                </li>
              ))}
            </ul>
            {grade.missing.length > 0 && (
              <p className="pc-caption2 faint pc-p">
                {'Not available: ' + grade.missing.map((m) => GRADE_METRIC_LABEL[m]).join(', ') + '. Left out, never defaulted.'}
              </p>
            )}
          </div>
        ) : (
          <p className="t-meta muted pc-p">No current-season line to grade.</p>
        )}
      </div>

      <div className="card pc-card">
        <ScreenSection title="Situation" subtitle="Each its own number, from its own source. None is inside the grade above.">
          {model.chips.length === 0 && <p className="t-meta muted pc-p">No situation data for this player yet.</p>}
          <div className="pc-chips">
            {model.chips.map((chip) => {
              const info = SITUATION[chip.metric]
              const pct = chip.percentile
              const tint = pct === undefined ? undefined : pct >= 0.6 ? 'var(--start)' : pct <= 0.4 ? 'var(--sit)' : SECONDARY
              return (
                <div className="pc-chip" key={chip.metric}>
                  <div className="pc-chip-head">
                    <span className="t-meta pc-strong">{info.label}</span>
                    {pct !== undefined && (
                      <span className="t-meta pc-mono pc-strong" style={{ color: tint }} aria-label={`percentile ${pct100(pct)}`}>{pct100(pct)}</span>
                    )}
                  </div>
                  <div className="pc-caption2 muted">{chip.detail}</div>
                  <div className="pc-caption2 faint">{pct === undefined ? info.source : `vs ${chip.comparedTo} · ${info.source}`}</div>
                </div>
              )
            })}
          </div>
        </ScreenSection>
      </div>

      <div className="card pc-card pc-stack">
        <label className="pc-toggle">
          <span>
            <span className="t-section">Weighted view</span>
            <span className="t-meta muted pc-block">
              Your own composite of the grade and the situation, under weights you set. Optional, and labelled as yours.
            </span>
          </span>
          <input type="checkbox" role="switch" className="pc-switch" checked={model.showWeighted}
            onChange={(e) => { model.showWeighted = e.target.checked }} />
        </label>
        {model.showWeighted && weighted && (
          <>
            <div className="pc-weighted-head">
              <GradeBadge score={weighted.score} thin={weighted.coverage < THIN_COVERAGE} />
              <span className="t-meta muted">{pct100(weighted.coverage)}% of your weight had a number behind it</span>
              <span className="pc-spacer" />
              <button type="button" className="button pc-small-button" onClick={() => model.resetWeights()}>Reset</button>
            </div>
            <WeightSlider model={model} weightKey={GRADE_KEY} label="Cohort grade" />
            {SITUATION_METRICS.map((metric) => (
              <WeightSlider key={metric} model={model} weightKey={metric} label={SITUATION[metric].label} />
            ))}
          </>
        )}
      </div>
    </>
  )
}

function WeightSlider({ model, weightKey, label }: { model: PlayerCardModel; weightKey: string; label: string }) {
  const value = model.weight(weightKey)
  const id = `pc-weight-${weightKey}`
  return (
    <div className="pc-slider-row">
      <label className="t-meta pc-slider-label" htmlFor={id}>{label}</label>
      <input id={id} type="range" min={0} max={50} step={0.5} value={value}
        onChange={(e) => { model.weights = { ...model.weights, [weightKey]: Math.round(Number(e.target.value) * 2) / 2 } }} />
      <span className="t-meta pc-mono pc-num" aria-hidden>{Math.round(value)}</span>
    </div>
  )
}

function GradeBadge({ score, thin }: { score?: number; thin: boolean }) {
  return (
    <div
      className={`pc-badge${thin ? ' thin' : ''}`}
      role="img"
      aria-label={score !== undefined ? `Grade ${score}${thin ? ', thin' : ''}` : 'No grade'}
      style={{ '--badge': thin ? 'var(--text-2)' : ACCENT } as CSSProperties}
    >
      {score !== undefined ? String(score) : '—'}
    </div>
  )
}
