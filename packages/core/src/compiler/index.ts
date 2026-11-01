import type { AuthProviderConfig, ScreenRegistry } from '@expo-foundation/contracts';
import {
  CapabilityRegistry,
  defaultCapabilityRegistry,
} from '../capability-registry/index.js';
import type {
  AuthIR,
  AuthStateTransitionIR,
  FoundationIR,
  IntegrationIR,
  NavigationIR,
  PlatformIR,
  PlatformNavigatorResolutionIR,
  RouteGraphNodeIR,
  RouteGuardRuleIR,
} from '../ir/index.js';
import {
  migrateAuthDocument,
  migrateIntegrationDocument,
  migrateNavigationDocument,
} from '../schema/index.js';
import type {
  AuthConfigDocument,
  CompilationMode,
  Diagnostic,
  IntegrationConfigDocument,
  NavigationConfigDocument,
  RouteParamSchema,
} from '../types/index.js';
import {
  validateAuthDocument,
  validateIntegrationDocument,
  validateNavigationDocument,
} from '../validation/index.js';

export interface CompilerInput {
  projectId?: string;
  auth?: AuthConfigDocument | Record<string, unknown> | null;
  navigation?: NavigationConfigDocument | Record<string, unknown> | null;
  integration?: IntegrationConfigDocument | Record<string, unknown> | null;
  screenRegistry?: ScreenRegistry;
  requireRegisteredScreens?: boolean;
  capabilityRegistry?: CapabilityRegistry;
}

export interface CompilerStageReport {
  stage: number;
  name: string;
  status: 'passed' | 'warning' | 'failed' | 'skipped';
  durationMs: number;
  summary: string;
}

export interface CompilationResult {
  ir: FoundationIR | null;
  diagnostics: Diagnostic[];
  canGenerate: boolean;
  stages: CompilerStageReport[];
}

const CANONICAL_AUTH_TRANSITIONS: AuthStateTransitionIR[] = [
  { from: 'unknown', event: 'RESTORE_START', to: 'restoring' },
  { from: 'unknown', event: 'SKIP_RESTORE', to: 'anonymous' },
  { from: 'restoring', event: 'RESTORE_SUCCESS', to: 'authenticated' },
  { from: 'restoring', event: 'RESTORE_EMPTY', to: 'anonymous' },
  { from: 'restoring', event: 'RESTORE_EXPIRED', to: 'refreshing' },
  { from: 'restoring', event: 'RESTORE_ERROR', to: 'anonymous' },
  { from: 'anonymous', event: 'SIGN_IN_START', to: 'authenticating' },
  { from: 'anonymous', event: 'SIGN_UP_START', to: 'authenticating' },
  { from: 'authenticating', event: 'AUTH_SUCCESS', to: 'authenticated' },
  { from: 'authenticating', event: 'VERIFICATION_REQUIRED', to: 'verifying' },
  { from: 'authenticating', event: 'CHALLENGE_REQUIRED', to: 'challenge_required' },
  { from: 'authenticating', event: 'RECOVERY_REQUIRED', to: 'recovery_required' },
  { from: 'authenticating', event: 'AUTH_ERROR', to: 'error' },
  { from: 'verifying', event: 'VERIFY_SUCCESS', to: 'authenticated' },
  { from: 'verifying', event: 'VERIFY_COMPLETE_TO_LOGIN', to: 'anonymous' },
  { from: 'verifying', event: 'VERIFY_ERROR', to: 'error' },
  { from: 'challenge_required', event: 'CHALLENGE_SUCCESS', to: 'authenticated' },
  { from: 'challenge_required', event: 'CHALLENGE_ERROR', to: 'error' },
  { from: 'recovery_required', event: 'RECOVERY_SUCCESS', to: 'anonymous' },
  { from: 'recovery_required', event: 'RECOVERY_AUTHENTICATED', to: 'authenticated' },
  { from: 'authenticated', event: 'REFRESH_START', to: 'refreshing' },
  { from: 'authenticated', event: 'SIGN_OUT_START', to: 'signing_out' },
  { from: 'authenticated', event: 'SESSION_EXPIRED', to: 'anonymous' },
  { from: 'authenticated', event: 'ACCOUNT_SUSPENDED', to: 'error' },
  { from: 'refreshing', event: 'REFRESH_SUCCESS', to: 'authenticated' },
  { from: 'refreshing', event: 'REFRESH_FAILURE', to: 'anonymous' },
  { from: 'signing_out', event: 'SIGN_OUT_COMPLETE', to: 'anonymous' },
  { from: 'error', event: 'RESET_TO_ANONYMOUS', to: 'anonymous' },
  { from: 'error', event: 'SIGN_IN_START', to: 'authenticating' },
];

