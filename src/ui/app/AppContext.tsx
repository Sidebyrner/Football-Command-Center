/**
 * The services and app-wide actions, handed to every screen — the web's
 * version of the phone's environment values (`appServices`, `openPlayerCard`,
 * `openTrade`, `openScreen`). Screens observe only the model they show.
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { AppServices } from '@models/app/AppServices'
import type { LeagueContext } from '@models/league/LeagueContext'
import type { TradeWizardPrefill } from '@models/market/TradeWizardModel'
import type { Screen } from '@models/navigation/screens'
import type { Observable } from '@models/Observable'
import type { PlayerCardModel } from '@models/player/PlayerCardModel'
import { startLiveUpdates } from '@models/gameday/LivePoller'
import { useNavigation } from '@ui/shell/navigationStore'
import { createServices } from './createServices'

interface AppValue {
  services: AppServices
  demo: boolean
  openScreen: (screen: Screen) => void
  openPlayerCard: (id: string, context: LeagueContext) => void
  openTrade: (prefill: TradeWizardPrefill) => void
  playerCard?: PlayerCardModel
  closePlayerCard: () => void
}

const AppContext = createContext<AppValue | undefined>(undefined)

export function useApp(): AppValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp outside AppProvider')
  return value
}

export const useServices = () => useApp().services

/** Re-renders when the model calls `changed()`. */
export function useModel<M extends Observable>(model: M): M {
  useSyncExternalStore(model.subscribe, model.getVersion, model.getVersion)
  return model
}

export function AppProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [created, setCreated] = useState<{ services: AppServices; demo: boolean }>()
  const [failure, setFailure] = useState<string>()
  const [playerCard, setPlayerCard] = useState<PlayerCardModel>()
  const { open } = useNavigation()

  useEffect(() => {
    let cancelled = false
    createServices().then(
      (c) => { if (!cancelled) setCreated(c) },
      (e: unknown) => { if (!cancelled) setFailure(e instanceof Error ? e.message : String(e)) },
    )
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!created) return
    void created.services.loadIfConfigured()
    // One loop keeps every live score current while the page is visible.
    return startLiveUpdates(created.services)
  }, [created])

  if (failure) return <div className="fcc" style={{ padding: 24 }}>Couldn’t start: {failure}</div>
  if (!created) return <>{fallback}</>

  const { services, demo } = created
  const value: AppValue = {
    services,
    demo,
    openScreen: open,
    openPlayerCard: (id, context) => setPlayerCard(services.playerCard(id, context)),
    openTrade: (prefill) => {
      setPlayerCard(undefined)
      open('trades')
      void services.trades.open(prefill)
    },
    playerCard,
    closePlayerCard: () => setPlayerCard(undefined),
  }
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
