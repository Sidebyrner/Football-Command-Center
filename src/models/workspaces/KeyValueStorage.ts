/**
 * A tiny string key-value store: `localStorage` in the browser, a map in
 * tests. Every `localStorage` access is guarded — private mode or a full quota
 * must never throw into a model.
 */
export interface KeyValueStorage {
  getItem(key: string): string | undefined
  /** False when the write didn't happen (storage blocked or full). */
  setItem(key: string, value: string): boolean
  removeItem(key: string): void
}

export class LocalKeyValueStorage implements KeyValueStorage {
  getItem(key: string): string | undefined {
    try {
      return globalThis.localStorage?.getItem(key) ?? undefined
    } catch {
      return undefined
    }
  }

  setItem(key: string, value: string): boolean {
    try {
      if (!globalThis.localStorage) return false
      globalThis.localStorage.setItem(key, value)
      return true
    } catch {
      return false
    }
  }

  removeItem(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key)
    } catch {
      // Storage blocked: nothing to remove.
    }
  }
}

export class InMemoryKeyValueStorage implements KeyValueStorage {
  private readonly items = new Map<string, string>()

  getItem(key: string): string | undefined {
    return this.items.get(key)
  }

  setItem(key: string, value: string): boolean {
    this.items.set(key, value)
    return true
  }

  removeItem(key: string): void {
    this.items.delete(key)
  }
}
