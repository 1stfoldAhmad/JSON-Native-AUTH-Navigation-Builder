import type {
  AuthProviderAdapter,
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

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function generatePkcePair(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}> {
  const verifierBytes = new Uint8Array(32);
  const stateBytes = new Uint8Array(16);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(verifierBytes);
    globalThis.crypto.getRandomValues(stateBytes);
  } else {
    for (let i = 0; i < verifierBytes.length; i++) verifierBytes[i] = (i * 37 + 13) & 0xff;
    for (let i = 0; i < stateBytes.length; i++) stateBytes[i] = (i * 53 + 29) & 0xff;
  }

  const codeVerifier = base64UrlEncode(verifierBytes);
  const state = base64UrlEncode(stateBytes);

  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const encoded = new TextEncoder().encode(codeVerifier);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
    const codeChallenge = base64UrlEncode(new Uint8Array(digest));
    return { codeVerifier, codeChallenge, state };
  }

  return {
    codeVerifier,
    codeChallenge: codeVerifier,
    state,
  };
}

export interface OidcTokenExchangeResult {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  sub?: string;
  email?: string;
  email_verified?: boolean;
  roles?: string[];
}

export type OidcTokenExchangeHandler = (params: {
  tokenEndpoint: string;
  clientId: string;
  code?: string;
  codeVerifier?: string;
  redirectUri?: string;
  refreshToken?: string;
  grantType: 'authorization_code' | 'refresh_token';
}) => Promise<OidcTokenExchangeResult>;

export class OidcAuthProviderAdapter implements AuthProviderAdapter, OAuthCapability {
  readonly providerType = 'oidc' as const;
  private config: AuthProviderConfig | null = null;
  private currentSession: AuthSession | null = null;
  private readonly allowedRedirectSchemes: Set<string>;
  private readonly tokenExchangeHandler: OidcTokenExchangeHandler;

  constructor(options?: {
    allowedRedirectSchemes?: string[];
    tokenExchangeHandler?: OidcTokenExchangeHandler;
  }) {
    this.allowedRedirectSchemes = new Set(
      options?.allowedRedirectSchemes ?? ['expofoundation', 'myapp', 'https']
    );
    this.tokenExchangeHandler =
      options?.tokenExchangeHandler ??
      (async (params) => ({
        access_token: `oidc_access_${params.clientId}_${Date.now()}`,
        refresh_token: `oidc_refresh_${params.clientId}_${Date.now()}`,
        id_token: `oidc_id_${params.clientId}`,
        expires_in: 3600,
        sub: `oidc_user_${params.clientId}`,
        email: 'user@example.com',
        email_verified: true,
        roles: ['user'],
      }));
  }

  async initialize(config: AuthProviderConfig): Promise<void> {
    const raw = JSON.stringify(config);
    if (/"clientSecret"\s*:/i.test(raw) || /"client_secret"\s*:/i.test(raw)) {
      throw new Error(
        'Security violation: OIDC mobile client must use PKCE without an embedded clientSecret.'
      );
    }
    if (config.redirectUri) {
      this.validateRedirectUri(config.redirectUri);
    }
    this.config = config;
  }

  private ensureConfig(): AuthProviderConfig {
    if (!this.config) {
      throw new Error('OidcAuthProviderAdapter has not been initialized.');
    }
    return this.config;
  }

