import type {
  AuthProviderAdapter,
  AuthProviderType,
  AuthSession,
  AuthTokens,
  AuthUser,
} from '@expo-foundation/contracts';
import type { SecureStorageAdapter } from '../storage/index.js';

export interface PersistedSessionEnvelope {
  sessionId: string;
  provider: AuthProviderType;
  issuedAt: number;
  expiresAt: number;
  tenantId?: string;
  userSummary: {
    id: string;
    email?: string;
    roles?: string[];
    permissions?: string[];
    emailVerified?: boolean;
    phoneVerified?: boolean;
    accountStatus?: string;
    tenantId?: string;
  };
}

export class TokenManager {
  private readonly storage: SecureStorageAdapter;
  private readonly keyPrefix: string;

  constructor(storage: SecureStorageAdapter, keyPrefix = 'expo_foundation_auth') {
    this.storage = storage;
    this.keyPrefix = keyPrefix;
  }

  private accessKey(): string {
    return `${this.keyPrefix}.access_token`;
  }

  private refreshKey(): string {
    return `${this.keyPrefix}.refresh_token`;
  }

  private sessionMetaKey(): string {
    return `${this.keyPrefix}.session_meta`;
  }

  async saveSession(session: AuthSession, rotateRefreshToken = true): Promise<void> {
    await this.storage.setItem(this.accessKey(), session.tokens.accessToken);
    if (session.tokens.refreshToken) {
      if (rotateRefreshToken) {
        await this.storage.setItem(this.refreshKey(), session.tokens.refreshToken);
      } else {
        const existingRefresh = await this.storage.getItem(this.refreshKey());
        if (!existingRefresh) {
          await this.storage.setItem(this.refreshKey(), session.tokens.refreshToken);
        }
      }
    }

    const envelope: PersistedSessionEnvelope = {
      sessionId: session.sessionId,
      provider: session.provider,
      issuedAt: session.issuedAt,
      expiresAt: session.expiresAt,
      tenantId: session.tenantId ?? session.user.tenantId,
      userSummary: {
        id: session.user.id,
        email: session.user.email,
        roles: session.user.roles,
        permissions: session.user.permissions,
        emailVerified: session.user.emailVerified,
        phoneVerified: session.user.phoneVerified,
        accountStatus: session.user.accountStatus,
        tenantId: session.user.tenantId,
      },
    };
    await this.storage.setItem(this.sessionMetaKey(), JSON.stringify(envelope));
  }

  async loadSession(): Promise<AuthSession | null> {
    const [accessToken, refreshToken, rawMeta] = await Promise.all([
      this.storage.getItem(this.accessKey()),
      this.storage.getItem(this.refreshKey()),
      this.storage.getItem(this.sessionMetaKey()),
    ]);

    if (!accessToken || !rawMeta) {
      return null;
    }

    try {
      const parsed = JSON.parse(rawMeta) as PersistedSessionEnvelope;
      const tokens: AuthTokens = {
        accessToken,
        refreshToken: refreshToken ?? undefined,
        expiresAt: parsed.expiresAt,
      };
      const user: AuthUser = {
        id: parsed.userSummary.id,
        email: parsed.userSummary.email,
        roles: parsed.userSummary.roles ?? [],
        permissions: parsed.userSummary.permissions ?? [],
        emailVerified: parsed.userSummary.emailVerified,
        phoneVerified: parsed.userSummary.phoneVerified,
        accountStatus: parsed.userSummary.accountStatus,
        tenantId: parsed.userSummary.tenantId,
      };
      return {
        sessionId: parsed.sessionId,
        user,
        tokens,
        provider: parsed.provider,
        issuedAt: parsed.issuedAt,
        expiresAt: parsed.expiresAt,
        tenantId: parsed.tenantId,
      };
    } catch {
      await this.clearTokens();
      return null;
    }
  }

  async getRefreshToken(): Promise<string | null> {
    return this.storage.getItem(this.refreshKey());
  }

  async clearTokens(): Promise<void> {
    await Promise.all([
      this.storage.deleteItem(this.accessKey()),
      this.storage.deleteItem(this.refreshKey()),
      this.storage.deleteItem(this.sessionMetaKey()),
    ]);
  }
}

export class SessionValidator {
  private readonly thresholdMs: number;

  constructor(thresholdSeconds = 60) {
    this.thresholdMs = thresholdSeconds * 1000;
  }

  isExpired(session: AuthSession, now = Date.now()): boolean {
    return now >= session.expiresAt;
  }

