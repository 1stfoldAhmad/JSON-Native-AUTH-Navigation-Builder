/**
 * @expo-foundation/auth - Secure Token Storage
 *
 * Implements Section 4.4 & Section 14.6:
 * - ExpoSecureStoreAdapter wrapping `expo-secure-store` (Keychain on iOS, Keystore on Android)
 * - InMemoryTokenStorage for unit tests and non-persistent previews
 * - Security guardrails preventing storage of raw passwords, clientSecrets, or oversized payloads
 */

export interface TokenStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface ExpoSecureStoreNativeDriver {
  getItemAsync(key: string, options?: Record<string, unknown>): Promise<string | null>;
  setItemAsync(
    key: string,
    value: string,
    options?: Record<string, unknown>
  ): Promise<void>;
  deleteItemAsync(key: string, options?: Record<string, unknown>): Promise<void>;
}

const FORBIDDEN_STORAGE_PATTERNS = [
  /"password"\s*:/i,
  /"clientSecret"\s*:/i,
  /"client_secret"\s*:/i,
  /"privateKey"\s*:/i,
  /"private_key"\s*:/i,
];

export const MAX_SECURE_STORE_BYTES = 2048;

export function assertSafeForSecureStorage(key: string, value: string): void {
  if (/password|secret|private_key/i.test(key)) {
    throw new Error(
      `Security violation: refusing to store forbidden key "${key}" in SecureStorage.`
    );
  }
  for (const pattern of FORBIDDEN_STORAGE_PATTERNS) {
    if (pattern.test(value)) {
      throw new Error(
        `Security violation: refusing to persist raw password or client secret in SecureStorage under "${key}".`
      );
    }
  }
  const byteLength = new TextEncoder().encode(value).byteLength;
  if (byteLength > MAX_SECURE_STORE_BYTES) {
    throw new Error(
      `SecureStorage payload for "${key}" (${byteLength} bytes) exceeds 2048-byte limit.`
    );
  }
}

export class InMemoryTokenStorage implements TokenStorageAdapter {
  private readonly store = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    assertSafeForSecureStorage(key, value);
    this.store.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export class ExpoSecureStoreAdapter implements TokenStorageAdapter {
  private readonly driver: ExpoSecureStoreNativeDriver;
  private readonly options: Record<string, unknown>;

  constructor(
    driver?: ExpoSecureStoreNativeDriver,
    options?: Record<string, unknown>
  ) {
    const fallbackStore = new Map<string, string>();
    this.driver = driver ?? {
      getItemAsync: async (k) => fallbackStore.get(k) ?? null,
      setItemAsync: async (k, v) => {
        fallbackStore.set(k, v);
      },
      deleteItemAsync: async (k) => {
        fallbackStore.delete(k);
      },
    };
    this.options = {
      keychainAccessible: 2, // WHEN_UNLOCKED_THIS_DEVICE_ONLY
      ...options,
    };
  }

  async getItem(key: string): Promise<string | null> {
    return this.driver.getItemAsync(key, this.options);
  }

  async setItem(key: string, value: string): Promise<void> {
    assertSafeForSecureStorage(key, value);
    await this.driver.setItemAsync(key, value, this.options);
  }

  async removeItem(key: string): Promise<void> {
    await this.driver.deleteItemAsync(key, this.options);
  }
}
