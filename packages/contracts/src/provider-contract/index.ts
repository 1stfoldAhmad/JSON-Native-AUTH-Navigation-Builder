/**
 * @expo-foundation/contracts - Auth Provider Adapter Contract
 *
 * Defines the provider-independent authentication adapter interface and optional
 * capability interfaces (OTP, MFA, OAuth/OIDC, Biometric, Passkeys, Multi-Account, Multi-Tenant).
 */

export type AuthProviderType =
  | 'rest'
  | 'oidc'
  | 'oauth'
  | 'apple'
  | 'google'
  | 'facebook'
  | 'supabase'
  | 'firebase'
  | 'clerk'
  | 'custom';

export interface AuthProviderConfig {
  type: AuthProviderType;
  ref?: string;
  baseUrl?: string;
  clientId?: string;
  discoveryUrl?: string;
  redirectUri?: string;
  scopes?: string[];
  endpoints?: Record<string, { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string }>;
  requestMapping?: Record<string, Record<string, string>>;
  responseMapping?: {
    accessToken?: string;
    refreshToken?: string;
    idToken?: string;
    user?: string;
    expiresIn?: string;
    verificationRequired?: string;
    mfaRequired?: string;
  };
  headers?: Record<string, string>;
  timeoutMs?: number;
  retryPolicy?: {
    maxRetries: number;
    backoffMs: number;
  };
  options?: Record<string, unknown>;
}

export interface AuthUser {
  id: string;
  email?: string;
  phone?: string;
  displayName?: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  roles?: string[];
  permissions?: string[];
  tenantId?: string;
  organizationIds?: string[];
  accountStatus?: 'active' | 'unverified' | 'suspended' | 'locked' | string;
  claims?: Record<string, unknown>;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  tokenType?: string;
  expiresAt: number;
}

export interface AuthSession {
  sessionId: string;
  user: AuthUser;
  tokens: AuthTokens;
  provider: AuthProviderType;
  issuedAt: number;
  expiresAt: number;
  tenantId?: string;
}

export interface SignInInput {
  email?: string;
  username?: string;
  phone?: string;
  password?: string;
  provider?: string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
}

export interface SignUpInput {
  email?: string;
  username?: string;
  phone?: string;
  password?: string;
  displayName?: string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
}

export interface PasswordResetRequest {
  email: string;
  redirectUrl?: string;
}

export interface PasswordResetInput {
  token: string;
  newPassword: string;
  email?: string;
}

export interface EmailVerificationInput {
  token?: string;
  code?: string;
  email?: string;
}

export interface AuthChallenge {
  challengeId: string;
  type: 'otp' | 'mfa' | 'email_verification' | 'phone_verification' | 'recovery';
  deliveryMedium?: 'email' | 'sms' | 'totp' | 'push';
  destinationHint?: string;
  expiresAt?: number;
}

export interface AuthResult {
  status:
    | 'authenticated'
    | 'verification_required'
    | 'challenge_required'
    | 'recovery_required'
    | 'account_suspended';
  session?: AuthSession;
  user?: AuthUser;
  challenge?: AuthChallenge;
}

/**
 * Core AuthProviderAdapter interface (Section 4.2)
 */
export interface AuthProviderAdapter {
  readonly providerType: AuthProviderType;

  initialize(config: AuthProviderConfig): Promise<void>;

  signIn(input: SignInInput): Promise<AuthResult>;

  signUp(input: SignUpInput): Promise<AuthResult>;

  signOut(): Promise<void>;

  restoreSession(): Promise<AuthSession | null>;

  refreshSession(refreshToken?: string): Promise<AuthSession>;

  requestPasswordReset(input: PasswordResetRequest): Promise<void>;

  resetPassword(input: PasswordResetInput): Promise<void>;

  verifyEmail(input: EmailVerificationInput): Promise<void>;

  getCurrentUser(): Promise<AuthUser | null>;
}

/**
 * Optional Capability Interfaces (Section 4.2)
 */

