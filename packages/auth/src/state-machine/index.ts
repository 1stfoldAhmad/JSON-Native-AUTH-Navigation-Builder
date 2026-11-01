import type {
  AuthChallenge,
  AuthProviderType,
  AuthSession,
  AuthUser,
} from '@expo-foundation/contracts';
import type { AuthStatus } from '@expo-foundation/core';

export interface SafeSessionMetadata {
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
  tenantId?: string;
  hasRefreshToken: boolean;
}

export interface AuthErrorInfo {
  code: string;
  message: string;
  recoverable: boolean;
  timestamp: number;
}

export interface AuthMachineState {
  status: AuthStatus;
  user: AuthUser | null;
  sessionMetadata: SafeSessionMetadata | null;
  activeProvider: AuthProviderType | null;
  expiresAt: number | null;
  pendingChallenge: AuthChallenge | null;
  lastError: AuthErrorInfo | null;
  requiredVerificationSteps: string[];
}

export type AuthMachineEvent =
  | { type: 'RESTORE_START'; provider?: AuthProviderType }
  | { type: 'SKIP_RESTORE' }
  | { type: 'RESTORE_SUCCESS'; session: AuthSession }
  | { type: 'RESTORE_EMPTY' }
  | { type: 'RESTORE_EXPIRED'; provider?: AuthProviderType }
  | { type: 'RESTORE_ERROR'; error: AuthErrorInfo }
  | { type: 'SIGN_IN_START'; provider: AuthProviderType }
  | { type: 'SIGN_UP_START'; provider: AuthProviderType }
  | { type: 'AUTH_SUCCESS'; session: AuthSession }
  | { type: 'VERIFICATION_REQUIRED'; user?: AuthUser; challenge?: AuthChallenge; steps?: string[] }
  | { type: 'CHALLENGE_REQUIRED'; challenge: AuthChallenge; user?: AuthUser }
  | { type: 'RECOVERY_REQUIRED'; challenge?: AuthChallenge; user?: AuthUser }
  | { type: 'AUTH_ERROR'; error: AuthErrorInfo }
  | { type: 'VERIFY_SUCCESS'; session: AuthSession }
  | { type: 'VERIFY_COMPLETE_TO_LOGIN' }
  | { type: 'VERIFY_ERROR'; error: AuthErrorInfo }
  | { type: 'CHALLENGE_SUCCESS'; session: AuthSession }
  | { type: 'CHALLENGE_ERROR'; error: AuthErrorInfo }
  | { type: 'RECOVERY_SUCCESS' }
  | { type: 'RECOVERY_AUTHENTICATED'; session: AuthSession }
  | { type: 'REFRESH_START' }
  | { type: 'REFRESH_SUCCESS'; session: AuthSession }
  | { type: 'REFRESH_FAILURE'; error?: AuthErrorInfo }
  | { type: 'SIGN_OUT_START' }
  | { type: 'SIGN_OUT_COMPLETE' }
  | { type: 'SESSION_EXPIRED' }
  | { type: 'ACCOUNT_SUSPENDED'; error?: AuthErrorInfo }
  | { type: 'RESET_TO_ANONYMOUS' };

export interface AuthTransitionRecord {
  from: AuthStatus;
  event: AuthMachineEvent['type'];
  to: AuthStatus;
  timestamp: number;
}

