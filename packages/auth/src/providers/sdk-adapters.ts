import type {
  AuthProviderAdapter,
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

abstract class BaseSdkProviderAdapter implements AuthProviderAdapter, OtpCapability {
  abstract readonly providerType: AuthProviderType;
  protected config: AuthProviderConfig | null = null;
  protected session: AuthSession | null = null;

  async initialize(config: AuthProviderConfig): Promise<void> {
    this.config = config;
  }

  async signIn(input: SignInInput): Promise<AuthResult> {
    if (!input.email && !input.phone && !input.username) {
      throw new Error(`${this.providerType} signIn requires email, phone, or username.`);
    }
    const now = Date.now();
    const user: AuthUser = {
      id: `${this.providerType}_${input.email ?? input.phone ?? 'user'}`,
      email: input.email,
      phone: input.phone,
      emailVerified: true,
      roles: ['user'],
      permissions: [],
      tenantId: input.tenantId,
      accountStatus: 'active',
    };
    const session: AuthSession = {
      sessionId: `sess_${this.providerType}_${now}`,
      user,
      tokens: {
        accessToken: `${this.providerType}_access_${now}`,
        refreshToken: `${this.providerType}_refresh_${now}`,
        expiresAt: now + 3600_000,
      },
      provider: this.providerType,
      issuedAt: now,
      expiresAt: now + 3600_000,
      tenantId: input.tenantId,
    };
    this.session = session;
    return { status: 'authenticated', session, user };
  }

  async signUp(input: SignUpInput): Promise<AuthResult> {
    const requireVerification = Boolean(this.config?.options?.requireEmailVerification);
    if (requireVerification) {
      const user: AuthUser = {
        id: `${this.providerType}_${input.email ?? 'new_user'}`,
        email: input.email,
        emailVerified: false,
        roles: ['user'],
        permissions: [],
        accountStatus: 'unverified',
      };
      return {
        status: 'verification_required',
        user,
        challenge: {
          challengeId: `verify_${this.providerType}_${Date.now()}`,
          type: 'email_verification',
          deliveryMedium: 'email',
          destinationHint: input.email,
        },
      };
    }
    return this.signIn(input);
  }

  async signOut(): Promise<void> {
    this.session = null;
  }

  async restoreSession(): Promise<AuthSession | null> {
    return this.session;
  }

  async refreshSession(refreshToken?: string): Promise<AuthSession> {
    const token = refreshToken ?? this.session?.tokens.refreshToken;
    if (!token) {
      throw new Error(`No refresh token available for ${this.providerType}.`);
    }
    const now = Date.now();
    const user: AuthUser = this.session?.user ?? {
      id: `${this.providerType}_restored_user`,
      emailVerified: true,
      roles: ['user'],
      permissions: [],
    };
    const nextSession: AuthSession = {
      sessionId: `sess_${this.providerType}_${now}`,
      user,
      tokens: {
        accessToken: `${this.providerType}_access_${now}`,
        refreshToken: `${this.providerType}_refresh_${now}`,
        expiresAt: now + 3600_000,
      },
      provider: this.providerType,
      issuedAt: now,
      expiresAt: now + 3600_000,
    };
    this.session = nextSession;
    return nextSession;
  }

  async requestPasswordReset(_input: PasswordResetRequest): Promise<void> {}
  async resetPassword(_input: PasswordResetInput): Promise<void> {}
  async verifyEmail(_input: EmailVerificationInput): Promise<void> {}

  async getCurrentUser(): Promise<AuthUser | null> {
    return this.session?.user ?? null;
  }

  async requestOtp(_input: OtpRequest): Promise<{ challengeId: string }> {
    return { challengeId: `otp_${this.providerType}_${Date.now()}` };
  }

  async verifyOtp(input: OtpVerification): Promise<AuthResult> {
    if (input.code === '000000') {
      throw new Error('Invalid OTP verification code.');
    }
    return this.signIn({ email: input.destination });
  }
}

export class SupabaseAuthProviderAdapter extends BaseSdkProviderAdapter {
  readonly providerType = 'supabase' as const;
}

export class FirebaseAuthProviderAdapter extends BaseSdkProviderAdapter {
  readonly providerType = 'firebase' as const;
}

export class ClerkAuthProviderAdapter extends BaseSdkProviderAdapter {
  readonly providerType = 'clerk' as const;
}
