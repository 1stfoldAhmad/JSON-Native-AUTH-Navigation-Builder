import AjvModule from 'ajv';
import type { ErrorObject } from 'ajv';
import {
  isValidFlowId,
  isValidScreenId,
  type ScreenRegistry,
} from '@expo-foundation/contracts';
import {
  AUTH_JSON_SCHEMA,
  INTEGRATION_JSON_SCHEMA,
  NAVIGATION_JSON_SCHEMA,
} from '../schema/index.js';
import type {
  AuthConfigDocument,
  Diagnostic,
  IntegrationConfigDocument,
  NavigationConfigDocument,
} from '../types/index.js';

const AjvConstructor =
  (AjvModule as unknown as { default?: unknown }).default ?? AjvModule;

const ajv = new (AjvConstructor as new (opts?: Record<string, unknown>) => {
  compile: (schema: object) => {
    (data: unknown): boolean;
    errors?: ErrorObject[] | null;
  };
})({
  allErrors: true,
  strict: false,
});

const validateAuthAjv = ajv.compile(AUTH_JSON_SCHEMA);
const validateNavigationAjv = ajv.compile(NAVIGATION_JSON_SCHEMA);
const validateIntegrationAjv = ajv.compile(INTEGRATION_JSON_SCHEMA);

const SAFE_JSON_PATH_REGEX = /^\$(\.[a-zA-Z_][a-zA-Z0-9_]*)+$/;

export function isValidJsonMappingExpression(expr: string): boolean {
  if (typeof expr !== 'string' || !SAFE_JSON_PATH_REGEX.test(expr)) {
    return false;
  }
  const forbiddenSegments = ['__proto__', 'constructor', 'prototype'];
  const parts = expr.split('.').slice(1);
  return !parts.some((p) => forbiddenSegments.includes(p));
}

function formatAjvErrors(
  errors: ErrorObject[] | null | undefined,
  document: 'auth' | 'navigation' | 'integration'
): Diagnostic[] {
  if (!errors || errors.length === 0) {
    return [];
  }
  return errors.map((err) => ({
    code: `SCHEMA_${document.toUpperCase()}_INVALID`,
    severity: 'error',
    document,
    jsonPath: err.instancePath || '/',
    message: `Schema validation failed at "${err.instancePath || '/'}": ${err.message ?? 'invalid value'}.`,
    suggestion:
      err.keyword === 'additionalProperties'
        ? `Remove unknown property "${String((err.params as Record<string, unknown>)?.additionalProperty)}".`
        : `Ensure "${err.instancePath || '/'}" satisfies schema rule "${err.keyword}".`,
    canGenerate: false,
  }));
}

