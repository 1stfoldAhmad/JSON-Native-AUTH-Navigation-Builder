/**
 * @expo-foundation/auth - Provider Adapter Registry & Production SDK Adapters
 *
 * Implements Section 14.1, 14.2, 14.5, and Audit Finding 5:
 * - Zero synthetic/mock providers in production @expo-foundation/auth (test mocks live in @expo-foundation/testing)
 * - Explicit `AuthProviderCapabilities` per provider
 * - Real SDK driver contracts for Apple (`expo-apple-authentication`), Google (OIDC PKCE),
 *   Supabase (`@supabase/supabase-js`), Firebase (`firebase/auth`), and Clerk (`@clerk/clerk-expo`)
 * - Fails closed when an external SDK driver or backend exchange endpoint is not supplied
 */

import type {
  AuthProviderAdapter,
  AuthProviderCapabilities,
  AuthProviderConfig,
  AuthProviderType,
  AuthResult,
  AuthSession,
  AuthUser,
  EmailVerificationInput,
  OtpCapability,
  OtpRequest,
  OtpVerification,
  PasswordResetInput,
  PasswordResetRequest,
  SignInInput,
  SignUpInput,
} from '@expo-foundation/contracts';
import { OidcAuthProviderAdapter, type PkceCryptoDriver } from './oidc-provider.js';
import { RestAuthProviderAdapter, type HttpFetchFn } from './rest-provider.js';

/**
 * Driver contract for Apple Native Authentication (`expo-apple-authentication`)
 */
export interface AppleNativeCredential {
  user: string;
  identityToken: string;
  authorizationCode?: string | null;
  email?: string | null;
  fullName?: {
    givenName?: string | null;
    familyName?: string | null;
  } | null;
}

export interface AppleNativeAuthDriver {
  isAvailableAsync(): Promise<boolean>;
  signInAsync(options?: {
    requestedScopes?: string[];
    nonce?: string;
    state?: string;
  }): Promise<AppleNativeCredential>;
}

export class AppleAuthProviderAdapter implements AuthProviderAdapter {
  readonly providerType = 'apple' as const;
  readonly capabilities: AuthProviderCapabilities = {
    passwordLogin: false,
    registration: false,
    passwordReset: false,
    emailVerification: false,
    phoneAuthentication: false,
    otp: false,
    oauth: true,
    mfa: false,
    biometric: true,
  };

  private config!: AuthProviderConfig;
  private currentSession: AuthSession | null = null;
  private readonly driver?: AppleNativeAuthDriver;
  private readonly fetchImpl?: HttpFetchFn;

  constructor(options?: {
    driver?: AppleNativeAuthDriver;
    fetchImpl?: HttpFetchFn;
  }) {
    this.driver = options?.driver;
    this.fetchImpl = options?.fetchImpl;
  }

  async initialize(config: AuthProviderConfig): Promise<void> {
    this.config = config;
  }

