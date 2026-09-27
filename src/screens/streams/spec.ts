/**
 * What one stream shows that another does not — ports of `StreamScreenSpec`,
 * `StreamCompareSpec`, `StreamPill`, `StreamCompareRow` and `StreamGameCell`.
 * Everything else about the screen is shared.
 */
import type { ComponentType } from 'react'
import type { Position } from '@core/Position'
import type { StreamStatPoints } from '@core/Stream'
import type { Screen } from '@models/navigation/screens'
import type { StreamKindTypes } from '@models/streams/StreamKind'
import type { StreamScreenModel } from '@models/streams/StreamScreenModel'

/** A labelled number for a stream row, card or compare cell. */
export interface StreamPill {
  label: string
  value: string
  /** A CSS colour; the text colour when absent. */
  tint?: string
}

/** One row of the comparison table. */
export type StreamCompareRow =
  /** Numbers, best tinted. */
  | { kind: 'metric'; label: string; values: number[]; format: (x: number) => string }
  | { kind: 'text'; label: string; values: string[] }

export interface StreamCompareSection {
  title: string
  rows: StreamCompareRow[]
}

/** One completed game in a compare cell: "14.2 pts" over "Wk 2 v IND · 100% · 7 tkl". */
export interface StreamGameCell {
  title: string
  detail: string
}

type Model<K extends StreamKindTypes> = StreamScreenModel<K>

/** What a stream puts in its comparison beyond the shared verdict, range, recent games and head-to-head. */
export interface StreamCompareSpec<K extends StreamKindTypes> {
  /** Projection-specific sections (stat line, points by stat, game factors). */
  sections: (model: Model<K>, players: K['Projection'][]) => StreamCompareSection[]
  /** Extra pills on each phone card, after E[pts]/floor/ceiling. */
  cardPills: (p: K['Projection']) => StreamPill[]
  breakdown: (model: Model<K>, p: K['Projection']) => StreamStatPoints[]
  recentGames: (model: Model<K>, id: string) => StreamGameCell[]
}

export interface StreamEditorProps<K extends StreamKindTypes> {
  model: Model<K>
  onClose: () => void
}

export interface StreamPlayerEditorProps<K extends StreamKindTypes> extends StreamEditorProps<K> {
  row: K['Projection']
}

export interface StreamScreenSpec<K extends StreamKindTypes> {
  title: string
  /** The screen, for its icon and hue. */
  screen: Screen
  /** Slot positions offered as filter chips; empty hides the chips. */
  filterPositions: Position[]
  scoringSummary: (s: K['Scoring']) => string
  /** Usage shown under the name, e.g. "93% snaps" or "24% targets". */
  usage: (p: K['Projection']) => string
  rowPills: (p: K['Projection']) => StreamPill[]
  starterPills: (p: K['Projection']) => StreamPill[]
  /** The team's spread from its own side — Swift's `Kind.Team.spread`, for the compare's Game rows. */
  teamSpread: (t: K['Team']) => number
  compare: StreamCompareSpec<K>
  ContextEditor: ComponentType<StreamEditorProps<K>>
  PlayerEditor: ComponentType<StreamPlayerEditorProps<K>>
}
