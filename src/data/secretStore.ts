/**
 * Where the relay access token lives — the web counterpart of FCData
 * `SecretStore`. The phone uses the Keychain; a browser has nothing equivalent,
 * so it's `localStorage` for this site only, never sent anywhere but the
 * relay the user configured. It is deliberately left out of export files.
 */
export interface SecretStore {
  load(): string | undefined
  save(value: string | undefined): void
}

export class LocalStorageSecretStore implements SecretStore {
  constructor(private readonly key = 'fcc.relay-token') {}

  load(): string | undefined {
    try {
      return localStorage.getItem(this.key) ?? undefined
    } catch {
      return undefined
    }
  }

  save(value: string | undefined): void {
    try {
      if (value) localStorage.setItem(this.key, value)
      else localStorage.removeItem(this.key)
    } catch {
      // Storage blocked (private mode): the token lasts for this visit only.
    }
  }
}

/** In-memory store for tests and previews. */
export class InMemorySecretStore implements SecretStore {
  constructor(private value?: string) {}
  load() { return this.value }
  save(value: string | undefined) { this.value = value || undefined }
}
