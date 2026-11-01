import type { AuthProviderConfig } from '@expo-foundation/contracts';
import { CapabilityRegistry } from '../capability-registry/index.js';
import type {
  AuthIR,
  IntegrationIR,
  NavigationIR,
  NavigatorIR,
  ProjectIR,
  RouteIR,
} from '../ir/index.js';
import type {
  AuthConfigDocument,
  CompilationMode,
  Diagnostic,
  IntegrationConfigDocument,
  NavigationConfigDocument,
  PlatformTarget,
} from '../types/index.js';
import {
  validateAuthSchema,
  validateAuthSemantics,
  validateIntegrationSchema,
  validateIntegrationSemantics,
  validateNavigationSchema,
  validateNavigationSemantics,
} from '../validation/index.js';

export interface CompilerInput {
  auth?: AuthConfigDocument;
  navigation?: NavigationConfigDocument;
  integration?: IntegrationConfigDocument;
  capabilityRegistry?: CapabilityRegistry;
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith('/')) {
    return `/${trimmed}`;
  }
  return trimmed.replace(/\/+/g, '/');
}

export class FoundationCompiler {
  private readonly capabilityRegistry: CapabilityRegistry;

  constructor(capabilityRegistry?: CapabilityRegistry) {
    this.capabilityRegistry = capabilityRegistry ?? new CapabilityRegistry();
  }

  compile(input: CompilerInput): ProjectIR {
    const registry = input.capabilityRegistry ?? this.capabilityRegistry;
    const diagnostics: Diagnostic[] = [];
    const requiredPackageNames = new Set<string>(['expo', 'react', 'react-native']);

    let authIR: AuthIR | undefined;
    let navigationIR: NavigationIR | undefined;
    let integrationIR: IntegrationIR | undefined;

    // 1. Validate & Compile Auth Document
    if (input.auth) {
      const schemaDiags = validateAuthSchema(input.auth);
      diagnostics.push(...schemaDiags);

      if (schemaDiags.length === 0) {
        const semanticDiags = validateAuthSemantics(input.auth);
        diagnostics.push(...semanticDiags);
        authIR = this.buildAuthIR(input.auth);
        for (const pkg of authIR.requiredPackages) {
          requiredPackageNames.add(pkg);
        }
      }
    }

    // 2. Validate & Compile Navigation Document
    if (input.navigation) {
      const schemaDiags = validateNavigationSchema(input.navigation);
      diagnostics.push(...schemaDiags);

      if (schemaDiags.length === 0) {
        const semanticDiags = validateNavigationSemantics(input.navigation);
        diagnostics.push(...semanticDiags);

        const navResult = this.buildNavigationIR(input.navigation, registry);
        navigationIR = navResult.ir;
        diagnostics.push(...navResult.diagnostics);
        for (const pkg of navigationIR.requiredPackages) {
          requiredPackageNames.add(pkg);
        }
      }
    }

    // 3. Validate & Compile Integration Document
    if (input.integration) {
      const schemaDiags = validateIntegrationSchema(input.integration);
      diagnostics.push(...schemaDiags);

      if (schemaDiags.length === 0) {
        const semanticDiags = validateIntegrationSemantics(
          input.integration,
          input.navigation,
          input.auth
        );
        diagnostics.push(...semanticDiags);
        integrationIR = this.buildIntegrationIR(input.integration);
      }
    }

    // 4. Resolve package versions from SDK 58 Compatibility Profile & validate them
    const manifest = registry.getPackageManifest();
    const requiredPackages: Record<string, string> = {
      expo: manifest.expoVersion,
      react: manifest.reactVersion,
      'react-native': manifest.reactNativeVersion,
    };

    for (const pkg of requiredPackageNames) {
      if (pkg === 'expo' || pkg === 'react' || pkg === 'react-native') continue;
      requiredPackages[pkg] = registry.resolvePackageVersion(pkg);
    }

    const versionDiagnostics = registry.validatePackageVersions(requiredPackages);
    diagnostics.push(...versionDiagnostics);

    const hasBlockingErrors = diagnostics.some(
      (d) => d.severity === 'error' || !d.canGenerate
    );

    const projectId =
      input.navigation?.projectId ??
      input.auth?.projectId ??
      input.integration?.projectId ??
      input.navigation?.id ??
      input.auth?.id ??
      'expo-foundation-app';

    const schemaVersion =
      input.navigation?.schemaVersion ??
      input.auth?.schemaVersion ??
      input.integration?.schemaVersion ??
      '1.0.0';

    const targetPlatforms: PlatformTarget[] =
      input.navigation?.target?.platforms ??
      input.auth?.target?.platforms ??
      ['ios', 'android'];

    return {
      sdkVersion: registry.getSdkVersion(),
      metadata: {
        projectId,
        schemaVersion,
        target: {
          expoSdk: registry.getSdkVersion(),
          platforms: targetPlatforms,
        },
      },
      auth: authIR,
      navigation: navigationIR,
      integration: integrationIR,
      requiredPackages,
      diagnostics,
      canGenerate: !hasBlockingErrors,
    };
  }

