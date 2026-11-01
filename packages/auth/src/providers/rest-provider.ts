/**
 * @expo-foundation/auth - Configurable REST API Provider Adapter
 *
 * Implements Section 14.3 & Audit Finding 13:
 * - Endpoint mapping for login, register, logout, refresh, me, forgotPassword, resetPassword, verifyEmail, requestOtp, verifyOtp
 * - Request & response field mapping via dot-paths
 * - Fail-closed environment variable resolution (`${env.VAR_NAME}`) — rejects unresolved placeholders
 * - Safe retry policy: retries only idempotent methods or requests with an explicit Idempotency-Key
 * - Strict user claim normalization: never fabricates user IDs, roles, or `emailVerified: true`
 */

import type {
  AuthProviderAdapter,
  AuthProviderCapabilities,
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

export type HttpFetchFn = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const ENV_PLACEHOLDER_REGEX = /\$\{env\.([a-zA-Z0-9_]+)\}/g;

/**
 * Resolves `${env.VAR_NAME}` placeholders against `envMap` or `process.env`.
 * Fails closed by throwing an error if any placeholder remains unresolved (Audit Finding 13).
 */
export function resolveEnvTemplate(
  value: string,
  envMap: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}
): string {
  const unresolved: string[] = [];
  const resolved = value.replace(ENV_PLACEHOLDER_REGEX, (_match, varName: string) => {
    const resolvedVal = envMap[varName];
    if (resolvedVal === undefined || resolvedVal === '') {
      unresolved.push(varName);
      return '';
    }
    return resolvedVal;
  });

  if (unresolved.length > 0) {
    throw new Error(
      `Unresolved environment variable placeholder(s): ${unresolved.map((v) => `\${env.${v}}`).join(', ')}. Configure the environment variable before initializing the Auth provider.`
    );
  }

  return resolved;
}