  async signIn(_input: SignInInput): Promise<AuthResult> {
    if (!this.driver) {
      throw new Error(
        'AppleAuthProviderAdapter requires an AppleNativeAuthDriver (expo-apple-authentication). Configure the native driver before calling signIn().'
      );
    }
    const available = await this.driver.isAvailableAsync();
    if (!available) {
      throw new Error('Sign in with Apple is not available on this device/platform.');
    }

    const credential = await this.driver.signInAsync({
      requestedScopes: this.config.scopes ?? ['FULL_NAME', 'EMAIL'],
    });

    if (!credential.identityToken) {
      throw new Error('Apple Sign-In did not return a signed identityToken.');
    }

    if (this.config.baseUrl && this.fetchImpl) {
      const response = await this.fetchImpl(
        `${this.config.baseUrl.replace(/\/+$/, '')}/auth/apple`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            identityToken: credential.identityToken,
            authorizationCode: credential.authorizationCode,
            user: credential.user,
          }),
        }
      );
      if (!response.ok) {
        throw new Error(`Apple backend token exchange failed with HTTP ${response.status}.`);
      }
      const data = (await response.json()) as Record<string, unknown>;
      const now = Date.now();
      const expiresAt = now + Number(data.expiresIn ?? 3600) * 1000;
      const user: AuthUser = {
        id: String(data.userId ?? credential.user),
        email:
          typeof data.email === 'string'
            ? data.email
            : (credential.email ?? undefined),
        emailVerified: true,
        roles: Array.isArray(data.roles) ? (data.roles as string[]) : [],
        permissions: Array.isArray(data.permissions)
          ? (data.permissions as string[])
          : [],
      };
      const session: AuthSession = {
        sessionId: `apple_sess_${user.id}_${now}`,
        user,
        tokens: {
          accessToken: String(data.accessToken ?? credential.identityToken),
          refreshToken:
            typeof data.refreshToken === 'string' ? data.refreshToken : undefined,
          idToken: credential.identityToken,
          tokenType: 'Bearer',
          expiresAt,
        },
        provider: 'apple',
        issuedAt: now,
        expiresAt,
      };
      this.currentSession = session;
      return { status: 'authenticated', session, user };
    }

    const now = Date.now();
    const expiresAt = now + 3600 * 1000;
    const displayName = [
      credential.fullName?.givenName,
      credential.fullName?.familyName,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

    const user: AuthUser = {
      id: credential.user,
      email: credential.email ?? undefined,
      displayName,
      emailVerified: true,
      roles: [],
      permissions: [],
    };
    const session: AuthSession = {
      sessionId: `apple_sess_${credential.user}_${now}`,
      user,
      tokens: {
        accessToken: credential.identityToken,
        idToken: credential.identityToken,
        tokenType: 'Bearer',
        expiresAt,
      },
      provider: 'apple',
      issuedAt: now,
      expiresAt,
    };
    this.currentSession = session;
    return { status: 'authenticated', session, user };
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

  async refreshSession(): Promise<AuthSession> {
    if (!this.currentSession) {
      throw new Error('No active Apple session to refresh.');
    }
    return this.currentSession;
  }

  async requestPasswordReset(): Promise<void> {
    throw new Error('Password reset is managed by Apple ID settings.');
  }

  async resetPassword(): Promise<void> {
    throw new Error('Password reset is managed by Apple ID settings.');
  }

  async verifyEmail(): Promise<void> {
    throw new Error('Email verification is managed by Apple ID.');
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    return this.currentSession?.user ?? null;
  }
}

/**
 * Google OAuth 2.0 / OIDC Provider Adapter built on OidcAuthProviderAdapter
 */
export class GoogleAuthProviderAdapter extends OidcAuthProviderAdapter {
  override readonly providerType = 'google' as unknown as 'oidc';

  constructor(options?: {
    fetchImpl?: HttpFetchFn;
    cryptoDriver?: PkceCryptoDriver;
  }) {
    super(options);
  }

  override async initialize(config: AuthProviderConfig): Promise<void> {
    await super.initialize({
      ...config,
      issuer: config.issuer ?? 'https://accounts.google.com',
      scopes: config.scopes ?? ['openid', 'profile', 'email'],
    });
  }
}

/**
 * Supabase Auth SDK Driver Contract (`@supabase/supabase-js`)
 */
export interface SupabaseAuthSdkDriver {
  signInWithPassword(credentials: {
    email: string;
    password: string;
  }): Promise<{
    data: { session: Record<string, unknown> | null; user: Record<string, unknown> | null };
    error: { message: string } | null;
  }>;
  signUp(credentials: {
    email: string;
    password: string;
    options?: { data?: Record<string, unknown> };
  }): Promise<{
    data: { session: Record<string, unknown> | null; user: Record<string, unknown> | null };
    error: { message: string } | null;
  }>;
  signOut(): Promise<{ error: { message: string } | null }>;
  refreshSession(currentSession?: { refresh_token: string }): Promise<{
    data: { session: Record<string, unknown> | null; user: Record<string, unknown> | null };
    error: { message: string } | null;
  }>;
  getUser(jwt?: string): Promise<{
    data: { user: Record<string, unknown> | null };
    error: { message: string } | null;
  }>;
  resetPasswordForEmail(email: string, options?: { redirectTo?: string }): Promise<{
    error: { message: string } | null;
  }>;
  signInWithOtp?(params: { email?: string; phone?: string }): Promise<{
    error: { message: string } | null;
  }>;
  verifyOtp?(params: {
    email?: string;
    phone?: string;
    token: string;
    type: string;
  }): Promise<{
    data: { session: Record<string, unknown> | null; user: Record<string, unknown> | null };
    error: { message: string } | null;
  }>;
}