export interface OtpRequest {
  channel: 'sms' | 'email';
  destination: string;
  purpose?: 'login' | 'verification' | 'reset';
}

export interface OtpVerification {
  channel: 'sms' | 'email';
  destination: string;
  code: string;
  challengeId?: string;
}

export interface OtpCapability {
  requestOtp(input: OtpRequest): Promise<{ challengeId: string }>;
  verifyOtp(input: OtpVerification): Promise<AuthResult>;
}

export interface MfaChallenge {
  challengeId: string;
  factors: Array<'totp' | 'sms' | 'backup_code'>;
  expiresAt: number;
}

export interface MfaVerifyInput {
  challengeId: string;
  factor: 'totp' | 'sms' | 'backup_code';
  code: string;
}

export interface MfaCapability {
  beginMfa(): Promise<MfaChallenge>;
  verifyMfa(input: MfaVerifyInput): Promise<AuthResult>;
}

export interface OAuthAuthorizationRequest {
  AuthorizationUrl: string;
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  redirectUri: string;
}

export interface OAuthCodeExchangeInput {
  code: string;
  state: string;
  expectedState: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface OAuthCapability {
  createAuthorizationRequest(): Promise<OAuthAuthorizationRequest>;
  exchangeAuthorizationCode(input: OAuthCodeExchangeInput): Promise<AuthResult>;
}

export interface BiometricCapability {
  isBiometricAvailable(): Promise<boolean>;
  authenticateWithBiometrics(promptMessage?: string): Promise<boolean>;
}

export interface PasskeyCapability {
  registerPasskey(userId: string): Promise<{ credentialId: string }>;
  authenticateWithPasskey(): Promise<AuthResult>;
}

export interface MultiAccountCapability {
  listAccounts(): Promise<AuthUser[]>;
  switchAccount(userId: string): Promise<AuthSession>;
  removeAccount(userId: string): Promise<void>;
}

export interface MultiTenantCapability {
  switchTenant(tenantId: string): Promise<AuthSession>;
}

export function hasOtpCapability(
  adapter: AuthProviderAdapter
): adapter is AuthProviderAdapter & OtpCapability {
  return (
    typeof (adapter as unknown as OtpCapability).requestOtp === 'function' &&
    typeof (adapter as unknown as OtpCapability).verifyOtp === 'function'
  );
}

export function hasMfaCapability(
  adapter: AuthProviderAdapter
): adapter is AuthProviderAdapter & MfaCapability {
  return (
    typeof (adapter as unknown as MfaCapability).beginMfa === 'function' &&
    typeof (adapter as unknown as MfaCapability).verifyMfa === 'function'
  );
}

export function hasOAuthCapability(
  adapter: AuthProviderAdapter
): adapter is AuthProviderAdapter & OAuthCapability {
  return (
    typeof (adapter as unknown as OAuthCapability).createAuthorizationRequest === 'function' &&
    typeof (adapter as unknown as OAuthCapability).exchangeAuthorizationCode === 'function'
  );
}

export function hasBiometricCapability(
  adapter: AuthProviderAdapter
): adapter is AuthProviderAdapter & BiometricCapability {
  return (
    typeof (adapter as unknown as BiometricCapability).isBiometricAvailable === 'function' &&
    typeof (adapter as unknown as BiometricCapability).authenticateWithBiometrics === 'function'
  );
}

export function hasMultiAccountCapability(
  adapter: AuthProviderAdapter
): adapter is AuthProviderAdapter & MultiAccountCapability {
  return (
    typeof (adapter as unknown as MultiAccountCapability).listAccounts === 'function' &&
    typeof (adapter as unknown as MultiAccountCapability).switchAccount === 'function'
  );
}

export function hasMultiTenantCapability(
  adapter: AuthProviderAdapter
): adapter is AuthProviderAdapter & MultiTenantCapability {
  return typeof (adapter as unknown as MultiTenantCapability).switchTenant === 'function';
}
