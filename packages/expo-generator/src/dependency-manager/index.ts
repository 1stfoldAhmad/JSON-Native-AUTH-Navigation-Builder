/**
 * @expo-foundation/expo-generator - Dependency Manager & SDK 58 Version Resolver
 *
 * Implements Section 9 Workstream B, Section 16.2, and Audit Findings 1 & 8:
 * - Resolves exact Expo SDK 58 dependency versions from `compatibility/sdk-58/packages.json`
 * - Distinguishes entry points across:
 *   1. Navigation / Complete Foundation app (`"expo-router/entry"`)
 *   2. Auth-only runnable Expo app (`"./src/AppEntry.tsx"`)
 *   3. Auth-only reusable module (`"./src/foundation/auth/index.ts"`)
 */

import { CapabilityRegistry, type ProjectIR } from '@expo-foundation/core';

export type GenerationOutputTarget = 'expo-app' | 'reusable-module';

export interface GeneratedPackageJson {
  name: string;
  version: string;
  private: boolean;
  main: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

export function generatePackageJson(
  ir: ProjectIR,
  options?: {
    appName?: string;
    version?: string;
    outputTarget?: GenerationOutputTarget;
    capabilityRegistry?: CapabilityRegistry;
  }
): GeneratedPackageJson {
  const registry = options?.capabilityRegistry ?? new CapabilityRegistry();
  const manifest = registry.getPackageManifest();
  const outputTarget: GenerationOutputTarget = options?.outputTarget ?? 'expo-app';

  const dependencies: Record<string, string> = {};
  const sortedPkgNames = Object.keys(ir.requiredPackages).sort();
  for (const pkg of sortedPkgNames) {
    dependencies[pkg] = ir.requiredPackages[pkg];
  }

  let mainEntry: string;
  if (ir.navigation) {
    mainEntry = 'expo-router/entry';
  } else if (outputTarget === 'reusable-module') {
    mainEntry = './src/foundation/auth/index.ts';
  } else {
    mainEntry = './src/AppEntry.tsx';
  }

  return {
    name:
      options?.appName ??
      ir.navigation?.id ??
      ir.auth?.id ??
      ir.metadata?.projectId ??
      'expo-foundation-generated-app',
    version: options?.version ?? '1.0.0',
    private: true,
    main: mainEntry,
    scripts: {
      start: 'expo start',
      ios: 'expo run:ios',
      android: 'expo run:android',
      typecheck: 'tsc --noEmit',
    },
    dependencies,
    devDependencies: {
      ...manifest.devPackages,
    },
  };
}
