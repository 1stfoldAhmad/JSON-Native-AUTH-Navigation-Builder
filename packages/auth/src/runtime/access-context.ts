import type { AccessContext } from '@expo-foundation/core';
import type { AuthMachineState } from '../state-machine/index.js';

export function buildAccessContext(
  state: AuthMachineState,
  defaultRoles: string[] = ['user']
): AccessContext {
  const isAuthenticated = state.status === 'authenticated' && state.user !== null;
  if (!isAuthenticated || !state.user) {
    return {
      authenticated: false,
      roles: [],
      permissions: [],
      verified: false,
    };
  }

  const roles =
    state.user.roles && state.user.roles.length > 0 ? [...state.user.roles] : [...defaultRoles];
  const permissions = state.user.permissions ? [...state.user.permissions] : [];
  const verified = Boolean(state.user.emailVerified ?? state.user.phoneVerified ?? true);

  return {
    authenticated: true,
    userId: state.user.id,
    roles,
    permissions,
    verified,
    tenantId: state.user.tenantId ?? state.sessionMetadata?.tenantId,
    accountStatus: state.user.accountStatus ?? 'active',
  };
}
