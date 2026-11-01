/**
 * @expo-foundation/core - Capability Registry & Authoritative SDK 58 Version Resolver
 *
 * Implements Section 9 (Workstreams A & B), Section 15 (Platform Capability Matrix),
 * and Audit Finding 1 remediation.
 */

import capabilitiesData from '../../../../compatibility/sdk-58/capabilities.json' with { type: 'json' };
import packagesData from '../../../../compatibility/sdk-58/packages.json' with { type: 'json' };
import rendererMapData from '../../../../compatibility/sdk-58/renderer-map.json' with { type: 'json' };
import type { ResolvedPlatformCapabilityIR } from '../ir/index.js';
import type {
  CompilationMode,
  Diagnostic,
  NavigatorType,
  PlatformTarget,
  VerificationStatus,
} from '../types/index.js';

export type CapabilitySupportLevel = 'native' | 'supported' | 'fallback' | 'unsupported';

export interface PlatformCapability {
  id: string;
  platform: PlatformTarget;
  support: CapabilitySupportLevel;
  minimumSdk: number;
  requiredPackages: string[];
  implementation: string;
  fallback?: string;
  limitations?: string[];
  verificationStatus: VerificationStatus;
}

export interface SdkPackageManifest {
  sdkVersion: number;
  expoVersion: string;
  reactNativeVersion: string;
  reactVersion: string;
  packages: Record<string, string>;
  devPackages: Record<string, string>;
}

const CAPABILITY_ID_BY_NAVIGATOR_TYPE: Record<NavigatorType, string> = {
  stack: 'navigation.stack',
  tabs: 'navigation.tabs',
  split: 'navigation.split',
  drawer: 'navigation.drawer',
  modal: 'navigation.modal',
};

export function navigatorTypeToCapabilityId(type: NavigatorType): string {
  return CAPABILITY_ID_BY_NAVIGATOR_TYPE[type] ?? `navigation.${type}`;
}

export class CapabilityRegistry {
  private readonly sdkVersion: number;
  private readonly capabilities: PlatformCapability[];
  private readonly packageManifest: SdkPackageManifest;
  private readonly rendererMap: typeof rendererMapData;

  constructor(
    customCapabilities?: PlatformCapability[],
    customPackages?: SdkPackageManifest
  ) {
    this.sdkVersion = capabilitiesData.sdkVersion;
    this.capabilities =
      customCapabilities ?? (capabilitiesData.capabilities as PlatformCapability[]);
    this.packageManifest = customPackages ?? (packagesData as SdkPackageManifest);
    this.rendererMap = rendererMapData;
  }

  getSdkVersion(): number {
    return this.sdkVersion;
  }

  getPackageManifest(): SdkPackageManifest {
    return this.packageManifest;
  }

  getRendererMap(): typeof rendererMapData {
    return this.rendererMap;
  }

  listCapabilities(platform?: PlatformTarget): PlatformCapability[] {
    if (!platform) {
      return [...this.capabilities];
    }
    return this.capabilities.filter((cap) => cap.platform === platform);
  }

  getCapability(id: string, platform: PlatformTarget): PlatformCapability | undefined {
    return this.capabilities.find((cap) => cap.id === id && cap.platform === platform);
  }

  /**
   * Authoritative SDK 58 dependency version resolver (Audit Finding 1).
   * Validates that every resolved Expo package matches the SDK 58 compatibility profile
   * and rejects pre-SDK-55/58 legacy versioning (e.g. ~4.0.0, ~14.0.0, ~0.1.0, ~52.0.0).
   */
  validatePackageVersions(
    packages: Record<string, string>,
    jsonPath = '/dependencies'
  ): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const expectedAll: Record<string, string> = {
      expo: this.packageManifest.expoVersion,
      react: this.packageManifest.reactVersion,
      'react-native': this.packageManifest.reactNativeVersion,
      ...this.packageManifest.packages,
      ...this.packageManifest.devPackages,
    };

    for (const [pkgName, actualVersion] of Object.entries(packages)) {
      const expectedVersion = expectedAll[pkgName];
      if (!expectedVersion) {
        continue;
      }

      if (actualVersion !== expectedVersion) {
        diagnostics.push({
          code: 'SDK_INCOMPATIBLE_PACKAGE_VERSION',
          severity: 'error',
          category: 'build',
          document: 'project',
          jsonPath: `${jsonPath}/${pkgName}`,
          message: `Package "${pkgName}" has version "${actualVersion}", which does not match the authoritative Expo SDK ${this.sdkVersion} version "${expectedVersion}".`,
          suggestion: `Use "${expectedVersion}" from compatibility/sdk-58/packages.json.`,
          canGenerate: false,
        });
      }
    }

