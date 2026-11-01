import { defaultCapabilityRegistry, type FoundationIR } from '@expo-foundation/core';

export interface ResolvedDependencies {
  sdkVersion: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

export class DependencyManager {
  resolveForIR(ir: FoundationIR): ResolvedDependencies {
    const profile = defaultCapabilityRegistry.getPackagesProfile();
    const dependencies: Record<string, string> = {
      ...profile.corePackages,
    };

    if (ir.navigation) {
      Object.assign(dependencies, profile.navigationPackages);
    }

    if (ir.auth && ir.auth.enabled) {
      Object.assign(dependencies, profile.authPackages);

      const providerType = ir.auth.primaryProvider.type;
      const optionalGroup = (
        profile.optionalProviderPackages as Record<string, Record<string, string>>
      )[providerType];
      if (optionalGroup) {
        Object.assign(dependencies, optionalGroup);
      }

      if (ir.auth.authMethods.oauth || ir.auth.authMethods.oidc) {
        Object.assign(dependencies, profile.optionalProviderPackages.oidc);
      }
      if (ir.auth.authMethods.apple) {
        Object.assign(dependencies, profile.optionalProviderPackages.apple);
      }
      if (ir.auth.authMethods.google) {
        Object.assign(dependencies, profile.optionalProviderPackages.google);
      }
      if (ir.auth.authMethods.biometric) {
        Object.assign(dependencies, profile.optionalProviderPackages.biometric);
      }
    }

    // Sort keys deterministically
    const sortedDeps: Record<string, string> = {};
    for (const key of Object.keys(dependencies).sort()) {
      sortedDeps[key] = dependencies[key];
    }

    const sortedDevDeps: Record<string, string> = {};
    for (const key of Object.keys(profile.devPackages).sort()) {
      sortedDevDeps[key] = (profile.devPackages as Record<string, string>)[key];
    }

    return {
      sdkVersion: profile.sdkVersion,
      dependencies: sortedDeps,
      devDependencies: sortedDevDeps,
    };
  }
}

export const defaultDependencyManager = new DependencyManager();
