import type {
  AuthProviderAdapter,
  AuthProviderConfig,
  AuthResult,
  AuthSession,
  AuthUser,
  EmailVerificationInput,
  PasswordResetInput,
  PasswordResetRequest,
  SignInInput,
  SignUpInput,
} from '@expo-foundation/contracts';

export class AppleAuthProviderAdapter implements AuthProviderAdapter {
  readonly providerType = 'apple' as const;
  private config: AuthProviderConfig | null = null;
  private session: AuthSession | null = null;

  async initialize(config: AuthProviderConfig): Promise<void> {
    this.config = config;
  }

  async signIn(input: SignInInput): Promise<AuthResult> {
    const now = Date.now();
    const user: AuthUser = {
      id: `apple_${input.email ?? 'user'}`,
      email: input.email ?? 'apple.user@privaterelay.appleid.com',
      displayName: 'Apple User',
      emailVerified: true,
      roles: ['user'],
      permissions: [],
      accountStatus: 'active',
    };
    const session: AuthSession = {
      sessionId: `sess_apple_${now}`,
      user,
      tokens: {
        accessToken: `apple_identity_token_${now}`,
        refreshToken: `apple_refresh_${now}`,
        expiresAt: now + 3600_000,
      },
      provider: 'apple',
      issuedAt: now,
      expiresAt: now + 3600_000,
    };
    this.session = session;
    return { status: 'authenticated', session, user };
  }

  async signUp(input: SignUpInput): Promise<AuthResult> {
    return this.signIn(input);
  }

  async signOut(): Promise<void> {
    this.session = null;
  }

  async restoreSession(): Promise<AuthSession | null> {
    return this.session;
  }

  async refreshSession(): Promise<AuthSession> {
    if (!this.session) {
      throw new Error('No active Apple session to refresh.');
    }
    const now = Date.now();
    this.session = {
      ...this.session,
      expiresAt: now + 3600_000,
      tokens: {
        ...this.session.tokens,
        accessToken: `apple_identity_token_${now}`,
        expiresAt: now + 3600_000,
      },
    };
    return this.session;
  }

  async requestPasswordReset(_input: PasswordResetRequest): Promise<void> {}
  async resetPassword(_input: PasswordResetInput): Promise<void> {}
  async verifyEmail(_input: EmailVerificationInput): Promise<void> {}

  async getCurrentUser(): Promise<AuthUser | null> {
    return this.session?.user ?? null;
  }
}

export class GoogleAuthProviderAdapter implements AuthProviderAdapter {
  readonly providerType = 'google' as const;
  private config: AuthProviderConfig | null = null;
  private session: AuthSession | null = null;

  async initialize(config: AuthProviderConfig): Promise<void> {
    this.config = config;
  }

  async signIn(input: SignInInput): Promise<AuthResult> {
    const now = Date.now();
    const user: AuthUser = {
      id: `google_${input.email ?? 'user'}`,
      email: input.email ?? 'user@gmail.com',
      displayName: 'Google User',
      emailVerified: true,
      roles: ['user'],
      permissions: [],
      accountStatus: 'active',
    };
    const session: AuthSession = {
      sessionId: `sess_google_${now}`,
      user,
      tokens: {
        accessToken: `google_access_token_${now}`,
        refreshToken: `google_refresh_${now}`,
        idToken: `google_id_token_${now}`,
        expiresAt: now + 3600_000,
      },
      provider: 'google',
      issuedAt: now,
      expiresAt: now + 3600_000,
    };
    this.session = session;
    return { status: 'authenticated', session, user };
  }

  async signUp(input: SignUpInput): Promise<AuthResult> {
    return this.signIn(input);
  }

  async signOut(): Promise<void> {
    this.session = null;
  }

  async restoreSession(): Promise<AuthSession | null> {
    return this.session;
  }

  async refreshSession(): Promise<AuthSession> {
    if (!this.session) {
      throw new Error('No active Google session to refresh.');
    }
    const now = Date.now();
    this.session = {
      ...this.session,
      expiresAt: now + 3600_000,
      tokens: {
        ...this.session.tokens,
        accessToken: `google_access_token_${now}`,
        expiresAt: now + 3600_000,
      },
    };
    return this.session;
  }

  async requestPasswordReset(_input: PasswordResetRequest): Promise<void> {}
  async resetPassword(_input: PasswordResetInput): Promise<void> {}
  async verifyEmail(_input: EmailVerificationInput): Promise<void> {}

  async getCurrentUser(): Promise<AuthUser | null> {
    return this.session?.user ?? null;
  }
}