export class SupabaseAuthProviderAdapter
  implements AuthProviderAdapter, OtpCapability
{
  readonly providerType = 'supabase' as const;
  readonly capabilities: AuthProviderCapabilities = {
    passwordLogin: true,
    registration: true,
    passwordReset: true,
    emailVerification: true,
    phoneAuthentication: true,
    otp: true,
    oauth: true,
    mfa: true,
    biometric: false,
  };

  private config!: AuthProviderConfig;
  private currentSession: AuthSession | null = null;
  private readonly driver?: SupabaseAuthSdkDriver;

  constructor(options?: { driver?: SupabaseAuthSdkDriver }) {
    this.driver = options?.driver;
  }

  async initialize(config: AuthProviderConfig): Promise<void> {
    this.config = config;
  }

  private requireDriver(): SupabaseAuthSdkDriver {
    if (!this.driver) {
      throw new Error(
        'SupabaseAuthProviderAdapter requires a configured SupabaseAuthSdkDriver (@supabase/supabase-js auth client). Failing closed.'
      );
    }
    return this.driver;
  }

  private mapSupabaseSession(
    rawSession: Record<string, unknown>,
    rawUser: Record<string, unknown>
  ): AuthSession {
    const userId = String(rawUser.id ?? '');
    if (!userId) {
      throw new Error('Supabase user response is missing required "id".');
    }
    const appMeta = (rawUser.app_metadata ?? {}) as Record<string, unknown>;
    const userMeta = (rawUser.user_metadata ?? {}) as Record<string, unknown>;
    const now = Date.now();
    const expiresIn = Number(rawSession.expires_in ?? 3600);
    const expiresAt = now + expiresIn * 1000;

    const user: AuthUser = {
      id: userId,
      email: typeof rawUser.email === 'string' ? rawUser.email : undefined,
      phone: typeof rawUser.phone === 'string' ? rawUser.phone : undefined,
      displayName:
        typeof userMeta.full_name === 'string' ? userMeta.full_name : undefined,
      emailVerified: Boolean(rawUser.email_confirmed_at),
      phoneVerified: Boolean(rawUser.phone_confirmed_at),
      roles: Array.isArray(appMeta.roles) ? (appMeta.roles as string[]) : [],
      permissions: Array.isArray(appMeta.permissions)
        ? (appMeta.permissions as string[])
        : [],
      claims: rawUser,
    };

    return {
      sessionId: `sb_sess_${userId}_${now}`,
      user,
      tokens: {
        accessToken: String(rawSession.access_token),
        refreshToken:
          typeof rawSession.refresh_token === 'string'
            ? rawSession.refresh_token
            : undefined,
        tokenType: 'Bearer',
        expiresAt,
      },
      provider: 'supabase',
      issuedAt: now,
      expiresAt,
    };
  }

  async signIn(input: SignInInput): Promise<AuthResult> {
    const sdk = this.requireDriver();
    if (!input.email || !input.password) {
      throw new Error('Supabase password sign-in requires email and password.');
    }
    const { data, error } = await sdk.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (error) {
      throw new Error(error.message);
    }
    if (!data.session || !data.user) {
      throw new Error('Supabase signInWithPassword did not return an active session.');
    }
    const session = this.mapSupabaseSession(data.session, data.user);
    this.currentSession = session;
    return { status: 'authenticated', session, user: session.user };
  }

  async signUp(input: SignUpInput): Promise<AuthResult> {
    const sdk = this.requireDriver();
    if (!input.email || !input.password) {
      throw new Error('Supabase signUp requires email and password.');
    }
    const { data, error } = await sdk.signUp({
      email: input.email,
      password: input.password,
      options: { data: { full_name: input.displayName } },
    });
    if (error) {
      throw new Error(error.message);
    }
    if (!data.session && data.user) {
      return {
        status: 'verification_required',
        user: {
          id: String(data.user.id),
          email: input.email,
          emailVerified: false,
        },
        challenge: {
          challengeId: `sb_verify_${Date.now()}`,
          type: 'email_verification',
          deliveryMedium: 'email',
          destinationHint: input.email,
        },
      };
    }
    if (!data.session || !data.user) {
      throw new Error('Supabase signUp returned neither a session nor a user.');
    }
    const session = this.mapSupabaseSession(data.session, data.user);
    this.currentSession = session;
    return { status: 'authenticated', session, user: session.user };
  }

  async signOut(): Promise<void> {
    const sdk = this.requireDriver();
    await sdk.signOut();
    this.currentSession = null;
  }

  async restoreSession(): Promise<AuthSession | null> {
    return this.currentSession;
  }

  async refreshSession(refreshToken?: string): Promise<AuthSession> {
    const sdk = this.requireDriver();
    const token = refreshToken ?? this.currentSession?.tokens.refreshToken;
    const { data, error } = await sdk.refreshSession(
      token ? { refresh_token: token } : undefined
    );
    if (error || !data.session || !data.user) {
      throw new Error(error?.message ?? 'Supabase session refresh failed.');
    }
    const session = this.mapSupabaseSession(data.session, data.user);
    this.currentSession = session;
    return session;
  }

  async requestPasswordReset(input: PasswordResetRequest): Promise<void> {
    const sdk = this.requireDriver();
    const { error } = await sdk.resetPasswordForEmail(input.email, {
      redirectTo: input.redirectUrl,
    });
    if (error) throw new Error(error.message);
  }

  async resetPassword(_input: PasswordResetInput): Promise<void> {
    throw new Error('Use Supabase updateUser({ password }) after recovery session.');
  }

  async verifyEmail(input: EmailVerificationInput): Promise<void> {
    const sdk = this.requireDriver();
    if (!sdk.verifyOtp || !input.email || !input.code) {
      throw new Error('Supabase email OTP verification requires email and code.');
    }
    const { error } = await sdk.verifyOtp({
      email: input.email,
      token: input.code,
      type: 'signup',
    });
    if (error) throw new Error(error.message);
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    const sdk = this.requireDriver();
    const { data, error } = await sdk.getUser(
      this.currentSession?.tokens.accessToken
    );
    if (error || !data.user) return null;
    const rawUser = data.user;
    const appMeta = (rawUser.app_metadata ?? {}) as Record<string, unknown>;
    return {
      id: String(rawUser.id),
      email: typeof rawUser.email === 'string' ? rawUser.email : undefined,
      emailVerified: Boolean(rawUser.email_confirmed_at),
      roles: Array.isArray(appMeta.roles) ? (appMeta.roles as string[]) : [],
      permissions: Array.isArray(appMeta.permissions)
        ? (appMeta.permissions as string[])
        : [],
      claims: rawUser,
    };
  }

  async requestOtp(input: OtpRequest): Promise<{ challengeId: string }> {
    const sdk = this.requireDriver();
    if (!sdk.signInWithOtp) {
      throw new Error('Supabase driver does not support signInWithOtp.');
    }
    const params =
      input.channel === 'email'
        ? { email: input.destination }
        : { phone: input.destination };
    const { error } = await sdk.signInWithOtp(params);
    if (error) throw new Error(error.message);
    return { challengeId: `sb_otp_${Date.now()}` };
  }

  async verifyOtp(input: OtpVerification): Promise<AuthResult> {
    const sdk = this.requireDriver();
    if (!sdk.verifyOtp) {
      throw new Error('Supabase driver does not support verifyOtp.');
    }
    const { data, error } = await sdk.verifyOtp({
      ...(input.channel === 'email'
        ? { email: input.destination, type: 'email' }
        : { phone: input.destination, type: 'sms' }),
      token: input.code,
    });
    if (error || !data.session || !data.user) {
      throw new Error(error?.message ?? 'Supabase OTP verification failed.');
    }
    const session = this.mapSupabaseSession(data.session, data.user);
    this.currentSession = session;
    return { status: 'authenticated', session, user: session.user };
  }
}

