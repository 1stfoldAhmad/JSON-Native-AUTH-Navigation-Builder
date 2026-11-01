/**
 * @expo-foundation/auth - OIDC / OAuth 2.0 PKCE Provider Adapter
 *
 * Implements Section 14.4 & Audit Finding 5:
 * - Fail-closed RFC 7636 PKCE S256 code verifier and challenge generation (requires WebCrypto or
 *   injected Expo Crypto driver; never falls back to Math.random() or plaintext verifier)
 * - Cryptographically secure `state` and `nonce` generation and validation
 * - OIDC Discovery (`.well-known/openid-configuration`)
 * - Authorization code exchange against the OIDC token endpoint
 * - ID token claim validation (`iss`, `aud`, `exp`, `nonce`)
 */

import type {
  AuthProviderAdapter,
  AuthProviderCapabilities,
  AuthProviderConfig,
  AuthResult,
  AuthSession,
  AuthUser,
  EmailVerificationInput,
  OAuthAuthorizationRequest,
  OAuthCapability,
  OAuthCodeExchangeInput,
  PasswordResetInput,
  PasswordResetRequest,
  SignInInput,
  SignUpInput,
} from '@expo-foundation/contracts';
import type { HttpFetchFn } from './rest-provider.js';

export interface PkceCryptoDriver {
  getRandomBytes(byteLength: number): Uint8Array;
  sha256(data: Uint8Array): Promise<Uint8Array>;
}

export interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  revocation_endpoint?: string;
  end_session_endpoint?: string;
  jwks_uri?: string;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecodeToJson(segment: string): Record<string, unknown> {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const full = padded + '='.repeat(padLen);
  const decoded =
    typeof atob === 'function'
      ? atob(full)
      : Buffer.from(full, 'base64').toString('utf-8');
  return JSON.parse(decoded) as Record<string, unknown>;
}

const defaultCryptoDriver: PkceCryptoDriver = {
  getRandomBytes(byteLength: number): Uint8Array {
    if (
      typeof globalThis.crypto === 'undefined' ||
      typeof globalThis.crypto.getRandomValues !== 'function'
    ) {
      throw new Error(
        'Cryptographically secure random generator (WebCrypto or expo-crypto) is unavailable. Failing closed.'
      );
    }
    const bytes = new Uint8Array(byteLength);
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  },
  async sha256(data: Uint8Array): Promise<Uint8Array> {
    if (
      typeof globalThis.crypto === 'undefined' ||
      !globalThis.crypto.subtle ||
      typeof globalThis.crypto.subtle.digest !== 'function'
    ) {
      throw new Error(
        'Cryptographic SHA-256 digest (WebCrypto subtle.digest or expo-crypto) is unavailable for PKCE S256. Failing closed.'
      );
    }
    const hashBuffer = await globalThis.crypto.subtle.digest(
      'SHA-256',
      data as unknown as BufferSource
    );
    return new Uint8Array(hashBuffer);
  },
};

export async function generatePkcePair(
  cryptoDriver: PkceCryptoDriver = defaultCryptoDriver
): Promise<{
  codeVerifier: string;
  codeChallenge: string;
  state: string;
  nonce: string;
}> {
  const verifierBytes = cryptoDriver.getRandomBytes(32);
  const stateBytes = cryptoDriver.getRandomBytes(16);
  const nonceBytes = cryptoDriver.getRandomBytes(16);

  const codeVerifier = base64UrlEncode(verifierBytes);
  const state = base64UrlEncode(stateBytes);
  const nonce = base64UrlEncode(nonceBytes);

  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digestBytes = await cryptoDriver.sha256(data);
  const codeChallenge = base64UrlEncode(digestBytes);

  if (!codeChallenge || codeChallenge === codeVerifier) {
    throw new Error('PKCE S256 challenge generation failed verification.');
  }

  return { codeVerifier, codeChallenge, state, nonce };
}

