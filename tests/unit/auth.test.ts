import { describe, expect, it } from 'vitest';
import {
  AuthController,
  AuthSessionManager,
  AuthStateMachine,
  extractByJsonPath,
  MemorySecureStorageAdapter,
  OidcAuthProviderAdapter,
  RestAuthProviderAdapter,
} from '@expo-foundation/auth';
import { defaultFoundationCompiler } from '@expo-foundation/core';
import authOnlyJson from '../../examples/auth-only/auth.json' with { type: 'json' };

describe('@expo-foundation/auth', () => {
  it('enforces deterministic AuthStateMachine transitions and redacts raw tokens', () => {
    const machine = new AuthStateMachine('unknown');
    expect(machine.getState().status).toBe('unknown');

    // Invalid transition from unknown -> refreshing must throw
    expect(() => machine.transition({ type: 'REFRESH_START' })).toThrow();

    machine.transition({ type: 'RESTORE_START', provider: 'rest' });
    expect(machine.getState().status).toBe('restoring');

    machine.transition({ type: 'RESTORE_EMPTY' });
    expect(machine.getState().status).toBe('anonymous');

    machine.transition({ type: 'SIGN_IN_START', provider: 'rest' });
    expect(machine.getState().status).toBe('authenticating');

    machine.transition({
      type: 'AUTH_SUCCESS',
      session: {
        sessionId: 'sess_1',
        provider: 'rest',
        issuedAt: 1000,
        expiresAt: 5000,
        user: {
          id: 'u_1',
          email: 'dev@expo.dev',
          roles: ['user', 'admin'],
          permissions: ['orders.read'],
          emailVerified: true,
        },
        tokens: {
          accessToken: 'secret_access_123',
          refreshToken: 'secret_refresh_456',
          expiresAt: 5000,
        },
      },
    });

    const state = machine.getState();
    expect(state.status).toBe('authenticated');
    expect(state.user?.id).toBe('u_1');
    expect(state.sessionMetadata?.hasRefreshToken).toBe(true);
    expect(JSON.stringify(state)).not.toContain('secret_access_123');
    expect(JSON.stringify(state)).not.toContain('secret_refresh_456');
  });

  it('prevents duplicate simultaneous refresh calls via single-flight RefreshCoordinator', async () => {
    const storage = new MemorySecureStorageAdapter();
    const sessionManager = new AuthSessionManager({
      storage,
      refreshEnabled: true,
      refreshThresholdSeconds: 60,
      rotateRefreshTokens: true,
    });

    let networkRefreshCalls = 0;
    const adapter = new RestAuthProviderAdapter({
      httpClient: async () => {
        networkRefreshCalls += 1;
        await new Promise((r) => setTimeout(r, 25));
        return {
          status: 200,
          ok: true,
          data: {
            data: {
              access_token: `rotated_access_${networkRefreshCalls}`,
              refresh_token: `rotated_refresh_${networkRefreshCalls}`,
              expires_in: 3600,
              user: { id: 'u_1', email: 'u@example.com', roles: ['user'] },
            },
          },
        };
      },
    });
    await adapter.initialize({ type: 'rest', baseUrl: 'https://api.example.com' });

    await sessionManager.persistSession({
      sessionId: 's_initial',
      provider: 'rest',
      issuedAt: Date.now() - 3600_000,
      expiresAt: Date.now() - 1000,
      user: { id: 'u_1', email: 'u@example.com', roles: ['user'] },
      tokens: {
        accessToken: 'old_access',
        refreshToken: 'initial_refresh',
        expiresAt: Date.now() - 1000,
      },
    });

    // Fire 5 concurrent refresh calls simultaneously
    const results = await Promise.all([
      sessionManager.refreshSession(adapter),
      sessionManager.refreshSession(adapter),
      sessionManager.refreshSession(adapter),
      sessionManager.refreshSession(adapter),
      sessionManager.refreshSession(adapter),
    ]);

    expect(networkRefreshCalls).toBe(1);
    expect(sessionManager.refreshCoordinator.getRefreshExecutionCount()).toBe(1);
    for (const res of results) {
      expect(res.tokens.accessToken).toBe('rotated_access_1');
    }
  });

  it('evaluates restricted JSONPath expressions and blocks unsafe expressions', () => {
    const payload = {
      data: {
        access_token: 'tok_abc',
        user: { id: 'usr_7' },
      },
    };
    expect(extractByJsonPath(payload, '$.data.access_token')).toBe('tok_abc');
    expect(extractByJsonPath(payload, '$.data.user.id')).toBe('usr_7');
    expect(() => extractByJsonPath(payload, '$.__proto__.polluted')).toThrow();
    expect(() => extractByJsonPath(payload, 'process.exit(1)')).toThrow();
  });

  it('executes OIDC Authorization Code + PKCE flow and validates state', async () => {
    const oidc = new OidcAuthProviderAdapter();
    await oidc.initialize({
      type: 'oidc',
      clientId: 'mobile-app',
      discoveryUrl: 'https://idp.example.com',
      redirectUri: 'expofoundation://auth/callback',
    });

    const authReq = await oidc.createAuthorizationRequest();
    expect(authReq.AuthorizationUrl).toContain('code_challenge_method=S256');
    expect(authReq.codeVerifier.length).toBeGreaterThanOrEqual(32);

    // Mismatched state must be rejected
    await expect(
      oidc.exchangeAuthorizationCode({
        code: 'code_123',
        state: 'tampered_state',
        expectedState: authReq.state,
        codeVerifier: authReq.codeVerifier,
        redirectUri: authReq.redirectUri,
      })
    ).rejects.toThrow(/state validation failed/i);

    // Valid PKCE & state succeeds
    const validResult = await oidc.exchangeAuthorizationCode({
      code: 'code_123',
      state: authReq.state,
      expectedState: authReq.state,
      codeVerifier: authReq.codeVerifier,
      redirectUri: authReq.redirectUri,
    });
    expect(validResult.status).toBe('authenticated');
    expect(validResult.session?.provider).toBe('oidc');
  });

  it('runs standalone AuthController in Auth-Only mode without Navigation Builder', async () => {
    const compiled = defaultFoundationCompiler.compile({ auth: authOnlyJson });
    expect(compiled.canGenerate).toBe(true);
    expect(compiled.ir?.projectMetadata.mode).toBe('auth-only');
    expect(compiled.ir?.navigation).toBeNull();

    const adapter = new RestAuthProviderAdapter({
      httpClient: async (req) => ({
        status: 200,
        ok: true,
        data: {
          data: {
            access_token: 'tok_standalone',
            refresh_token: 'ref_standalone',
            expires_in: 3600,
            verification_required: req.url.endsWith('/register'),
            user: {
              id: 'u_standalone',
              email: 'solo@expo.dev',
              roles: ['admin'],
              permissions: ['users.manage'],
              emailVerified: !req.url.endsWith('/register'),
            },
          },
        },
      }),
    });

    const controller = new AuthController({
      authIR: compiled.ir!.auth!,
      adapter,
    });

    await controller.initialize();
    expect(controller.getState().status).toBe('anonymous');

    await controller.signIn({ email: 'solo@expo.dev', password: 'secret' });
    expect(controller.getState().status).toBe('authenticated');
    expect(controller.getAccessContext().roles).toContain('admin');

    await controller.signOut();
    expect(controller.getState().status).toBe('anonymous');
    expect(controller.getAccessContext().authenticated).toBe(false);
  });
});