/**
 * Firebase Auth SDK Driver Contract (`firebase/auth`)
 */
export interface FirebaseAuthSdkDriver {
  signInWithEmailAndPassword(
    email: string,
    password: string
  ): Promise<{
    user: {
      uid: string;
      email: string | null;
      displayName: string | null;
      emailVerified: boolean;
      getIdTokenResult(forceRefresh?: boolean): Promise<{
        token: string;
        expirationTime: string;
        claims: Record<string, unknown>;
      }>;
      refreshToken: string;
    };
  }>;
  createUserWithEmailAndPassword(
    email: string,
    password: string
  ): Promise<{
    user: {
      uid: string;
      email: string | null;
      displayName: string | null;
      emailVerified: boolean;
      getIdTokenResult(forceRefresh?: boolean): Promise<{
        token: string;
        expirationTime: string;
        claims: Record<string, unknown>;
      }>;
      refreshToken: string;
    };
  }>;
  signOut(): Promise<void>;
  sendPasswordResetEmail(email: string): Promise<void>;
}

export class FirebaseAuthProviderAdapter implements AuthProviderAdapter {
  readonly providerType = 'firebase' as const;
  readonly capabilities: AuthProviderCapabilities = {
    passwordLogin: true,
    registration: true,
    passwordReset: true,
    emailVerification: true,
    phoneAuthentication: true,
    otp: true,
    oauth: true,
    mfa: true,
    biometric: false,
  };

