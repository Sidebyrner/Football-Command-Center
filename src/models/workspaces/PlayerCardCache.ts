/**
 * Recently opened Player Cards, so a linked panel flicking between players
 * doesn't rebuild and refetch each one. Cleared when the league reloads — a
 * port of FCApp `PlayerCardCache.swift`.
 */
import type { PlayerCardModel } from '../player/PlayerCardModel'

export class PlayerCardCache {
  private readonly models = new Map<string, PlayerCardModel>()
  /** Most recent last. */
  private order: string[] = []

  constructor(readonly capacity = 12) {}

  get count(): number { return this.models.size }

  model(id: string, make: () => PlayerCardModel): PlayerCardModel {
    const cached = this.models.get(id)
    if (cached) {
      this.touch(id)
      return cached
    }
    const model = make()
    this.models.set(id, model)
    this.order.push(id)
    while (this.order.length > this.capacity) {
      this.models.delete(this.order.shift()!)
    }
    return model
  }

  removeAll(): void {
    this.models.clear()
    this.order = []
  }

  private touch(id: string): void {
    this.order = this.order.filter((x) => x !== id)
    this.order.push(id)
  }
}