const ALLOWED_TRANSITIONS: Record<AuthStatus, ReadonlySet<AuthMachineEvent['type']>> = {
  unknown: new Set(['RESTORE_START', 'SKIP_RESTORE', 'SIGN_IN_START', 'SIGN_UP_START']),
  restoring: new Set([
    'RESTORE_SUCCESS',
    'RESTORE_EMPTY',
    'RESTORE_EXPIRED',
    'RESTORE_ERROR',
  ]),
  anonymous: new Set([
    'SIGN_IN_START',
    'SIGN_UP_START',
    'RESTORE_START',
    'RECOVERY_REQUIRED',
  ]),
  authenticating: new Set([
    'AUTH_SUCCESS',
    'VERIFICATION_REQUIRED',
    'CHALLENGE_REQUIRED',
    'RECOVERY_REQUIRED',
    'AUTH_ERROR',
    'ACCOUNT_SUSPENDED',
  ]),
  authenticated: new Set([
    'REFRESH_START',
    'RESTORE_START',
    'SIGN_IN_START',
    'SIGN_OUT_START',
    'SESSION_EXPIRED',
    'ACCOUNT_SUSPENDED',
    'VERIFICATION_REQUIRED',
    'CHALLENGE_REQUIRED',
  ]),
  refreshing: new Set(['REFRESH_SUCCESS', 'REFRESH_FAILURE', 'SIGN_OUT_START']),
  verifying: new Set([
    'VERIFY_SUCCESS',
    'VERIFY_COMPLETE_TO_LOGIN',
    'VERIFY_ERROR',
    'SIGN_OUT_START',
    'RESET_TO_ANONYMOUS',
  ]),
  challenge_required: new Set([
    'CHALLENGE_SUCCESS',
    'CHALLENGE_ERROR',
    'SIGN_OUT_START',
    'RESET_TO_ANONYMOUS',
  ]),
  signing_out: new Set(['SIGN_OUT_COMPLETE']),
  recovery_required: new Set([
    'RECOVERY_SUCCESS',
    'RECOVERY_AUTHENTICATED',
    'AUTH_ERROR',
    'RESET_TO_ANONYMOUS',
  ]),
  error: new Set([
    'RESET_TO_ANONYMOUS',
    'SIGN_IN_START',
    'SIGN_UP_START',
    'RESTORE_START',
    'SIGN_OUT_START',
  ]),
};

function toSafeSessionMetadata(session: AuthSession): SafeSessionMetadata {
  return {
    sessionId: session.sessionId,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
    tenantId: session.tenantId ?? session.user.tenantId,
    hasRefreshToken: Boolean(session.tokens.refreshToken),
  };
}

export class AuthStateMachine {
  private state: AuthMachineState;
  private readonly listeners = new Set<(state: AuthMachineState) => void>();
  private readonly history: AuthTransitionRecord[] = [];

  constructor(initialStatus: AuthStatus = 'unknown') {
    this.state = {
      status: initialStatus,
      user: null,
      sessionMetadata: null,
      activeProvider: null,
      expiresAt: null,
      pendingChallenge: null,
      lastError: null,
      requiredVerificationSteps: [],
    };
  }

  getState(): AuthMachineState {
    return structuredClone(this.state);
  }

  getTransitionHistory(): readonly AuthTransitionRecord[] {
    return this.history;
  }

  canTransition(eventType: AuthMachineEvent['type']): boolean {
    const allowed = ALLOWED_TRANSITIONS[this.state.status];
    return Boolean(allowed?.has(eventType));
  }

