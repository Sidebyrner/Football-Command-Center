import { describe, expect, it } from 'vitest'
import { NavigationHistory, screenPlace, shortLabel, trailLabel, workspacePlace } from './NavigationHistory'
import { Router } from './Router'
import { hubFor, hubs, hubScreens, launchScreen, pathFor, screenForPath, type Screen } from './screens'

// Ported from NavigationHistoryTests.swift, RouterHistoryTests and PhoneHubTests
// (apple/Packages/FCApp/Tests/FCAppTests) — the same cases, the same answers.

const board = screenPlace('board')
const injuries = screenPlace('injuries')
const sitStart = screenPlace('sitStart')
const market = screenPlace('discovery')
const settings = screenPlace('settings')

describe('NavigationHistory', () => {
  it('back and forward retrace the steps', () => {
    let h = NavigationHistory.empty().record(board, injuries).record(injuries, sitStart)
    expect(h.back).toEqual([board, injuries])
    let move = h.goBack(sitStart)!
    expect(move.target).toEqual(injuries)
    move = move.history.goBack(injuries)!
    expect(move.target).toEqual(board)
    h = move.history
    expect(h.canGoBack).toBe(false)
    expect(h.forward).toEqual([sitStart, injuries])
    const fwd = h.goForward(board)!
    expect(fwd.target).toEqual(injuries)
    expect(fwd.history.back).toEqual([board])
  })

  it('a new step clears forward', () => {
    const h = NavigationHistory.empty().record(board, injuries).goBack(injuries)!.history
    expect(h.canGoForward).toBe(true)
    expect(h.record(board, market).canGoForward).toBe(false)
  })

  it('bouncing straight back is a back step, not a new one', () => {
    const h = NavigationHistory.empty().record(board, market).record(market, board)
    expect(h.canGoBack).toBe(false)
    expect(h.forward).toEqual([market])
  })

  it('settings is never a step', () => {
    const h = NavigationHistory.empty().record(screenPlace('dashboard'), settings).record(settings, screenPlace('dashboard'))
    expect(h.canGoBack).toBe(false)
    expect(h.canGoForward).toBe(false)
  })

  it('the trail is capped', () => {
    const screens: Screen[] = ['board', 'dashboard', 'sitStart', 'matchup', 'injuries', 'discovery', 'waivers']
    let h = NavigationHistory.empty()
    for (let i = 0; i < 100; i++) {
      h = h.record(screenPlace(screens[i % screens.length]!), screenPlace(screens[(i + 1) % screens.length]!))
    }
    expect(h.back.length).toBe(NavigationHistory.capacity)
  })

  it('jumping back several steps keeps them forward', () => {
    const h = NavigationHistory.empty().record(board, injuries).record(injuries, sitStart).record(sitStart, market)
    const jump = h.jumpBack(0, market)!
    expect(jump.target).toEqual(board)
    expect(jump.history.canGoBack).toBe(false)
    expect(jump.history.forward).toEqual([market, sitStart, injuries])
    expect(jump.history.goForward(board)!.target).toEqual(injuries)
  })

  it('a deleted workspace is forgotten', () => {
    const ws = workspacePlace('w1')
    const h = NavigationHistory.empty().record(board, ws).record(ws, market).forget('w1')
    expect(h.back).toEqual([board])
  })

  it('trail labels', () => {
    expect(trailLabel(injuries)).toBe('Lineup › Injuries')
    expect(trailLabel(board)).toBe('Board')
    expect(trailLabel(screenPlace('dashboard'))).toBe('My Team')
    expect(trailLabel(screenPlace('wrStream'))).toBe('Streams › WR')
    expect(shortLabel(screenPlace('wrStream'))).toBe('Streams WR')
    expect(shortLabel(injuries)).toBe('Injuries')
    expect(trailLabel(workspacePlace('w'), (id) => (id === 'w' ? 'Game day' : undefined))).toBe('Game day')
    expect(trailLabel(workspacePlace('w'))).toBe('Workspace')
  })
})

describe('Router', () => {
  it('a tile then back lands where you were', () => {
    let r = Router.at(board).open('injuries')
    expect(r.phoneHub).toBe('lineup')
    expect(r.canGoBack).toBe(true)
    r = r.goBack()
    expect(r.selection).toEqual(board)
    expect(r.segment('lineup')).toBe('injuries')
    expect(r.canGoForward).toBe(true)
    expect(r.goForward().selection).toEqual(injuries)
  })

  it('an accidental tab tap is one step back', () => {
    let r = Router.at(sitStart).open('matchup').selectHub('market')
    expect(r.selection).toEqual(market)
    r = r.goBack()
    expect(r.selection).toEqual(screenPlace('matchup'))
  })

  it("going back isn't itself recorded", () => {
    const r = Router.at(board).open('injuries').open('waivers').goBack().goBack()
    expect(r.selection).toEqual(board)
    expect(r.canGoBack).toBe(false)
    expect(r.history.forward.length).toBe(2)
  })

  it('jumping back from the trail', () => {
    const r = Router.at(board).open('injuries').open('waivers').open('qbStream').goBackTo(0)
    expect(r.selection).toEqual(board)
  })

  it('hubs remember their segment', () => {
    let r = Router.at(screenPlace('dashboard'))
    expect(r.phoneHub).toBe('team')
    r = r.selectHub('streams')
    expect(r.selection).toEqual(screenPlace(hubScreens.streams[0]!))
    r = r.open('wrStream').selectHub('market')
    expect(r.selection).toEqual(market)
    expect(r.selectHub('streams').selection).toEqual(screenPlace('wrStream'))
  })
})

describe('screens and hubs', () => {
  it('every screen belongs to exactly one hub', () => {
    const all: Screen[] = ['board', 'dashboard', 'injuries', 'discovery', 'planning', 'waivers', 'trades', 'idpStream',
      'wrStream', 'rbStream', 'qbStream', 'dstStream', 'kStream', 'matchup', 'sitStart', 'decide']
    for (const s of all) {
      expect(hubs.filter((h) => hubScreens[h].includes(s))).toHaveLength(1)
    }
    expect(hubFor('settings')).toBe('team')
    expect(hubs).toEqual(['board', 'team', 'lineup', 'market', 'streams'])
    expect(hubScreens.lineup).toEqual(['sitStart', 'decide', 'matchup', 'injuries'])
  })

  it('the phone opens on the Board', () => {
    expect(launchScreen(true)).toBe('board')
    expect(launchScreen(false)).toBe('dashboard')
  })

  it('every screen has a URL that maps back', () => {
    for (const hub of hubs) for (const s of hubScreens[hub]) expect(screenForPath(pathFor(s))).toBe(s)
    expect(screenForPath('/lineup')).toBe('sitStart')
    expect(screenForPath('/streams/')).toBe('qbStream')
    expect(screenForPath('/nowhere')).toBeUndefined()
  })
})
