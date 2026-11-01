/**
 * @expo-foundation/auth - Deterministic 11-State Authentication State Machine
 *
 * Implements Section 4.3 & Section 14:
 * Explicit state transitions across `unknown`, `restoring`, `anonymous`, `authenticating`,
 * `authenticated`, `refreshing`, `verifying`, `challenge_required`, `signing_out`,
 * `recovery_required`, and `error`.
 */

import type { AuthStatus } from '@expo-foundation/core';

export type AuthTransitionEvent =
  | 'RESTORE_START'
  | 'RESTORE_SUCCESS'
  | 'RESTORE_EMPTY'
  | 'SIGN_IN_START'
  | 'SIGN_IN_SUCCESS'
  | 'SIGN_UP_START'
  | 'SIGN_UP_SUCCESS'
  | 'VERIFICATION_REQUIRED'
  | 'VERIFICATION_COMPLETE'
  | 'CHALLENGE_REQUIRED'
  | 'CHALLENGE_COMPLETE'
  | 'REFRESH_START'
  | 'REFRESH_SUCCESS'
  | 'REFRESH_FAILED'
  | 'SIGN_OUT_START'
  | 'SIGN_OUT_COMPLETE'
  | 'RECOVERY_REQUIRED'
  | 'RECOVERY_COMPLETE'
  | 'AUTH_ERROR'
  | 'RESET_TO_ANONYMOUS';

const TRANSITION_TABLE: Record<
  AuthStatus,
  Partial<Record<AuthTransitionEvent, AuthStatus>>
> = {
  unknown: {
    RESTORE_START: 'restoring',
    SIGN_IN_START: 'authenticating',
    SIGN_UP_START: 'authenticating',
    RESET_TO_ANONYMOUS: 'anonymous',
  },
  restoring: {
    RESTORE_SUCCESS: 'authenticated',
    RESTORE_EMPTY: 'anonymous',
    VERIFICATION_REQUIRED: 'verifying',
    CHALLENGE_REQUIRED: 'challenge_required',
    AUTH_ERROR: 'error',
  },
  anonymous: {
    RESTORE_START: 'restoring',
    SIGN_IN_START: 'authenticating',
    SIGN_UP_START: 'authenticating',
    RECOVERY_REQUIRED: 'recovery_required',
  },
  authenticating: {
    SIGN_IN_SUCCESS: 'authenticated',
    SIGN_UP_SUCCESS: 'authenticated',
    VERIFICATION_REQUIRED: 'verifying',
    CHALLENGE_REQUIRED: 'challenge_required',
    RECOVERY_REQUIRED: 'recovery_required',
    AUTH_ERROR: 'error',
    RESET_TO_ANONYMOUS: 'anonymous',
  },
  authenticated: {
    RESTORE_START: 'restoring',
    SIGN_IN_START: 'authenticating',
    REFRESH_START: 'refreshing',
    SIGN_OUT_START: 'signing_out',
    VERIFICATION_REQUIRED: 'verifying',
    CHALLENGE_REQUIRED: 'challenge_required',
    AUTH_ERROR: 'error',
    RESET_TO_ANONYMOUS: 'anonymous',
  },
  refreshing: {
    REFRESH_SUCCESS: 'authenticated',
    REFRESH_FAILED: 'anonymous',
    SIGN_OUT_START: 'signing_out',
    AUTH_ERROR: 'error',
  },
  verifying: {
    VERIFICATION_COMPLETE: 'authenticated',
    SIGN_OUT_START: 'signing_out',
    AUTH_ERROR: 'error',
    RESET_TO_ANONYMOUS: 'anonymous',
  },
  challenge_required: {
    CHALLENGE_COMPLETE: 'authenticated',
    SIGN_OUT_START: 'signing_out',
    AUTH_ERROR: 'error',
    RESET_TO_ANONYMOUS: 'anonymous',
  },
  signing_out: {
    SIGN_OUT_COMPLETE: 'anonymous',
    AUTH_ERROR: 'anonymous',
  },
  recovery_required: {
    RECOVERY_COMPLETE: 'anonymous',
    SIGN_IN_START: 'authenticating',
    SIGN_OUT_START: 'signing_out',
    AUTH_ERROR: 'error',
  },
  error: {
    SIGN_IN_START: 'authenticating',
    SIGN_UP_START: 'authenticating',
    RESTORE_START: 'restoring',
    SIGN_OUT_START: 'signing_out',
    RESET_TO_ANONYMOUS: 'anonymous',
  },
};

export interface StateTransitionRecord {
  from: AuthStatus;
  event: AuthTransitionEvent;
  to: AuthStatus;
  timestamp: string;
}

export class AuthStateMachine {
  private currentStatus: AuthStatus;
  private readonly history: StateTransitionRecord[] = [];

  constructor(initialStatus: AuthStatus = 'unknown') {
    this.currentStatus = initialStatus;
  }

  getStatus(): AuthStatus {
    return this.currentStatus;
  }

  canTransition(event: AuthTransitionEvent): boolean {
    const allowed = TRANSITION_TABLE[this.currentStatus];
    return Boolean(allowed && allowed[event]);
  }

  transition(event: AuthTransitionEvent): AuthStatus {
    const allowed = TRANSITION_TABLE[this.currentStatus];
    const next = allowed?.[event];
    if (!next) {
      throw new Error(
        `Invalid AuthStateMachine transition: cannot apply event "${event}" from state "${this.currentStatus}".`
      );
    }

    this.history.push({
      from: this.currentStatus,
      event,
      to: next,
      timestamp: new Date().toISOString(),
    });
    this.currentStatus = next;
    return this.currentStatus;
  }

  getHistory(): readonly StateTransitionRecord[] {
    return this.history;
  }
}