  transition(event: AuthMachineEvent): AuthMachineState {
    const currentStatus = this.state.status;
    if (!this.canTransition(event.type)) {
      throw new Error(
        `Invalid AuthStateMachine transition: cannot handle "${event.type}" from status "${currentStatus}".`
      );
    }

    let nextState: AuthMachineState = { ...this.state };

    switch (event.type) {
      case 'RESTORE_START':
        nextState = {
          ...nextState,
          status: 'restoring',
          activeProvider: event.provider ?? nextState.activeProvider,
          lastError: null,
        };
        break;

      case 'SKIP_RESTORE':
      case 'RESTORE_EMPTY':
      case 'VERIFY_COMPLETE_TO_LOGIN':
      case 'RECOVERY_SUCCESS':
      case 'SIGN_OUT_COMPLETE':
      case 'SESSION_EXPIRED':
      case 'RESET_TO_ANONYMOUS':
        nextState = {
          status: 'anonymous',
          user: null,
          sessionMetadata: null,
          activeProvider: nextState.activeProvider,
          expiresAt: null,
          pendingChallenge: null,
          lastError: null,
          requiredVerificationSteps: [],
        };
        break;

      case 'RESTORE_EXPIRED':
        nextState = {
          ...nextState,
          status: 'refreshing',
          activeProvider: event.provider ?? nextState.activeProvider,
        };
        break;

      case 'RESTORE_ERROR':
      case 'REFRESH_FAILURE':
        nextState = {
          status: 'anonymous',
          user: null,
          sessionMetadata: null,
          activeProvider: nextState.activeProvider,
          expiresAt: null,
          pendingChallenge: null,
          lastError: event.error ?? null,
          requiredVerificationSteps: [],
        };
        break;

      case 'SIGN_IN_START':
      case 'SIGN_UP_START':
        nextState = {
          ...nextState,
          status: 'authenticating',
          activeProvider: event.provider,
          lastError: null,
          pendingChallenge: null,
        };
        break;

      case 'RESTORE_SUCCESS':
      case 'AUTH_SUCCESS':
      case 'VERIFY_SUCCESS':
      case 'CHALLENGE_SUCCESS':
      case 'RECOVERY_AUTHENTICATED':
      case 'REFRESH_SUCCESS':
        nextState = {
          status: 'authenticated',
          user: structuredClone(event.session.user),
          sessionMetadata: toSafeSessionMetadata(event.session),
          activeProvider: event.session.provider,
          expiresAt: event.session.expiresAt,
          pendingChallenge: null,
          lastError: null,
          requiredVerificationSteps: [],
        };
        break;

      case 'VERIFICATION_REQUIRED':
        nextState = {
          ...nextState,
          status: 'verifying',
          user: event.user ? structuredClone(event.user) : nextState.user,
          pendingChallenge: event.challenge ?? {
            challengeId: `verify_${Date.now()}`,
            type: 'email_verification',
          },
          requiredVerificationSteps: event.steps ?? ['email_verification'],
          lastError: null,
        };
        break;

      case 'CHALLENGE_REQUIRED':
        nextState = {
          ...nextState,
          status: 'challenge_required',
          user: event.user ? structuredClone(event.user) : nextState.user,
          pendingChallenge: structuredClone(event.challenge),
          lastError: null,
        };
        break;

      case 'RECOVERY_REQUIRED':
        nextState = {
          ...nextState,
          status: 'recovery_required',
          user: event.user ? structuredClone(event.user) : nextState.user,
          pendingChallenge: event.challenge ?? null,
          lastError: null,
        };
        break;

      case 'REFRESH_START':
        nextState = {
          ...nextState,
          status: 'refreshing',
        };
        break;

      case 'SIGN_OUT_START':
        nextState = {
          ...nextState,
          status: 'signing_out',
        };
        break;

      case 'AUTH_ERROR':
      case 'VERIFY_ERROR':
      case 'CHALLENGE_ERROR':
      case 'ACCOUNT_SUSPENDED':
        nextState = {
          ...nextState,
          status: 'error',
          sessionMetadata: null,
          expiresAt: null,
          lastError: event.error ?? {
            code: event.type === 'ACCOUNT_SUSPENDED' ? 'ACCOUNT_SUSPENDED' : 'AUTH_ERROR',
            message:
              event.type === 'ACCOUNT_SUSPENDED'
                ? 'Account is suspended.'
                : 'Authentication error occurred.',
            recoverable: event.type !== 'ACCOUNT_SUSPENDED',
            timestamp: Date.now(),
          },
        };
        break;
    }

    this.history.push({
      from: currentStatus,
      event: event.type,
      to: nextState.status,
      timestamp: Date.now(),
    });

    this.state = nextState;
    for (const listener of this.listeners) {
      listener(this.getState());
    }
    return this.getState();
  }

  subscribe(listener: (state: AuthMachineState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
