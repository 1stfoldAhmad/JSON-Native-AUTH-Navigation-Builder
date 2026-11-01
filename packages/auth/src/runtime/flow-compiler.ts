import type { AuthIR } from '@expo-foundation/core';

export interface AuthWorkflowStep {
  id: string;
  action:
    | 'validate_input'
    | 'call_provider'
    | 'map_response'
    | 'check_verification'
    | 'save_session'
    | 'clear_session'
    | 'emit_event';
  description: string;
  event?: string;
  flowRef?: string;
}

export interface CompiledAuthFlow {
  flowId: 'login' | 'registration' | 'logout' | 'restore' | 'refresh';
  enabled: boolean;
  steps: AuthWorkflowStep[];
}

export function compileAuthFlows(authIR: AuthIR): Record<CompiledAuthFlow['flowId'], CompiledAuthFlow> {
  const findFlowRef = (trigger: string): string | undefined =>
    authIR.events.find((e) => e.trigger === trigger || e.emittedEvent === trigger)?.flowRef;

  return {
    login: {
      flowId: 'login',
      enabled: authIR.authMethods.password || authIR.authMethods.oauth || authIR.authMethods.otp,
      steps: [
        {
          id: 'login.validate',
          action: 'validate_input',
          description: 'Validate credentials input contract',
        },
        {
          id: 'login.provider',
          action: 'call_provider',
          description: `Call ${authIR.primaryProvider.type} provider signIn`,
        },
        {
          id: 'login.map',
          action: 'map_response',
          description: 'Map provider response into normalized AuthResult',
        },
        {
          id: 'login.save',
          action: 'save_session',
          description: `Save session in ${authIR.sessionPolicy.storage}`,
        },
        {
          id: 'login.emit',
          action: 'emit_event',
          description: 'Emit auth.login.success lifecycle event',
          event: 'auth.login.success',
          flowRef: findFlowRef('loginSuccess') ?? findFlowRef('login.success'),
        },
      ],
    },
    registration: {
      flowId: 'registration',
      enabled: authIR.authMethods.registration,
      steps: [
        {
          id: 'register.validate',
          action: 'validate_input',
          description: 'Validate registration data and configuration',
        },
        {
          id: 'register.provider',
          action: 'call_provider',
          description: `Call ${authIR.primaryProvider.type} provider signUp`,
        },
        {
          id: 'register.check_verification',
          action: 'check_verification',
          description: authIR.authMethods.emailVerification
            ? 'Branch to auth.verification.required if unverified'
            : 'Complete registration directly',
          event: authIR.authMethods.emailVerification
            ? 'auth.verification.required'
            : 'auth.registration.completed',
          flowRef:
            findFlowRef('registrationCompleted') ?? findFlowRef('registration.completed'),
        },
      ],
    },
    logout: {
      flowId: 'logout',
      enabled: true,
      steps: [
        {
          id: 'logout.provider',
          action: 'call_provider',
          description: 'Revoke session on provider if configured',
        },
        {
          id: 'logout.clear',
          action: 'clear_session',
          description: 'Clear credentials from SecureStorage',
        },
        {
          id: 'logout.emit',
          action: 'emit_event',
          description: 'Emit auth.logout.success event',
          event: 'auth.logout.success',
          flowRef: findFlowRef('logoutSuccess') ?? findFlowRef('logout.success'),
        },
      ],
    },
    restore: {
      flowId: 'restore',
      enabled: authIR.sessionPolicy.restoreOnLaunch,
      steps: [
        {
          id: 'restore.emit_start',
          action: 'emit_event',
          description: 'Emit auth.session.restoring to hold protected navigation',
          event: 'auth.session.restoring',
        },
        {
          id: 'restore.check',
          action: 'call_provider',
          description: 'Load stored session and refresh if near expiration',
        },
        {
          id: 'restore.emit_done',
          action: 'emit_event',
          description: 'Emit auth.session.restored or auth.session.expired',
          event: 'auth.session.restored',
        },
      ],
    },
    refresh: {
      flowId: 'refresh',
      enabled: authIR.sessionPolicy.refreshEnabled,
      steps: [
        {
          id: 'refresh.provider',
          action: 'call_provider',
          description: 'Single-flight refresh token exchange via RefreshCoordinator',
        },
        {
          id: 'refresh.save',
          action: 'save_session',
          description: 'Persist rotated tokens in SecureStorage',
        },
      ],
    },
  };
}
