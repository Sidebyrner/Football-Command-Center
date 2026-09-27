import type { CSSProperties, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { CheckCircle2, Info, OctagonX, TriangleAlert } from 'lucide-react'

export type StatusTone = 'start' | 'caution' | 'sit'

const toneIcon: Record<StatusTone, LucideIcon> = { start: CheckCircle2, caution: TriangleAlert, sit: OctagonX }
const toneColor: Record<StatusTone, string> = { start: 'var(--start)', caution: 'var(--caution)', sit: 'var(--sit)' }

/**
 * The top of a screen: where you are, and the one answer the screen exists to
 * give, on a band in the screen's hue — the port of `ScreenHero`.
 */
export function ScreenHero(props: {
  overline: string
  icon: LucideIcon
  answer: string
  detail?: string
  stats?: { value: string; label: string }[]
  tone?: StatusTone
  hue: string
  trailing?: ReactNode
}) {
  const { overline, icon: Icon, answer, detail, stats = [], tone, hue, trailing } = props
  const ToneIcon = tone ? toneIcon[tone] : undefined
  return (
    <section
      className="hero"
      style={{ '--hue': hue } as CSSProperties}
      aria-label={`${overline}: ${answer}`}
    >
      <div className="hero-overline t-micro">
        <Icon size={14} strokeWidth={2.5} aria-hidden />
        <span>{overline}</span>
        <span style={{ flex: 1 }} />
        {trailing}
      </div>
      <div className="hero-answer">
        {ToneIcon && <ToneIcon size={26} color={toneColor[tone!]} aria-hidden />}
        <h2 className="t-display">{answer}</h2>
      </div>
      {detail && <p className="t-body muted">{detail}</p>}
      {stats.length > 0 && (
        <div className="hero-stats">
          {stats.map((s) => (
            <StatValue key={s.label} value={s.value} label={s.label} />
          ))}
        </div>
      )}
    </section>
  )
}

/** A number with its label under it. */
export function StatValue({ value, label, tint }: { value: string; label: string; tint?: string }) {
  return (
    <div className="stat">
      <div className="t-title" style={tint ? { color: tint } : undefined}>{value}</div>
      <div className="t-meta muted">{label}</div>
    </div>
  )
}

/** A section: an icon in the screen's hue, a title and a count, then its content. */
export function ScreenSection(props: {
  title: string
  icon?: LucideIcon
  count?: number
  subtitle?: string
  hue?: string
  children: ReactNode
}) {
  const { title, icon: Icon, count, subtitle, hue, children } = props
  return (
    <section className="section">
      <header className="section-header">
        <div className="section-title">
          {Icon && <Icon size={17} strokeWidth={2.4} color={hue ?? 'var(--accent)'} aria-hidden />}
          <h3 className="t-section">{title}</h3>
          {count !== undefined && <span className="count t-meta">{count}</span>}
        </div>
        {subtitle && <p className="t-meta muted">{subtitle}</p>}
      </header>
      {children}
    </section>
  )
}

/** A verdict as an icon and a word — colour never carries it alone. */
export function StatusLabel({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  const Icon = toneIcon[tone]
  return (
    <span className="status-label t-body" style={{ color: toneColor[tone] }}>
      <Icon size={16} aria-hidden /> {children}
    </span>
  )
}

/** A verdict card: a raised card with the status colour down its leading edge. */
export function Callout({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <div className="card callout" style={{ '--tone': toneColor[tone] } as CSSProperties}>
      {children}
    </div>
  )
}

/** Where the numbers come from — kept, but folded at the bottom of a screen. */
export function AboutThisData({ children }: { children: ReactNode }) {
  return (
    <details className="about">
      <summary className="t-meta muted">
        <Info size={13} aria-hidden /> About this data
      </summary>
      <div className="about-body t-meta muted">{children}</div>
    </details>
  )
}

/** One filter chip. Selected is a filled neutral — selection isn't an action. */
export function FilterChip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`chip t-body${selected ? ' chip-on' : ''}`} aria-pressed={selected} onClick={onClick}>
      {label}
    </button>
  )
}

/** A segmented control whose selected option is a raised neutral pill. */
export function SegmentBar<T extends string>(props: {
  options: readonly T[]
  value: T
  label: (option: T) => string
  onChange: (option: T) => void
  ariaLabel: string
}) {
  const { options, value, label, onChange, ariaLabel } = props
  return (
    <div className="segments" role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="tab"
          aria-selected={option === value}
          className={`segment t-body${option === value ? ' segment-on' : ''}`}
          onClick={() => onChange(option)}
        >
          {label(option)}
        </button>
      ))}
    </div>
  )
}
