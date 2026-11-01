/**
 * @expo-foundation/auth - Runtime Auth Controller
 *
 * Implements Section 14.6, 14.7, 14.8, and Audit Findings 6, 12, 14, 15:
 * - Defaults to `ExpoSecureStoreAdapter` unless `storage` is explicitly configured as `'memory'`
 * - Deterministic lifecycle event emission (`emit` + `emitAsync`) with single-owner `flowRef`
 *   deduplication via `eventBus.claimFlowDispatch(envelope.id, flowRef)`
 * - Trusted authorization context (`AccessContext` with `issuedAt`): removes unverified local
 *   role mutation and provides `refreshAccessContextFromServer()`
 */

import {
  FoundationEventBus,
  hasMfaCapability,
  hasOtpCapability,
  InMemoryFlowRegistry,
  type AuthChallenge,
  type AuthLifecycleEventName,
  type AuthProviderAdapter,
  type AuthSession,
  type AuthUser,
  type EmailVerificationInput,
  type FlowRegistry,
  type MfaVerifyInput,
  type OtpRequest,
  type OtpVerification,
  type PasswordResetInput,
  type PasswordResetRequest,
  type SignInInput,
  type SignUpInput,
} from '@expo-foundation/contracts';
import type { AccessContext, AuthIR, AuthStatus } from '@expo-foundation/core';
import { AuthProviderRegistry } from '../providers/provider-registry.js';
import { SessionManager } from '../session-manager/index.js';
import { AuthStateMachine } from '../state-machine/index.js';
import {
  ExpoSecureStoreAdapter,
  InMemoryTokenStorage,
  type TokenStorageAdapter,
} from '../storage/index.js';

export interface AuthRuntimeSnapshot {
  status: AuthStatus;
  user: AuthUser | null;
  session: AuthSession | null;
  challenge: AuthChallenge | null;
  accessContext: AccessContext;
  lastError: string | null;
}

export class AuthController {
  private readonly ir: AuthIR;
  private readonly stateMachine: AuthStateMachine;
  private readonly sessionManager: SessionManager;
  private readonly adapter: AuthProviderAdapter;
  private readonly eventBus: FoundationEventBus;
  private readonly flowRegistry: FlowRegistry;

  private currentUser: AuthUser | null = null;
  private currentSession: AuthSession | null = null;
  private currentChallenge: AuthChallenge | null = null;
  private accessContextIssuedAt: number | undefined;
  private lastError: string | null = null;
  private readonly stateListeners = new Set<(snapshot: AuthRuntimeSnapshot) => void>();

  constructor(options: {
    authIR: AuthIR;
    adapter?: AuthProviderAdapter;
    storage?: TokenStorageAdapter;
    eventBus?: FoundationEventBus;
    flowRegistry?: FlowRegistry;
    providerRegistry?: AuthProviderRegistry;
    now?: () => number;
  }) {
    this.ir = options.authIR;
    this.stateMachine = new AuthStateMachine('unknown');
    this.eventBus = options.eventBus ?? new FoundationEventBus();
    this.flowRegistry = options.flowRegistry ?? new InMemoryFlowRegistry();

    const registry = options.providerRegistry ?? new AuthProviderRegistry();
    this.adapter = options.adapter ?? registry.create(this.ir.providerType);

    // Audit Finding 6: Default to ExpoSecureStoreAdapter unless 'memory' or custom storage is supplied
    const storage: TokenStorageAdapter =
      options.storage ??
      (this.ir.session.storage === 'memory'
        ? new InMemoryTokenStorage()
        : new ExpoSecureStoreAdapter());

    this.sessionManager = new SessionManager({
      storage,
      refreshEnabled: this.ir.session.refreshEnabled,
      refreshThresholdSeconds: this.ir.session.refreshThresholdSeconds,
      rotateRefreshTokens: this.ir.session.rotateRefreshTokens,
      now: options.now,
    });
  }

  async initialize(): Promise<AuthRuntimeSnapshot> {
    await this.adapter.initialize(this.ir.providerConfig);

    if (this.ir.session.restoreOnLaunch) {
      return this.restoreSession();
    } else {
      this.stateMachine.transition('RESTORE_START');
      this.stateMachine.transition('RESTORE_EMPTY');
      this.notifyStateChange();
      return this.getSnapshot();
    }
  }