export class FoundationCompiler {
  private readonly capabilityRegistry: CapabilityRegistry;

  constructor(capabilityRegistry: CapabilityRegistry = defaultCapabilityRegistry) {
    this.capabilityRegistry = capabilityRegistry;
  }

  compile(input: CompilerInput): CompilationResult {
    const diagnostics: Diagnostic[] = [];
    const stages: CompilerStageReport[] = [];

    // Stage 1: Read & migrate project configuration
    const t1 = Date.now();
    let authDoc: AuthConfigDocument | null = null;
    let navDoc: NavigationConfigDocument | null = null;
    let intDoc: IntegrationConfigDocument | null = null;

    if (!input.auth && !input.navigation) {
      diagnostics.push({
        code: 'COMPILER_EMPTY_INPUT',
        severity: 'error',
        document: 'system',
        jsonPath: '/',
        message: 'ERROR: At least one of Auth or Navigation configuration must be provided.',
        suggestion: 'Supply auth.json, navigation.json, or both.',
        canGenerate: false,
      });
    }

    if (input.auth) {
      const migrated = migrateAuthDocument(input.auth as Record<string, unknown>);
      authDoc = migrated.document;
    }
    if (input.navigation) {
      const migrated = migrateNavigationDocument(input.navigation as Record<string, unknown>);
      navDoc = migrated.document;
    }
    if (input.integration) {
      const migrated = migrateIntegrationDocument(input.integration as Record<string, unknown>);
      intDoc = migrated.document;
    }

    const mode: 'auth-only' | 'navigation-only' | 'complete' =
      authDoc && navDoc ? 'complete' : authDoc ? 'auth-only' : 'navigation-only';

    stages.push({
      stage: 1,
      name: 'Read Project Configuration',
      status: diagnostics.length === 0 ? 'passed' : 'failed',
      durationMs: Date.now() - t1,
      summary: `Loaded configuration in "${mode}" mode.`,
    });

    // Stage 2 & 3 & 4: Schema Validation, Reference Resolution & Semantic Validation
    const t2 = Date.now();
    if (authDoc) {
      diagnostics.push(
        ...validateAuthDocument(authDoc, {
          screenRegistry: input.screenRegistry,
          requireRegisteredScreens: input.requireRegisteredScreens,
        })
      );
    }
    if (navDoc) {
      diagnostics.push(
        ...validateNavigationDocument(navDoc, {
          screenRegistry: input.screenRegistry,
          requireRegisteredScreens: input.requireRegisteredScreens,
        })
      );
    }
    if (intDoc) {
      diagnostics.push(
        ...validateIntegrationDocument(intDoc, {
          auth: authDoc,
          navigation: navDoc,
        })
      );
    }

    const schemaDiagnostics = diagnostics.filter((d) => d.code.startsWith('SCHEMA_'));
    const refDiagnostics = diagnostics.filter(
      (d) =>
        d.code.includes('REF') ||
        d.code.includes('UNKNOWN') ||
        d.code.includes('INITIAL_ROUTE')
    );
    const semanticDiagnostics = diagnostics.filter(
      (d) => !schemaDiagnostics.includes(d) && !refDiagnostics.includes(d)
    );

    stages.push({
      stage: 2,
      name: 'Schema Validation',
      status: schemaDiagnostics.some((d) => !d.canGenerate)
        ? 'failed'
        : schemaDiagnostics.length > 0
          ? 'warning'
          : 'passed',
      durationMs: Date.now() - t2,
      summary:
        schemaDiagnostics.length === 0
          ? 'All JSON documents match JSON Schema 2020-12 contracts.'
          : `${schemaDiagnostics.length} schema issue(s) found.`,
    });

    stages.push({
      stage: 3,
      name: 'Reference Resolution',
      status: refDiagnostics.some((d) => !d.canGenerate)
        ? 'failed'
        : refDiagnostics.length > 0
          ? 'warning'
          : 'passed',
      durationMs: 1,
      summary:
        refDiagnostics.length === 0
          ? 'All provider, route, navigator, screen, and flow references resolved.'
          : `${refDiagnostics.length} reference issue(s) detected.`,
    });

    stages.push({
      stage: 4,
      name: 'Semantic Validation',
      status: semanticDiagnostics.some((d) => !d.canGenerate)
        ? 'failed'
        : semanticDiagnostics.length > 0
          ? 'warning'
          : 'passed',
      durationMs: 1,
      summary:
        semanticDiagnostics.length === 0
          ? 'State machine transitions, route graph, and access policies are consistent.'
          : `${semanticDiagnostics.length} semantic diagnostic(s) emitted.`,
    });

    // If schema validation failed fatally, we cannot safely build IR
    if (schemaDiagnostics.length > 0 || (!authDoc && !navDoc)) {
      return {
        ir: null,
        diagnostics,
        canGenerate: false,
        stages,
      };
    }

    // Stage 5: Platform Capability Analysis
    const t5 = Date.now();
    const capDiagnostics: Diagnostic[] = [];
    const platformIR = this.buildPlatformIR(navDoc, authDoc, capDiagnostics);
    diagnostics.push(...capDiagnostics);

    stages.push({
      stage: 5,
      name: 'Platform Capability Analysis',
      status: capDiagnostics.some((d) => !d.canGenerate)
        ? 'failed'
        : capDiagnostics.length > 0
          ? 'warning'
          : 'passed',
      durationMs: Date.now() - t5,
      summary: `Resolved capabilities against Expo SDK ${this.capabilityRegistry.getSdkVersion()}.`,
    });

    // Stage 6: Generate Canonical IR
    const t6 = Date.now();
    const authIR = authDoc ? this.buildAuthIR(authDoc) : null;
    const navigationIR = navDoc ? this.buildNavigationIR(navDoc) : null;
    const integrationIR =
      intDoc || (authIR && navigationIR)
        ? this.buildIntegrationIR(intDoc, authIR, navigationIR)
        : null;

    const ir: FoundationIR = {
      projectMetadata: {
        projectId:
          input.projectId ??
          authDoc?.projectId ??
          navDoc?.projectId ??
          'expo-foundation-app',
        schemaVersion: authDoc?.schemaVersion ?? navDoc?.schemaVersion ?? '1.0.0',
        builderVersion: '1.0.0',
        sdkVersion: this.capabilityRegistry.getSdkVersion(),
        mode,
        compiledAt: new Date().toISOString(),
      },
      auth: authIR,
      navigation: navigationIR,
      integration: integrationIR,
      platform: platformIR,
    };

    const canGenerate = diagnostics.every((d) => d.canGenerate);

    stages.push({
      stage: 6,
      name: 'Generate Canonical IR',
      status: canGenerate ? 'passed' : 'failed',
      durationMs: Date.now() - t6,
      summary: `Normalized FoundationIR (${mode}).`,
    });

    return {
      ir,
      diagnostics,
      canGenerate,
      stages,
    };
  }

