import {
  FoundationEventBus,
  hasMfaCapability,
  hasOtpCapability,
  InMemoryFlowRegistry,
  type AuthProviderAdapter,
  type AuthResult,
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
import type { AccessContext, AuthIR } from '@expo-foundation/core';
import {
  AuthProviderRegistry,
  defaultAuthProviderRegistry,
} from '../providers/registry.js';
import { AuthSessionManager } from '../session-manager/index.js';
import { AuthStateMachine, type AuthMachineState } from '../state-machine/index.js';
import {
  MemorySecureStorageAdapter,
  type SecureStorageAdapter,
} from '../storage/index.js';
import { buildAccessContext } from './access-context.js';
import { normalizeAuthError } from './error-normalizer.js';

export interface AuthControllerOptions {
  authIR: AuthIR;
  storage?: SecureStorageAdapter;
  providerRegistry?: AuthProviderRegistry;
  adapter?: AuthProviderAdapter;
  eventBus?: FoundationEventBus;
  flowRegistry?: FlowRegistry;
}

export class AuthController {
  readonly authIR: AuthIR;
  readonly stateMachine: AuthStateMachine;
  readonly sessionManager: AuthSessionManager;
  readonly eventBus: FoundationEventBus;
  readonly flowRegistry: FlowRegistry;
  readonly adapter: AuthProviderAdapter;
  private readonly providerRegistry: AuthProviderRegistry;

  constructor(options: AuthControllerOptions) {
    this.authIR = options.authIR;
    this.stateMachine = new AuthStateMachine('unknown');
    this.sessionManager = new AuthSessionManager({
      storage: options.storage ?? new MemorySecureStorageAdapter(),
      refreshEnabled: options.authIR.sessionPolicy.refreshEnabled,
      refreshThresholdSeconds: options.authIR.sessionPolicy.refreshThresholdSeconds,
      rotateRefreshTokens: options.authIR.sessionPolicy.rotateRefreshTokens,
      revokeOnLogout: options.authIR.sessionPolicy.revokeOnLogout,
    });
    this.eventBus = options.eventBus ?? new FoundationEventBus();
    this.flowRegistry = options.flowRegistry ?? new InMemoryFlowRegistry();
    this.providerRegistry = options.providerRegistry ?? defaultAuthProviderRegistry;
    this.adapter =
      options.adapter ??
      this.providerRegistry.create(options.authIR.primaryProvider.type);
  }

  private findFlowRef(eventName: string): string | undefined {
    const match = this.authIR.events.find(
      (e) =>
        e.emittedEvent === eventName ||
        e.trigger === eventName ||
        `auth.${e.trigger}` === eventName
    );
    return match?.flowRef;
  }

  private async emitAuthEvent(
    eventName: string,
    payload: Record<string, unknown> = {}
  ): Promise<void> {
    const flowRef = this.findFlowRef(eventName);
    this.eventBus.emit(eventName, payload, {
      source: 'auth',
      flowRef,
    });
    if (flowRef) {
      await this.flowRegistry.dispatch(flowRef, eventName, payload);
    }
  }

  async initialize(): Promise<AuthMachineState> {
    await this.adapter.initialize(this.authIR.primaryProvider.config);
    if (this.authIR.sessionPolicy.restoreOnLaunch) {
      return this.restoreSession();
    }
    this.stateMachine.transition({ type: 'SKIP_RESTORE' });
    return this.stateMachine.getState();
  }

  async restoreSession(now = Date.now()): Promise<AuthMachineState> {
    this.stateMachine.transition({
      type: 'RESTORE_START',
      provider: this.adapter.providerType,
    });
    await this.emitAuthEvent('auth.session.restoring', {});

    try {
      const outcome = await this.sessionManager.restoreOrRefreshSession(this.adapter, now);
      if (
        (outcome.status === 'restored' || outcome.status === 'refreshed') &&
        outcome.session
      ) {
        this.stateMachine.transition({
          type: 'RESTORE_SUCCESS',
          session: outcome.session,
        });
        await this.emitAuthEvent('auth.session.restored', {
          userId: outcome.session.user.id,
          roles: outcome.session.user.roles ?? [],
        });
      } else if (outcome.status === 'expired') {
        this.stateMachine.transition({ type: 'RESTORE_EMPTY' });
        await this.emitAuthEvent('auth.session.expired', {});
      } else {
        this.stateMachine.transition({ type: 'RESTORE_EMPTY' });
      }
    } catch (err) {
      const normalized = normalizeAuthError(err);
      this.stateMachine.transition({ type: 'RESTORE_ERROR', error: normalized });
      await this.emitAuthEvent('auth.session.expired', { error: normalized.code });
    }

    return this.stateMachine.getState();
  }

  private async handleAuthResult(
    result: AuthResult,
    sourceOperation: 'login' | 'register' | 'verify' | 'challenge'
  ): Promise<AuthMachineState> {
    if (result.status === 'account_suspended') {
      this.stateMachine.transition({
        type: 'ACCOUNT_SUSPENDED',
        error: {
          code: 'ACCOUNT_SUSPENDED',
          message: 'Account has been suspended.',
          recoverable: false,
          timestamp: Date.now(),
        },
      });
      await this.emitAuthEvent('auth.account.suspended', {
        userId: result.user?.id,
      });
      return this.stateMachine.getState();
    }

    if (result.status === 'verification_required') {
      this.stateMachine.transition({
        type: 'VERIFICATION_REQUIRED',
        user: result.user,
        challenge: result.challenge,
      });
      await this.emitAuthEvent('auth.verification.required', {
        userId: result.user?.id,
        screenRef: this.authIR.screenRefs.verification,
      });
      return this.stateMachine.getState();
    }

    if (result.status === 'challenge_required' && result.challenge) {
      this.stateMachine.transition({
        type: 'CHALLENGE_REQUIRED',
        user: result.user,
        challenge: result.challenge,
      });
      return this.stateMachine.getState();
    }

    if (result.status === 'recovery_required') {
      this.stateMachine.transition({
        type: 'RECOVERY_REQUIRED',
        user: result.user,
        challenge: result.challenge,
      });
      return this.stateMachine.getState();
    }

    if (result.status === 'authenticated' && result.session) {
      await this.sessionManager.persistSession(result.session);
      const eventType =
        sourceOperation === 'verify'
          ? 'VERIFY_SUCCESS'
          : sourceOperation === 'challenge'
            ? 'CHALLENGE_SUCCESS'
            : 'AUTH_SUCCESS';

      this.stateMachine.transition({
        type: eventType,
        session: result.session,
      });

      if (sourceOperation === 'register') {
        await this.emitAuthEvent('auth.registration.completed', {
          userId: result.session.user.id,
        });
      } else {
        await this.emitAuthEvent('auth.login.success', {
          userId: result.session.user.id,
          roles: result.session.user.roles ?? [],
        });
      }
      return this.stateMachine.getState();
    }

    throw new Error('Unhandled AuthResult state.');
  }

  async signIn(input: SignInInput): Promise<AuthMachineState> {
    this.stateMachine.transition({
      type: 'SIGN_IN_START',
      provider: this.adapter.providerType,
    });
    try {
      const result = await this.adapter.signIn(input);
      return await this.handleAuthResult(result, 'login');
    } catch (err) {
      const normalized = normalizeAuthError(err);
      this.stateMachine.transition({ type: 'AUTH_ERROR', error: normalized });
      await this.emitAuthEvent('auth.error', { error: normalized });
      throw err;
    }
  }

  async signUp(input: SignUpInput): Promise<AuthMachineState> {
    if (!this.authIR.authMethods.registration) {
      throw new Error('Registration method is disabled in Auth configuration.');
    }
    this.stateMachine.transition({
      type: 'SIGN_UP_START',
      provider: this.adapter.providerType,
    });
    try {
      const result = await this.adapter.signUp(input);
      if (
        this.authIR.authMethods.emailVerification &&
        result.status === 'authenticated' &&
        result.user?.emailVerified === false
      ) {
        return await this.handleAuthResult(
          {
            status: 'verification_required',
            user: result.user,
          },
          'register'
        );
      }
      return await this.handleAuthResult(result, 'register');
    } catch (err) {
      const normalized = normalizeAuthError(err);
      this.stateMachine.transition({ type: 'AUTH_ERROR', error: normalized });
      await this.emitAuthEvent('auth.error', { error: normalized });
      throw err;
    }
  }

  async signOut(): Promise<AuthMachineState> {
    if (this.stateMachine.canTransition('SIGN_OUT_START')) {
      this.stateMachine.transition({ type: 'SIGN_OUT_START' });
    }
    await this.sessionManager.clearAndRevoke(this.adapter);
    if (this.stateMachine.canTransition('SIGN_OUT_COMPLETE')) {
      this.stateMachine.transition({ type: 'SIGN_OUT_COMPLETE' });
    } else if (this.stateMachine.canTransition('RESET_TO_ANONYMOUS')) {
      this.stateMachine.transition({ type: 'RESET_TO_ANONYMOUS' });
    }
    await this.emitAuthEvent('auth.logout.success', {});
    return this.stateMachine.getState();
  }

  async refreshSession(): Promise<AuthMachineState> {
    if (this.stateMachine.canTransition('REFRESH_START')) {
      this.stateMachine.transition({ type: 'REFRESH_START' });
    }
    try {
      const session = await this.sessionManager.refreshSession(this.adapter);
      this.stateMachine.transition({ type: 'REFRESH_SUCCESS', session });
      await this.emitAuthEvent('auth.access.changed', {
        userId: session.user.id,
        roles: session.user.roles ?? [],
      });
      return this.stateMachine.getState();
    } catch (err) {
      const normalized = normalizeAuthError(err);
      await this.sessionManager.tokenManager.clearTokens();
      this.stateMachine.transition({ type: 'REFRESH_FAILURE', error: normalized });
      await this.emitAuthEvent('auth.session.expired', { reason: normalized.code });
      return this.stateMachine.getState();
    }
  }

  async verifyEmail(input: EmailVerificationInput): Promise<AuthMachineState> {
    try {
      await this.adapter.verifyEmail(input);
      if (this.stateMachine.canTransition('VERIFY_COMPLETE_TO_LOGIN')) {
        this.stateMachine.transition({ type: 'VERIFY_COMPLETE_TO_LOGIN' });
      }
      await this.emitAuthEvent('auth.registration.completed', { verified: true });
      return this.stateMachine.getState();
    } catch (err) {
      const normalized = normalizeAuthError(err);
      if (this.stateMachine.canTransition('VERIFY_ERROR')) {
        this.stateMachine.transition({ type: 'VERIFY_ERROR', error: normalized });
      }
      throw err;
    }
  }

  async requestPasswordReset(input: PasswordResetRequest): Promise<void> {
    await this.adapter.requestPasswordReset(input);
  }

  async resetPassword(input: PasswordResetInput): Promise<void> {
    await this.adapter.resetPassword(input);
    if (this.stateMachine.canTransition('RECOVERY_SUCCESS')) {
      this.stateMachine.transition({ type: 'RECOVERY_SUCCESS' });
    }
  }

  async requestOtp(input: OtpRequest): Promise<{ challengeId: string }> {
    if (!hasOtpCapability(this.adapter)) {
      throw new Error(`Active provider "${this.adapter.providerType}" does not implement OtpCapability.`);
    }
    return this.adapter.requestOtp(input);
  }

  async verifyOtp(input: OtpVerification): Promise<AuthMachineState> {
    if (!hasOtpCapability(this.adapter)) {
      throw new Error(`Active provider "${this.adapter.providerType}" does not implement OtpCapability.`);
    }
    if (this.stateMachine.canTransition('SIGN_IN_START')) {
      this.stateMachine.transition({
        type: 'SIGN_IN_START',
        provider: this.adapter.providerType,
      });
    }
    const result = await this.adapter.verifyOtp(input);
    return this.handleAuthResult(result, 'login');
  }

  async verifyMfa(input: MfaVerifyInput): Promise<AuthMachineState> {
    if (!hasMfaCapability(this.adapter)) {
      throw new Error(`Active provider "${this.adapter.providerType}" does not implement MfaCapability.`);
    }
    try {
      const result = await this.adapter.verifyMfa(input);
      return await this.handleAuthResult(result, 'challenge');
    } catch (err) {
      const normalized = normalizeAuthError(err);
      if (this.stateMachine.canTransition('CHALLENGE_ERROR')) {
        this.stateMachine.transition({ type: 'CHALLENGE_ERROR', error: normalized });
      }
      throw err;
    }
  }

  async updateAccessRolesAndPermissions(
    roles: string[],
    permissions: string[] = []
  ): Promise<AccessContext> {
    const current = this.stateMachine.getState();
    if (current.status === 'authenticated' && current.user) {
      const stored = await this.sessionManager.tokenManager.loadSession();
      if (stored) {
        stored.user = {
          ...stored.user,
          roles,
          permissions,
        };
        await this.sessionManager.persistSession(stored);
        if (this.stateMachine.canTransition('REFRESH_START')) {
          this.stateMachine.transition({ type: 'REFRESH_START' });
          this.stateMachine.transition({ type: 'REFRESH_SUCCESS', session: stored });
        }
      }
    }
    await this.emitAuthEvent('auth.access.changed', { roles, permissions });
    return this.getAccessContext();
  }

  async suspendAccount(reason = 'Account suspended by administrator'): Promise<AuthMachineState> {
    await this.sessionManager.tokenManager.clearTokens();
    if (this.stateMachine.canTransition('ACCOUNT_SUSPENDED')) {
      this.stateMachine.transition({
        type: 'ACCOUNT_SUSPENDED',
        error: {
          code: 'ACCOUNT_SUSPENDED',
          message: reason,
          recoverable: false,
          timestamp: Date.now(),
        },
      });
    }
    await this.emitAuthEvent('auth.account.suspended', { reason });
    return this.stateMachine.getState();
  }

  getState(): AuthMachineState {
    return this.stateMachine.getState();
  }

  getAccessContext(): AccessContext {
    return buildAccessContext(
      this.stateMachine.getState(),
      this.authIR.accessContext.defaultRoles
    );
  }

  subscribe(listener: (state: AuthMachineState) => void): () => void {
    return this.stateMachine.subscribe(listener);
  }
}