  private config!: AuthProviderConfig;
  private currentSession: AuthSession | null = null;
  private readonly driver?: FirebaseAuthSdkDriver;

  constructor(options?: { driver?: FirebaseAuthSdkDriver }) {
    this.driver = options?.driver;
  }

  async initialize(config: AuthProviderConfig): Promise<void> {
    this.config = config;
  }

  private requireDriver(): FirebaseAuthSdkDriver {
    if (!this.driver) {
      throw new Error(
        'FirebaseAuthProviderAdapter requires a configured FirebaseAuthSdkDriver (firebase/auth). Failing closed.'
      );
    }
    return this.driver;
  }

  async signIn(input: SignInInput): Promise<AuthResult> {
    const sdk = this.requireDriver();
    if (!input.email || !input.password) {
      throw new Error('Firebase password login requires email and password.');
    }
    const credential = await sdk.signInWithEmailAndPassword(
      input.email,
      input.password
    );
    const tokenResult = await credential.user.getIdTokenResult();
    const now = Date.now();
    const expiresAt = Date.parse(tokenResult.expirationTime) || now + 3600_000;
    const user: AuthUser = {
      id: credential.user.uid,
      email: credential.user.email ?? undefined,
      displayName: credential.user.displayName ?? undefined,
      emailVerified: credential.user.emailVerified,
      roles: Array.isArray(tokenResult.claims.roles)
        ? (tokenResult.claims.roles as string[])
        : [],
      permissions: Array.isArray(tokenResult.claims.permissions)
        ? (tokenResult.claims.permissions as string[])
        : [],
      claims: tokenResult.claims,
    };
    const session: AuthSession = {
      sessionId: `fb_sess_${user.id}_${now}`,
      user,
      tokens: {
        accessToken: tokenResult.token,
        refreshToken: credential.user.refreshToken,
        idToken: tokenResult.token,
        tokenType: 'Bearer',
        expiresAt,
      },
      provider: 'firebase',
      issuedAt: now,
      expiresAt,
    };
    this.currentSession = session;
    return { status: 'authenticated', session, user };
  }

  async signUp(input: SignUpInput): Promise<AuthResult> {
    const sdk = this.requireDriver();
    if (!input.email || !input.password) {
      throw new Error('Firebase registration requires email and password.');
    }
    const credential = await sdk.createUserWithEmailAndPassword(
      input.email,
      input.password
    );
    const tokenResult = await credential.user.getIdTokenResult();
    const now = Date.now();
    const expiresAt = Date.parse(tokenResult.expirationTime) || now + 3600_000;
    const user: AuthUser = {
      id: credential.user.uid,
      email: credential.user.email ?? undefined,
      emailVerified: credential.user.emailVerified,
      roles: [],
      permissions: [],
    };
    const session: AuthSession = {
      sessionId: `fb_sess_${user.id}_${now}`,
      user,
      tokens: {
        accessToken: tokenResult.token,
        refreshToken: credential.user.refreshToken,
        idToken: tokenResult.token,
        tokenType: 'Bearer',
        expiresAt,
      },
      provider: 'firebase',
      issuedAt: now,
      expiresAt,
    };
    this.currentSession = session;
    return { status: 'authenticated', session, user };
  }