  private buildAuthIR(doc: AuthConfigDocument): AuthIR {
    const providerRef = doc.provider.ref;
    const externalConfig = doc.providers?.[providerRef];
    const primaryConfig: AuthProviderConfig = {
      type: doc.provider.type,
      ref: providerRef,
      ...(externalConfig ?? {}),
      ...(doc.provider.config ?? {}),
    };

    const providers: Record<string, AuthProviderConfig> = {
      ...(doc.providers ?? {}),
      [providerRef]: primaryConfig,
    };

    const events = Object.entries(doc.events ?? {}).map(([trigger, entry]) => {
      if (typeof entry === 'string') {
        return { trigger, emittedEvent: entry };
      }
      return {
        trigger,
        emittedEvent: entry.event,
        flowRef: entry.flowRef,
      };
    });

    const screenRefs: Record<string, string> = {};
    for (const [k, v] of Object.entries(doc.screenRefs)) {
      if (v) {
        screenRefs[k] = v;
      }
    }

    return {
      id: doc.id,
      enabled: doc.enabled,
      primaryProvider: {
        ref: providerRef,
        type: doc.provider.type,
        config: primaryConfig,
      },
      providers,
      authMethods: {
        password: Boolean(doc.methods.password),
        registration: Boolean(doc.methods.registration),
        emailVerification: Boolean(doc.methods.emailVerification),
        passwordReset: Boolean(doc.methods.passwordReset),
        phone: Boolean(doc.methods.phone),
        otp: Boolean(doc.methods.otp),
        oauth: Boolean(doc.methods.oauth),
        oidc: Boolean(doc.methods.oidc),
        google: Boolean(doc.methods.google),
        apple: Boolean(doc.methods.apple),
        facebook: Boolean(doc.methods.facebook),
        biometric: Boolean(doc.methods.biometric),
        mfa: Boolean(doc.methods.mfa),
        passkeys: Boolean(doc.methods.passkeys),
        multiAccount: Boolean(doc.methods.multiAccount),
        multiTenant: Boolean(doc.methods.multiTenant),
      },
      stateMachine: {
        initialStatus: doc.session.restoreOnLaunch ? 'restoring' : 'anonymous',
        statuses: [
          'unknown',
          'restoring',
          'anonymous',
          'authenticating',
          'authenticated',
          'refreshing',
          'verifying',
          'challenge_required',
          'signing_out',
          'recovery_required',
          'error',
        ],
        transitions: CANONICAL_AUTH_TRANSITIONS,
      },
      sessionPolicy: {
        restoreOnLaunch: doc.session.restoreOnLaunch,
        storage: doc.session.storage,
        refreshEnabled: doc.session.refreshEnabled,
        refreshStrategy: doc.session.refreshStrategy,
        refreshThresholdSeconds: doc.session.refreshThresholdSeconds ?? 60,
        rotateRefreshTokens: doc.session.rotateRefreshTokens ?? true,
        revokeOnLogout: doc.session.revokeOnLogout ?? true,
      },
      events,
      accessContext: {
        defaultRoles: doc.accessControl?.defaultRoles ?? ['user'],
        requireEmailVerification: doc.accessControl?.requireEmailVerification ?? doc.methods.emailVerification,
        supportedRoles: doc.accessControl?.supportedRoles ?? ['user', 'admin'],
        supportedPermissions: doc.accessControl?.supportedPermissions ?? [],
      },
      screenRefs,
    };
  }

