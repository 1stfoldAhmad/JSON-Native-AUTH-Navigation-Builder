import type {
  CompilationMode,
  Diagnostic,
  NavigatorDefinition,
  PlatformTarget,
} from '../types/index.js';
import type { PlatformNavigatorResolutionIR } from '../ir/index.js';

import sdk58CapabilitiesJson from '../../../../compatibility/sdk-58/capabilities.json' with { type: 'json' };
import sdk58PackagesJson from '../../../../compatibility/sdk-58/packages.json' with { type: 'json' };
import sdk58RendererMapJson from '../../../../compatibility/sdk-58/renderer-map.json' with { type: 'json' };

export type CapabilitySupportLevel = 'native' | 'supported' | 'fallback' | 'unsupported';

export interface CapabilityDefinition {
  id: string;
  platform: PlatformTarget;
  support: CapabilitySupportLevel;
  minimumSdk?: number;
  requiredPackages?: string[];
  implementation?: string;
  fallback?: string;
  limitations?: string[];
  verificationStatus?: 'verified' | 'experimental' | 'unverified';
}

export interface CapabilityResolutionOutcome {
  capability: CapabilityDefinition;
  resolvedImplementation: string;
  usedFallback: boolean;
  diagnostics: Diagnostic[];
}

export class CapabilityRegistry {
  private readonly capabilities: CapabilityDefinition[];
  private readonly sdkVersion: number;

  constructor(
    capabilities: CapabilityDefinition[] = sdk58CapabilitiesJson.capabilities as CapabilityDefinition[],
    sdkVersion: number = sdk58CapabilitiesJson.sdkVersion
  ) {
    this.capabilities = capabilities;
    this.sdkVersion = sdkVersion;
  }

  getSdkVersion(): number {
    return this.sdkVersion;
  }

  getPackagesProfile() {
    return sdk58PackagesJson;
  }

  getRendererMap() {
    return sdk58RendererMapJson;
  }

  listCapabilities(platform?: PlatformTarget): CapabilityDefinition[] {
    if (!platform) {
      return [...this.capabilities];
    }
    return this.capabilities.filter((cap) => cap.platform === platform);
  }

  getCapability(id: string, platform: PlatformTarget): CapabilityDefinition | undefined {
    return this.capabilities.find((cap) => cap.id === id && cap.platform === platform);
  }

  resolveCapability(
    capabilityId: string,
    platform: PlatformTarget,
    mode: CompilationMode,
    jsonPath = '/platforms'
  ): CapabilityResolutionOutcome {
    const diagnostics: Diagnostic[] = [];
    const cap = this.getCapability(capabilityId, platform);

    if (!cap) {
      diagnostics.push({
        code: 'CAP_UNKNOWN_CAPABILITY',
        severity: 'error',
        document: 'navigation',
        jsonPath,
        message: `Capability "${capabilityId}" is not registered for platform "${platform}" in SDK ${this.sdkVersion}.`,
        suggestion: `Choose a supported navigation type or check the SDK ${this.sdkVersion} compatibility matrix.`,
        canGenerate: false,
      });
      return {
        capability: {
          id: capabilityId,
          platform,
          support: 'unsupported',
        },
        resolvedImplementation: 'none',
        usedFallback: false,
        diagnostics,
      };
    }

    if (cap.support === 'unsupported') {
      diagnostics.push({
        code: 'CAP_UNSUPPORTED_FEATURE',
        severity: 'error',
        document: 'navigation',
        jsonPath,
        message: `Capability "${capabilityId}" is unsupported on "${platform}".`,
        suggestion: 'Remove this feature or restrict the route/navigator to supported platforms.',
        canGenerate: false,
      });
      return {
        capability: cap,
        resolvedImplementation: 'none',
        usedFallback: false,
        diagnostics,
      };
    }

    if (cap.support === 'fallback') {
      if (mode === 'strict-native') {
        diagnostics.push({
          code: 'CAP_STRICT_NATIVE_VIOLATION',
          severity: 'error',
          document: 'navigation',
          jsonPath,
          message: `Capability "${capabilityId}" on "${platform}" requires a fallback (${cap.fallback ?? cap.implementation}), which is disallowed in "strict-native" mode.`,
          suggestion: `Switch "${platform}" compilation mode to "automatic-fallback" or use a native capability.`,
          canGenerate: false,
        });
      } else if (mode === 'diagnostic') {
        diagnostics.push({
          code: 'CAP_DIAGNOSTIC_FALLBACK_REPORT',
          severity: 'warning',
          document: 'navigation',
          jsonPath,
          message: `Capability "${capabilityId}" on "${platform}" is not strictly native in Expo UI; approved fallback "${cap.fallback ?? cap.implementation}" will be used.`,
          suggestion: 'Review the platform capability matrix or approve automatic-fallback mode.',
          canGenerate: true,
        });
      }
      return {
        capability: cap,
        resolvedImplementation: cap.fallback ?? cap.implementation ?? 'expo-router',
        usedFallback: true,
        diagnostics,
      };
    }

    if (cap.limitations && cap.limitations.length > 0 && mode === 'diagnostic') {
      diagnostics.push({
        code: 'CAP_PLATFORM_QUALIFICATION',
        severity: 'info',
        document: 'navigation',
        jsonPath,
        message: `${cap.limitations.join(' ')}`,
        suggestion: 'Ensure custom router synchronization tests pass for this navigator.',
        canGenerate: true,
      });
    }

    return {
      capability: cap,
      resolvedImplementation: cap.implementation ?? 'native',
      usedFallback: false,
      diagnostics,
    };
  }

  resolveNavigatorForPlatform(
    navigator: NavigatorDefinition,
    platform: PlatformTarget,
    mode: CompilationMode,
    navigatorIndex: number
  ): {
    resolution: PlatformNavigatorResolutionIR;
    diagnostics: Diagnostic[];
  } {
    const capabilityMap: Record<NavigatorDefinition['type'], string> = {
      stack: 'navigation.stack',
      tabs: 'navigation.tabs',
      drawer: 'navigation.drawer',
      split: 'navigation.split',
      modal:
        navigator.modalOptions?.presentationStyle === 'fullScreen'
          ? 'navigation.fullscreen-modal'
          : 'navigation.modal',
    };

    const capabilityId = capabilityMap[navigator.type];
    const outcome = this.resolveCapability(
      capabilityId,
      platform,
      mode,
      `/navigators/${navigatorIndex}`
    );

    const rendererMap = sdk58RendererMapJson.renderers[platform].navigators as Record<
      string,
      {
        capabilityId: string;
        component: string;
        importPath: string;
        adapterModule: string;
      }
    >;
    const rendererEntry = rendererMap[navigator.type];

    return {
      resolution: {
        navigatorId: navigator.id,
        navigatorType: navigator.type,
        capabilityId,
        support: outcome.capability.support,
        component: rendererEntry?.component ?? outcome.resolvedImplementation,
        importPath: rendererEntry?.importPath ?? 'expo-router',
        adapterModule:
          rendererEntry?.adapterModule ??
          `renderers/${platform}/NativeStack.${platform}.tsx`,
        usedFallback: outcome.usedFallback,
        notes: outcome.capability.limitations ?? [],
      },
      diagnostics: outcome.diagnostics,
    };
  }
}

export const defaultCapabilityRegistry = new CapabilityRegistry();
