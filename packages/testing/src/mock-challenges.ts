import type { AuthChallenge, MfaChallenge } from '@expo-foundation/contracts';

export function createMockChallenge(overrides?: Partial<AuthChallenge>): AuthChallenge {
  return {
    challengeId: overrides?.challengeId ?? `chg_${Date.now()}`,
    type: overrides?.type ?? 'email_verification',
    deliveryMedium: overrides?.deliveryMedium ?? 'email',
    destinationHint: overrides?.destinationHint ?? 't***@expo.dev',
    expiresAt: overrides?.expiresAt ?? Date.now() + 300_000,
  };
}

export function createMockMfaChallenge(overrides?: Partial<MfaChallenge>): MfaChallenge {
  return {
    challengeId: overrides?.challengeId ?? `mfa_${Date.now()}`,
    factors: overrides?.factors ?? ['totp', 'sms'],
    expiresAt: overrides?.expiresAt ?? Date.now() + 300_000,
  };
}