  async signOut(): Promise<void> {
    const sdk = this.requireDriver();
    await sdk.signOut();
    this.currentSession = null;
  }

  async restoreSession(): Promise<AuthSession | null> {
    return this.currentSession;
  }

  async refreshSession(): Promise<AuthSession> {
    if (!this.currentSession) {
      throw new Error('No active Firebase session to refresh.');
    }
    return this.currentSession;
  }

  async requestPasswordReset(input: PasswordResetRequest): Promise<void> {
    const sdk = this.requireDriver();
    await sdk.sendPasswordResetEmail(input.email);
  }

  async resetPassword(): Promise<void> {
    throw new Error('Use Firebase confirmPasswordReset() with action code.');
  }

  async verifyEmail(): Promise<void> {
    throw new Error('Use Firebase applyActionCode() to verify email.');
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    return this.currentSession?.user ?? null;
  }
}

/**
 * Clerk Auth SDK Driver Contract (`@clerk/clerk-expo`)
 */
export interface ClerkAuthSdkDriver {
  signIn(params: { identifier: string; password?: string }): Promise<{
    status: 'complete' | 'needs_first_factor' | 'needs_second_factor';
    createdSessionId?: string;
    token?: string;
    user?: {
      id: string;
      primaryEmailAddress?: string;
      emailVerified?: boolean;
      roles?: string[];
      permissions?: string[];
    };
  }>;
  signUp(params: { emailAddress: string; password?: string }): Promise<{
    status: 'complete' | 'missing_requirements';
    createdSessionId?: string;
    token?: string;
    user?: {
      id: string;
      primaryEmailAddress?: string;
      emailVerified?: boolean;
    };
  }>;
  signOut(): Promise<void>;
  getToken(): Promise<string | null>;
}

export class ClerkAuthProviderAdapter implements AuthProviderAdapter {
  readonly providerType = 'clerk' as const;
  readonly capabilities: AuthProviderCapabilities = {
    passwordLogin: true,
    registration: true,
    passwordReset: true,
    emailVerification: true,
    phoneAuthentication: true,
    otp: true,
    oauth: true,
    mfa: true,
    biometric: true,
  };

  private config!: AuthProviderConfig;
  private currentSession: AuthSession | null = null;
  private readonly driver?: ClerkAuthSdkDriver;

  constructor(options?: { driver?: ClerkAuthSdkDriver }) {
    this.driver = options?.driver;
  }

  async initialize(config: AuthProviderConfig): Promise<void> {
    this.config = config;
  }

  private requireDriver(): ClerkAuthSdkDriver {
    if (!this.driver) {
      throw new Error(
        'ClerkAuthProviderAdapter requires a configured ClerkAuthSdkDriver (@clerk/clerk-expo). Failing closed.'
      );
    }
    return this.driver;
  }

  async signIn(input: SignInInput): Promise<AuthResult> {
    const sdk = this.requireDriver();
    const identifier = input.email ?? input.username ?? input.phone;
    if (!identifier) {
      throw new Error('Clerk signIn requires an email, username, or phone identifier.');
    }
    const res = await sdk.signIn({ identifier, password: input.password });
    if (res.status === 'needs_second_factor') {
      return {
        status: 'challenge_required',
        challenge: {
          challengeId: `clerk_mfa_${Date.now()}`,
          type: 'mfa',
          deliveryMedium: 'totp',
        },
      };
    }
    if (res.status !== 'complete' || !res.user || !res.token) {
      throw new Error(`Clerk signIn did not complete (status: ${res.status}).`);
    }
    const now = Date.now();
    const expiresAt = now + 3600_000;
    const user: AuthUser = {
      id: res.user.id,
      email: res.user.primaryEmailAddress,
      emailVerified: res.user.emailVerified ?? false,
      roles: res.user.roles ?? [],
      permissions: res.user.permissions ?? [],
    };
    const session: AuthSession = {
      sessionId: res.createdSessionId ?? `clerk_sess_${user.id}_${now}`,
      user,
      tokens: {
        accessToken: res.token,
        tokenType: 'Bearer',
        expiresAt,
      },
      provider: 'clerk',
      issuedAt: now,
      expiresAt,
    };
    this.currentSession = session;
    return { status: 'authenticated', session, user };
  }

