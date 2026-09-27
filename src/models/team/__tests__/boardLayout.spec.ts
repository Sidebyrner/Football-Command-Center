import { describe, expect, it } from 'vitest'
import { hubFor } from '../../navigation/screens'
import { BOARD_TILES, BoardLayout, boardTileDestination, type BoardTile } from '../BoardTile'

/**
 * Port of BoardLayoutTests: the Board's saved tile list — order, hidden tiles,
 * and what happens as the catalog changes between versions.
 */
describe('Board layout', () => {
  it('unset is the standard layout with every tile', () => {
    const layout = BoardLayout.decode(undefined)
    expect(layout.equals(BoardLayout.standard)).toBe(true)
    expect(new Set(layout.order), 'every tile is in the standard layout').toEqual(new Set(BOARD_TILES))
    expect(layout.visible[0]).toBe('liveMatchup')
  })

  it('round-trips order and hidden', () => {
    const layout = BoardLayout.standard
    ;[layout.order[0], layout.order[3]] = [layout.order[3]!, layout.order[0]!]
    layout.hidden = new Set<BoardTile>(['news', 'byeWeeks'])
    const back = BoardLayout.decode(layout.encoded)
    expect(back.equals(layout)).toBe(true)
    expect(back.visible.includes('news')).toBe(false)
    expect(layout.encoded.includes('-news')).toBe(true)
  })

  it('unknown tiles drop and new ones append shown', () => {
    const layout = BoardLayout.decode('injuries,retired,-games,injuries')
    expect(layout.order.slice(0, 2)).toEqual(['injuries', 'games'])
    expect(layout.hidden).toEqual(new Set(['games']))
    expect(new Set(layout.order), "tiles it didn't know about come back").toEqual(new Set(BOARD_TILES))
    expect(layout.order.length, 'no duplicates').toBe(BOARD_TILES.length)
    expect(layout.visible.includes('liveMatchup')).toBe(true)
  })

  it('half tiles pair and full tiles span', () => {
    const rows = BoardLayout.rows(['readiness', 'liveMatchup', 'injuries', 'topPickup', 'standings'])
    expect(rows).toEqual([['readiness'], ['liveMatchup'], ['injuries', 'topPickup'], ['standings']])
  })

  it('every tile opens a screen on the phone', () => {
    for (const tile of BOARD_TILES) {
      expect(hubFor(boardTileDestination(tile)), `${tile} opens somewhere else`).not.toBe('board')
    }
  })
})
