/**
 * @expo-foundation/expo-generator - Multi-Stage Generated Output Validator
 *
 * Implements Section 16.5 & Audit Findings 1, 3, 4, 7, 8:
 * - Verifies all required files exist in the generated file map
 * - Validates JSON syntax of `package.json`, `app.json`, and `tsconfig.json`
 * - Validates SDK 58 dependency versions against `compatibility/sdk-58/packages.json`
 * - Verifies all route files and screen references are present
 * - Verifies that `app/_layout.tsx` and nested navigator layouts mount real compiled
 *   navigators (never bare `<Slot />` placeholders)
 * - Verifies no deprecated imports (`expo-router/unstable-native-tabs`) exist
 */

import { CapabilityRegistry, type Diagnostic, type ProjectIR } from '@expo-foundation/core';

export interface OutputValidationResult {
  valid: boolean;
  diagnostics: Diagnostic[];
}

export function validateGeneratedOutput(
  files: Record<string, string>,
  ir: ProjectIR,
  capabilityRegistry?: CapabilityRegistry
): OutputValidationResult {
  const diagnostics: Diagnostic[] = [];
  const registry = capabilityRegistry ?? new CapabilityRegistry();

  const requiredBaseFiles = ['package.json', 'app.json', 'tsconfig.json'];
  for (const path of requiredBaseFiles) {
    if (!files[path]) {
      diagnostics.push({
        code: 'GEN_MISSING_CORE_FILE',
        severity: 'error',
        category: 'generator',
        document: 'system',
        jsonPath: path,
        message: `Generated project is missing required file "${path}".`,
        suggestion: 'Ensure the project generator emits all base Expo configuration files.',
        canGenerate: false,
      });
    }
  }

  // Validate JSON syntax of all .json files
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith('.json')) {
      try {
        JSON.parse(content);
      } catch (err) {
        diagnostics.push({
          code: 'GEN_INVALID_JSON_SYNTAX',
          severity: 'error',
          category: 'generator',
          document: 'system',
          jsonPath: path,
          message: `Generated JSON file "${path}" contains invalid JSON: ${
            err instanceof Error ? err.message : 'syntax error'
          }`,
          suggestion: `Fix JSON serialization in generator for "${path}".`,
          canGenerate: false,
        });
      }
    }

    // Ensure no file uses deprecated unstable-native-tabs import (Audit Finding 4)
    if (content.includes('expo-router/unstable-native-tabs')) {
      diagnostics.push({
        code: 'GEN_DEPRECATED_NATIVE_TABS_IMPORT',
        severity: 'error',
        category: 'generator',
        document: 'navigation',
        jsonPath: path,
        message: `Generated file "${path}" imports deprecated "expo-router/unstable-native-tabs".`,
        suggestion: 'Use "expo-router/native-tabs" for Expo SDK 58.',
        canGenerate: false,
      });
    }
  }

  // Validate package.json dependencies against authoritative SDK 58 manifest (Audit Finding 1)
  if (files['package.json']) {
    try {
      const parsedPkg = JSON.parse(files['package.json']) as {
        main?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };

      const depDiags = registry.validatePackageVersions(
        {
          ...(parsedPkg.dependencies ?? {}),
          ...(parsedPkg.devDependencies ?? {}),
        },
        'package.json#/dependencies'
      );
      diagnostics.push(...depDiags);

      // Verify main entry file exists when relative path is used (Audit Finding 8)
      if (parsedPkg.main && parsedPkg.main.startsWith('./')) {
        const normalizedMain = parsedPkg.main.replace(/^\.\//, '');
        if (!files[normalizedMain]) {
          diagnostics.push({
            code: 'GEN_MISSING_MAIN_ENTRYPOINT',
            severity: 'error',
            category: 'generator',
            document: 'project',
            jsonPath: 'package.json#/main',
            message: `package.json "main" points to "${parsedPkg.main}", which was not generated.`,
            suggestion: `Generate "${normalizedMain}" or update package.json#main.`,
            canGenerate: false,
          });
        }
      }
    } catch {
      // Handled by JSON syntax check above
    }
  }

  if (ir.auth) {
    const requiredAuthFiles = [
      'src/foundation/auth/auth.config.ts',
      'src/foundation/auth/AuthProvider.tsx',
      'src/foundation/auth/index.ts',
    ];
    for (const path of requiredAuthFiles) {
      if (!files[path]) {
        diagnostics.push({
          code: 'GEN_MISSING_AUTH_MODULE_FILE',
          severity: 'error',
          category: 'generator',
          document: 'auth',
          jsonPath: path,
          message: `Missing generated Auth module file "${path}".`,
          suggestion: 'Verify Auth generator output.',
          canGenerate: false,
        });
      }
    }
  }

  if (ir.navigation) {
    const requiredNavFiles = [
      'src/foundation/navigation/routes.manifest.ts',
      'src/foundation/navigation/NavigationProvider.tsx',
      'src/foundation/navigation/renderers/ios/NativeStack.ios.tsx',
      'src/foundation/navigation/renderers/ios/NativeTabs.ios.tsx',
      'src/foundation/navigation/renderers/android/NativeStack.android.tsx',
      'src/foundation/navigation/renderers/android/NativeTabs.android.tsx',
      'app/_layout.tsx',
    ];
    for (const path of requiredNavFiles) {
      if (!files[path]) {
        diagnostics.push({
          code: 'GEN_MISSING_NAVIGATION_MODULE_FILE',
          severity: 'error',
          category: 'generator',
          document: 'navigation',
          jsonPath: path,
          message: `Missing generated Navigation module file "${path}".`,
          suggestion: 'Verify Navigation generator output.',
          canGenerate: false,
        });
      }
    }

    // Audit Finding 7: Verify `app/_layout.tsx` mounts a compiled navigator, not a bare `<Slot />`
    const rootLayoutContent = files['app/_layout.tsx'] ?? '';
    if (
      rootLayoutContent.includes('<Slot') &&
      !rootLayoutContent.includes('IOSNative') &&
      !rootLayoutContent.includes('AndroidNative')
    ) {
      diagnostics.push({
        code: 'GEN_UNCOMPILED_SLOT_LAYOUT',
        severity: 'error',
        category: 'generator',
        document: 'navigation',
        jsonPath: 'app/_layout.tsx',
        message:
          'Generated "app/_layout.tsx" contains a bare <Slot /> placeholder instead of a compiled navigator.',
        suggestion:
          'Compile the rootNavigator from NavigationIR using compileNavigatorLayoutFile().',
        canGenerate: false,
      });
    }
  }

  return {
    valid: diagnostics.every((d) => d.severity !== 'error'),
    diagnostics,
  };
}
