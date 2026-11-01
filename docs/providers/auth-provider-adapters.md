# Auth Provider Adapters & Security Rules

## Core Adapter Contract (`AuthProviderAdapter`)

All authentication providers implement `AuthProviderAdapter` from `@expo-foundation/contracts`:

- `initialize(config: AuthProviderConfig): Promise<void>`
- `signIn(input: SignInInput): Promise<AuthResult>`
- `signUp(input: SignUpInput): Promise<AuthResult>`
- `signOut(): Promise<void>`
- `restoreSession(): Promise<AuthSession | null>`
- `refreshSession(refreshToken?: string): Promise<AuthSession>`
- `requestPasswordReset(input: PasswordResetRequest): Promise<void>`
- `resetPassword(input: PasswordResetInput): Promise<void>`
- `verifyEmail(input: EmailVerificationInput): Promise<void>`
- `getCurrentUser(): Promise<AuthUser | null>`

## Optional Capability Interfaces

- `OtpCapability` (`requestOtp`, `verifyOtp`)
- `MfaCapability` (`beginMfa`, `verifyMfa`)
- `OAuthCapability` (`createAuthorizationRequest`, `exchangeAuthorizationCode`)
- `BiometricCapability`, `PasskeyCapability`, `MultiAccountCapability`, `MultiTenantCapability`

## Restricted JSONPath Mapping (`RestAuthProviderAdapter`)

`RestAuthProviderAdapter` uses `extractByJsonPath` (`packages/auth/src/providers/json-path.ts`) which permits only validated `$.field.subfield` dot-paths and rejects arbitrary JavaScript execution or prototype pollution (`__proto__`, `constructor`, `prototype`).
