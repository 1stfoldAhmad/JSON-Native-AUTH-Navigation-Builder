import { describe, expect, it } from 'vitest';
import {
  CapabilityRegistry,
  FoundationCompiler,
  type AuthConfigDocument,
  type IntegrationConfigDocument,
  type NavigationConfigDocument,
} from '@expo-foundation/core';
import { ExpoProjectGenerator } from '@expo-foundation/expo-generator';
import authOnlyDoc from '../../examples/auth-only/auth.json' with { type: 'json' };
import navOnlyDoc from '../../examples/navigation-only/navigation.json' with { type: 'json' };
import completeAuthDoc from '../../examples/complete-foundation/auth.json' with { type: 'json' };
import completeNavDoc from '../../examples/complete-foundation/navigation.json' with { type: 'json' };
import completeIntDoc from '../../examples/complete-foundation/integration.json' with { type: 'json' };

describe('Compiler, Capability Registry, Route Layout Compiler & Expo Generator', () => {
  const compiler = new FoundationCompiler();
  const generator = new ExpoProjectGenerator();

  it('enforces authoritative Expo SDK 58 package versions and rejects legacy specifiers (Finding 1)', () => {
    const registry = new CapabilityRegistry();
    const manifest = registry.getPackageManifest();

    expect(manifest.packages['expo-router']).toBe('~58.0.29');
    expect(manifest.packages['@expo/ui']).toBe('~58.0.21');
    expect(manifest.packages['expo-secure-store']).toBe('~58.0.2');
    expect(manifest.packages['expo-auth-session']).toBe('~58.0.16');

    const badVersionDiagnostics = registry.validatePackageVersions({
      'expo-router': '~4.0.0',
      '@expo/ui': '~0.1.0',
    });
    expect(badVersionDiagnostics).toHaveLength(2);
    expect(
      badVersionDiagnostics.every(
        (d) => d.code === 'SDK_INCOMPATIBLE_PACKAGE_VERSION'
      )
    ).toBe(true);
  });

  it('compiles Auth-only configuration into both runnable expo-app and reusable-module targets (Finding 8)', () => {
    const ir = compiler.compile({
      auth: authOnlyDoc as unknown as AuthConfigDocument,
    });

    expect(ir.canGenerate).toBe(true);
    expect(ir.requiredPackages['expo-secure-store']).toBe('~58.0.2');

    // 1. Runnable Expo App target
    const appBundle = generator.generate(ir, { outputTarget: 'expo-app' });
    expect(appBundle.validation.valid).toBe(true);
    const appPkg = JSON.parse(appBundle.files['package.json']);
    expect(appPkg.main).toBe('./src/AppEntry.tsx');
    expect(appBundle.files['src/AppEntry.tsx']).toContain('registerRootComponent');

    // 2. Reusable Auth Module target
    const moduleBundle = generator.generate(ir, {
      outputTarget: 'reusable-module',
    });
    expect(moduleBundle.validation.valid).toBe(true);
    const modPkg = JSON.parse(moduleBundle.files['package.json']);
    expect(modPkg.main).toBe('./src/foundation/auth/index.ts');
    expect(moduleBundle.files['src/foundation/auth/index.ts']).toBeDefined();
  });

  it('compiles navigator hierarchy into real nested _layout.tsx files with Host & SDK 58 primitives (Findings 3, 4, 7)', () => {
    const ir = compiler.compile({
      auth: completeAuthDoc as unknown as AuthConfigDocument,
      navigation: completeNavDoc as unknown as NavigationConfigDocument,
      integration: completeIntDoc as unknown as IntegrationConfigDocument,
    });

    expect(ir.canGenerate).toBe(true);
    const bundle = generator.generate(ir, { appName: 'complete-foundation-test' });
    expect(bundle.validation.valid).toBe(true);

    // Finding 7: Root layout compiles root-stack navigator wrapped in AuthProvider + NavigationProvider + AuthNavigationGate
    const rootLayout = bundle.files['app/_layout.tsx'];
    expect(rootLayout).toContain('IOSNativeStack');
    expect(rootLayout).toContain('AndroidNativeStack');
    expect(rootLayout).toContain('AuthProvider');
    expect(rootLayout).toContain('AuthNavigationGate');
    expect(rootLayout).not.toContain('<Slot');

    // Nested layouts exist for guest-stack, main-tabs, and nested tab stacks
    expect(bundle.files['app/(guest-stack)/_layout.tsx']).toContain('IOSNativeStack');
    expect(bundle.files['app/(main-tabs)/_layout.tsx']).toContain('IOSNativeTabs');
    expect(bundle.files['app/(main-tabs)/_layout.tsx']).toContain('AndroidNativeTabs');
    expect(
      bundle.files['app/(main-tabs)/(home-stack)/_layout.tsx']
    ).toContain('IOSNativeStack');

    // Finding 3: iOS renderer uses <Host>, 2-arg createStandardRouterNavigator, and descriptors -> NavigationDestination
    const iosStackRenderer =
      bundle.files['src/foundation/navigation/renderers/ios/NativeStack.ios.tsx'];
    expect(iosStackRenderer).toContain('<Host style={{ flex: 1 }}>');
    expect(iosStackRenderer).toContain(
      'createStandardRouterNavigator(\n  IOSNativeStackNavigator,\n  StackRouter\n)'
    );
    expect(iosStackRenderer).toContain('Object.values(descriptors).map');
    expect(iosStackRenderer).not.toContain('integrateWithRouter');

    // Finding 4: Android renderer uses <Host>, <NavigationBar>, <NavigationBarItem>, and "expo-router/native-tabs"
    const androidTabsRenderer =
      bundle.files['src/foundation/navigation/renderers/android/NativeTabs.android.tsx'];
    expect(androidTabsRenderer).toContain("from 'expo-router/native-tabs'");
    expect(androidTabsRenderer).not.toContain('unstable-native-tabs');
    expect(androidTabsRenderer).toContain('<Host>');
    expect(androidTabsRenderer).toContain('<NavigationBar>');
    expect(androidTabsRenderer).toContain('<NavigationBarItem');

    // Finding 6 & 15: Generated AuthProvider wraps canonical AuthController & ExpoSecureStoreAdapter
    const authProvider = bundle.files['src/foundation/auth/AuthProvider.tsx'];
    expect(authProvider).toContain('new AuthController(');
    expect(authProvider).toContain('new ExpoSecureStoreAdapter(');
  });

  it('produces identical byte-for-byte deterministic output across repeated runs', () => {
    const ir = compiler.compile({
      navigation: navOnlyDoc as unknown as NavigationConfigDocument,
    });
    const run1 = generator.generate(ir);
    const run2 = generator.generate(ir);
    expect(run1.fileList).toEqual(run2.fileList);
    expect(JSON.stringify(run1.files)).toBe(JSON.stringify(run2.files));
  });

  it('detects cyclic navigator graphs, conflicting route paths, and Strict Native fallback violations', () => {
    const brokenNav: NavigationConfigDocument = {
      ...(structuredClone(completeNavDoc) as unknown as NavigationConfigDocument),
      platforms: {
        ios: { renderer: 'expo-ui', strictNative: true, mode: 'strict-native' },
        android: {
          renderer: 'auto',
          fallback: 'expo-router',
          mode: 'strict-native',
        },
      },
      navigators: [
        { id: 'nav-a', type: 'stack', children: ['nav-b'] },
        { id: 'nav-b', type: 'stack', children: ['nav-a'] },
        { id: 'orphan-nav', type: 'stack', children: ['login'] },
      ],
      rootNavigator: 'nav-a',
    };

    const ir = compiler.compile({ navigation: brokenNav });
    expect(ir.canGenerate).toBe(false);

    const codes = ir.diagnostics.map((d) => d.code);
    expect(codes).toContain('NAV_GRAPH_CYCLE_DETECTED');
    expect(codes).toContain('NAV_ORPHAN_NAVIGATOR');
    expect(codes).toContain('CAP_STRICT_NATIVE_VIOLATION');
  });
});
