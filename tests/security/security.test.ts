import { describe, expect, it } from 'vitest';
import {
  assertSafeForSecureStorage,
  MemorySecureStorageAdapter,
  normalizeAuthError,
  OidcAuthProviderAdapter,
  RestAuthProviderAdapter,
  TokenManager,
} from '@expo-foundation/auth';
import { validateAuthDocument, validateIntegrationDocument } from '@expo-foundation/core';
import completeAuthJson from '../../examples/complete-foundation/auth.json' with { type: 'json' };
import completeIntJson from '../../examples/complete-foundation/integration.json' with { type: 'json' };

describe('Section 18.E — Security Audit Tests', () => {
  it('rejects embedded client secrets and private keys in Auth configurations and adapters', async () => {
    const withSecret = structuredClone(completeAuthJson) as Record<string, unknown>;
    (
      (withSecret.provider as Record<string, unknown>).config as Record<string, unknown>
    ).clientSecret = 'super_secret_do_not_embed';

    const diags = validateAuthDocument(withSecret);
    expect(diags.some((d) => d.code === 'AUTH_EMBEDDED_CLIENT_SECRET')).toBe(true);

    const oidc = new OidcAuthProviderAdapter();
    await expect(
      oidc.initialize({
        type: 'oidc',
        options: { clientSecret: 'leaked_secret' },
      })
    ).rejects.toThrow(/Security violation/i);

    const rest = new RestAuthProviderAdapter();
    await expect(
      rest.initialize({
        type: 'rest',
        options: { privateKey: 'leaked_private_key' },
      })
    ).rejects.toThrow(/Security violation/i);
  });

  it('prevents storing passwords, secrets, or oversized (>2048B) payloads in SecureStorage', async () => {
    const storage = new MemorySecureStorageAdapter();

    await expect(storage.setItem('user_password', 'secret123')).rejects.toThrow(
      /Security violation/i
    );
    await expect(
      storage.setItem('session_meta', JSON.stringify({ password: 'secret' }))
    ).rejects.toThrow(/Security violation/i);

    const oversized = 'x'.repeat(2500);
    await expect(storage.setItem('large_profile', oversized)).rejects.toThrow(
      /exceeds 2048-byte limit/i
    );

    expect(() =>
      assertSafeForSecureStorage('expo_foundation_auth.access_token', 'jwt_token_value')
    ).not.toThrow();
  });

  it('redacts Bearer tokens and JWTs in ErrorNormalizer output', () => {
    const leakedError = new Error(
      'Request failed with header Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    );
    const normalized = normalizeAuthError(leakedError);
    expect(normalized.message).not.toContain('eyJhbGci');
    expect(normalized.message).toContain('[REDACTED]');
  });

  it('rejects external redirect URLs in Integration configuration', () => {
    const unsafeInt = structuredClone(completeIntJson);
    unsafeInt.authNavigation.afterLogin = 'https://attacker.example.com/phish';
    const diags = validateIntegrationDocument(unsafeInt);
    expect(diags.some((d) => d.code === 'INT_UNSAFE_EXTERNAL_REDIRECT')).toBe(true);
  });

  it('cleans up corrupt or partial session data after reinstall/desync', async () => {
    const storage = new MemorySecureStorageAdapter();
    const tokenManager = new TokenManager(storage);

    await storage.setItem('expo_foundation_auth.access_token', 'orphan_token');
    await storage.setItem('expo_foundation_auth.session_meta', '{not-valid-json');

    const loaded = await tokenManager.loadSession();
    expect(loaded).toBeNull();
    expect(await storage.getItem('expo_foundation_auth.access_token')).toBeNull();
  });
});