  private buildNavigationIR(doc: NavigationConfigDocument): NavigationIR {
    const navigators: NavigationIR['navigators'] = {};
    const routes: NavigationIR['routes'] = {};
    const routeParameters: Record<string, Record<string, RouteParamSchema>> = {};
    const nodes: Record<string, RouteGraphNodeIR> = {};
    const screenRefsSet = new Set<string>();

    for (const nav of doc.navigators) {
      navigators[nav.id] = nav;
      nodes[nav.id] = {
        id: nav.id,
        kind: 'navigator',
        parentId: null,
        childrenIds: [...nav.children],
        depth: 0,
      };
    }

    for (const route of doc.routes) {
      routes[route.id] = route;
      screenRefsSet.add(route.screenRef);

      // Extract both explicit params and implicit :param from path
      const paramMap: Record<string, RouteParamSchema> = {
        ...(route.params ?? {}),
      };
      const pathParams = route.path.match(/:([a-zA-Z0-9_]+)/g) ?? [];
      for (const raw of pathParams) {
        const key = raw.slice(1);
        if (!paramMap[key]) {
          paramMap[key] = {
            type: 'string',
            required: true,
            source: 'path',
          };
        }
      }
      routeParameters[route.id] = paramMap;

      nodes[route.id] = {
        id: route.id,
        kind: 'route',
        parentId: route.navigatorId ?? null,
        childrenIds: [],
        depth: 0,
      };
    }

    // Link parents & compute depths and reachability
    const reachableRouteIds: string[] = [];
    const visited = new Set<string>();

    const traverse = (nodeId: string, parentId: string | null, depth: number) => {
      const node = nodes[nodeId];
      if (!node) return;
      node.parentId = parentId;
      node.depth = depth;
      if (node.kind === 'route') {
        if (!reachableRouteIds.includes(nodeId)) {
          reachableRouteIds.push(nodeId);
        }
        if (parentId && routes[nodeId] && !routes[nodeId].navigatorId) {
          routes[nodeId] = { ...routes[nodeId], navigatorId: parentId };
        }
        return;
      }
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      for (const childId of node.childrenIds) {
        traverse(childId, nodeId, depth + 1);
      }
    };

    if (nodes[doc.rootNavigator]) {
      traverse(doc.rootNavigator, null, 0);
    }

    const unreachableRouteIds = Object.keys(routes).filter(
      (id) => !reachableRouteIds.includes(id)
    );

    const iosMode: CompilationMode =
      doc.platforms.ios.mode ??
      (doc.platforms.ios.strictNative ? 'strict-native' : 'automatic-fallback');
    const androidMode: CompilationMode =
      doc.platforms.android.mode ?? 'automatic-fallback';

    return {
      id: doc.id,
      rootNavigatorId: doc.rootNavigator,
      routeGraph: {
        nodes,
        reachableRouteIds,
        unreachableRouteIds,
      },
      navigators,
      routes,
      routeParameters,
      linking: doc.linking ?? {
        scheme: 'expofoundation',
        hosts: ['example.com'],
        universalLinks: true,
        androidAppLinks: true,
      },
      navigationPolicies: {
        ios: {
          renderer: doc.platforms.ios.renderer,
          strictNative: doc.platforms.ios.strictNative,
          mode: iosMode,
        },
        android: {
          renderer: doc.platforms.android.renderer,
          fallback: doc.platforms.android.fallback,
          mode: androidMode,
        },
      },
      screenRefs: Array.from(screenRefsSet),
    };
  }