  private buildAuthIR(doc: AuthConfigDocument): AuthIR {
    const requiredPackages = new Set<string>();

    if (doc.session.storage === 'secure-store') {
      requiredPackages.add('expo-secure-store');
    }

    if (
      doc.methods.oauth ||
      doc.methods.oidc ||
      doc.methods.google ||
      doc.methods.facebook ||
      doc.provider.type === 'oidc' ||
      doc.provider.type === 'oauth' ||
      doc.provider.type === 'google' ||
      doc.provider.type === 'facebook'
    ) {
      requiredPackages.add('expo-auth-session');
      requiredPackages.add('expo-crypto');
      requiredPackages.add('expo-web-browser');
    }

    if (doc.methods.apple || doc.provider.type === 'apple') {
      requiredPackages.add('expo-apple-authentication');
    }

    if (doc.methods.biometric) {
      requiredPackages.add('expo-local-authentication');
    }

    if (doc.provider.type === 'supabase') {
      requiredPackages.add('@supabase/supabase-js');
    } else if (doc.provider.type === 'firebase') {
      requiredPackages.add('firebase');
    } else if (doc.provider.type === 'clerk') {
      requiredPackages.add('@clerk/clerk-expo');
    }

    const baseProviderConfig: AuthProviderConfig =
      doc.providers?.[doc.provider.ref] ?? {
        type: doc.provider.type,
        ref: doc.provider.ref,
        ...(doc.provider.config ?? {}),
      };

    const eventFlows: Record<string, string> = {};
    if (doc.events) {
      for (const [key, val] of Object.entries(doc.events)) {
        const flowRef = typeof val === 'string' ? val : val.flowRef;
        if (flowRef) {
          eventFlows[key] = flowRef;
        }
      }
    }

    const screenRefs: Record<string, string> = {};
    for (const [k, v] of Object.entries(doc.screenRefs)) {
      if (v) screenRefs[k] = v;
    }

    return {
      id: doc.id,
      schemaVersion: doc.schemaVersion,
      enabled: doc.enabled,
      providerType: doc.provider.type,
      providerRef: doc.provider.ref,
      providerConfig: baseProviderConfig,
      session: {
        ...doc.session,
        refreshThresholdSeconds: doc.session.refreshThresholdSeconds ?? 60,
        rotateRefreshTokens: doc.session.rotateRefreshTokens ?? true,
        revokeOnLogout: doc.session.revokeOnLogout ?? true,
      },
      methods: doc.methods,
      screenRefs,
      eventFlows,
      defaultRoles: doc.accessControl?.defaultRoles ?? ['user'],
      requireEmailVerification: doc.accessControl?.requireEmailVerification ?? false,
      requiredPackages: Array.from(requiredPackages),
    };
  }

