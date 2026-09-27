/**
 * The web counterpart of a SwiftUI `ObservableObject`: a screen model holds its
 * state in plain fields and calls `changed()` after mutating them (where the
 * Swift model had `@Published`). React subscribes through `useModel` in the UI
 * layer; tests just read the fields.
 */
export class Observable {
  private readonly listeners = new Set<() => void>()
  private version = 0

  /** Subscribe to changes; returns the unsubscribe function. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** A number that moves on every change — for `useSyncExternalStore`. */
  getVersion = (): number => this.version

  protected changed(): void {
    this.version++
    for (const l of [...this.listeners]) l()
  }
}

/** Swift's `LoadState`-style phases, shared by every screen model. */
export type LoadPhase<E = string> =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded' }
  | { kind: 'failed'; message: E }
