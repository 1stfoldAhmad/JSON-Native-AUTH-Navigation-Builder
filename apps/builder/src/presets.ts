import type {
  AuthConfigDocument,
  IntegrationConfigDocument,
  NavigationConfigDocument,
} from '@expo-foundation/core';

import completeAuth from '../../../examples/complete-foundation/auth.json' with { type: 'json' };
import completeNav from '../../../examples/complete-foundation/navigation.json' with { type: 'json' };
import completeInt from '../../../examples/complete-foundation/integration.json' with { type: 'json' };
import authOnly from '../../../examples/auth-only/auth.json' with { type: 'json' };
import navOnly from '../../../examples/navigation-only/navigation.json' with { type: 'json' };

export interface BuilderPreset {
  id: string;
  label: string;
  description: string;
  auth?: AuthConfigDocument;
  navigation?: NavigationConfigDocument;
  integration?: IntegrationConfigDocument;
}

export const BUILDER_PRESETS: BuilderPreset[] = [
  {
    id: 'complete-foundation',
    label: 'Complete E-Commerce Auth + Navigation',
    description:
      'Full REST Auth + SwiftUI/Compose Nested Stacks & Tabs + Deferred Deep Link Integration',
    auth: completeAuth as unknown as AuthConfigDocument,
    navigation: completeNav as unknown as NavigationConfigDocument,
    integration: completeInt as unknown as IntegrationConfigDocument,
  },
  {
    id: 'auth-only',
    label: 'Auth-Only Module (OIDC PKCE + MFA)',
    description:
      'Standalone Auth Builder configuration with OIDC PKCE, Biometrics, and SecureStore',
    auth: authOnly as unknown as AuthConfigDocument,
  },
  {
    id: 'navigation-only',
    label: 'Navigation-Only Catalog (Tabs + Split View)',
    description:
      'Standalone Navigation Builder configuration with SwiftUI TabView & NavigationSplitView',
    navigation: navOnly as unknown as NavigationConfigDocument,
  },
];
