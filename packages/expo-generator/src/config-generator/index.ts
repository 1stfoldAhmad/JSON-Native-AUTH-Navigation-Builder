/**
 * @expo-foundation/expo-generator - Expo Config Generator
 *
 * Generates `app.json` and `tsconfig.json` for Expo SDK 58 projects.
 */

import type { ProjectIR } from '@expo-foundation/core';

export interface GeneratedAppJson {
  expo: {
    name: string;
    slug: string;
    version: string;
    sdkVersion: string;
    scheme: string;
    platforms: string[];
    newArchEnabled: boolean;
    ios: {
      supportsTablet: boolean;
      bundleIdentifier: string;
      associatedDomains?: string[];
    };
    android: {
      package: string;
      intentFilters?: Array<Record<string, unknown>>;
    };
    plugins: string[];
  };
}

export function generateAppJson(
  ir: ProjectIR,
  options?: {
    appName?: string;
    slug?: string;
    bundleIdentifier?: string;
    androidPackage?: string;
  }
): GeneratedAppJson {
  const slug =
    options?.slug ??
    ir.navigation?.id ??
    ir.auth?.id ??
    ir.metadata?.projectId ??
    'expo-foundation-app';
  const cleanId = slug.toLowerCase().replace(/[^a-z0-9]/g, '');
  const scheme = ir.navigation?.linking.scheme ?? (cleanId || 'app');

  const plugins = new Set<string>();
  if (ir.navigation) {
    plugins.add('expo-router');
  }
  if (ir.auth?.session.storage === 'secure-store') {
    plugins.add('expo-secure-store');
  }
  if (ir.auth?.methods.apple || ir.auth?.providerType === 'apple') {
    plugins.add('expo-apple-authentication');
  }

  const hosts = ir.navigation?.linking.hosts ?? [];
  const associatedDomains =
    ir.navigation?.linking.universalLinks && hosts.length > 0
      ? hosts.map((h) => `applinks:${h}`)
      : undefined;

  const intentFilters =
    ir.navigation?.linking.androidAppLinks && hosts.length > 0
      ? [
          {
            action: 'VIEW',
            autoVerify: true,
            data: hosts.map((h) => ({
              scheme: 'https',
              host: h,
              pathPrefix: '/',
            })),
            category: ['BROWSABLE', 'DEFAULT'],
          },
        ]
      : undefined;

  return {
    expo: {
      name: options?.appName ?? slug,
      slug,
      version: '1.0.0',
      sdkVersion: `${ir.sdkVersion}.0.0`,
      scheme,
      platforms: ['ios', 'android'],
      newArchEnabled: true,
      ios: {
        supportsTablet: true,
        bundleIdentifier:
          options?.bundleIdentifier ?? `dev.expofoundation.${cleanId}`,
        ...(associatedDomains ? { associatedDomains } : {}),
      },
      android: {
        package: options?.androidPackage ?? `dev.expofoundation.${cleanId}`,
        ...(intentFilters ? { intentFilters } : {}),
      },
      plugins: Array.from(plugins),
    },
  };
}

export function generateTsConfigJson(): Record<string, unknown> {
  return {
    extends: 'expo/tsconfig.base',
    compilerOptions: {
      strict: true,
      paths: {
        '@/*': ['./src/*'],
      },
    },
    include: ['**/*.ts', '**/*.tsx', '.expo/types/**/*.ts', 'expo-env.d.ts'],
  };
}