/**
 * Validates an OIDC ID Token's structure and mandatory claims (`iss`, `aud`, `exp`, `nonce`).
 */
export function validateIdTokenClaims(
  idToken: string,
  expected: {
    issuer: string;
    clientId: string;
    nonce?: string;
    nowMs?: number;
  }
): Record<string, unknown> {
  const parts = idToken.split('.');
  if (parts.length !== 3 || !parts[2]) {
    throw new Error('Invalid OIDC ID token format: expected 3-part signed JWT.');
  }

  let payload: Record<string, unknown>;
  try {
    payload = base64UrlDecodeToJson(parts[1]);
  } catch {
    throw new Error('Invalid OIDC ID token payload encoding.');
  }

  const expectedIssuer = expected.issuer.replace(/\/+$/, '');
  const actualIssuer = String(payload.iss ?? '').replace(/\/+$/, '');
  if (!actualIssuer || actualIssuer !== expectedIssuer) {
    throw new Error(
      `OIDC ID token issuer mismatch: expected "${expectedIssuer}", received "${actualIssuer}".`
    );
  }

  const aud = payload.aud;
  const audMatches = Array.isArray(aud)
    ? aud.includes(expected.clientId)
    : aud === expected.clientId;
  if (!audMatches) {
    throw new Error(
      `OIDC ID token audience mismatch: expected "${expected.clientId}".`
    );
  }

  const nowSeconds = Math.floor((expected.nowMs ?? Date.now()) / 1000);
  const exp = Number(payload.exp ?? 0);
  if (!exp || exp <= nowSeconds) {
    throw new Error('OIDC ID token has expired or is missing the "exp" claim.');
  }

  if (expected.nonce && payload.nonce !== expected.nonce) {
    throw new Error('OIDC ID token nonce mismatch.');
  }

  return payload;
}

export class OidcAuthProviderAdapter implements AuthProviderAdapter, OAuthCapability {
  readonly providerType = 'oidc' as const;
  readonly capabilities: AuthProviderCapabilities = {
    passwordLogin: false,
    registration: false,
    passwordReset: false,
    emailVerification: false,
    phoneAuthentication: false,
    otp: false,
    oauth: true,
    mfa: true,
    biometric: false,
  };

  private config!: AuthProviderConfig;
  private currentSession: AuthSession | null = null;
  private discoveryDocument: OidcDiscoveryDocument | null = null;
  private lastGeneratedNonce: string | undefined;
  private readonly fetchImpl?: HttpFetchFn;
  private readonly cryptoDriver: PkceCryptoDriver;

  constructor(options?: {
    fetchImpl?: HttpFetchFn;
    cryptoDriver?: PkceCryptoDriver;
  }) {
    this.fetchImpl =
      options?.fetchImpl ??
      (typeof globalThis.fetch === 'function'
        ? (globalThis.fetch.bind(globalThis) as unknown as HttpFetchFn)
        : undefined);
    this.cryptoDriver = options?.cryptoDriver ?? defaultCryptoDriver;
  }

  async initialize(config: AuthProviderConfig): Promise<void> {
    if (!config.issuer && !config.discoveryUrl) {
      throw new Error(
        'OIDC provider requires either "issuer" or "discoveryUrl" in configuration.'
      );
    }
    if (!config.clientId) {
      throw new Error('OIDC provider requires "clientId" in configuration.');
    }
    this.config = config;
  }

  async fetchDiscoveryDocument(): Promise<OidcDiscoveryDocument> {
    if (this.discoveryDocument) {
      return this.discoveryDocument;
    }

    const issuer = (this.config.issuer ?? 'https://idp.example.com').replace(/\/+$/, '');
    const discoveryUrl =
      this.config.discoveryUrl ?? `${issuer}/.well-known/openid-configuration`;

    if (this.fetchImpl && this.config.discoveryUrl) {
      const response = await this.fetchImpl(discoveryUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(
          `Failed to load OIDC discovery document from "${discoveryUrl}" (HTTP ${response.status}).`
        );
      }
      const doc = (await response.json()) as OidcDiscoveryDocument;
      this.discoveryDocument = doc;
      return doc;
    }

    this.discoveryDocument = {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      userinfo_endpoint: `${issuer}/userinfo`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
    };
    return this.discoveryDocument;
  }

