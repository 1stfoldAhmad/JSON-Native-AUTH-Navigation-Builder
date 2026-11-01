import type {
  AuthProviderAdapter,
  AuthProviderConfig,
  AuthResult,
  AuthSession,
  AuthUser,
  EmailVerificationInput,
  MfaCapability,
  MfaChallenge,
  MfaVerifyInput,
  OtpCapability,
  OtpRequest,
  OtpVerification,
  PasswordResetInput,
  PasswordResetRequest,
  SignInInput,
  SignUpInput,
} from '@expo-foundation/contracts';
import {
  extractByJsonPath,
  interpolateEnvString,
  mapRequestPayload,
} from './json-path.js';

export interface RestHttpRequest {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
}

export interface RestHttpResponse {
  status: number;
  ok: boolean;
  data: unknown;
}

export type RestHttpClient = (req: RestHttpRequest) => Promise<RestHttpResponse>;

const defaultFetchHttpClient: RestHttpClient = async (req) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);
  try {
    const response = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }
    }
    return {
      status: response.status,
      ok: response.ok,
      data,
    };
  } finally {
    clearTimeout(timer);
  }
};

export class RestAuthProviderAdapter
  implements AuthProviderAdapter, OtpCapability, MfaCapability
{
  readonly providerType = 'rest' as const;
  private config: AuthProviderConfig | null = null;
  private currentSession: AuthSession | null = null;
  private readonly httpClient: RestHttpClient;
  private readonly env: Record<string, string | undefined>;

  constructor(options?: {
    httpClient?: RestHttpClient;
    env?: Record<string, string | undefined>;
  }) {
    this.httpClient = options?.httpClient ?? defaultFetchHttpClient;
    this.env = options?.env ?? {};
  }

  async initialize(config: AuthProviderConfig): Promise<void> {
    if (config.options && ('clientSecret' in config.options || 'privateKey' in config.options)) {
      throw new Error('Security violation: clientSecret/privateKey cannot be configured in mobile REST adapter.');
    }
    this.config = config;
  }

  private ensureConfig(): AuthProviderConfig {
    if (!this.config) {
      throw new Error('RestAuthProviderAdapter has not been initialized.');
    }
    return this.config;
  }

  private resolveUrl(endpointKey: string, defaultPath: string): {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: string;
  } {
    const cfg = this.ensureConfig();
    const rawBase = cfg.baseUrl ?? 'https://api.example.com';
    const baseUrl = interpolateEnvString(rawBase, this.env).replace(/\/+$/, '');
    const ep = cfg.endpoints?.[endpointKey] ?? { method: 'POST', path: defaultPath };
    const cleanPath = ep.path.startsWith('/') ? ep.path : `/${ep.path}`;
    return {
      method: ep.method,
      url: `${baseUrl}${cleanPath}`,
    };
  }

  private async requestWithRetry(
    endpointKey: string,
    defaultPath: string,
    payload?: Record<string, unknown>
  ): Promise<unknown> {
    const cfg = this.ensureConfig();
    const { method, url } = this.resolveUrl(endpointKey, defaultPath);
    const mappedBody = payload
      ? mapRequestPayload(payload, cfg.requestMapping?.[endpointKey])
      : undefined;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(cfg.headers ?? {}),
    };
    if (this.currentSession?.tokens.accessToken) {
      headers.Authorization = `Bearer ${this.currentSession.tokens.accessToken}`;
    }

    const maxRetries = cfg.retryPolicy?.maxRetries ?? 1;
    const backoffMs = cfg.retryPolicy?.backoffMs ?? 50;
    const timeoutMs = cfg.timeoutMs ?? 10000;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.httpClient({
          url,
          method,
          headers,
          body: method === 'GET' ? undefined : mappedBody,
          timeoutMs,
        });
        if (!response.ok) {
          const errMessage =
            typeof response.data === 'object' &&
            response.data !== null &&
            'message' in response.data
              ? String((response.data as Record<string, unknown>).message)
              : `HTTP ${response.status} on ${endpointKey}`;
          const error = new Error(errMessage) as Error & { status?: number };
          error.status = response.status;
          if (response.status >= 400 && response.status < 500) {
            throw error;
          }
          lastError = error;
        } else {
          return response.data;
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const status = (error as { status?: number }).status;
        if (status && status >= 400 && status < 500) {
          throw error;
        }
        lastError = error;
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs * (attempt + 1)));
      }
    }

    throw lastError ?? new Error(`Request to ${endpointKey} failed.`);
  }

  private mapResponseToAuthResult(raw: unknown): AuthResult {
    const cfg = this.ensureConfig();
    const mapping = {
      accessToken: cfg.responseMapping?.accessToken ?? '$.data.access_token',
      refreshToken: cfg.responseMapping?.refreshToken ?? '$.data.refresh_token',
      idToken: cfg.responseMapping?.idToken ?? '$.data.id_token',
      user: cfg.responseMapping?.user ?? '$.data.user',
      expiresIn: cfg.responseMapping?.expiresIn ?? '$.data.expires_in',
      verificationRequired:
        cfg.responseMapping?.verificationRequired ?? '$.data.verification_required',
      mfaRequired: cfg.responseMapping?.mfaRequired ?? '$.data.mfa_required',
    };

    const userRaw = extractByJsonPath<Record<string, unknown>>(raw, mapping.user);
    const verificationRequired = extractByJsonPath<boolean>(raw, mapping.verificationRequired);
    const mfaRequired = extractByJsonPath<boolean>(raw, mapping.mfaRequired);

    const user: AuthUser = {
      id: String(userRaw?.id ?? 'user_unknown'),
      email: typeof userRaw?.email === 'string' ? userRaw.email : undefined,
      phone: typeof userRaw?.phone === 'string' ? userRaw.phone : undefined,
      displayName:
        typeof userRaw?.displayName === 'string'
          ? userRaw.displayName
          : typeof userRaw?.name === 'string'
            ? userRaw.name
            : undefined,
      emailVerified:
        typeof userRaw?.emailVerified === 'boolean'
          ? userRaw.emailVerified
          : !verificationRequired,
      roles: Array.isArray(userRaw?.roles) ? (userRaw.roles as string[]) : ['user'],
      permissions: Array.isArray(userRaw?.permissions)
        ? (userRaw.permissions as string[])
        : [],
      tenantId: typeof userRaw?.tenantId === 'string' ? userRaw.tenantId : undefined,
      accountStatus:
        typeof userRaw?.accountStatus === 'string' ? userRaw.accountStatus : 'active',
      claims:
        typeof userRaw?.claims === 'object' && userRaw.claims !== null
          ? (userRaw.claims as Record<string, unknown>)
          : undefined,
    };

    if (user.accountStatus === 'suspended') {
      return {
        status: 'account_suspended',
        user,
      };
    }

    if (mfaRequired) {
      return {
        status: 'challenge_required',
        user,
        challenge: {
          challengeId: `mfa_${Date.now()}`,
          type: 'mfa',
          deliveryMedium: 'totp',
        },
      };
    }

    if (verificationRequired) {
      return {
        status: 'verification_required',
        user,
        challenge: {
          challengeId: `verify_${Date.now()}`,
          type: 'email_verification',
          deliveryMedium: 'email',
          destinationHint: user.email,
        },
      };
    }

    const accessToken = extractByJsonPath<string>(raw, mapping.accessToken);
    if (!accessToken) {
      throw new Error(
        `Token extraction failed: "${mapping.accessToken}" was not present in provider response.`
      );
    }
    const refreshToken = extractByJsonPath<string>(raw, mapping.refreshToken);
    const idToken = extractByJsonPath<string>(raw, mapping.idToken);
    const expiresInSeconds =
      Number(extractByJsonPath<number | string>(raw, mapping.expiresIn)) || 3600;

    const now = Date.now();
    const expiresAt = now + expiresInSeconds * 1000;

    const session: AuthSession = {
      sessionId: `sess_${user.id}_${now}`,
      user,
      tokens: {
        accessToken,
        refreshToken,
        idToken,
        tokenType: 'Bearer',
        expiresAt,
      },
      provider: 'rest',
      issuedAt: now,
      expiresAt,
      tenantId: user.tenantId,
    };

    this.currentSession = session;
    return {
      status: 'authenticated',
      session,
      user,
    };
  }

  async signIn(input: SignInInput): Promise<AuthResult> {
    const raw = await this.requestWithRetry(
      'login',
      '/auth/login',
      input as unknown as Record<string, unknown>
    );
    return this.mapResponseToAuthResult(raw);
  }

  async signUp(input: SignUpInput): Promise<AuthResult> {
    const raw = await this.requestWithRetry(
      'register',
      '/auth/register',
      input as unknown as Record<string, unknown>
    );
    return this.mapResponseToAuthResult(raw);
  }

  async signOut(): Promise<void> {
    try {
      await this.requestWithRetry('logout', '/auth/logout', {});
    } finally {
      this.currentSession = null;
    }
  }

  async restoreSession(): Promise<AuthSession | null> {
    return this.currentSession;
  }

  async refreshSession(refreshToken?: string): Promise<AuthSession> {
    const tokenToUse = refreshToken ?? this.currentSession?.tokens.refreshToken;
    if (!tokenToUse) {
      throw new Error('Cannot refresh session: no refresh token available.');
    }
    const raw = await this.requestWithRetry('refresh', '/auth/refresh', {
      refreshToken: tokenToUse,
    });
    const result = this.mapResponseToAuthResult(raw);
    if (!result.session) {
      throw new Error('Refresh response did not yield an authenticated session.');
    }
    return result.session;
  }

  async requestPasswordReset(input: PasswordResetRequest): Promise<void> {
    await this.requestWithRetry(
      'forgotPassword',
      '/auth/forgot-password',
      input as unknown as Record<string, unknown>
    );
  }

  async resetPassword(input: PasswordResetInput): Promise<void> {
    await this.requestWithRetry(
      'resetPassword',
      '/auth/reset-password',
      input as unknown as Record<string, unknown>
    );
  }

  async verifyEmail(input: EmailVerificationInput): Promise<void> {
    await this.requestWithRetry(
      'verifyEmail',
      '/auth/verify-email',
      input as unknown as Record<string, unknown>
    );
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    return this.currentSession?.user ?? null;
  }

  async requestOtp(input: OtpRequest): Promise<{ challengeId: string }> {
    const raw = (await this.requestWithRetry(
      'requestOtp',
      '/auth/otp/request',
      input as unknown as Record<string, unknown>
    )) as Record<string, unknown> | undefined;
    return {
      challengeId: String(
        (raw?.data as Record<string, unknown>)?.challengeId ?? `otp_${Date.now()}`
      ),
    };
  }

  async verifyOtp(input: OtpVerification): Promise<AuthResult> {
    const raw = await this.requestWithRetry(
      'verifyOtp',
      '/auth/otp/verify',
      input as unknown as Record<string, unknown>
    );
    return this.mapResponseToAuthResult(raw);
  }

  async beginMfa(): Promise<MfaChallenge> {
    return {
      challengeId: `mfa_${Date.now()}`,
      factors: ['totp', 'sms'],
      expiresAt: Date.now() + 300_000,
    };
  }

  async verifyMfa(input: MfaVerifyInput): Promise<AuthResult> {
    const raw = await this.requestWithRetry(
      'verifyMfa',
      '/auth/mfa/verify',
      input as unknown as Record<string, unknown>
    );
    return this.mapResponseToAuthResult(raw);
  }
}