  subscribe(listener: (snapshot: AuthRuntimeSnapshot) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  getSnapshot(): AuthRuntimeSnapshot {
    return {
      status: this.stateMachine.getStatus(),
      user: this.currentUser,
      session: this.currentSession,
      challenge: this.currentChallenge,
      accessContext: this.getAccessContext(),
      lastError: this.lastError,
    };
  }

  getAccessContext(): AccessContext {
    const isAuthenticated =
      this.stateMachine.getStatus() === 'authenticated' && this.currentUser !== null;

    if (!isAuthenticated || !this.currentUser) {
      return {
        authenticated: false,
        roles: [],
        permissions: [],
        verified: false,
      };
    }

    const verified =
      Boolean(this.currentUser.emailVerified) ||
      Boolean(this.currentUser.phoneVerified) ||
      !this.ir.requireEmailVerification;

    return {
      authenticated: true,
      userId: this.currentUser.id,
      roles:
        this.currentUser.roles && this.currentUser.roles.length > 0
          ? this.currentUser.roles
          : this.ir.defaultRoles,
      permissions: this.currentUser.permissions ?? [],
      verified,
      tenantId: this.currentUser.tenantId ?? this.currentSession?.tenantId,
      accountStatus: this.currentUser.accountStatus ?? 'active',
      issuedAt: this.accessContextIssuedAt ?? this.currentSession?.issuedAt,
    };
  }

  async restoreSession(): Promise<AuthRuntimeSnapshot> {
    this.stateMachine.transition('RESTORE_START');
    await this.emitAuthEvent('auth.session.restoring', {});
    this.notifyStateChange();

    const restored = await this.sessionManager.restoreSession(this.adapter);
    if (restored.status === 'restored' && restored.session) {
      this.currentSession = restored.session;
      this.currentUser = restored.session.user;
      this.accessContextIssuedAt = restored.session.issuedAt;
      this.currentChallenge = null;
      this.lastError = null;
      this.stateMachine.transition('RESTORE_SUCCESS');

      await this.emitAuthEvent('auth.session.restored', {
        userId: restored.session.user.id,
        sessionId: restored.session.sessionId,
      });
    } else if (restored.status === 'expired') {
      this.currentSession = null;
      this.currentUser = null;
      this.accessContextIssuedAt = undefined;
      this.stateMachine.transition('RESTORE_EMPTY');
      await this.emitAuthEvent('auth.session.expired', {
        reason: restored.reason ?? 'expired',
      });
    } else {
      this.currentSession = null;
      this.currentUser = null;
      this.accessContextIssuedAt = undefined;
      this.stateMachine.transition('RESTORE_EMPTY');
    }

    this.notifyStateChange();
    return this.getSnapshot();
  }

  async signIn(input: SignInInput): Promise<AuthRuntimeSnapshot> {
    this.stateMachine.transition('SIGN_IN_START');
    this.lastError = null;
    await this.emitAuthEvent('auth.login.started', {
      identifier: input.email ?? input.username ?? input.phone,
    });
    this.notifyStateChange();

    try {
      const result = await this.adapter.signIn(input);
      return await this.applyAuthResult(result, 'login');
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'Sign-in failed';
      this.stateMachine.transition('AUTH_ERROR');
      await this.emitAuthEvent('auth.login.failed', {
        message: this.lastError,
      });
      await this.emitAuthEvent('auth.error', {
        action: 'signIn',
        message: this.lastError,
      });
      this.notifyStateChange();
      throw err;
    }
  }

  async signUp(input: SignUpInput): Promise<AuthRuntimeSnapshot> {
    this.stateMachine.transition('SIGN_UP_START');
    this.lastError = null;
    await this.emitAuthEvent('auth.registration.started', {
      email: input.email,
    });
    this.notifyStateChange();

    try {
      const result = await this.adapter.signUp(input);
      return await this.applyAuthResult(result, 'registration');
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'Sign-up failed';
      this.stateMachine.transition('AUTH_ERROR');
      await this.emitAuthEvent('auth.error', {
        action: 'signUp',
        message: this.lastError,
      });
      this.notifyStateChange();
      throw err;
    }
  }

  async signOut(): Promise<AuthRuntimeSnapshot> {
    this.stateMachine.transition('SIGN_OUT_START');
    await this.emitAuthEvent('auth.logout.started', {
      userId: this.currentUser?.id,
    });
    this.notifyStateChange();

    const userId = this.currentUser?.id;
    try {
      await this.adapter.signOut();
    } finally {
      await this.sessionManager.clearPersistedSession();
      this.currentSession = null;
      this.currentUser = null;
      this.accessContextIssuedAt = undefined;
      this.currentChallenge = null;
      this.lastError = null;
      this.stateMachine.transition('SIGN_OUT_COMPLETE');
      await this.emitAuthEvent('auth.logout.success', {
        userId,
      });
      this.notifyStateChange();
    }

    return this.getSnapshot();
  }

  async refreshSession(): Promise<AuthRuntimeSnapshot> {
    if (!this.currentSession) {
      throw new Error('Cannot refresh session when no session is active.');
    }

    this.stateMachine.transition('REFRESH_START');
    this.notifyStateChange();

    try {
      const refreshed = await this.sessionManager.refreshSessionSingleFlight(
        this.adapter,
        this.currentSession
      );
      this.currentSession = refreshed;
      this.currentUser = refreshed.user;
      this.accessContextIssuedAt = refreshed.issuedAt;
      this.stateMachine.transition('REFRESH_SUCCESS');
      await this.emitAuthEvent('auth.session.refreshed', {
        userId: refreshed.user.id,
        sessionId: refreshed.sessionId,
      });
      this.notifyStateChange();
      return this.getSnapshot();
    } catch (err) {
      await this.sessionManager.clearPersistedSession();
      this.currentSession = null;
      this.currentUser = null;
      this.accessContextIssuedAt = undefined;
      this.stateMachine.transition('REFRESH_FAILED');
      await this.emitAuthEvent('auth.session.expired', {
        reason: err instanceof Error ? err.message : 'refresh_failed',
      });
      this.notifyStateChange();
      throw err;
    }
  }

  async verifyEmail(input: EmailVerificationInput): Promise<AuthRuntimeSnapshot> {
    await this.adapter.verifyEmail(input);
    if (this.currentUser) {
      this.currentUser = {
        ...this.currentUser,
        emailVerified: true,
        accountStatus: 'active',
      };
    }
    this.currentChallenge = null;
    this.accessContextIssuedAt = Date.now();
    if (this.currentSession && this.currentUser) {
      this.currentSession = {
        ...this.currentSession,
        user: this.currentUser,
      };
      await this.sessionManager.persistSession(this.currentSession);
    }

    this.stateMachine.transition('VERIFICATION_COMPLETE');
    await this.emitAuthEvent('auth.login.success', {
      userId: this.currentUser?.id,
      via: 'email_verification',
    });
    this.notifyStateChange();
    return this.getSnapshot();
  }

  async requestOtp(input: OtpRequest): Promise<{ challengeId: string }> {
    if (!hasOtpCapability(this.adapter)) {
      throw new Error(
        `Provider "${this.adapter.providerType}" does not support OTP capability.`
      );
    }
    return this.adapter.requestOtp(input);
  }

  async verifyOtp(input: OtpVerification): Promise<AuthRuntimeSnapshot> {
    if (!hasOtpCapability(this.adapter)) {
      throw new Error(
        `Provider "${this.adapter.providerType}" does not support OTP capability.`
      );
    }
    const result = await this.adapter.verifyOtp(input);
    return this.applyAuthResult(result, 'login');
  }

  async verifyMfa(input: MfaVerifyInput): Promise<AuthRuntimeSnapshot> {
    if (!hasMfaCapability(this.adapter)) {
      throw new Error(
        `Provider "${this.adapter.providerType}" does not support MFA capability.`
      );
    }
    const result = await this.adapter.verifyMfa(input);
    if (result.status === 'authenticated' && result.session) {
      this.currentSession = result.session;
      this.currentUser = result.session.user;
      this.accessContextIssuedAt = result.session.issuedAt;
      this.currentChallenge = null;
      await this.sessionManager.persistSession(result.session);
      this.stateMachine.transition('CHALLENGE_COMPLETE');
      await this.emitAuthEvent('auth.login.success', {
        userId: result.session.user.id,
        via: 'mfa',
      });
      this.notifyStateChange();
      return this.getSnapshot();
    }
    return this.applyAuthResult(result, 'login');
  }

  async requestPasswordReset(input: PasswordResetRequest): Promise<void> {
    await this.adapter.requestPasswordReset(input);
  }

  async resetPassword(input: PasswordResetInput): Promise<void> {
    await this.adapter.resetPassword(input);
  }

  /**
   * Refreshes the user's roles, permissions, and account status strictly from the
   * trusted authentication provider / backend server (Audit Finding 14 & Section 14.8).
   * Unverified client-side role mutation is prohibited.
   */
  async refreshAccessContextFromServer(): Promise<AuthRuntimeSnapshot> {
    if (!this.currentSession) {
      throw new Error('Cannot refresh access context when no session is active.');
    }

    const verifiedUser = await this.adapter.getCurrentUser();
    if (!verifiedUser) {
      throw new Error('Provider getCurrentUser() returned null during access context refresh.');
    }

    this.currentUser = verifiedUser;
    this.accessContextIssuedAt = Date.now();
    this.currentSession = {
      ...this.currentSession,
      user: verifiedUser,
    };
    await this.sessionManager.persistSession(this.currentSession);

    await this.emitAuthEvent('auth.access.changed', {
      userId: verifiedUser.id,
      roles: verifiedUser.roles ?? [],
      permissions: verifiedUser.permissions ?? [],
      issuedAt: this.accessContextIssuedAt,
    });
    this.notifyStateChange();
    return this.getSnapshot();
  }

  private async applyAuthResult(
    result: Awaited<ReturnType<AuthProviderAdapter['signIn']>>,
    sourceAction: 'login' | 'registration'
  ): Promise<AuthRuntimeSnapshot> {
    if (result.status === 'verification_required') {
      this.currentUser = result.user ?? null;
      this.currentChallenge = result.challenge ?? null;
      this.stateMachine.transition('VERIFICATION_REQUIRED');
      if (sourceAction === 'registration') {
        await this.emitAuthEvent('auth.registration.completed', {
          userId: result.user?.id,
          verificationRequired: true,
        });
      }
      await this.emitAuthEvent('auth.verification.required', {
        userId: result.user?.id,
        challenge: result.challenge,
      });
      this.notifyStateChange();
      return this.getSnapshot();
    }

    if (result.status === 'challenge_required') {
      this.currentUser = result.user ?? null;
      this.currentChallenge = result.challenge ?? null;
      this.stateMachine.transition('CHALLENGE_REQUIRED');
      await this.emitAuthEvent('auth.challenge.required', {
        userId: result.user?.id,
        challenge: result.challenge,
      });
      this.notifyStateChange();
      return this.getSnapshot();
    }

    if (result.status === 'account_suspended' || result.status === 'account_disabled') {
      this.currentUser = result.user ?? null;
      this.currentSession = null;
      this.stateMachine.transition('RECOVERY_REQUIRED');
      await this.emitAuthEvent('auth.account.suspended', {
        userId: result.user?.id,
        status: result.status,
      });
      this.notifyStateChange();
      return this.getSnapshot();
    }

    if (result.status === 'authenticated' && result.session) {
      if (
        this.ir.requireEmailVerification &&
        result.session.user.emailVerified === false
      ) {
        this.currentUser = result.session.user;
        this.currentSession = result.session;
        this.stateMachine.transition('VERIFICATION_REQUIRED');
        await this.emitAuthEvent('auth.verification.required', {
          userId: result.session.user.id,
        });
        this.notifyStateChange();
        return this.getSnapshot();
      }

      this.currentSession = result.session;
      this.currentUser = result.session.user;
      this.accessContextIssuedAt = result.session.issuedAt;
      this.currentChallenge = null;
      await this.sessionManager.persistSession(result.session);

      if (sourceAction === 'registration') {
        this.stateMachine.transition('SIGN_UP_SUCCESS');
        await this.emitAuthEvent('auth.registration.completed', {
          userId: result.session.user.id,
          verificationRequired: false,
        });
      } else {
        this.stateMachine.transition('SIGN_IN_SUCCESS');
      }

      await this.emitAuthEvent('auth.login.success', {
        userId: result.session.user.id,
        sessionId: result.session.sessionId,
      });
      this.notifyStateChange();
      return this.getSnapshot();
    }

    this.stateMachine.transition('RECOVERY_REQUIRED');
    this.notifyStateChange();
    return this.getSnapshot();
  }

  private async emitAuthEvent(
    eventName: AuthLifecycleEventName,
    payload: Record<string, unknown>
  ): Promise<void> {
    const flowMap: Record<string, string | undefined> = {
      'auth.login.success': this.ir.eventFlows.onLoginSuccess,
      'auth.logout.success': this.ir.eventFlows.onLogout,
      'auth.registration.completed': this.ir.eventFlows.onRegisterSuccess,
      'auth.session.expired': this.ir.eventFlows.onSessionExpired,
      'auth.verification.required': this.ir.eventFlows.onVerificationRequired,
      'auth.access.changed': this.ir.eventFlows.onAccessChanged,
    };

    const flowRef = flowMap[eventName];
    const envelope = await this.eventBus.emitAsync(eventName, payload, {
      source: 'auth',
      flowRef,
    });

    // Single-owner flow dispatch deduplication (Audit Finding 12)
    if (flowRef && this.eventBus.claimFlowDispatch(envelope.id, flowRef)) {
      await this.flowRegistry.dispatch(flowRef, eventName, payload, envelope.id);
    }
  }

  private notifyStateChange(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.stateListeners) {
      listener(snapshot);
    }
  }
}