  private buildIntegrationIR(
    doc: IntegrationConfigDocument | null,
    authIR: AuthIR | null,
    navIR: NavigationIR | null
  ): IntegrationIR {
    const allRoutes = navIR ? Object.values(navIR.routes) : [];
    const defaultGuestRoute =
      allRoutes.find((r) => r.access === 'guest')?.id ??
      allRoutes[0]?.id ??
      'auth.login';
    const defaultAuthRoute =
      allRoutes.find((r) => r.access === 'authenticated')?.id ??
      allRoutes[0]?.id ??
      'app.home';

    const guestEntry = doc?.authNavigation.guestEntry ?? defaultGuestRoute;
    const authenticatedEntry = doc?.authNavigation.authenticatedEntry ?? defaultAuthRoute;

    const guards: RouteGuardRuleIR[] = allRoutes.map((route) => {
      const policy = route.access ?? 'public';
      let redirectOnDeny = guestEntry;
      if (policy === 'guest') {
        redirectOnDeny = authenticatedEntry;
      } else if (policy === 'verified' && doc?.authNavigation.verificationRoute) {
        redirectOnDeny = doc.authNavigation.verificationRoute;
      } else if (
        typeof policy === 'object' &&
        doc?.authNavigation.accessDeniedRoute
      ) {
        redirectOnDeny = doc.authNavigation.accessDeniedRoute;
      }
      return {
        routeId: route.id,
        path: route.path,
        policy,
        redirectOnDeny,
      };
    });

    const eventBindings: IntegrationIR['eventBindings'] = [
      {
        authEvent: 'auth.session.restoring',
        action: 'hold',
      },
      {
        authEvent: 'auth.session.restored',
        action: 'navigate',
        targetRoute: authenticatedEntry,
      },
      {
        authEvent: 'auth.login.success',
        action:
          (doc?.authNavigation.afterLogin ?? 'restore-intended-destination') ===
          'restore-intended-destination'
            ? 'restore-intended-destination'
            : 'navigate',
        targetRoute:
          doc?.authNavigation.afterLogin === 'restore-intended-destination'
            ? authenticatedEntry
            : (doc?.authNavigation.afterLogin ?? authenticatedEntry),
      },
      {
        authEvent: 'auth.registration.completed',
        action: 'navigate',
        targetRoute: doc?.authNavigation.afterRegistration ?? guestEntry,
      },
      {
        authEvent: 'auth.verification.required',
        action: 'navigate',
        targetRoute: doc?.authNavigation.verificationRoute ?? guestEntry,
      },
      {
        authEvent: 'auth.session.expired',
        action: 'reset',
        targetRoute: doc?.authNavigation.sessionExpiredRoute ?? guestEntry,
      },
      {
        authEvent: 'auth.logout.success',
        action: 'reset',
        targetRoute: doc?.authNavigation.afterLogout ?? guestEntry,
      },
      {
        authEvent: 'auth.access.changed',
        action: 'replace',
      },
      {
        authEvent: 'auth.account.suspended',
        action: 'reset',
        targetRoute: doc?.authNavigation.accountSuspendedRoute ?? guestEntry,
      },
    ];

    if (doc?.authNavigation.events) {
      for (const [evtName, binding] of Object.entries(doc.authNavigation.events)) {
        const existing = eventBindings.find(
          (b) => b.authEvent === evtName || b.authEvent === `auth.${evtName}`
        );
        if (existing) {
          if (binding.targetRoute) existing.targetRoute = binding.targetRoute;
          if (binding.flowRef) existing.flowRef = binding.flowRef;
          if (binding.action) existing.action = binding.action;
        } else {
          eventBindings.push({
            authEvent: evtName.startsWith('auth.') ? evtName : `auth.${evtName}`,
            action: binding.action ?? 'navigate',
            targetRoute: binding.targetRoute,
            flowRef: binding.flowRef,
          });
        }
      }
    }

    return {
      enabled: doc ? doc.authNavigation.enabled : Boolean(authIR && navIR),
      entryPoints: {
        guestEntry,
        authenticatedEntry,
        verificationRoute: doc?.authNavigation.verificationRoute,
        accessDeniedRoute: doc?.authNavigation.accessDeniedRoute,
        sessionExpiredRoute: doc?.authNavigation.sessionExpiredRoute,
        accountSuspendedRoute: doc?.authNavigation.accountSuspendedRoute,
      },
      redirects: {
        afterLogin: doc?.authNavigation.afterLogin ?? 'restore-intended-destination',
        afterRegistration: doc?.authNavigation.afterRegistration ?? guestEntry,
        afterLogout: doc?.authNavigation.afterLogout ?? guestEntry,
      },
      guards,
      roleRouteGroups: doc?.authNavigation.roleRouteGroups ?? {},
      eventBindings,
    };
  }