export function validateAuthDocument(
  doc: unknown,
  options?: { screenRegistry?: ScreenRegistry; requireRegisteredScreens?: boolean }
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const valid = validateAuthAjv(doc);
  if (!valid) {
    diagnostics.push(...formatAjvErrors(validateAuthAjv.errors, 'auth'));
    return diagnostics;
  }

  const auth = doc as AuthConfigDocument;

  // Resolve provider configuration
  const providerRef = auth.provider.ref;
  const externalProvider = auth.providers?.[providerRef];
  const mergedProviderConfig = {
    type: auth.provider.type,
    ...(externalProvider ?? {}),
    ...(auth.provider.config ?? {}),
  };

  // Security check: never allow embedded clientSecret or privateKey
  const rawConfigString = JSON.stringify(mergedProviderConfig);
  if (
    /"clientSecret"\s*:/i.test(rawConfigString) ||
    /"client_secret"\s*:/i.test(rawConfigString) ||
    /"privateKey"\s*:/i.test(rawConfigString)
  ) {
    diagnostics.push({
      code: 'AUTH_EMBEDDED_CLIENT_SECRET',
      severity: 'error',
      document: 'auth',
      jsonPath: '/provider',
      message: 'ERROR: Client secret or private key must never be embedded in mobile Auth configuration.',
      suggestion: 'Use PKCE for OAuth/OIDC and keep secrets on the backend server only.',
      canGenerate: false,
    });
  }

  // REST provider checks
  if (auth.provider.type === 'rest') {
    const endpoints = mergedProviderConfig.endpoints as
      | Record<string, { method: string; path: string }>
      | undefined;

    if (auth.session.refreshEnabled && (!endpoints || !endpoints.refresh)) {
      diagnostics.push({
        code: 'AUTH_MISSING_REFRESH_ENDPOINT',
        severity: 'error',
        document: 'auth',
        jsonPath: '/provider/config/endpoints/refresh',
        message: 'ERROR: Refresh endpoint is not configured while session.refreshEnabled is true.',
        suggestion: 'Add an "endpoints.refresh" definition (e.g., POST /auth/refresh) or disable session.refreshEnabled.',
        canGenerate: false,
      });
    }

    const responseMapping = mergedProviderConfig.responseMapping as
      | Record<string, string | undefined>
      | undefined;
    if (responseMapping) {
      for (const [key, expr] of Object.entries(responseMapping)) {
        if (expr !== undefined && !isValidJsonMappingExpression(expr)) {
          diagnostics.push({
            code: 'AUTH_INVALID_TOKEN_MAPPING',
            severity: 'error',
            document: 'auth',
            jsonPath: `/provider/config/responseMapping/${key}`,
            message: `ERROR: Token response mapping "${expr}" for "${key}" is invalid. Only restricted "$." dot-path expressions are permitted.`,
            suggestion: `Use a safe JSON path expression such as "$.data.${key}".`,
            canGenerate: false,
          });
        }
      }
    }
  }

  // Session refresh rotation warning
  if (auth.session.refreshEnabled && auth.session.rotateRefreshTokens === undefined) {
    diagnostics.push({
      code: 'AUTH_MISSING_ROTATION_POLICY',
      severity: 'warning',
      document: 'auth',
      jsonPath: '/session/rotateRefreshTokens',
      message: 'WARNING: Refresh token rotation is not explicitly configured.',
      suggestion: 'Set "session.rotateRefreshTokens" to true or false explicitly.',
      canGenerate: true,
    });
  }

  // OAuth / OIDC redirect check
  if (
    (auth.methods.oauth || auth.methods.oidc || auth.provider.type === 'oidc' || auth.provider.type === 'oauth') &&
    !mergedProviderConfig.redirectUri
  ) {
    diagnostics.push({
      code: 'AUTH_MISSING_OAUTH_REDIRECT',
      severity: 'warning',
      document: 'auth',
      jsonPath: '/provider/config/redirectUri',
      message: 'WARNING: OAuth redirect scheme is missing.',
      suggestion: 'Configure "redirectUri" (e.g. "myapp://auth/callback") on the OAuth/OIDC provider.',
      canGenerate: true,
    });
  }

  // Email verification screen reference check
  if (auth.methods.emailVerification && !auth.screenRefs.verification) {
    diagnostics.push({
      code: 'AUTH_MISSING_VERIFICATION_SCREEN',
      severity: 'warning',
      document: 'auth',
      jsonPath: '/screenRefs/verification',
      message:
        'WARNING: Registration requires email verification but no verification screen reference exists.',
      suggestion: 'Set "screenRefs.verification" to a valid screen ID such as "screen.auth.verify".',
      canGenerate: true,
    });
  }

  // Screen reference format & optional registry check
  for (const [slot, screenId] of Object.entries(auth.screenRefs)) {
    if (!screenId) continue;
    if (!isValidScreenId(screenId)) {
      diagnostics.push({
        code: 'AUTH_INVALID_SCREEN_REF',
        severity: 'error',
        document: 'auth',
        jsonPath: `/screenRefs/${slot}`,
        message: `ERROR: Screen reference "${screenId}" for "${slot}" is invalid.`,
        suggestion: 'Use stable screen reference format "screen.<domain>.<name>".',
        canGenerate: false,
      });
    } else if (
      options?.requireRegisteredScreens &&
      options.screenRegistry &&
      !options.screenRegistry.has(screenId)
    ) {
      diagnostics.push({
        code: 'AUTH_UNRESOLVED_SCREEN_REF',
        severity: 'error',
        document: 'auth',
        jsonPath: `/screenRefs/${slot}`,
        message: `ERROR: Screen reference "${screenId}" is unresolved in the ScreenRegistry.`,
        suggestion: `Register "${screenId}" in the application ScreenRegistry.`,
        canGenerate: false,
      });
    }
  }

  // Flow reference validation in events
  if (auth.events) {
    for (const [key, value] of Object.entries(auth.events)) {
      if (typeof value === 'object' && value !== null && value.flowRef) {
        if (!isValidFlowId(value.flowRef)) {
          diagnostics.push({
            code: 'AUTH_INVALID_FLOW_REF',
            severity: 'error',
            document: 'auth',
            jsonPath: `/events/${key}/flowRef`,
            message: `ERROR: Flow reference "${value.flowRef}" is invalid.`,
            suggestion: 'Use format "flow.<domain>.<action>".',
            canGenerate: false,
          });
        }
      }
    }
  }

  return diagnostics;
}

