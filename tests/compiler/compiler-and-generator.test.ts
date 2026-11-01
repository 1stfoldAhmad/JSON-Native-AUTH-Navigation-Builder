import { describe, expect, it } from 'vitest';
import {
  defaultCapabilityRegistry,
  defaultFoundationCompiler,
  migrateAuthDocument,
  migrateNavigationDocument,
  validateAuthDocument,
  validateIntegrationDocument,
  validateNavigationDocument,
  type NavigationConfigDocument,
} from '@expo-foundation/core';
import {
  defaultExpoProjectGenerator,
  defaultOutputValidator,
} from '@expo-foundation/expo-generator';
import completeAuthJson from '../../examples/complete-foundation/auth.json' with { type: 'json' };
import completeNavJson from '../../examples/complete-foundation/navigation.json' with { type: 'json' };
import completeIntJson from '../../examples/complete-foundation/integration.json' with { type: 'json' };
import authOnlyJson from '../../examples/auth-only/auth.json' with { type: 'json' };
import navOnlyJson from '../../examples/navigation-only/navigation.json' with { type: 'json' };

describe('Compiler, Diagnostics, Capability Registry & Expo Project Generator', () => {
  it('migrates 0.9.0 configurations to 1.0.0 non-destructively', () => {
    const legacyAuth = {
      schemaVersion: '0.9.0',
      id: 'legacy.auth',
      enabled: true,
      provider: { type: 'rest', ref: 'provider.primary' },
    };
    const migratedAuth = migrateAuthDocument(legacyAuth);
    expect(migratedAuth.migrated).toBe(true);
    expect(migratedAuth.toVersion).toBe('1.0.0');
    expect(migratedAuth.document.session.storage).toBe('secure-store');

    const legacyNav = {
      schemaVersion: '0.9.0',
      id: 'legacy.nav',
      rootNavigator: 'root.stack',
      navigators: [{ id: 'root.stack', type: 'stack', children: ['home'] }],
      routes: [{ id: 'home', path: '/', screenRef: 'screen.app.home' }],
    };
    const migratedNav = migrateNavigationDocument(legacyNav);
    expect(migratedNav.migrated).toBe(true);
    expect(migratedNav.document.platforms.ios.renderer).toBe('expo-ui');
  });

  it('produces all expected Section 16 Auth, Navigation, and Integration diagnostics', () => {
    // 1. Auth diagnostics: missing refresh endpoint, invalid token mapping, missing verification screen
    const brokenAuth = structuredClone(completeAuthJson) as Record<string, unknown>;
    const providerCfg = (brokenAuth.provider as Record<string, unknown>).config as Record<
      string,
      unknown
    >;
    delete (providerCfg.endpoints as Record<string, unknown>).refresh;
    (providerCfg.responseMapping as Record<string, unknown>).accessToken = 'window.eval()';
    delete (brokenAuth.screenRefs as Record<string, unknown>).verification;

    const authDiags = validateAuthDocument(brokenAuth);
    const authCodes = authDiags.map((d) => d.code);
    expect(authCodes).toContain('AUTH_MISSING_REFRESH_ENDPOINT');
    expect(authCodes).toContain('AUTH_INVALID_TOKEN_MAPPING');
    expect(authCodes).toContain('AUTH_MISSING_VERIFICATION_SCREEN');

    // 2. Navigation diagnostics: duplicate route ID, unknown initial route, unreachable route
    const brokenNav = structuredClone(completeNavJson) as unknown as NavigationConfigDocument;
    brokenNav.navigators[0].initialRoute = 'non.existent.route';
    brokenNav.routes.push({
      id: 'auth.login', // duplicate
      path: '/dup',
      screenRef: 'screen.auth.login',
      access: 'guest',
    });
    brokenNav.routes.push({
      id: 'orphan.route',
      path: '/orphan',
      screenRef: 'screen.app.orphan',
      access: 'public',
    });

    const navDiags = validateNavigationDocument(brokenNav);
    const navCodes = navDiags.map((d) => d.code);
    expect(navCodes).toContain('NAV_DUPLICATE_ROUTE_ID');
    expect(navCodes).toContain('NAV_MISSING_INITIAL_ROUTE');
    expect(navCodes).toContain('NAV_UNREACHABLE_ROUTE');

    // 3. Integration diagnostics: guest route marked authenticated, unknown afterLogin route
    const brokenInt = structuredClone(completeIntJson);
    brokenInt.authNavigation.guestEntry = 'app.home'; // app.home is authenticated!
    brokenInt.authNavigation.afterLogin = 'unknown.destination';

    const intDiags = validateIntegrationDocument(brokenInt, {
      auth: completeAuthJson as never,
      navigation: completeNavJson as never,
    });
    const intCodes = intDiags.map((d) => d.code);
    expect(intCodes).toContain('INT_GUEST_ROUTE_MARKED_AUTHENTICATED');
    expect(intCodes).toContain('INT_INVALID_AFTER_LOGIN_ROUTE');
  });

  it('enforces CapabilityRegistry modes (strict-native vs automatic-fallback vs diagnostic)', () => {
    const strictAndroidStack = defaultCapabilityRegistry.resolveCapability(
      'navigation.stack',
      'android',
      'strict-native'
    );
    expect(strictAndroidStack.diagnostics.some((d) => d.code === 'CAP_STRICT_NATIVE_VIOLATION')).toBe(
      true
    );

    const fallbackAndroidStack = defaultCapabilityRegistry.resolveCapability(
      'navigation.stack',
      'android',
      'automatic-fallback'
    );
    expect(fallbackAndroidStack.usedFallback).toBe(true);
    expect(fallbackAndroidStack.diagnostics).toHaveLength(0);

    const iosNativeStack = defaultCapabilityRegistry.resolveCapability(
      'navigation.stack',
      'ios',
      'strict-native'
    );
    expect(iosNativeStack.usedFallback).toBe(false);
    expect(iosNativeStack.capability.support).toBe('native');
  });

  it('generates deterministic Expo SDK 58 projects for Complete, Auth-Only, and Navigation-Only modes', () => {
    const bundle1 = defaultExpoProjectGenerator.compileAndGenerate({
      auth: completeAuthJson,
      navigation: completeNavJson,
      integration: completeIntJson,
    });
    const bundle2 = defaultExpoProjectGenerator.compileAndGenerate({
      auth: completeAuthJson,
      navigation: completeNavJson,
      integration: completeIntJson,
    });

    // Deterministic output: checksums must match byte-for-byte
    expect(bundle1.manifest.files).toEqual(bundle2.manifest.files);

    const validationReport = defaultOutputValidator.validate(bundle1);
    expect(validationReport.valid).toBe(true);

    // Auth-Only generation
    const authOnlyBundle = defaultExpoProjectGenerator.compileAndGenerate({
      auth: authOnlyJson,
    });
    expect(defaultOutputValidator.validate(authOnlyBundle).valid).toBe(true);
    expect(authOnlyBundle.files['src/foundation/auth/AuthController.ts']).toBeDefined();
    expect(authOnlyBundle.files['src/foundation/navigation/RouteRegistry.ts']).toBeUndefined();

    // Navigation-Only generation
    const navOnlyBundle = defaultExpoProjectGenerator.compileAndGenerate({
      navigation: navOnlyJson,
    });
    expect(defaultOutputValidator.validate(navOnlyBundle).valid).toBe(true);
    expect(navOnlyBundle.files['src/foundation/navigation/RouteRegistry.ts']).toBeDefined();
    expect(navOnlyBundle.files['src/foundation/auth/AuthController.ts']).toBeUndefined();
  });

  it('preserves user-owned files and detects manual edits to generated files on regeneration', () => {
    const initialBundle = defaultExpoProjectGenerator.compileAndGenerate({
      auth: completeAuthJson,
      navigation: completeNavJson,
      integration: completeIntJson,
    });

    const customUserRegistry = `// Custom user registrations\nexport const screenRegistry = { custom: true };\n`;
    const tamperedGeneratedAuth = `${initialBundle.files['src/foundation/auth/AuthController.ts'].content}\n// manual edit\n`;

    const regenerated = defaultExpoProjectGenerator.compileAndGenerate(
      {
        auth: completeAuthJson,
        navigation: completeNavJson,
        integration: completeIntJson,
      },
      {
        existingFiles: {
          'src/screens/registry.ts': customUserRegistry,
          'src/foundation/auth/AuthController.ts': tamperedGeneratedAuth,
        },
        previousManifest: initialBundle.manifest,
        allowOverwriteModifiedGenerated: false,
      }
    );

    expect(regenerated.preservedUserFiles).toContain('src/screens/registry.ts');
    expect(regenerated.files['src/screens/registry.ts'].content).toBe(customUserRegistry);
    expect(regenerated.modifiedGeneratedFiles).toContain(
      'src/foundation/auth/AuthController.ts'
    );
    expect(
      regenerated.diagnostics.some((d) => d.code === 'GEN_MANUAL_MODIFICATION_DETECTED')
    ).toBe(true);
  });
});
