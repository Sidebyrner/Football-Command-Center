/**
 * Everything the app builds once — a port of FCApp `AppServices`: the loader,
 * every screen model and the workspace library. Screens and workspace panels
 * take their model from here, so a panel and its full screen share one
 * instance and one load. Deliberately not observable itself: each view
 * observes only the model it shows.
 */
import { RelayClient } from '@data/RelayClient'
import type { SleeperService } from '@data/SleeperService'
import type { StaticDataStore } from '@data/StaticDataStore'
import { GameDayModel } from '../gameday/GameDayModel'
import type { LeagueContext } from '../league/LeagueContext'
import { LeagueContextLoader } from '../league/LeagueContextLoader'
import { MatchupModel } from '../lineup/MatchupModel'
import { SitStartModel } from '../lineup/SitStartModel'
import { DiscoveryModel } from '../market/DiscoveryModel'
import { InjuryCenterModel } from '../market/InjuryCenterModel'
import { PlanningModel } from '../market/PlanningModel'
import { TradeDeskScreenModel } from '../market/TradeDeskScreenModel'
import { WaiverBoardModel } from '../market/WaiverBoardModel'
import { PlayerCardModel } from '../player/PlayerCardModel'
import { isConfigured, type AppSettingsStore } from '../settings/AppSettings'
import { SettingsModel, usableRelay } from '../settings/SettingsModel'
import { DSTStreamScreenModel } from '../streams/DSTStreamKind'
import { IDPStreamScreenModel } from '../streams/IDPStreamKind'
import { KStreamScreenModel } from '../streams/KStreamKind'
import { QBStreamScreenModel } from '../streams/QBStreamKind'
import { RBStreamScreenModel } from '../streams/RBStreamKind'
import { WRStreamScreenModel } from '../streams/WRStreamKind'
import { DashboardModel } from '../team/DashboardModel'
import { LinkBus } from '../workspaces/LinkBus'
import { PlayerCardCache } from '../workspaces/PlayerCardCache'
import { StorageWorkspacePersistence, WorkspaceStore, type WorkspacePersistence } from '../workspaces/WorkspaceStore'
import type { SecretStore } from '@data/secretStore'

export interface AppServicesInit {
  sleeper: SleeperService
  staticData: StaticDataStore
  settingsStore: AppSettingsStore
  workspacePersistence?: WorkspacePersistence
  secrets?: SecretStore
  now?: () => number
}

export class AppServices {
  readonly sleeper: SleeperService
  readonly settingsStore: AppSettingsStore
  readonly loader: LeagueContextLoader
  readonly settingsModel: SettingsModel
  readonly planning: PlanningModel
  readonly dashboard: DashboardModel
  readonly matchup: MatchupModel
  readonly sitStart: SitStartModel
  readonly injuries: InjuryCenterModel
  readonly waivers: WaiverBoardModel
  readonly idpStream: IDPStreamScreenModel
  readonly wrStream: WRStreamScreenModel
  readonly rbStream: RBStreamScreenModel
  readonly qbStream: QBStreamScreenModel
  readonly dstStream: DSTStreamScreenModel
  readonly kStream: KStreamScreenModel
  readonly trades: TradeDeskScreenModel
  readonly discovery: DiscoveryModel
  /** This week's NFL games with their live state. */
  readonly gameDay: GameDayModel
  readonly workspaces: WorkspaceStore
  readonly linkBus = new LinkBus()
  readonly playerCards = new PlayerCardCache()
  private hasLoaded = false

  constructor({ sleeper, staticData, settingsStore, workspacePersistence, secrets, now = Date.now }: AppServicesInit) {
    this.sleeper = sleeper
    this.settingsStore = settingsStore
    this.settingsModel = new SettingsModel(sleeper, settingsStore, secrets)
    const loader = new LeagueContextLoader(sleeper, staticData, now)
    this.loader = loader
    // The relay is optional and fails soft; an address that can't work isn't used.
    const saved = settingsStore.load().relayBaseURL
    const relayBaseURL = saved !== undefined ? usableRelay(saved) : undefined
    this.planning = new PlanningModel(loader, sleeper)
    this.planning.relayBaseURL = relayBaseURL
    this.dashboard = new DashboardModel(loader, sleeper, relayBaseURL !== undefined ? new RelayClient(relayBaseURL) : undefined)
    this.matchup = new MatchupModel(loader, sleeper)
    this.sitStart = new SitStartModel(loader)
    this.injuries = new InjuryCenterModel(loader, sleeper)
    this.waivers = new WaiverBoardModel(loader, sleeper)
    this.idpStream = new IDPStreamScreenModel(loader)
    this.wrStream = new WRStreamScreenModel(loader)
    this.rbStream = new RBStreamScreenModel(loader)
    this.qbStream = new QBStreamScreenModel(loader)
    this.dstStream = new DSTStreamScreenModel(loader)
    this.kStream = new KStreamScreenModel(loader)
    this.trades = new TradeDeskScreenModel(loader)
    this.trades.relayBaseURL = relayBaseURL
    this.discovery = new DiscoveryModel(loader, sleeper)
    this.gameDay = new GameDayModel(loader, sleeper)
    this.workspaces = new WorkspaceStore(workspacePersistence ?? new StorageWorkspacePersistence())
  }

  /**
   * Loads every screen once the league is set up, in parallel — they share one
   * league context through the loader's memo. `force` refetches.
   */
  async loadIfConfigured(force = false): Promise<void> {
    const settings = this.settingsModel.settings
    if (!isConfigured(settings)) return
    if (!force && this.hasLoaded) return
    const { leagueID, rosterID } = settings
    if (leagueID === undefined || rosterID === undefined) return
    this.hasLoaded = true
    if (force) this.playerCards.removeAll()
    const request = { leagueID, userRosterID: rosterID, force }
    await Promise.all([
      this.dashboard.load(leagueID, rosterID, undefined, force),
      this.matchup.load(leagueID, rosterID, undefined, force),
      this.sitStart.load(leagueID, rosterID, undefined, force),
      this.planning.load(leagueID, rosterID, undefined, force),
      this.injuries.load(request),
      this.waivers.load(request),
      this.idpStream.load(leagueID, rosterID, undefined, force),
      this.wrStream.load(leagueID, rosterID, undefined, force),
      this.rbStream.load(leagueID, rosterID, undefined, force),
      this.trades.load(leagueID, rosterID, undefined, force),
      this.discovery.load(request),
      this.qbStream.load(leagueID, rosterID, undefined, force),
      this.dstStream.load(leagueID, rosterID, undefined, force),
      this.kStream.load(leagueID, rosterID, undefined, force),
      this.gameDay.load(leagueID, rosterID, force),
    ])
  }

  /** A new relay address reaches every model that uses it; the Board reloads. */
  setRelay(baseURL: string | undefined): void {
    this.dashboard.setRelay(baseURL)
    this.planning.relayBaseURL = baseURL
    this.trades.relayBaseURL = baseURL
    const { leagueID, rosterID } = this.settingsModel.settings
    if (leagueID === undefined || rosterID === undefined) return
    void this.dashboard.load(leagueID, rosterID)
  }

  /** A Player Card, reused while the league data stays the same. */
  playerCard(id: string, context: LeagueContext): PlayerCardModel {
    return this.playerCards.model(id, () => new PlayerCardModel(
      id, context, this.sleeper, this.settingsStore.load().gradeWeights ?? {},
      (weights) => {
        const settings = this.settingsStore.load()
        this.settingsStore.save({ ...settings, gradeWeights: weights })
      },
    ))
  }
}
