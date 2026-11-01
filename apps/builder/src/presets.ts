import type {
  AuthConfigDocument,
  IntegrationConfigDocument,
  NavigationConfigDocument,
} from '@expo-foundation/core';

import completeAuthJson from '../../../examples/complete-foundation/auth.json' with { type: 'json' };
import completeNavJson from '../../../examples/complete-foundation/navigation.json' with { type: 'json' };
import completeIntJson from '../../../examples/complete-foundation/integration.json' with { type: 'json' };
import authOnlyJson from '../../../examples/auth-only/auth.json' with { type: 'json' };
import navOnlyJson from '../../../examples/navigation-only/navigation.json' with { type: 'json' };

export type BuilderPresetId = 'complete' | 'auth-only' | 'navigation-only';

export interface BuilderPreset {
  id: BuilderPresetId;
  label: string;
  description: string;
  auth: AuthConfigDocument | null;
  navigation: NavigationConfigDocument | null;
  integration: IntegrationConfigDocument | null;
}

export const BUILDER_PRESETS: Record<BuilderPresetId, BuilderPreset> = {
  complete: {
    id: 'complete',
    label: 'Complete Foundation (Auth + Navigation + Integration)',
    description:
      'Full commerce application with REST Auth, iOS SwiftUI NavigationStack/TabView, Android Compose/Router hybrid, and protected deep links.',
    auth: structuredClone(completeAuthJson) as unknown as AuthConfigDocument,
    navigation: structuredClone(completeNavJson) as unknown as NavigationConfigDocument,
    integration: structuredClone(completeIntJson) as unknown as IntegrationConfigDocument,
  },
  'auth-only': {
    id: 'auth-only',
    label: 'Auth-Only Mode (Standalone Headless Auth)',
    description:
      'Executes the Auth Builder independently without any Navigation Builder dependency.',
    auth: structuredClone(authOnlyJson) as unknown as AuthConfigDocument,
    navigation: null,
    integration: null,
  },
  'navigation-only': {
    id: 'navigation-only',
    label: 'Navigation-Only Mode (Standalone Native Navigation)',
    description:
      'Executes the Navigation Builder independently for a public catalog app without Auth.',
    auth: null,
    navigation: structuredClone(navOnlyJson) as unknown as NavigationConfigDocument,
    integration: null,
  },
};
