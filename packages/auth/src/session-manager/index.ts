/**
 * @expo-foundation/auth - Session Manager & Single-Flight Refresh Coordinator
 *
 * Implements Section 4.4 & Section 14.6:
 * - Persists minimal session envelope in SecureStorage
 * - Restores session on app launch and validates expiration
 * - Single-flight token refresh lock (`refreshSessionSingleFlight`) to prevent concurrent race conditions
 * - Refresh token rotation and logout revocation
 */

import type { AuthProviderAdapter, AuthSession } from '@expo-foundation/contracts';
import type { TokenStorageAdapter } from '../storage/index.js';

export const SESSION_STORAGE_KEY = 'expo_foundation.auth.session.v1';

export interface SessionRestoreResult {
  status: 'empty' | 'restored' | 'expired';
  session?: AuthSession;
  reason?: string;
}

export class SessionManager {
  private readonly storage: TokenStorageAdapter;
  private readonly refreshEnabled: boolean;
  private readonly refreshThresholdSeconds: number;
  private readonly rotateRefreshTokens: boolean;
  private readonly now: () => number;
  private inFlightRefreshPromise: Promise<AuthSession> | null = null;

  constructor(options: {
    storage: TokenStorageAdapter;
    refreshEnabled?: boolean;
    refreshThresholdSeconds?: number;
    rotateRefreshTokens?: boolean;
    now?: () => number;
  }) {
    this.storage = options.storage;
    this.refreshEnabled = options.refreshEnabled ?? true;
    this.refreshThresholdSeconds = options.refreshThresholdSeconds ?? 60;
    this.rotateRefreshTokens = options.rotateRefreshTokens ?? true;
    this.now = options.now ?? (() => Date.now());
  }

  async persistSession(session: AuthSession): Promise<void> {
    await this.storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  }

  async loadPersistedSession(): Promise<AuthSession | null> {
    const raw = await this.storage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as AuthSession;
      if (!parsed || !parsed.sessionId || !parsed.tokens?.accessToken || !parsed.user?.id) {
        await this.clearPersistedSession();
        return null;
      }
      return parsed;
    } catch {
      await this.clearPersistedSession();
      return null;
    }
  }

  async clearPersistedSession(): Promise<void> {
    await this.storage.removeItem(SESSION_STORAGE_KEY);
  }

  isExpiredOrNearExpiry(session: AuthSession): boolean {
    const currentMs = this.now();
    const thresholdMs = this.refreshThresholdSeconds * 1000;
    return session.expiresAt - currentMs <= thresholdMs;
  }

  async restoreSession(adapter: AuthProviderAdapter): Promise<SessionRestoreResult> {
    let session = await this.loadPersistedSession();
    if (!session) {
      session = await adapter.restoreSession();
    }
    if (!session) {
      return { status: 'empty' };
    }

    if (!this.isExpiredOrNearExpiry(session)) {
      await this.persistSession(session);
      return { status: 'restored', session };
    }

    if (!this.refreshEnabled || !session.tokens.refreshToken) {
      await this.clearPersistedSession();
      return { status: 'expired', reason: 'token_expired_and_refresh_unavailable' };
    }

    try {
      const refreshed = await this.refreshSessionSingleFlight(adapter, session);
      return { status: 'restored', session: refreshed };
    } catch (err) {
      await this.clearPersistedSession();
      return {
        status: 'expired',
        reason: err instanceof Error ? err.message : 'refresh_failed',
      };
    }
  }

  async refreshSessionSingleFlight(
    adapter: AuthProviderAdapter,
    currentSession: AuthSession
  ): Promise<AuthSession> {
    if (this.inFlightRefreshPromise) {
      return this.inFlightRefreshPromise;
    }

    this.inFlightRefreshPromise = (async () => {
      try {
        const refreshed = await adapter.refreshSession(
          currentSession.tokens.refreshToken
        );
        const finalSession: AuthSession = {
          ...refreshed,
          tokens: {
            ...refreshed.tokens,
            refreshToken: this.rotateRefreshTokens
              ? (refreshed.tokens.refreshToken ?? currentSession.tokens.refreshToken)
              : currentSession.tokens.refreshToken,
          },
        };
        await this.persistSession(finalSession);
        return finalSession;
      } finally {
        this.inFlightRefreshPromise = null;
      }
    })();

    return this.inFlightRefreshPromise;
  }
}