export function validateNavigationDocument(
  doc: unknown,
  options?: { screenRegistry?: ScreenRegistry; requireRegisteredScreens?: boolean }
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const valid = validateNavigationAjv(doc);
  if (!valid) {
    diagnostics.push(...formatAjvErrors(validateNavigationAjv.errors, 'navigation'));
    return diagnostics;
  }

  const nav = doc as NavigationConfigDocument;

  const navigatorMap = new Map<string, (typeof nav.navigators)[number]>();
  const routeMap = new Map<string, (typeof nav.routes)[number]>();

  // Check duplicate navigator IDs
  nav.navigators.forEach((navigator, idx) => {
    if (navigatorMap.has(navigator.id)) {
      diagnostics.push({
        code: 'NAV_DUPLICATE_NAVIGATOR_ID',
        severity: 'error',
        document: 'navigation',
        jsonPath: `/navigators/${idx}/id`,
        message: `ERROR: Duplicate navigator ID "${navigator.id}".`,
        suggestion: 'Ensure every navigator has a globally unique ID.',
        canGenerate: false,
      });
    }
    navigatorMap.set(navigator.id, navigator);
  });

  // Check duplicate route IDs
  nav.routes.forEach((route, idx) => {
    if (routeMap.has(route.id) || navigatorMap.has(route.id)) {
      diagnostics.push({
        code: 'NAV_DUPLICATE_ROUTE_ID',
        severity: 'error',
        document: 'navigation',
        jsonPath: `/routes/${idx}/id`,
        message: `ERROR: Duplicate route ID "${route.id}".`,
        suggestion: 'Assign a unique stable ID to each route.',
        canGenerate: false,
      });
    }
    routeMap.set(route.id, route);
  });

  // Check rootNavigator exists
  if (!navigatorMap.has(nav.rootNavigator)) {
    diagnostics.push({
      code: 'NAV_UNKNOWN_ROOT_NAVIGATOR',
      severity: 'error',
      document: 'navigation',
      jsonPath: '/rootNavigator',
      message: `ERROR: Root navigator "${nav.rootNavigator}" does not exist.`,
      suggestion: 'Set "rootNavigator" to one of the defined navigator IDs.',
      canGenerate: false,
    });
  }

  // Validate each navigator's children, initialRoute, and options
  nav.navigators.forEach((navigator, idx) => {
    if (navigator.initialRoute) {
      const existsInRoutesOrNavs =
        routeMap.has(navigator.initialRoute) || navigatorMap.has(navigator.initialRoute);
      const isChild = navigator.children.includes(navigator.initialRoute);
      if (!existsInRoutesOrNavs || !isChild) {
        diagnostics.push({
          code: 'NAV_MISSING_INITIAL_ROUTE',
          severity: 'error',
          document: 'navigation',
          jsonPath: `/navigators/${idx}/initialRoute`,
          message: `ERROR: Initial route "${navigator.initialRoute}" does not exist in navigator "${navigator.id}".`,
          suggestion: `Set "initialRoute" to one of the children of "${navigator.id}".`,
          canGenerate: false,
        });
      }
    }

    navigator.children.forEach((childId, childIdx) => {
      if (!routeMap.has(childId) && !navigatorMap.has(childId)) {
        diagnostics.push({
          code: 'NAV_UNKNOWN_CHILD_REFERENCE',
          severity: 'error',
          document: 'navigation',
          jsonPath: `/navigators/${idx}/children/${childIdx}`,
          message: `ERROR: Navigator "${navigator.id}" references an unknown route or child navigator "${childId}".`,
          suggestion: `Define route "${childId}" in "/routes" or remove it from "${navigator.id}.children".`,
          canGenerate: false,
        });
      }
    });

    if (navigator.type === 'tabs' && navigator.tabsOptions?.preserveTabState === false) {
      diagnostics.push({
        code: 'NAV_TAB_STATE_WARNING',
        severity: 'warning',
        document: 'navigation',
        jsonPath: `/navigators/${idx}/tabsOptions/preserveTabState`,
        message: 'WARNING: Tab configuration may not preserve nested stack state.',
        suggestion: 'Enable "preserveTabState: true" so users keep their stack history when switching tabs.',
        canGenerate: true,
      });
    }
  });

  // Cycle detection & reachability traversal from rootNavigator
  const visitedNavigators = new Set<string>();
  const activeStack = new Set<string>();
  const reachableRoutes = new Set<string>();

  function dfs(nodeId: string): void {
    if (routeMap.has(nodeId)) {
      reachableRoutes.add(nodeId);
      return;
    }
    const navNode = navigatorMap.get(nodeId);
    if (!navNode) return;

    if (activeStack.has(nodeId)) {
      diagnostics.push({
        code: 'NAV_CYCLE_DETECTED',
        severity: 'error',
        document: 'navigation',
        jsonPath: '/navigators',
        message: `ERROR: Cyclic navigator hierarchy detected involving "${nodeId}".`,
        suggestion: 'Break the cycle in navigator children references.',
        canGenerate: false,
      });
      return;
    }

    if (visitedNavigators.has(nodeId)) return;
    visitedNavigators.add(nodeId);
    activeStack.add(nodeId);

    for (const childId of navNode.children) {
      dfs(childId);
    }

    activeStack.delete(nodeId);
  }

  if (navigatorMap.has(nav.rootNavigator)) {
    dfs(nav.rootNavigator);
  }

  // Validate routes (screenRef, reachability, dynamic parameters)
  nav.routes.forEach((route, idx) => {
    if (!isValidScreenId(route.screenRef)) {
      diagnostics.push({
        code: 'NAV_INVALID_SCREEN_REF',
        severity: 'error',
        document: 'navigation',
        jsonPath: `/routes/${idx}/screenRef`,
        message: `ERROR: Screen reference "${route.screenRef}" on route "${route.id}" is invalid.`,
        suggestion: 'Use stable screen reference ID format "screen.<domain>.<name>".',
        canGenerate: false,
      });
    } else if (
      options?.requireRegisteredScreens &&
      options.screenRegistry &&
      !options.screenRegistry.has(route.screenRef)
    ) {
      diagnostics.push({
        code: 'NAV_UNRESOLVED_SCREEN_REF',
        severity: 'error',
        document: 'navigation',
        jsonPath: `/routes/${idx}/screenRef`,
        message: `ERROR: Screen reference "${route.screenRef}" is unresolved.`,
        suggestion: `Register "${route.screenRef}" in the ScreenRegistry before production validation.`,
        canGenerate: false,
      });
    }

    if (navigatorMap.has(nav.rootNavigator) && !reachableRoutes.has(route.id)) {
      diagnostics.push({
        code: 'NAV_UNREACHABLE_ROUTE',
        severity: 'warning',
        document: 'navigation',
        jsonPath: `/routes/${idx}`,
        message: `WARNING: Route "${route.id}" is unreachable from root navigator "${nav.rootNavigator}".`,
        suggestion: `Add "${route.id}" to a navigator's "children" array or remove the unused route.`,
        canGenerate: true,
      });
    }

    // Dynamic path parameter check
    const pathMatches = route.path.match(/:([a-zA-Z0-9_]+)/g) ?? [];
    for (const match of pathMatches) {
      const paramName = match.slice(1);
      if (!route.params || !route.params[paramName]) {
        diagnostics.push({
          code: 'NAV_MISSING_PATH_PARAM_SCHEMA',
          severity: 'warning',
          document: 'navigation',
          jsonPath: `/routes/${idx}/params`,
          message: `WARNING: Route "${route.id}" path "${route.path}" includes dynamic parameter ":${paramName}" without an explicit parameter schema.`,
          suggestion: `Define "params.${paramName}" on route "${route.id}" for compile-time TypeScript safety.`,
          canGenerate: true,
        });
      }
    }
  });

  return diagnostics;
}

