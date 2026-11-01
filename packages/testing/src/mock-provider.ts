import type {
  AuthProviderAdapter,
  AuthProviderCapabilities,
  AuthProviderConfig,
  AuthProviderType,
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
import { createMockChallenge, createMockMfaChallenge } from './mock-challenges.js';
import { createMockSession, createMockUser } from './mock-session.js';

export interface MockAuthProviderOptions {
  providerType?: AuthProviderType;
  requireEmailVerification?: boolean;
  requireMfa?: boolean;
  shouldFailRefresh?: boolean;
  defaultRoles?: string[];
  defaultPermissions?: string[];
}

/**
 * Isolated Test-Only MockAuthProviderAdapter.
 * Must NEVER be registered in the production AuthProviderRegistry.
 */
export class MockAuthProviderAdapter
  implements AuthProviderAdapter, OtpCapability, MfaCapability
{
  readonly providerType: AuthProviderType;
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

  private config: AuthProviderConfig | null = null;
  private currentSession: AuthSession | null = null;
  private readonly options: MockAuthProviderOptions;

  constructor(options?: MockAuthProviderOptions) {
    this.options = options ?? {};
    this.providerType = options?.providerType ?? 'custom';
  }

  async initialize(config: AuthProviderConfig): Promise<void> {
    this.config = config;
  }

  async signIn(input: SignInInput): Promise<AuthResult> {
    if (this.options.requireMfa) {
      return {
        status: 'challenge_required',
        user: createMockUser({ email: input.email }),
        challenge: createMockChallenge({ type: 'mfa', deliveryMedium: 'totp' }),
      };
    }

    const session = createMockSession({
      provider: this.providerType,
      user: {
        id: `usr_${input.email ?? input.username ?? 'mock'}`,
        email: input.email ?? 'tester@expo.dev',
        roles: this.options.defaultRoles ?? ['user'],
        permissions: this.options.defaultPermissions ?? ['orders.read'],
        emailVerified: true,
        tenantId: input.tenantId,
      },
    });
    this.currentSession = session;
    return {
      status: 'authenticated',
      session,
      user: session.user,
    };
  }

  async signUp(input: SignUpInput): Promise<AuthResult> {
    const requireVerify =
      this.options.requireEmailVerification ??
      Boolean(this.config?.options?.requireEmailVerification);
    if (requireVerify) {
      const user = createMockUser({
        id: `usr_${input.email ?? 'new'}`,
        email: input.email,
        emailVerified: false,
        accountStatus: 'unverified',
      });
      return {
        status: 'verification_required',
        user,
        challenge: createMockChallenge({
          type: 'email_verification',
          destinationHint: input.email,
        }),
      };
    }
    return this.signIn(input);
  }

  async signOut(): Promise<void> {
    this.currentSession = null;
  }

  async restoreSession(): Promise<AuthSession | null> {
    return this.currentSession;
  }

  async refreshSession(refreshToken?: string): Promise<AuthSession> {
    if (this.options.shouldFailRefresh) {
      throw new Error('Simulated refresh failure in MockAuthProviderAdapter.');
    }
    const token = refreshToken ?? this.currentSession?.tokens.refreshToken;
    if (!token) {
      throw new Error('No refresh token available.');
    }
    const refreshed = createMockSession({
      provider: this.providerType,
      user: this.currentSession?.user,
    });
    this.currentSession = refreshed;
    return refreshed;
  }

  async requestPasswordReset(_input: PasswordResetRequest): Promise<void> {}
  async resetPassword(_input: PasswordResetInput): Promise<void> {}
  async verifyEmail(_input: EmailVerificationInput): Promise<void> {}

  async getCurrentUser(): Promise<AuthUser | null> {
    return this.currentSession?.user ?? null;
  }

  async requestOtp(_input: OtpRequest): Promise<{ challengeId: string }> {
    return { challengeId: `otp_mock_${Date.now()}` };
  }

  async verifyOtp(input: OtpVerification): Promise<AuthResult> {
    if (input.code === '000000') {
      throw new Error('Invalid OTP verification code.');
    }
    return this.signIn({ email: input.destination });
  }

  async beginMfa(): Promise<MfaChallenge> {
    return createMockMfaChallenge();
  }

  async verifyMfa(input: MfaVerifyInput): Promise<AuthResult> {
    if (input.code === '000000') {
      throw new Error('Invalid MFA verification code.');
    }
    return this.signIn({ email: 'mfa.verified@expo.dev' });
  }
}