    return diagnostics;
  }

  /**
   * Resolves how a navigator capability will be compiled on a target platform
   * under the requested compilation mode ('strict-native' | 'automatic-fallback' | 'diagnostic').
   */
  resolveNavigatorCapability(params: {
    navigatorId: string;
    navigatorType: NavigatorType;
    platform: PlatformTarget;
    mode: CompilationMode;
    jsonPath: string;
    androidRendererPreference?: 'auto' | 'expo-ui-compose' | 'expo-router';
    androidFallbackPreference?: 'expo-router' | 'native-tabs';
  }): {
    resolved: ResolvedPlatformCapabilityIR;
    diagnostics: Diagnostic[];
  } {
    const capabilityId = navigatorTypeToCapabilityId(params.navigatorType);
    const cap = this.getCapability(capabilityId, params.platform);
    const diagnostics: Diagnostic[] = [];

    if (!cap || cap.support === 'unsupported') {
      diagnostics.push({
        code: 'CAP_UNSUPPORTED_PRIMITIVE',
        severity: 'error',
        category: 'capability',
        document: 'navigation',
        jsonPath: params.jsonPath,
        platform: params.platform,
        message: `Navigator "${params.navigatorId}" of type "${params.navigatorType}" (${capabilityId}) is unsupported on ${params.platform} for Expo SDK ${this.sdkVersion}.`,
        suggestion: `Choose a supported navigator type for ${params.platform} or configure a platform-specific route layout.`,
        canGenerate: false,
      });
      return {
        resolved: {
          capabilityId,
          platform: params.platform,
          support: 'unsupported',
          implementation: 'unsupported',
          fallbackUsed: false,
          requiredPackages: [],
        },
        diagnostics,
      };
    }

    if (cap.support === 'fallback') {
      if (params.mode === 'strict-native') {
        diagnostics.push({
          code: 'CAP_STRICT_NATIVE_VIOLATION',
          severity: 'error',
          category: 'capability',
          document: 'navigation',
          jsonPath: params.jsonPath,
          platform: params.platform,
          message: `Navigator "${params.navigatorId}" (${capabilityId}) on ${params.platform} requires fallback "${cap.fallback ?? cap.implementation}", which is disallowed in strict-native mode.`,
          suggestion: `Switch ${params.platform} mode to "automatic-fallback" or replace "${params.navigatorType}" with a native-supported primitive.`,
          canGenerate: false,
        });
      } else {
        diagnostics.push({
          code: 'CAP_FALLBACK_APPLIED',
          severity: params.mode === 'diagnostic' ? 'info' : 'warning',
          category: 'capability',
          document: 'navigation',
          jsonPath: params.jsonPath,
          platform: params.platform,
          message: `Navigator "${params.navigatorId}" (${capabilityId}) on ${params.platform} uses verified Expo Router fallback (${cap.fallback ?? cap.implementation}).`,
          suggestion:
            cap.limitations?.[0] ??
            `No action required; fallback is automatically configured for ${params.platform}.`,
          canGenerate: true,
        });
      }

      return {
        resolved: {
          capabilityId,
          platform: params.platform,
          support: 'fallback',
          implementation: cap.fallback ?? cap.implementation,
          fallbackUsed: true,
          fallbackImplementation: cap.fallback ?? cap.implementation,
          requiredPackages: cap.requiredPackages,
        },
        diagnostics,
      };
    }

    // Android tabs preference handling
    if (
      params.platform === 'android' &&
      params.navigatorType === 'tabs' &&
      params.androidRendererPreference === 'expo-router'
    ) {
      const fallbackImpl =
        params.androidFallbackPreference === 'native-tabs'
          ? 'expo-router/native-tabs#NativeTabs'
          : 'expo-router#Tabs';
      diagnostics.push({
        code: 'CAP_ANDROID_ROUTER_TABS_SELECTED',
        severity: 'info',
        category: 'capability',
        document: 'navigation',
        jsonPath: params.jsonPath,
        platform: 'android',
        message: `Navigator "${params.navigatorId}" on Android is configured to use ${fallbackImpl}.`,
        suggestion: 'Switch android.renderer to "auto" or "expo-ui-compose" to use Compose NavigationBar.',
        canGenerate: true,
      });

      return {
        resolved: {
          capabilityId,
          platform: params.platform,
          support: 'supported',
          implementation: fallbackImpl,
          fallbackUsed: true,
          fallbackImplementation: fallbackImpl,
          requiredPackages: ['expo-router'],
        },
        diagnostics,
      };
    }

    if (params.mode === 'diagnostic' && cap.limitations && cap.limitations.length > 0) {
      diagnostics.push({
        code: 'CAP_DIAGNOSTIC_NOTE',
        severity: 'info',
        category: 'capability',
        document: 'navigation',
        jsonPath: params.jsonPath,
        platform: params.platform,
        message: `Capability "${capabilityId}" on ${params.platform}: ${cap.limitations.join(' ')}`,
        suggestion: 'Verified compatible with Expo SDK 58.',
        canGenerate: true,
      });
    }

    return {
      resolved: {
        capabilityId,
        platform: params.platform,
        support: cap.support,
        implementation: cap.implementation,
        fallbackUsed: false,
        fallbackImplementation: cap.fallback,
        requiredPackages: cap.requiredPackages,
      },
      diagnostics,
    };
  }

  resolvePackageVersion(packageName: string): string {
    return (
      this.packageManifest.packages[packageName] ??
      this.packageManifest.devPackages[packageName] ??
      '*'
    );
  }
}