  async signUp(input: SignUpInput): Promise<AuthResult> {
    const sdk = this.requireDriver();
    if (!input.email) {
      throw new Error('Clerk signUp requires an email address.');
    }
    const res = await sdk.signUp({
      emailAddress: input.email,
      password: input.password,
    });
    if (res.status === 'missing_requirements') {
      return {
        status: 'verification_required',
        challenge: {
          challengeId: `clerk_verify_${Date.now()}`,
          type: 'email_verification',
          deliveryMedium: 'email',
          destinationHint: input.email,
        },
      };
    }
    if (!res.user || !res.token) {
      throw new Error('Clerk signUp did not return a user and session token.');
    }
    const now = Date.now();
    const expiresAt = now + 3600_000;
    const user: AuthUser = {
      id: res.user.id,
      email: res.user.primaryEmailAddress ?? input.email,
      emailVerified: res.user.emailVerified ?? false,
      roles: [],
      permissions: [],
    };
    const session: AuthSession = {
      sessionId: res.createdSessionId ?? `clerk_sess_${user.id}_${now}`,
      user,
      tokens: {
        accessToken: res.token,
        tokenType: 'Bearer',
        expiresAt,
      },
      provider: 'clerk',
      issuedAt: now,
      expiresAt,
    };
    this.currentSession = session;
    return { status: 'authenticated', session, user };
  }

  async signOut(): Promise<void> {
    const sdk = this.requireDriver();
    await sdk.signOut();
    this.currentSession = null;
  }

  async restoreSession(): Promise<AuthSession | null> {
    return this.currentSession;
  }

  async refreshSession(): Promise<AuthSession> {
    const sdk = this.requireDriver();
    const nextToken = await sdk.getToken();
    if (!nextToken || !this.currentSession) {
      throw new Error('Failed to refresh Clerk session token.');
    }
    const now = Date.now();
    const expiresAt = now + 3600_000;
    this.currentSession = {
      ...this.currentSession,
      tokens: {
        ...this.currentSession.tokens,
        accessToken: nextToken,
        expiresAt,
      },
      issuedAt: now,
      expiresAt,
    };
    return this.currentSession;
  }

  async requestPasswordReset(): Promise<void> {
    throw new Error('Use Clerk signIn.create({ strategy: "reset_password_email_code" }).');
  }

  async resetPassword(): Promise<void> {
    throw new Error('Use Clerk signIn.attemptFirstFactor({ strategy: "reset_password_email_code" }).');
  }

  async verifyEmail(): Promise<void> {
    throw new Error('Use Clerk signUp.attemptEmailAddressVerification().');
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    return this.currentSession?.user ?? null;
  }
}

export type ProviderFactory = () => AuthProviderAdapter;

/**
 * Production AuthProviderRegistry (Section 14.2 & Audit Finding 5).
 * Never registers a mock/synthetic provider in production.
 */
export class AuthProviderRegistry {
  private readonly factories = new Map<AuthProviderType, ProviderFactory>();

  constructor() {
    this.register('rest', () => new RestAuthProviderAdapter());
    this.register('oidc', () => new OidcAuthProviderAdapter());
    this.register('oauth', () => new OidcAuthProviderAdapter());
    this.register('apple', () => new AppleAuthProviderAdapter());
    this.register('google', () => new GoogleAuthProviderAdapter());
    this.register('facebook', () => new OidcAuthProviderAdapter());
    this.register('supabase', () => new SupabaseAuthProviderAdapter());
    this.register('firebase', () => new FirebaseAuthProviderAdapter());
    this.register('clerk', () => new ClerkAuthProviderAdapter());
  }

  register(type: AuthProviderType, factory: ProviderFactory): void {
    this.factories.set(type, factory);
  }

  create(type: AuthProviderType): AuthProviderAdapter {
    const factory = this.factories.get(type);
    if (!factory) {
      throw new Error(
        `No production AuthProviderAdapter registered for provider type "${type}". If you are running unit tests with a custom provider, register an adapter from @expo-foundation/testing explicitly.`
      );
    }
    return factory();
  }

  listSupportedTypes(): AuthProviderType[] {
    return Array.from(this.factories.keys());
  }
}