  needsRefresh(session: AuthSession, now = Date.now()): boolean {
    return now + this.thresholdMs >= session.expiresAt;
  }
}

/**
 * RefreshCoordinator prevents duplicate simultaneous refresh operations (single-flight lock).
 */
export class RefreshCoordinator {
  private inflightPromise: Promise<AuthSession> | null = null;
  private refreshCount = 0;

  async executeRefresh(operation: () => Promise<AuthSession>): Promise<AuthSession> {
    if (this.inflightPromise) {
      return this.inflightPromise;
    }
    this.refreshCount += 1;
    this.inflightPromise = operation().finally(() => {
      this.inflightPromise = null;
    });
    return this.inflightPromise;
  }

  isRefreshing(): boolean {
    return this.inflightPromise !== null;
  }

  getRefreshExecutionCount(): number {
    return this.refreshCount;
  }
}

export class LogoutCoordinator {
  private readonly tokenManager: TokenManager;

  constructor(tokenManager: TokenManager) {
    this.tokenManager = tokenManager;
  }

  async executeLogout(
    adapter: AuthProviderAdapter,
    revokeOnServer = true
  ): Promise<void> {
    try {
      if (revokeOnServer) {
        await adapter.signOut();
      }
    } finally {
      await this.tokenManager.clearTokens();
    }
  }
}

export interface SessionManagerOptions {
  storage: SecureStorageAdapter;
  refreshEnabled: boolean;
  refreshThresholdSeconds?: number;
  rotateRefreshTokens?: boolean;
  revokeOnLogout?: boolean;
}

export class AuthSessionManager {
  readonly tokenManager: TokenManager;
  readonly validator: SessionValidator;
  readonly refreshCoordinator: RefreshCoordinator;
  readonly logoutCoordinator: LogoutCoordinator;
  private readonly options: Required<Omit<SessionManagerOptions, 'storage'>>;

  constructor(options: SessionManagerOptions) {
    this.tokenManager = new TokenManager(options.storage);
    this.validator = new SessionValidator(options.refreshThresholdSeconds ?? 60);
    this.refreshCoordinator = new RefreshCoordinator();
    this.logoutCoordinator = new LogoutCoordinator(this.tokenManager);
    this.options = {
      refreshEnabled: options.refreshEnabled,
      refreshThresholdSeconds: options.refreshThresholdSeconds ?? 60,
      rotateRefreshTokens: options.rotateRefreshTokens ?? true,
      revokeOnLogout: options.revokeOnLogout ?? true,
    };
  }

  async persistSession(session: AuthSession): Promise<void> {
    await this.tokenManager.saveSession(session, this.options.rotateRefreshTokens);
  }

  async restoreOrRefreshSession(
    adapter: AuthProviderAdapter,
    now = Date.now()
  ): Promise<{
    status: 'restored' | 'refreshed' | 'empty' | 'expired';
    session: AuthSession | null;
  }> {
    const stored = await this.tokenManager.loadSession();
    if (!stored) {
      const providerRestored = await adapter.restoreSession();
      if (!providerRestored) {
        return { status: 'empty', session: null };
      }
      await this.persistSession(providerRestored);
      return { status: 'restored', session: providerRestored };
    }

    if (!this.validator.isExpired(stored, now) && !this.validator.needsRefresh(stored, now)) {
      return { status: 'restored', session: stored };
    }

    if (!this.options.refreshEnabled || !stored.tokens.refreshToken) {
      if (this.validator.isExpired(stored, now)) {
        await this.tokenManager.clearTokens();
        return { status: 'expired', session: null };
      }
      return { status: 'restored', session: stored };
    }

    try {
      const refreshed = await this.refreshSession(adapter, stored.tokens.refreshToken);
      return { status: 'refreshed', session: refreshed };
    } catch {
      await this.tokenManager.clearTokens();
      return { status: 'expired', session: null };
    }
  }

  async refreshSession(
    adapter: AuthProviderAdapter,
    explicitRefreshToken?: string
  ): Promise<AuthSession> {
    return this.refreshCoordinator.executeRefresh(async () => {
      const refreshToken =
        explicitRefreshToken ?? (await this.tokenManager.getRefreshToken()) ?? undefined;
      const newSession = await adapter.refreshSession(refreshToken);
      await this.persistSession(newSession);
      return newSession;
    });
  }

  async clearAndRevoke(adapter: AuthProviderAdapter): Promise<void> {
    await this.logoutCoordinator.executeLogout(adapter, this.options.revokeOnLogout);
  }
}
