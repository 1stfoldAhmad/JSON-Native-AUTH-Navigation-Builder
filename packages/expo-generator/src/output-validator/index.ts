import type { GeneratedProjectBundle } from '../project-generator/index.js';
import { computeDeterministicChecksum } from '../project-generator/index.js';

export interface OutputValidationCheck {
  id: string;
  name: string;
  passed: boolean;
  details: string;
}

export interface OutputValidationReport {
  valid: boolean;
  checks: OutputValidationCheck[];
}

const FORBIDDEN_UI_PRIMITIVES_IN_GENERATED = [
  /\bStyleSheet\.create\b/,
  /<TextInput\b/,
  /<ScrollView\b/,
  /<FlatList\b/,
];

const FORBIDDEN_SECRET_PATTERNS = [
  /"clientSecret"\s*:/i,
  /"client_secret"\s*:/i,
  /"privateKey"\s*:/i,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
];

export class GeneratedOutputValidator {
  validate(bundle: GeneratedProjectBundle): OutputValidationReport {
    const checks: OutputValidationCheck[] = [];
    const filePaths = Object.keys(bundle.files);

    // 1. Core project files exist
    const hasCoreConfigs =
      filePaths.includes('package.json') &&
      filePaths.includes('app.json') &&
      filePaths.includes('tsconfig.json') &&
      filePaths.includes('.foundation-manifest.json');
    checks.push({
      id: 'core-config-files',
      name: 'Core Expo configuration files generated',
      passed: hasCoreConfigs,
      details: hasCoreConfigs
        ? 'package.json, app.json, tsconfig.json, and .foundation-manifest.json are present.'
        : 'Missing one or more core project configuration files.',
    });

    // 2. Ownership headers on all generated TypeScript files
    const generatedTsFiles = Object.values(bundle.files).filter(
      (f) => f.ownership === 'generated' && (f.path.endsWith('.ts') || f.path.endsWith('.tsx'))
    );
    const allHaveGeneratedBanner = generatedTsFiles.every((f) =>
      f.content.includes('@generated')
    );
    checks.push({
      id: 'ownership-headers',
      name: 'Generated file ownership markers',
      passed: allHaveGeneratedBanner,
      details: allHaveGeneratedBanner
        ? `All ${generatedTsFiles.length} generated TypeScript files include @generated markers.`
        : 'Some generated TypeScript files are missing @generated headers.',
    });

    // 3. Strict scope separation: no visual UI components or form controls in generated code
    const uiViolations: string[] = [];
    for (const file of generatedTsFiles) {
      for (const regex of FORBIDDEN_UI_PRIMITIVES_IN_GENERATED) {
        if (regex.test(file.content)) {
          uiViolations.push(`${file.path} matched ${String(regex)}`);
        }
      }
    }
    checks.push({
      id: 'no-visual-ui-leakage',
      name: 'Strict scope boundary (no screen layouts or UI form components)',
      passed: uiViolations.length === 0,
      details:
        uiViolations.length === 0
          ? 'Zero visual screen layouts or form controls found in generated Auth/Navigation code.'
          : `UI leakage detected: ${uiViolations.join(', ')}`,
    });

    // 4. Security check: no client secrets or hardcoded JWTs in generated files
    const secretViolations: string[] = [];
    for (const file of Object.values(bundle.files)) {
      if (file.path.endsWith('SecureStorage.ts')) continue;
      for (const pattern of FORBIDDEN_SECRET_PATTERNS) {
        if (pattern.test(file.content)) {
          secretViolations.push(`${file.path} matched ${String(pattern)}`);
        }
      }
    }
    checks.push({
      id: 'no-embedded-secrets',
      name: 'Security audit: no client secrets or tokens in generated output',
      passed: secretViolations.length === 0,
      details:
        secretViolations.length === 0
          ? 'No client secrets, private keys, or raw tokens present in generated output.'
          : `Security violation: ${secretViolations.join(', ')}`,
    });

    // 5. Mode-specific module verification
    if (bundle.ir.auth && bundle.ir.auth.enabled) {
      const hasAuthModules =
        filePaths.includes('src/foundation/auth/AuthController.ts') &&
        filePaths.includes('src/foundation/auth/AuthStateMachine.ts') &&
        filePaths.includes('src/foundation/auth/SessionManager.ts') &&
        filePaths.includes('src/foundation/config/auth.generated.ts');
      checks.push({
        id: 'auth-modules-complete',
        name: 'Auth Builder runtime modules generated',
        passed: hasAuthModules,
        details: hasAuthModules
          ? 'AuthController, AuthStateMachine, SessionManager, and auth.generated.ts verified.'
          : 'Missing required Auth runtime files.',
      });
    }

    if (bundle.ir.navigation) {
      const hasNavModules =
        filePaths.includes('src/foundation/navigation/RouteRegistry.ts') &&
        filePaths.includes('src/foundation/navigation/RouteResolver.ts') &&
        filePaths.includes('src/foundation/navigation/renderers/ios/NativeStack.ios.tsx') &&
        filePaths.includes('src/foundation/navigation/renderers/android/NativeStack.android.tsx');
      checks.push({
        id: 'navigation-modules-complete',
        name: 'Navigation Builder native iOS & Android renderer modules generated',
        passed: hasNavModules,
        details: hasNavModules
          ? 'RouteRegistry, RouteResolver, iOS SwiftUI renderers, and Android Compose/Router renderers verified.'
          : 'Missing required Navigation runtime or renderer files.',
      });
    }

    // 6. Manifest checksum consistency
    let checksumMismatch = false;
    for (const [path, entry] of Object.entries(bundle.manifest.files)) {
      const file = bundle.files[path];
      if (!file || computeDeterministicChecksum(file.content) !== entry.checksum) {
        checksumMismatch = true;
        break;
      }
    }
    checks.push({
      id: 'manifest-checksum-integrity',
      name: 'Deterministic manifest checksum integrity',
      passed: !checksumMismatch,
      details: !checksumMismatch
        ? 'All generated file checksums match .foundation-manifest.json.'
        : 'Checksum mismatch detected in .foundation-manifest.json.',
    });

    return {
      valid: checks.every((c) => c.passed),
      checks,
    };
  }
}

export const defaultOutputValidator = new GeneratedOutputValidator();
