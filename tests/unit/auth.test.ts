import { describe, expect, it, vi } from 'vitest';
import {
  AppleAuthProviderAdapter,
  AuthController,
  AuthProviderRegistry,
  AuthStateMachine,
  ExpoSecureStoreAdapter,
  InMemoryTokenStorage,
  OidcAuthProviderAdapter,
  RestAuthProviderAdapter,
  SessionManager,
  SupabaseAuthProviderAdapter,
  generatePkcePair,
  resolveEnvTemplate,
  validateIdTokenClaims,
} from '@expo-foundation/auth';
import { FoundationCompiler, type AuthConfigDocument } from '@expo-foundation/core';
import authOnlyDoc from '../../examples/auth-only/auth.json' with { type: 'json' };

describe('@expo-foundation/auth', () => {
  it('enforces valid state machine transitions and rejects invalid transitions', () => {
    const sm = new AuthStateMachine('unknown');
    expect(sm.transition('RESTORE_START')).toBe('restoring');
    expect(sm.transition('RESTORE_EMPTY')).toBe('anonymous');
    expect(sm.transition('SIGN_IN_START')).toBe('authenticating');
    expect(sm.transition('SIGN_IN_SUCCESS')).toBe('authenticated');

    expect(() => sm.transition('SIGN_UP_SUCCESS')).toThrow(/Invalid AuthStateMachine transition/);
  });

  it('defaults AuthController to ExpoSecureStoreAdapter unless memory is configured (Finding 6)', () => {
    const compiler = new FoundationCompiler();
    const ir = compiler.compile({ auth: authOnlyDoc as unknown as AuthConfigDocument });
    const controller = new AuthController({ authIR: ir.auth! });
    const internalStorage = (
      controller as unknown as { sessionManager: { storage: unknown } }
    ).sessionManager.storage;
    expect(internalStorage).toBeInstanceOf(ExpoSecureStoreAdapter);
  });

  it('does not register any synthetic/mock provider in production AuthProviderRegistry (Finding 5)', () => {
    const registry = new AuthProviderRegistry();
    expect(() => registry.create('custom')).toThrow(
      /No production AuthProviderAdapter registered/
    );
  });

  it('coalesces concurrent session refreshes into a single-flight request', async () => {
    const storage = new InMemoryTokenStorage();
    const now = Date.now();
    const sessionManager = new SessionManager({
      storage,
      refreshEnabled: true,
      refreshThresholdSeconds: 60,
      now: () => now,
    });

    let refreshCallCount = 0;
    const fakeAdapter = {
      providerType: 'rest' as const,
      initialize: vi.fn(),
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      restoreSession: vi.fn(),
      refreshSession: vi.fn(async () => {
        refreshCallCount += 1;
        await new Promise((r) => setTimeout(r, 20));
        return {
          sessionId: 'sess_refreshed',
          user: { id: 'usr_1', email: 'test@expo.dev' },
          tokens: {
            accessToken: 'new_access_token',
            refreshToken: 'new_refresh_token',
            expiresAt: now + 3600_000,
          },
          provider: 'rest' as const,
          issuedAt: now,
          expiresAt: now + 3600_000,
        };
      }),
      requestPasswordReset: vi.fn(),
      resetPassword: vi.fn(),
      verifyEmail: vi.fn(),
      getCurrentUser: vi.fn(),
    };

    const initialSession = {
      sessionId: 'sess_old',
      user: { id: 'usr_1', email: 'test@expo.dev' },
      tokens: {
        accessToken: 'old_access',
        refreshToken: 'old_refresh',
        expiresAt: now + 10_000,
      },
      provider: 'rest' as const,
      issuedAt: now - 3500_000,
      expiresAt: now + 10_000,
    };

    const [r1, r2, r3] = await Promise.all([
      sessionManager.refreshSessionSingleFlight(fakeAdapter, initialSession),
      sessionManager.refreshSessionSingleFlight(fakeAdapter, initialSession),
      sessionManager.refreshSessionSingleFlight(fakeAdapter, initialSession),
    ]);

    expect(refreshCallCount).toBe(1);
    expect(r1.tokens.accessToken).toBe('new_access_token');
    expect(r2.tokens.accessToken).toBe('new_access_token');
    expect(r3.tokens.accessToken).toBe('new_access_token');
  });

  it('hardens RestAuthProviderAdapter: fail-closed env vars, retry safety, and strict user claims (Finding 13)', async () => {
    expect(() => resolveEnvTemplate('${env.MISSING_API_URL}', {})).toThrow(
      /Unresolved environment variable/
    );

    let postAttempts = 0;
    const adapter = new RestAuthProviderAdapter({
      env: { API_URL: 'https://api.test.local' },
      fetchImpl: async (url, init) => {
        if (url.endsWith('/auth/register')) {
          postAttempts += 1;
          throw new Error('Network error on non-idempotent POST');
        }
        if (url.endsWith('/auth/login')) {
          const body = JSON.parse(init.body ?? '{}') as { email: string };
          if (body.email === 'missing-id@expo.dev') {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                accessToken: 'tok_no_id',
                user: { email: 'missing-id@expo.dev' },
              }),
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              accessToken: 'tok_123',
              refreshToken: 'ref_123',
              expiresIn: 3600,
              user: {
                id: 'usr_rest_1',
                email: body.email,
              },
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      },
    });

    await adapter.initialize({
      type: 'rest',
      baseUrl: '${env.API_URL}',
      retryPolicy: { maxRetries: 3, backoffMs: 5 },
    });

    // Non-idempotent POST without Idempotency-Key must NOT retry
    await expect(
      adapter.signUp({ email: 'new@expo.dev', password: 'pw' })
    ).rejects.toThrow(/Network error/);
    expect(postAttempts).toBe(1);

    // Missing user ID must fail closed instead of fabricating 'usr_anonymous'
    await expect(
      adapter.signIn({ email: 'missing-id@expo.dev', password: 'pw' })
    ).rejects.toThrow(/missing a valid user "id"/);

    // Valid login must not fabricate roles or emailVerified: true when omitted by server
    const res = await adapter.signIn({ email: 'user@expo.dev', password: 'pw' });
    expect(res.status).toBe('authenticated');
    expect(res.user?.id).toBe('usr_rest_1');
    expect(res.user?.emailVerified).toBe(false);
    expect(res.user?.roles).toEqual([]);
  });

  it('validates OIDC PKCE S256, state, nonce, and ID token claims and fails closed without crypto (Finding 5)', async () => {
    const pkce = await generatePkcePair();
    expect(pkce.codeVerifier.length).toBeGreaterThanOrEqual(40);
    expect(pkce.codeChallenge).not.toBe(pkce.codeVerifier);
    expect(pkce.nonce.length).toBeGreaterThan(10);

    // Fail closed if SHA-256 is unavailable
    await expect(
      generatePkcePair({
        getRandomBytes: (len) => new Uint8Array(len),
        sha256: async () => {
          throw new Error('Crypto unavailable');
        },
      })
    ).rejects.toThrow(/Crypto unavailable/);

    // Create a valid 3-part JWT ID token and verify claims
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString(
      'base64url'
    );
    const payload = Buffer.from(
      JSON.stringify({
        iss: 'https://idp.example.com',
        aud: 'expo-mobile-client',
        sub: 'usr_oidc_99',
        email: 'oidc@expo.dev',
        email_verified: true,
        nonce: pkce.nonce,
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString('base64url');
    const validIdToken = `${header}.${payload}.sig_verified`;

    const claims = validateIdTokenClaims(validIdToken, {
      issuer: 'https://idp.example.com',
      clientId: 'expo-mobile-client',
      nonce: pkce.nonce,
    });
    expect(claims.sub).toBe('usr_oidc_99');

    const oidc = new OidcAuthProviderAdapter({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'oidc_at_1',
          refresh_token: 'oidc_rt_1',
          id_token: validIdToken,
          expires_in: 3600,
        }),
      }),
    });

    await oidc.initialize({
      type: 'oidc',
      issuer: 'https://idp.example.com',
      clientId: 'expo-mobile-client',
      redirectUri: 'efauth://callback',
    });

    const authReq = await oidc.createAuthorizationRequest();
    expect(authReq.AuthorizationUrl).toContain('code_challenge_method=S256');
    expect(authReq.AuthorizationUrl).toContain(`nonce=${authReq.nonce}`);

    await expect(
      oidc.exchangeAuthorizationCode({
        code: 'auth_code_123',
        state: 'tampered_state',
        expectedState: authReq.state,
        codeVerifier: authReq.codeVerifier,
        redirectUri: authReq.redirectUri,
      })
    ).rejects.toThrow(/OAuth state mismatch/);

    // Exchange with matching state & nonce
    const payloadWithReqNonce = Buffer.from(
      JSON.stringify({
        iss: 'https://idp.example.com',
        aud: 'expo-mobile-client',
        sub: 'usr_oidc_99',
        email: 'oidc@expo.dev',
        email_verified: true,
        nonce: authReq.nonce,
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString('base64url');
    const idTokenForReq = `${header}.${payloadWithReqNonce}.sig_verified`;

    const oidcWithToken = new OidcAuthProviderAdapter({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'oidc_at_1',
          id_token: idTokenForReq,
          expires_in: 3600,
        }),
      }),
    });
    await oidcWithToken.initialize({
      type: 'oidc',
      issuer: 'https://idp.example.com',
      clientId: 'expo-mobile-client',
      redirectUri: 'efauth://callback',
    });

    const exchanged = await oidcWithToken.exchangeAuthorizationCode({
      code: 'auth_code_123',
      state: authReq.state,
      expectedState: authReq.state,
      expectedNonce: authReq.nonce,
      codeVerifier: authReq.codeVerifier,
      redirectUri: authReq.redirectUri,
    });
    expect(exchanged.status).toBe('authenticated');
    expect(exchanged.user?.id).toBe('usr_oidc_99');
  });

  it('supports Apple and Supabase SDK drivers and fails closed when unconfigured (Finding 5)', async () => {
    const unconfiguredSupabase = new SupabaseAuthProviderAdapter();
    await unconfiguredSupabase.initialize({ type: 'supabase' });
    await expect(
      unconfiguredSupabase.signIn({ email: 'a@b.com', password: 'pw' })
    ).rejects.toThrow(/requires a configured SupabaseAuthSdkDriver/);

    const apple = new AppleAuthProviderAdapter({
      driver: {
        isAvailableAsync: async () => true,
        signInAsync: async () => ({
          user: 'apple_usr_01',
          identityToken: 'apple_jwt_id_token',
          email: 'apple@privaterelay.appleid.com',
        }),
      },
    });
    await apple.initialize({ type: 'apple' });
    const appleRes = await apple.signIn({});
    expect(appleRes.status).toBe('authenticated');
    expect(appleRes.user?.id).toBe('apple_usr_01');
  });
});