  private buildNavigationIR(
    doc: NavigationConfigDocument,
    registry: CapabilityRegistry
  ): {
    ir: NavigationIR;
    diagnostics: Diagnostic[];
  } {
    const diagnostics: Diagnostic[] = [];
    const requiredPackages = new Set<string>([
      'expo-router',
      'expo-linking',
      'expo-status-bar',
      'react-native-safe-area-context',
      'react-native-screens',
    ]);

    const iosMode: CompilationMode =
      doc.platforms.ios.mode ??
      (doc.platforms.ios.strictNative ? 'strict-native' : 'automatic-fallback');

    const androidMode: CompilationMode =
      doc.platforms.android.mode ?? 'automatic-fallback';

    const navIds = new Set(doc.navigators.map((n) => n.id));
    const routeIds = new Set(doc.routes.map((r) => r.id));

    // Map child navigator -> parent navigator ID
    const parentNavByChild = new Map<string, string>();
    for (const nav of doc.navigators) {
      for (const childId of nav.children) {
        if (navIds.has(childId)) {
          parentNavByChild.set(childId, nav.id);
        }
      }
    }

    const navigators: Record<string, NavigatorIR> = {};
    doc.navigators.forEach((nav, idx) => {
      const jsonPath = `/navigators/${idx}`;

      const iosRes = registry.resolveNavigatorCapability({
        navigatorId: nav.id,
        navigatorType: nav.type,
        platform: 'ios',
        mode: iosMode,
        jsonPath,
      });

      const androidRes = registry.resolveNavigatorCapability({
        navigatorId: nav.id,
        navigatorType: nav.type,
        platform: 'android',
        mode: androidMode,
        jsonPath,
        androidRendererPreference: doc.platforms.android.renderer,
        androidFallbackPreference: doc.platforms.android.fallback,
      });

      diagnostics.push(...iosRes.diagnostics, ...androidRes.diagnostics);

      for (const pkg of iosRes.resolved.requiredPackages) {
        requiredPackages.add(pkg);
      }
      for (const pkg of androidRes.resolved.requiredPackages) {
        requiredPackages.add(pkg);
      }

      const childRoutes = nav.children.filter((c) => routeIds.has(c));
      const childNavigators = nav.children.filter((c) => navIds.has(c));
      const initialRoute = nav.initialRoute ?? nav.children[0] ?? '';

      navigators[nav.id] = {
        id: nav.id,
        type: nav.type,
        parentNavigatorId: parentNavByChild.get(nav.id),
        initialRoute,
        children: [...nav.children],
        childRoutes,
        childNavigators,
        stackOptions: nav.stackOptions,
        tabsOptions: nav.tabsOptions,
        modalOptions: nav.modalOptions,
        splitOptions: nav.splitOptions,
        iosCapability: iosRes.resolved,
        androidCapability: androidRes.resolved,
      };
    });

    // Map route parent navigator
    const parentNavigatorByRoute = new Map<string, string>();
    for (const nav of doc.navigators) {
      for (const childId of nav.children) {
        if (routeIds.has(childId) && !parentNavigatorByRoute.has(childId)) {
          parentNavigatorByRoute.set(childId, nav.id);
        }
      }
    }

    const routes: Record<string, RouteIR> = {};
    const routeOrder: string[] = [];

    for (const route of doc.routes) {
      routeOrder.push(route.id);
      const navigatorId =
        route.navigatorId ??
        parentNavigatorByRoute.get(route.id) ??
        doc.rootNavigator;

      routes[route.id] = {
        id: route.id,
        name: route.name ?? route.id,
        path: route.path,
        normalizedPath: normalizePath(route.path),
        screenRef: route.screenRef,
        navigatorId,
        params: route.params ?? {},
        access: route.access ?? 'public',
        options: route.options ?? {},
        deepLink: {
          enabled: route.deepLink?.enabled ?? true,
          aliases: route.deepLink?.aliases ?? [],
          universalLink: route.deepLink?.universalLink ?? false,
        },
        platforms: route.platforms ?? ['ios', 'android'],
      };
    }

    return {
      ir: {
        id: doc.id,
        schemaVersion: doc.schemaVersion,
        iosMode,
        androidMode,
        androidRendererPreference: doc.platforms.android.renderer,
        androidFallbackPreference: doc.platforms.android.fallback,
        rootNavigator: doc.rootNavigator,
        navigators,
        routes,
        routeOrder,
        linking: doc.linking ?? {
          scheme: doc.id.toLowerCase().replace(/[^a-z0-9]/g, '') || 'app',
          hosts: [],
          universalLinks: false,
          androidAppLinks: false,
        },
        requiredPackages: Array.from(requiredPackages),
      },
      diagnostics,
    };
  }

  private buildIntegrationIR(doc: IntegrationConfigDocument): IntegrationIR {
    const cfg = doc.authNavigation;
    return {
      schemaVersion: doc.schemaVersion,
      enabled: cfg.enabled,
      guestEntry: cfg.guestEntry,
      authenticatedEntry: cfg.authenticatedEntry,
      afterLogin: cfg.afterLogin,
      afterRegistration: cfg.afterRegistration,
      afterLogout: cfg.afterLogout,
      verificationRoute: cfg.verificationRoute,
      accessDeniedRoute: cfg.accessDeniedRoute,
      sessionExpiredRoute: cfg.sessionExpiredRoute,
      accountSuspendedRoute: cfg.accountSuspendedRoute,
      roleRouteGroups: cfg.roleRouteGroups ?? {},
      events: cfg.events ?? {},
    };
  }
}