  async createAuthorizationRequest(): Promise<OAuthAuthorizationRequest> {
    const { codeVerifier, codeChallenge, state, nonce } = await generatePkcePair(
      this.cryptoDriver
    );
    this.lastGeneratedNonce = nonce;

    const discovery = await this.fetchDiscoveryDocument();
    const clientId = this.config.clientId;
    if (!clientId) {
      throw new Error('OIDC clientId is required to create an authorization request.');
    }
    const redirectUri = this.config.redirectUri ?? 'app://auth/callback';
    const scopes = (this.config.scopes ?? ['openid', 'profile', 'email']).join(' ');

    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', scopes);
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');

    return {
      AuthorizationUrl: url.toString(),
      state,
      nonce,
      codeVerifier,
      codeChallenge,
      redirectUri,
    };
  }

  async exchangeAuthorizationCode(input: OAuthCodeExchangeInput): Promise<AuthResult> {
    if (!input.state || !input.expectedState || input.state !== input.expectedState) {
      throw new Error(
        'OAuth state mismatch: possible CSRF or tampered authorization callback.'
      );
    }
    if (!input.codeVerifier || input.codeVerifier.length < 32) {
      throw new Error('Missing or invalid PKCE code_verifier during token exchange.');
    }
    if (!input.code) {
      throw new Error('Missing authorization code during OIDC token exchange.');
    }

    const discovery = await this.fetchDiscoveryDocument();
    const expectedNonce = input.expectedNonce ?? this.lastGeneratedNonce;

    if (!this.fetchImpl) {
      throw new Error(
        'No HTTP fetch implementation configured for OIDC authorization code token exchange.'
      );
    }

    const response = await this.fetchImpl(discovery.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: this.config.clientId,
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `OIDC token exchange failed with HTTP status ${response.status}.`
      );
    }

    const tokenPayload = (await response.json()) as Record<string, unknown>;
    const accessToken = String(
      tokenPayload.access_token ?? tokenPayload.accessToken ?? ''
    );
    if (!accessToken) {
      throw new Error('OIDC token endpoint response did not include an access_token.');
    }

    const idToken =
      typeof tokenPayload.id_token === 'string'
        ? tokenPayload.id_token
        : typeof tokenPayload.idToken === 'string'
          ? tokenPayload.idToken
          : undefined;

    let claims: Record<string, unknown> = {};
    if (idToken) {
      claims = validateIdTokenClaims(idToken, {
        issuer: discovery.issuer,
        clientId: this.config.clientId!,
        nonce: expectedNonce,
      });
    } else if (expectedNonce) {
      throw new Error(
        'OIDC response is missing required id_token for nonce and issuer verification.'
      );
    }

    const sub = String(claims.sub ?? tokenPayload.sub ?? '');
    if (!sub) {
      throw new Error('OIDC token response is missing required subject ("sub") claim.');
    }

    const expiresIn = Number(tokenPayload.expires_in ?? tokenPayload.expiresIn ?? 3600);
    const now = Date.now();
    const expiresAt = now + expiresIn * 1000;

    const user: AuthUser = {
      id: sub,
      email: typeof claims.email === 'string' ? claims.email : undefined,
      displayName:
        typeof claims.name === 'string' ? claims.name : undefined,
      emailVerified:
        typeof claims.email_verified === 'boolean' ? claims.email_verified : false,
      roles: Array.isArray(claims.roles) ? (claims.roles as string[]) : [],
      permissions: Array.isArray(claims.permissions)
        ? (claims.permissions as string[])
        : [],
      claims,
    };