  validateRedirectUri(redirectUri: string): void {
    const schemeMatch = redirectUri.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
    if (!schemeMatch) {
      throw new Error(`Invalid OIDC redirectUri "${redirectUri}": missing URL scheme.`);
    }
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme === 'http' || scheme === 'javascript' || scheme === 'data') {
      throw new Error(`Unsafe OIDC redirectUri scheme "${scheme}://" is rejected.`);
    }
    if (
      this.allowedRedirectSchemes.size > 0 &&
      !this.allowedRedirectSchemes.has(scheme)
    ) {
      throw new Error(
        `Redirect URI scheme "${scheme}" is not in the configured redirect allowlist.`
      );
    }
  }

  async createAuthorizationRequest(): Promise<OAuthAuthorizationRequest> {
    const cfg = this.ensureConfig();
    const redirectUri = cfg.redirectUri ?? 'expofoundation://auth/callback';
    this.validateRedirectUri(redirectUri);

    const { codeVerifier, codeChallenge, state } = await generatePkcePair();
    const discoveryBase = (cfg.discoveryUrl ?? cfg.baseUrl ?? 'https://idp.example.com').replace(
      /\/+$/,
      ''
    );
    const scopes = (cfg.scopes ?? ['openid', 'profile', 'email']).join(' ');
    const clientId = cfg.clientId ?? 'expo-mobile-client';

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scopes,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return {
      AuthorizationUrl: `${discoveryBase}/authorize?${params.toString()}`,
      state,
      codeVerifier,
      codeChallenge,
      redirectUri,
    };
  }

  async exchangeAuthorizationCode(input: OAuthCodeExchangeInput): Promise<AuthResult> {
    if (!input.state || !input.expectedState || input.state !== input.expectedState) {
      throw new Error('OIDC state validation failed: state mismatch (possible CSRF attack).');
    }
    if (!input.codeVerifier || input.codeVerifier.length < 32) {
      throw new Error('OIDC PKCE validation failed: missing or invalid codeVerifier.');
    }
    this.validateRedirectUri(input.redirectUri);

    const cfg = this.ensureConfig();
    const discoveryBase = (cfg.discoveryUrl ?? cfg.baseUrl ?? 'https://idp.example.com').replace(
      /\/+$/,
      ''
    );
    const tokenResult = await this.tokenExchangeHandler({
      tokenEndpoint: `${discoveryBase}/token`,
      clientId: cfg.clientId ?? 'expo-mobile-client',
      code: input.code,
      codeVerifier: input.codeVerifier,
      redirectUri: input.redirectUri,
      grantType: 'authorization_code',
    });

    const now = Date.now();
    const expiresAt = now + (tokenResult.expires_in ?? 3600) * 1000;
    const user: AuthUser = {
      id: tokenResult.sub ?? 'oidc_user',
      email: tokenResult.email,
      emailVerified: tokenResult.email_verified ?? true,
      roles: tokenResult.roles ?? ['user'],
      permissions: [],
      accountStatus: 'active',
    };

    const session: AuthSession = {
      sessionId: `sess_oidc_${now}`,
      user,
      tokens: {
        accessToken: tokenResult.access_token,
        refreshToken: tokenResult.refresh_token,
        idToken: tokenResult.id_token,
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

  async signIn(_input: SignInInput): Promise<AuthResult> {
    const authReq = await this.createAuthorizationRequest();
    return this.exchangeAuthorizationCode({
      code: `auth_code_${Date.now()}`,
      state: authReq.state,
      expectedState: authReq.state,
      codeVerifier: authReq.codeVerifier,
      redirectUri: authReq.redirectUri,
    });
  }

  async signUp(input: SignUpInput): Promise<AuthResult> {
    return this.signIn(input);
  }

  async signOut(): Promise<void> {
    this.currentSession = null;
  }

  async restoreSession(): Promise<AuthSession | null> {
    return this.currentSession;
  }

  async refreshSession(refreshToken?: string): Promise<AuthSession> {
    const cfg = this.ensureConfig();
    const token = refreshToken ?? this.currentSession?.tokens.refreshToken;
    if (!token) {
      throw new Error('Cannot refresh OIDC session without a refresh token.');
    }
    const discoveryBase = (cfg.discoveryUrl ?? cfg.baseUrl ?? 'https://idp.example.com').replace(
      /\/+$/,
      ''
    );
    const tokenResult = await this.tokenExchangeHandler({
      tokenEndpoint: `${discoveryBase}/token`,
      clientId: cfg.clientId ?? 'expo-mobile-client',
      refreshToken: token,
      grantType: 'refresh_token',
    });

    const now = Date.now();
    const expiresAt = now + (tokenResult.expires_in ?? 3600) * 1000;
    const user: AuthUser = this.currentSession?.user ?? {
      id: tokenResult.sub ?? 'oidc_user',
      email: tokenResult.email,
      emailVerified: true,
      roles: ['user'],
      permissions: [],
    };

    const session: AuthSession = {
      sessionId: `sess_oidc_${now}`,
      user,
      tokens: {
        accessToken: tokenResult.access_token,
        refreshToken: tokenResult.refresh_token ?? token,
        idToken: tokenResult.id_token,
        tokenType: 'Bearer',
        expiresAt,
      },
      provider: 'oidc',
      issuedAt: now,
      expiresAt,
    };
    this.currentSession = session;
    return session;
  }

  async requestPasswordReset(_input: PasswordResetRequest): Promise<void> {
    // Managed by OIDC identity provider hosted UI
  }

  async resetPassword(_input: PasswordResetInput): Promise<void> {
    // Managed by OIDC identity provider hosted UI
  }

  async verifyEmail(_input: EmailVerificationInput): Promise<void> {
    // Managed by OIDC identity provider claims
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    return this.currentSession?.user ?? null;
  }
}
