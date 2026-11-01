import type { AuthProviderType, AuthSession, AuthUser } from '@expo-foundation/contracts';

export function createMockUser(overrides?: Partial<AuthUser>): AuthUser {
  return {
    id: overrides?.id ?? 'usr_test_1',
    email: overrides?.email ?? 'tester@expo.dev',
    displayName: overrides?.displayName ?? 'Test User',
    emailVerified: overrides?.emailVerified ?? true,
    roles: overrides?.roles ?? ['user'],
    permissions: overrides?.permissions ?? ['orders.read'],
    tenantId: overrides?.tenantId,
    accountStatus: overrides?.accountStatus ?? 'active',
    claims: overrides?.claims,
  };
}

export function createMockSession(options?: {
  user?: Partial<AuthUser>;
  provider?: AuthProviderType;
  expiresInSeconds?: number;
  issuedAt?: number;
}): AuthSession {
  const now = options?.issuedAt ?? Date.now();
  const expiresAt = now + (options?.expiresInSeconds ?? 3600) * 1000;
  const user = createMockUser(options?.user);
  return {
    sessionId: `sess_mock_${user.id}_${now}`,
    user,
    tokens: {
      accessToken: `mock_access_token_${now}`,
      refreshToken: `mock_refresh_token_${now}`,
      idToken: `mock_id_token_${now}`,
      tokenType: 'Bearer',
      expiresAt,
    },
    provider: options?.provider ?? 'rest',
    issuedAt: now,
    expiresAt,
    tenantId: user.tenantId,
  };
}