export function validateIntegrationDocument(
  doc: unknown,
  context?: {
    auth?: AuthConfigDocument | null;
    navigation?: NavigationConfigDocument | null;
  }
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const valid = validateIntegrationAjv(doc);
  if (!valid) {
    diagnostics.push(...formatAjvErrors(validateIntegrationAjv.errors, 'integration'));
    return diagnostics;
  }

  const integration = doc as IntegrationConfigDocument;
  const authNav = integration.authNavigation;
  if (!authNav.enabled) {
    return diagnostics;
  }

  const checkExternalUrl = (value: string | undefined, fieldPath: string) => {
    if (!value) return;
    if (/^https?:\/\//i.test(value) || value.includes('://')) {
      diagnostics.push({
        code: 'INT_UNSAFE_EXTERNAL_REDIRECT',
        severity: 'error',
        document: 'integration',
        jsonPath: fieldPath,
        message: `ERROR: Unsafe external redirect URL "${value}" is not permitted as a route destination.`,
        suggestion: 'Use a validated internal route identifier (e.g., "app.home" or "auth.login").',
        canGenerate: false,
      });
    }
  };

  checkExternalUrl(authNav.guestEntry, '/authNavigation/guestEntry');
  checkExternalUrl(authNav.authenticatedEntry, '/authNavigation/authenticatedEntry');
  checkExternalUrl(authNav.afterLogin, '/authNavigation/afterLogin');
  checkExternalUrl(authNav.afterRegistration, '/authNavigation/afterRegistration');
  checkExternalUrl(authNav.afterLogout, '/authNavigation/afterLogout');
  checkExternalUrl(authNav.verificationRoute, '/authNavigation/verificationRoute');
  checkExternalUrl(authNav.accessDeniedRoute, '/authNavigation/accessDeniedRoute');

  const nav = context?.navigation;
  if (nav) {
    const routeMap = new Map(nav.routes.map((r) => [r.id, r]));

    const guestRoute = routeMap.get(authNav.guestEntry);
    if (!guestRoute) {
      diagnostics.push({
        code: 'INT_UNKNOWN_GUEST_ENTRY',
        severity: 'error',
        document: 'integration',
        jsonPath: '/authNavigation/guestEntry',
        message: `ERROR: Guest entry references an unknown route "${authNav.guestEntry}".`,
        suggestion: 'Point "guestEntry" to a defined route ID in navigation.json (e.g., "auth.login").',
        canGenerate: false,
      });
    } else if (
      guestRoute.access === 'authenticated' ||
      guestRoute.access === 'verified' ||
      (typeof guestRoute.access === 'object' && guestRoute.access !== null)
    ) {
      diagnostics.push({
        code: 'INT_GUEST_ROUTE_MARKED_AUTHENTICATED',
        severity: 'error',
        document: 'integration',
        jsonPath: '/authNavigation/guestEntry',
        message: `ERROR: Guest entry route "${authNav.guestEntry}" is marked as requiring authentication.`,
        suggestion: `Change route "${authNav.guestEntry}" access policy to "guest" or "public".`,
        canGenerate: false,
      });
    }

    const authEntryRoute = routeMap.get(authNav.authenticatedEntry);
    if (!authEntryRoute) {
      diagnostics.push({
        code: 'INT_UNKNOWN_AUTHENTICATED_ENTRY',
        severity: 'error',
        document: 'integration',
        jsonPath: '/authNavigation/authenticatedEntry',
        message: `ERROR: Authenticated entry references an unknown route "${authNav.authenticatedEntry}".`,
        suggestion: 'Point "authenticatedEntry" to a defined route ID in navigation.json (e.g., "app.home").',
        canGenerate: false,
      });
    } else if (authEntryRoute.access === 'guest') {
      diagnostics.push({
        code: 'INT_AUTHENTICATED_ROUTE_MARKED_GUEST',
        severity: 'warning',
        document: 'integration',
        jsonPath: '/authNavigation/authenticatedEntry',
        message: `WARNING: Authenticated entry route "${authNav.authenticatedEntry}" has "guest" access policy.`,
        suggestion: `Set route "${authNav.authenticatedEntry}" access policy to "authenticated".`,
        canGenerate: true,
      });
    }

    if (
      authNav.afterLogin !== 'restore-intended-destination' &&
      !routeMap.has(authNav.afterLogin)
    ) {
      diagnostics.push({
        code: 'INT_INVALID_AFTER_LOGIN_ROUTE',
        severity: 'error',
        document: 'integration',
        jsonPath: '/authNavigation/afterLogin',
        message: `ERROR: Login destination "${authNav.afterLogin}" has no valid route mapping.`,
        suggestion:
          'Set "afterLogin" to "restore-intended-destination" or a valid route ID in navigation.json.',
        canGenerate: false,
      });
    }

    if (!routeMap.has(authNav.afterRegistration)) {
      diagnostics.push({
        code: 'INT_INVALID_AFTER_REGISTRATION_ROUTE',
        severity: 'error',
        document: 'integration',
        jsonPath: '/authNavigation/afterRegistration',
        message: `ERROR: Registration destination "${authNav.afterRegistration}" references an unknown route.`,
        suggestion: 'Set "afterRegistration" to a valid route ID in navigation.json.',
        canGenerate: false,
      });
    }

    if (!routeMap.has(authNav.afterLogout)) {
      diagnostics.push({
        code: 'INT_INVALID_AFTER_LOGOUT_ROUTE',
        severity: 'error',
        document: 'integration',
        jsonPath: '/authNavigation/afterLogout',
        message: `ERROR: After-logout destination "${authNav.afterLogout}" references an unknown route.`,
        suggestion: 'Set "afterLogout" to a valid guest route ID in navigation.json.',
        canGenerate: false,
      });
    }

    // Warn when deep-linked routes require authentication
    for (const route of nav.routes) {
      if (
        route.deepLink?.enabled &&
        route.access &&
        route.access !== 'public' &&
        route.access !== 'guest'
      ) {
        diagnostics.push({
          code: 'INT_DEEPLINK_AUTH_WARNING',
          severity: 'warning',
          document: 'integration',
          jsonPath: `/routes/${route.id}/deepLink`,
          message: `WARNING: Deep-linked route "${route.id}" (${route.path}) requires authentication; unauthenticated launches will defer to "${authNav.guestEntry}".`,
          suggestion:
            'Keep "afterLogin": "restore-intended-destination" so deep links resume automatically after sign-in.',
          canGenerate: true,
        });
      }
    }
  }

  // Validate flow references in integration events
  if (authNav.events) {
    for (const [eventKey, binding] of Object.entries(authNav.events)) {
      if (binding.flowRef && !isValidFlowId(binding.flowRef)) {
        diagnostics.push({
          code: 'INT_INVALID_FLOW_REF',
          severity: 'error',
          document: 'integration',
          jsonPath: `/authNavigation/events/${eventKey}/flowRef`,
          message: `ERROR: Invalid flow reference "${binding.flowRef}" for event "${eventKey}".`,
          suggestion: 'Use format "flow.<domain>.<action>".',
          canGenerate: false,
        });
      }
    }
  }

  return diagnostics;
}