    const session: AuthSession = {
      sessionId: `oidc_sess_${sub}_${now}`,
      user,
      tokens: {
        accessToken,
        refreshToken:
          typeof tokenPayload.refresh_token === 'string'
            ? tokenPayload.refresh_token
            : undefined,
        idToken,
        tokenType: 'Bearer',
        expiresAt,
      },
      provider: 'oidc',
      issuedAt: now,
      expiresAt,
    };

    this.currentSession = session;
    return {
      status: 'authenticated',
      session,
      user,
    };
  }

  async signIn(input: SignInInput): Promise<AuthResult> {
    // Allow sign-in when an authorization code exchange payload is passed in metadata
    const meta = input.metadata;
    if (
      meta &&
      typeof meta.code === 'string' &&
      typeof meta.state === 'string' &&
      typeof meta.expectedState === 'string' &&
      typeof meta.codeVerifier === 'string'
    ) {
      return this.exchangeAuthorizationCode({
        code: meta.code,
        state: meta.state,
        expectedState: meta.expectedState,
        expectedNonce:
          typeof meta.expectedNonce === 'string' ? meta.expectedNonce : undefined,
        codeVerifier: meta.codeVerifier,
        redirectUri:
          typeof meta.redirectUri === 'string'
            ? meta.redirectUri
            : (this.config.redirectUri ?? 'app://auth/callback'),
      });
    }

    throw new Error(
      'OIDC provider requires PKCE authorization code flow via createAuthorizationRequest() and exchangeAuthorizationCode(). Direct password login is not supported on OidcAuthProviderAdapter.'
    );
  }

  async signUp(_input: SignUpInput): Promise<AuthResult> {
    throw new Error(
      'OIDC provider delegates registration to the identity provider authorization endpoint via createAuthorizationRequest().'
    );
  }

  async signOut(): Promise<void> {
    this.currentSession = null;
  }

  async restoreSession(): Promise<AuthSession | null> {
    return this.currentSession;
  }

  async refreshSession(refreshToken?: string): Promise<AuthSession> {
    const token = refreshToken ?? this.currentSession?.tokens.refreshToken;
    if (!token) {
      throw new Error('No OIDC refresh token available.');
    }
    if (!this.fetchImpl) {
      throw new Error(
        'No HTTP fetch implementation configured to refresh OIDC session.'
      );
    }

    const discovery = await this.fetchDiscoveryDocument();
    const response = await this.fetchImpl(discovery.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: this.config.clientId,
        refresh_token: token,
      }),
    });

    if (!response.ok) {
      throw new Error(`OIDC token refresh failed with HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const accessToken = String(payload.access_token ?? '');
    if (!accessToken || !this.currentSession) {
      throw new Error('Invalid OIDC refresh token response.');
    }

    const expiresIn = Number(payload.expires_in ?? 3600);
    const now = Date.now();
    const expiresAt = now + expiresIn * 1000;

    const refreshed: AuthSession = {
      ...this.currentSession,
      tokens: {
        ...this.currentSession.tokens,
        accessToken,
        refreshToken:
          typeof payload.refresh_token === 'string'
            ? payload.refresh_token
            : token,
        expiresAt,
      },
      issuedAt: now,
      expiresAt,
    };
    this.currentSession = refreshed;
    return refreshed;
  }

  async requestPasswordReset(_input: PasswordResetRequest): Promise<void> {
    throw new Error('Password reset is managed by the external OIDC Identity Provider.');
  }

  async resetPassword(_input: PasswordResetInput): Promise<void> {
    throw new Error('Password reset is managed by the external OIDC Identity Provider.');
  }

  async verifyEmail(_input: EmailVerificationInput): Promise<void> {
    throw new Error('Email verification is managed by the external OIDC Identity Provider.');
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    return this.currentSession?.user ?? null;
  }
}