  private buildPlatformIR(
    navDoc: NavigationConfigDocument | null,
    authDoc: AuthConfigDocument | null,
    diagnostics: Diagnostic[]
  ): PlatformIR {
    const pkgProfile = this.capabilityRegistry.getPackagesProfile();
    const basePackages = new Set<string>(Object.keys(pkgProfile.corePackages));

    if (authDoc?.enabled) {
      for (const pkg of Object.keys(pkgProfile.authPackages)) {
        basePackages.add(pkg);
      }
      const pType = authDoc.provider.type;
      const optPkgs = (pkgProfile.optionalProviderPackages as Record<string, Record<string, string>>)[
        pType
      ];
      if (optPkgs) {
        for (const pkg of Object.keys(optPkgs)) {
          basePackages.add(pkg);
        }
      }
      if (authDoc.methods.oauth || authDoc.methods.oidc) {
        for (const pkg of Object.keys(pkgProfile.optionalProviderPackages.oidc)) {
          basePackages.add(pkg);
        }
      }
      if (authDoc.methods.biometric) {
        for (const pkg of Object.keys(pkgProfile.optionalProviderPackages.biometric)) {
          basePackages.add(pkg);
        }
      }
    }

    const iosResolutions: Record<string, PlatformNavigatorResolutionIR> = {};
    const androidResolutions: Record<string, PlatformNavigatorResolutionIR> = {};
    const iosPackages = new Set<string>(basePackages);
    const androidPackages = new Set<string>(basePackages);

    const iosMode: CompilationMode = navDoc
      ? (navDoc.platforms.ios.mode ??
        (navDoc.platforms.ios.strictNative ? 'strict-native' : 'automatic-fallback'))
      : 'strict-native';

    const androidMode: CompilationMode = navDoc
      ? (navDoc.platforms.android.mode ?? 'automatic-fallback')
      : 'automatic-fallback';

    if (navDoc) {
      for (const pkg of Object.keys(pkgProfile.navigationPackages)) {
        iosPackages.add(pkg);
        androidPackages.add(pkg);
      }

      navDoc.navigators.forEach((navigator, idx) => {
        const iosOut = this.capabilityRegistry.resolveNavigatorForPlatform(
          navigator,
          'ios',
          iosMode,
          idx
        );
        iosResolutions[navigator.id] = iosOut.resolution;
        diagnostics.push(...iosOut.diagnostics);

        const androidOut = this.capabilityRegistry.resolveNavigatorForPlatform(
          navigator,
          'android',
          androidMode,
          idx
        );
        androidResolutions[navigator.id] = androidOut.resolution;
        diagnostics.push(...androidOut.diagnostics);
      });
    }

    return {
      ios: {
        platform: 'ios',
        mode: iosMode,
        engine: 'expo-ui-swiftui',
        navigatorResolutions: iosResolutions,
        requiredPackages: Array.from(iosPackages),
      },
      android: {
        platform: 'android',
        mode: androidMode,
        engine: 'expo-ui-compose-router-hybrid',
        navigatorResolutions: androidResolutions,
        requiredPackages: Array.from(androidPackages),
      },
    };
  }
}

export const defaultFoundationCompiler = new FoundationCompiler();