function getByDotPath(obj: unknown, dotPath?: string): unknown {
  if (!obj || !dotPath) return undefined;
  const parts = dotPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

export class RestAuthProviderAdapter
  implements AuthProviderAdapter, OtpCapability, MfaCapability
{
  readonly providerType = 'rest' as const;
  readonly capabilities: AuthProviderCapabilities = {
    passwordLogin: true,
    registration: true,
    passwordReset: true,
    emailVerification: true,
    phoneAuthentication: true,
    otp: true,
    oauth: false,
    mfa: true,
    biometric: false,
  };

  private config!: AuthProviderConfig;
  private readonly fetchImpl: HttpFetchFn;
  private readonly envMap?: Record<string, string | undefined>;
  private currentSession: AuthSession | null = null;

  constructor(options?: {
    fetchImpl?: HttpFetchFn;
    env?: Record<string, string | undefined>;
  }) {
    this.fetchImpl =
      options?.fetchImpl ?? (globalThis.fetch?.bind(globalThis) as unknown as HttpFetchFn);
    this.envMap = options?.env;
  }

  async initialize(config: AuthProviderConfig): Promise<void> {
    const resolvedBaseUrl = config.baseUrl
      ? resolveEnvTemplate(config.baseUrl, this.envMap)
      : 'https://api.example.com';

    const resolvedHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(config.headers ?? {})) {
      resolvedHeaders[k] = resolveEnvTemplate(v, this.envMap);
    }

    this.config = {
      ...config,
      baseUrl: resolvedBaseUrl.replace(/\/+$/, ''),
      headers: resolvedHeaders,
      timeoutMs: config.timeoutMs ?? 10_000,
    };
  }

  private resolveEndpoint(
    action: string,
    defaultMethod: 'GET' | 'POST',
    defaultPath: string
  ): { method: string; url: string } {
    const configured = this.config.endpoints?.[action];
    const method = configured?.method ?? defaultMethod;
    const rawPath = configured?.path ?? defaultPath;
    const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    return {
      method,
      url: `${this.config.baseUrl}${path}`,
    };
  }

  private async request(
    action: string,
    defaultMethod: 'GET' | 'POST',
    defaultPath: string,
    body?: Record<string, unknown>,
    extraHeaders?: Record<string, string>
  ): Promise<Record<string, unknown>> {
    const { method, url } = this.resolveEndpoint(action, defaultMethod, defaultPath);
    const maxRetries = this.config.retryPolicy?.maxRetries ?? 1;
    const backoffMs = this.config.retryPolicy?.backoffMs ?? 150;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(this.config.headers ?? {}),
      ...(extraHeaders ?? {}),
    };

    if (this.currentSession?.tokens.accessToken) {
      headers.Authorization = `Bearer ${this.currentSession.tokens.accessToken}`;
    }

    // Audit Finding 13: Only retry idempotent methods OR requests carrying an explicit Idempotency-Key
    const isRetrySafe =
      IDEMPOTENT_METHODS.has(method.toUpperCase()) ||
      Boolean(headers['Idempotency-Key'] || headers['idempotency-key']);
    const effectiveMaxRetries = isRetrySafe ? maxRetries : 0;

    let lastError: unknown;
    for (let attempt = 0; attempt <= effectiveMaxRetries; attempt += 1) {
      try {
        const res = await this.fetchImpl(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });

        const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          const message =
            typeof payload.message === 'string'
              ? payload.message
              : `HTTP ${res.status} on ${action}`;
          const error = new Error(message) as Error & { status?: number };
          error.status = res.status;
          throw error;
        }
        return payload;
      } catch (err) {
        lastError = err;
        const status = (err as { status?: number })?.status;
        if (status && status >= 400 && status < 500) {
          throw err;
        }
        if (attempt < effectiveMaxRetries) {
          await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Request "${action}" failed`);
  }

  private normalizeAuthResult(raw: Record<string, unknown>): AuthResult {
    const mapping = this.config.responseMapping ?? {};

    const verificationRequired = Boolean(
      getByDotPath(raw, mapping.verificationRequired ?? 'verificationRequired')
    );
    if (verificationRequired) {
      return {
        status: 'verification_required',
        user: this.extractOptionalUser(raw),
        challenge: {
          challengeId: String(raw.challengeId ?? `chg_${Date.now()}`),
          type: 'email_verification',
          deliveryMedium: 'email',
        },
      };
    }

    const mfaRequired = Boolean(getByDotPath(raw, mapping.mfaRequired ?? 'mfaRequired'));
    if (mfaRequired) {
      return {
        status: 'challenge_required',
        user: this.extractOptionalUser(raw),
        challenge: {
          challengeId: String(raw.challengeId ?? `mfa_${Date.now()}`),
          type: 'mfa',
          deliveryMedium: 'totp',
        },
      };
    }

    const user = this.extractStrictUser(raw);
    if (user.accountStatus === 'suspended') {
      return {
        status: 'account_suspended',
        user,
      };
    }
    if (user.accountStatus === 'disabled') {
      return {
        status: 'account_disabled',
        user,
      };
    }

    const session = this.extractSession(raw, user);
    this.currentSession = session;
    return {
      status: 'authenticated',
      session,
      user: session.user,
    };
  }

  /**
   * Audit Finding 13: Never fabricate user IDs, default roles, or `emailVerified: true`
   * when claims are absent from the server response.
   */
  private extractStrictUser(raw: Record<string, unknown>): AuthUser {
    const mapping = this.config.responseMapping ?? {};
    const rawUser =
      (getByDotPath(raw, mapping.user ?? 'user') as Record<string, unknown> | undefined) ??
      raw;

    const rawId = rawUser.id ?? rawUser.sub ?? rawUser.userId;
    if (typeof rawId !== 'string' && typeof rawId !== 'number') {
      throw new Error(
        'Server authentication response is missing a valid user "id" or "sub" claim.'
      );
    }

    return {
      id: String(rawId),
      email: typeof rawUser.email === 'string' ? rawUser.email : undefined,
      phone: typeof rawUser.phone === 'string' ? rawUser.phone : undefined,
      displayName:
        typeof rawUser.displayName === 'string'
          ? rawUser.displayName
          : typeof rawUser.name === 'string'
            ? rawUser.name
            : undefined,
      emailVerified:
        typeof rawUser.emailVerified === 'boolean' ? rawUser.emailVerified : false,
      phoneVerified:
        typeof rawUser.phoneVerified === 'boolean' ? rawUser.phoneVerified : false,
      roles: Array.isArray(rawUser.roles) ? (rawUser.roles as string[]) : [],
      permissions: Array.isArray(rawUser.permissions)
        ? (rawUser.permissions as string[])
        : [],
      tenantId: typeof rawUser.tenantId === 'string' ? rawUser.tenantId : undefined,
      accountStatus:
        typeof rawUser.accountStatus === 'string' ? rawUser.accountStatus : 'active',
      claims: rawUser,
    };
  }

  private extractOptionalUser(raw: Record<string, unknown>): AuthUser | undefined {
    try {
      return this.extractStrictUser(raw);
    } catch {
      return undefined;
    }
  }

  private extractSession(raw: Record<string, unknown>, verifiedUser?: AuthUser): AuthSession {
    const mapping = this.config.responseMapping ?? {};
    const accessToken = String(
      getByDotPath(raw, mapping.accessToken ?? 'accessToken') ??
        raw.access_token ??
        ''
    );
    if (!accessToken) {
      throw new Error('Authentication response did not include an accessToken.');
    }

    const refreshTokenRaw =
      getByDotPath(raw, mapping.refreshToken ?? 'refreshToken') ?? raw.refresh_token;
    const idTokenRaw = getByDotPath(raw, mapping.idToken ?? 'idToken') ?? raw.id_token;
    const expiresInSeconds = Number(
      getByDotPath(raw, mapping.expiresIn ?? 'expiresIn') ?? raw.expires_in ?? 3600
    );

    const now = Date.now();
    const expiresAt = now + expiresInSeconds * 1000;
    const user = verifiedUser ?? this.extractStrictUser(raw);

    return {
      sessionId: String(raw.sessionId ?? `sess_${user.id}_${now}`),
      user,
      tokens: {
        accessToken,
        refreshToken: refreshTokenRaw ? String(refreshTokenRaw) : undefined,
        idToken: idTokenRaw ? String(idTokenRaw) : undefined,
        tokenType: 'Bearer',
        expiresAt,
      },
      provider: 'rest',
      issuedAt: now,
      expiresAt,
      tenantId: user.tenantId,
    };
  }

  async signIn(input: SignInInput): Promise<AuthResult> {
    const headers = input.idempotencyKey
      ? { 'Idempotency-Key': input.idempotencyKey }
      : undefined;
    const raw = await this.request(
      'login',
      'POST',
      '/auth/login',
      input as unknown as Record<string, unknown>,
      headers
    );
    return this.normalizeAuthResult(raw);
  }

  async signUp(input: SignUpInput): Promise<AuthResult> {
    const headers = input.idempotencyKey
      ? { 'Idempotency-Key': input.idempotencyKey }
      : undefined;
    const raw = await this.request(
      'register',
      'POST',
      '/auth/register',
      input as unknown as Record<string, unknown>,
      headers
    );
    return this.normalizeAuthResult(raw);
  }

  async signOut(): Promise<void> {
    try {
      await this.request('logout', 'POST', '/auth/logout', {});
    } finally {
      this.currentSession = null;
    }
  }

  async restoreSession(): Promise<AuthSession | null> {
    return this.currentSession;
  }

  async refreshSession(refreshToken?: string): Promise<AuthSession> {
    const token = refreshToken ?? this.currentSession?.tokens.refreshToken;
    if (!token) {
      throw new Error('No refresh token available to refresh session.');
    }
    const raw = await this.request('refresh', 'POST', '/auth/refresh', {
      refreshToken: token,
    });
    const session = this.extractSession(raw);
    this.currentSession = session;
    return session;
  }

  async requestPasswordReset(input: PasswordResetRequest): Promise<void> {
    const headers = input.idempotencyKey
      ? { 'Idempotency-Key': input.idempotencyKey }
      : undefined;
    await this.request(
      'forgotPassword',
      'POST',
      '/auth/forgot-password',
      { email: input.email, redirectUrl: input.redirectUrl },
      headers
    );
  }

  async resetPassword(input: PasswordResetInput): Promise<void> {
    const headers = input.idempotencyKey
      ? { 'Idempotency-Key': input.idempotencyKey }
      : undefined;
    await this.request(
      'resetPassword',
      'POST',
      '/auth/reset-password',
      { token: input.token, newPassword: input.newPassword, email: input.email },
      headers
    );
  }

  async verifyEmail(input: EmailVerificationInput): Promise<void> {
    await this.request('verifyEmail', 'POST', '/auth/verify-email', {
      token: input.token,
      code: input.code,
      email: input.email,
    });
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    if (!this.currentSession) return null;
    const raw = await this.request('me', 'GET', '/auth/me');
    return this.extractStrictUser(raw);
  }

  async requestOtp(input: OtpRequest): Promise<{ challengeId: string }> {
    const headers = input.idempotencyKey
      ? { 'Idempotency-Key': input.idempotencyKey }
      : undefined;
    const raw = await this.request(
      'requestOtp',
      'POST',
      '/auth/otp/request',
      {
        channel: input.channel,
        destination: input.destination,
        purpose: input.purpose ?? 'login',
      },
      headers
    );
    return {
      challengeId: String(raw.challengeId ?? `otp_${Date.now()}`),
    };
  }

  async verifyOtp(input: OtpVerification): Promise<AuthResult> {
    const raw = await this.request('verifyOtp', 'POST', '/auth/otp/verify', {
      channel: input.channel,
      destination: input.destination,
      code: input.code,
      challengeId: input.challengeId,
    });
    return this.normalizeAuthResult(raw);
  }

  async beginMfa(): Promise<MfaChallenge> {
    const raw = await this.request('beginMfa', 'POST', '/auth/mfa/begin', {});
    return {
      challengeId: String(raw.challengeId ?? `mfa_${Date.now()}`),
      factors: Array.isArray(raw.factors)
        ? (raw.factors as Array<'totp' | 'sms' | 'backup_code'>)
        : ['totp'],
      expiresAt: Number(raw.expiresAt ?? Date.now() + 300_000),
    };
  }

  async verifyMfa(input: MfaVerifyInput): Promise<AuthResult> {
    const raw = await this.request('verifyMfa', 'POST', '/auth/mfa/verify', {
      challengeId: input.challengeId,
      factor: input.factor,
      code: input.code,
    });
    return this.normalizeAuthResult(raw);
  }
}
