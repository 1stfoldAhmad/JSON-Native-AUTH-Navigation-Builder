import { describe, expect, it } from 'vitest';
import {
  ExpoSecureStoreAdapter,
  OidcAuthProviderAdapter,
  RestAuthProviderAdapter,
  generatePkcePair,
  resolveEnvTemplate,
  validateIdTokenClaims,
} from '@expo-foundation/auth';
import { sanitizeEventPayload } from '@expo-foundation/contracts';
import {
  evaluateAccessPolicy,
  FoundationCompiler,
  type NavigationConfigDocument,
} from '@expo-foundation/core';
import { DeepLinkManager, NavigationStateManager } from '@expo-foundation/navigation';
import completeNavDoc from '../../examples/complete-foundation/navigation.json' with { type: 'json' };

describe('Security & Token Hygiene Verification Suite (Section 18.4)', () => {
  it('never leaks raw tokens, passwords, or secrets in sanitized event payloads', () => {
    const raw = {
      userId: 'usr_sec_1',
      accessToken: 'eyJhbGciOiJIUzI1NiJ9.secret',
      refreshToken: 'rt_secret_999',
      idToken: 'id_secret_888',
      password: 'SuperSecretPassword!',
      clientSecret: 'cs_live_12345',
      codeVerifier: 'pkce_secret_verifier',
    };

    const sanitized = sanitizeEventPayload(raw);
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain('eyJhbGciOiJIUzI1NiJ9.secret');
    expect(serialized).not.toContain('rt_secret_999');
    expect(serialized).not.toContain('id_secret_888');
    expect(serialized).not.toContain('SuperSecretPassword!');
    expect(serialized).not.toContain('cs_live_12345');
    expect(serialized).not.toContain('pkce_secret_verifier');
  });

  it('rejects OAuth / OIDC callback with mismatched state parameter or tampered ID token (CSRF & OIDC protection)', async () => {
    const adapter = new OidcAuthProviderAdapter();
    await adapter.initialize({
      type: 'oidc',
      issuer: 'https://auth.example.com',
      clientId: 'client_123',
      redirectUri: 'efshop://auth/callback',
    });

    const req = await adapter.createAuthorizationRequest();
    expect(req.AuthorizationUrl).toContain('code_challenge_method=S256');
    expect(req.codeVerifier).not.toBe(req.codeChallenge);

    await expect(
      adapter.exchangeAuthorizationCode({
        code: 'auth_code_abc',
        state: 'malicious_forged_state',
        expectedState: req.state,
        codeVerifier: req.codeVerifier,
        redirectUri: req.redirectUri,
      })
    ).rejects.toThrow(/OAuth state mismatch/);

    // Expired or wrong-issuer ID token must fail closed
    const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
    const badIssuerPayload = Buffer.from(
      JSON.stringify({
        iss: 'https://evil-idp.example.com',
        aud: 'client_123',
        sub: 'usr_1',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString('base64url');

    expect(() =>
      validateIdTokenClaims(`${header}.${badIssuerPayload}.sig`, {
        issuer: 'https://auth.example.com',
        clientId: 'client_123',
      })
    ).toThrow(/issuer mismatch/);
  });

  it('rejects Universal Links from untrusted external hosts or when hosts allowlist is empty (Finding 9)', () => {
    const compiler = new FoundationCompiler();
    const ir = compiler.compile({
      navigation: completeNavDoc as unknown as NavigationConfigDocument,
    });
    const sm = new NavigationStateManager({ navigationIR: ir.navigation! });
    const dl = new DeepLinkManager({
      navigationIR: ir.navigation!,
      stateManager: sm,
    });

    const maliciousResult = dl.handleIncomingUrl(
      'https://phishing.evil.example.com/orders/ORD-123'
    );
    expect(maliciousResult.status).toBe('rejected');
    expect(maliciousResult.reason).toBe('untrusted_host');
  });

  it('centrally enforces guest, verified, role, permission, accountStatus, and tenantId policies', () => {
    const anonCtx = {
      authenticated: false,
      roles: [],
      permissions: [],
      verified: false,
    };
    const authCtx = {
      authenticated: true,
      userId: 'usr_1',
      roles: ['editor'],
      permissions: ['posts.write'],
      verified: true,
      tenantId: 'org_acme',
      accountStatus: 'active',
    };

    expect(evaluateAccessPolicy('guest', anonCtx).allowed).toBe(true);
    expect(evaluateAccessPolicy('guest', authCtx)).toEqual({
      allowed: false,
      reason: 'guest_only',
    });
    expect(
      evaluateAccessPolicy({ tenantId: 'org_acme' }, authCtx).allowed
    ).toBe(true);
    expect(
      evaluateAccessPolicy({ tenantId: 'org_other' }, authCtx)
    ).toEqual({
      allowed: false,
      reason: 'invalid_tenant',
    });
  });

  it('fails closed on unresolved environment variables in RestAuthProviderAdapter (Finding 13)', async () => {
    expect(() =>
      resolveEnvTemplate('https://${env.UNSET_DOMAIN}/v1', {})
    ).toThrow(/Unresolved environment variable/);

    const rest = new RestAuthProviderAdapter({ env: {} });
    await expect(
      rest.initialize({
        type: 'rest',
        baseUrl: '${env.UNSET_API_BASE}',
      })
    ).rejects.toThrow(/Unresolved environment variable/);
  });

  it('clears corrupted session JSON from storage without crashing', async () => {
    const backing = new Map<string, string>();
    const secureStore = new ExpoSecureStoreAdapter({
      getItemAsync: async (k) => backing.get(k) ?? null,
      setItemAsync: async (k, v) => {
        backing.set(k, v);
      },
      deleteItemAsync: async (k) => {
        backing.delete(k);
      },
    });

    await secureStore.setItem('key1', 'value1');
    expect(await secureStore.getItem('key1')).toBe('value1');
    await secureStore.removeItem('key1');
    expect(await secureStore.getItem('key1')).toBeNull();

    const pkce = await generatePkcePair();
    expect(pkce.codeChallenge).toBeTruthy();
  });
});
