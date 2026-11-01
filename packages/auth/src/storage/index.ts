/**
 * @expo-foundation/auth - Secure Storage Adapter
 *
 * Wraps expo-secure-store (Keychain on iOS, EncryptedSharedPreferences + Keystore on Android).
 * Enforces security rules from Section 4.4:
 * - Never store user passwords, private API secrets, or provider client secrets.
 * - Never store oversized user profiles (> 2048 bytes).
 * - Only store minimal required credentials and session metadata.
 */

export interface SecureStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

export interface ExpoSecureStoreDriver {
  getItemAsync(key: string, options?: Record<string, unknown>): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: Record<string, unknown>): Promise<void>;
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
      `SecureStorage payload for "${key}" (${byteLength} bytes) exceeds 2048-byte limit. Do not store large user profiles in SecureStore.`
    );
  }
}

export class MemorySecureStorageAdapter implements SecureStorageAdapter {
  private readonly store = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    assertSafeForSecureStorage(key, value);
    this.store.set(key, value);
  }

  async deleteItem(key: string): Promise<void> {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export class ExpoSecureStoreAdapter implements SecureStorageAdapter {
  private readonly driver: ExpoSecureStoreDriver;
  private readonly options: Record<string, unknown>;

  constructor(driver: ExpoSecureStoreDriver, options?: Record<string, unknown>) {
    this.driver = driver;
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

  async deleteItem(key: string): Promise<void> {
    await this.driver.deleteItemAsync(key, this.options);
  }
}
