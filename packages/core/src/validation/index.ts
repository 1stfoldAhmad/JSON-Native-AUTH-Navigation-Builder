import AjvModule, { type ErrorObject } from 'ajv';
import addFormatsModule from 'ajv-formats';
import { isValidFlowId, isValidScreenId } from '@expo-foundation/contracts';
import {
  AUTH_JSON_SCHEMA,
  INTEGRATION_JSON_SCHEMA,
  NAVIGATION_JSON_SCHEMA,
} from '../schema/index.js';
import type {
  AccessContext,
  AccessPolicy,
  AuthConfigDocument,
  Diagnostic,
  IntegrationConfigDocument,
  NavigationConfigDocument,
  NavigatorDefinition,
  RouteDefinition,
} from '../types/index.js';

export type AccessPolicyFailureReason =
  | 'unauthenticated'
  | 'guest_only'
  | 'unverified'
  | 'insufficient_roles'
  | 'insufficient_permissions'
  | 'invalid_account_status'
  | 'invalid_tenant';

export interface AccessPolicyEvaluationResult {
  allowed: boolean;
  reason?: AccessPolicyFailureReason;
}

/**
 * Single authoritative AccessPolicy evaluator shared by RouteGuardManager,
 * DeepLinkManager, and NavigationStateManager (Audit Finding 9 & Section 12.7 / 12.8).
 */
export function evaluateAccessPolicy(
  policy: AccessPolicy | undefined,
  context: AccessContext
): AccessPolicyEvaluationResult {
  const effectivePolicy = policy ?? 'public';

  if (effectivePolicy === 'public') {
    return { allowed: true };
  }

  if (effectivePolicy === 'guest') {
    if (context.authenticated) {
      return { allowed: false, reason: 'guest_only' };
    }
    return { allowed: true };
  }

  if (!context.authenticated) {
    return { allowed: false, reason: 'unauthenticated' };
  }

  if (effectivePolicy === 'authenticated') {
    return { allowed: true };
  }

  if (effectivePolicy === 'verified') {
    if (!context.verified) {
      return { allowed: false, reason: 'unverified' };
    }
    return { allowed: true };
  }

  if (typeof effectivePolicy === 'object') {
    if ('roles' in effectivePolicy) {
      const mode = effectivePolicy.mode ?? 'any';
      const userRoles = new Set(context.roles);
      const passed =
        mode === 'all'
          ? effectivePolicy.roles.every((r) => userRoles.has(r))
          : effectivePolicy.roles.some((r) => userRoles.has(r));
      if (!passed) {
        return { allowed: false, reason: 'insufficient_roles' };
      }
      return { allowed: true };
    }

    if ('permissions' in effectivePolicy) {
      const mode = effectivePolicy.mode ?? 'any';
      const userPermissions = new Set(context.permissions);
      const passed =
        mode === 'all'
          ? effectivePolicy.permissions.every((p) => userPermissions.has(p))
          : effectivePolicy.permissions.some((p) => userPermissions.has(p));
      if (!passed) {
        return { allowed: false, reason: 'insufficient_permissions' };
      }
      return { allowed: true };
    }

    if ('accountStatus' in effectivePolicy) {
      const currentStatus = context.accountStatus ?? 'active';
      if (!effectivePolicy.accountStatus.includes(currentStatus)) {
        return { allowed: false, reason: 'invalid_account_status' };
      }
      return { allowed: true };
    }

    if ('tenantId' in effectivePolicy) {
      if (context.tenantId !== effectivePolicy.tenantId) {
        return { allowed: false, reason: 'invalid_tenant' };
      }
      return { allowed: true };
    }
  }

  return { allowed: true };
}

type AjvConstructor = new (options?: {
  allErrors?: boolean;
  strict?: boolean;
}) => {
  compile: (schema: unknown) => {
    (data: unknown): boolean;
    errors?: ErrorObject[] | null;
  };
};
const AjvClass: AjvConstructor =
  ((AjvModule as unknown as { default?: AjvConstructor }).default ??
    (AjvModule as unknown as AjvConstructor));
const addFormats =
  ((addFormatsModule as unknown as { default?: (ajv: unknown) => void }).default ??
    (addFormatsModule as unknown as (ajv: unknown) => void));

function createAjvInstance() {
  const ajv = new AjvClass({
    allErrors: true,
    strict: false,
  });
  addFormats(ajv);
  return ajv;
}

const ajvInstance = createAjvInstance();
const validateAuthSchemaFn = ajvInstance.compile(AUTH_JSON_SCHEMA);
const validateNavSchemaFn = ajvInstance.compile(NAVIGATION_JSON_SCHEMA);
const validateIntSchemaFn = ajvInstance.compile(INTEGRATION_JSON_SCHEMA);

function ajvErrorsToDiagnostics(
  errors: ErrorObject[] | null | undefined,
  document: 'auth' | 'navigation' | 'integration'
): Diagnostic[] {
  if (!errors || errors.length === 0) {
    return [];
  }
  return errors.map((err) => ({
    code: `SCHEMA_INVALID_${document.toUpperCase()}`,
    severity: 'error',
    category: 'schema',
    document,
    jsonPath: err.instancePath || '/',
    message: `${err.instancePath || '/'} ${err.message ?? 'violates schema'}`,
    suggestion: `Fix property at "${err.instancePath || '/'}" to conform to the ${document} JSON schema v1.0.0.`,
    canGenerate: false,
  }));
}

export function validateAuthSchema(doc: unknown): Diagnostic[] {
  const valid = validateAuthSchemaFn(doc);
  if (valid) return [];
  return ajvErrorsToDiagnostics(validateAuthSchemaFn.errors, 'auth');
}

export function validateNavigationSchema(doc: unknown): Diagnostic[] {
  const valid = validateNavSchemaFn(doc);
  if (valid) return [];
  return ajvErrorsToDiagnostics(validateNavSchemaFn.errors, 'navigation');
}

export function validateIntegrationSchema(doc: unknown): Diagnostic[] {
  const valid = validateIntSchemaFn(doc);
  if (valid) return [];
  return ajvErrorsToDiagnostics(validateIntSchemaFn.errors, 'integration');
}

/**
 * Semantic Validation for AuthConfigDocument (Section 8.1, 14, 16)
 */
export function validateAuthSemantics(doc: AuthConfigDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (doc.session.storage === 'memory') {
    diagnostics.push({
      code: 'AUTH_INSECURE_MEMORY_STORAGE',
      severity: 'warning',
      category: 'session-security',
      document: 'auth',
      jsonPath: '/session/storage',
      message:
        'Session storage is set to "memory". Tokens will not persist across app restarts and secure hardware storage is bypassed.',
      suggestion: 'Set "/session/storage" to "secure-store" for production builds.',
      canGenerate: true,
    });
  }

  for (const [key, ref] of Object.entries(doc.screenRefs ?? {})) {
    if (ref && !isValidScreenId(ref)) {
      diagnostics.push({
        code: 'AUTH_INVALID_SCREEN_REF',
        severity: 'error',
        category: 'auth',
        document: 'auth',
        jsonPath: `/screenRefs/${key}`,
        message: `Screen reference "${ref}" for "${key}" is not a valid screen identifier.`,
        suggestion: 'Use format "screen.<domain>.<name>", e.g. "screen.auth.login".',
        canGenerate: false,
      });
    }
  }

  if (doc.methods.password && !doc.screenRefs.login) {
    diagnostics.push({
      code: 'AUTH_MISSING_LOGIN_SCREEN_REF',
      severity: 'error',
      category: 'auth',
      document: 'auth',
      jsonPath: '/screenRefs/login',
      message: 'Password login is enabled, but "/screenRefs/login" is not defined.',
      suggestion: 'Add "login": "screen.auth.login" under "/screenRefs".',
      canGenerate: false,
    });
  }

  if (doc.methods.registration && !doc.screenRefs.register) {
    diagnostics.push({
      code: 'AUTH_MISSING_REGISTER_SCREEN_REF',
      severity: 'error',
      category: 'auth',
      document: 'auth',
      jsonPath: '/screenRefs/register',
      message: 'Registration is enabled, but "/screenRefs/register" is not defined.',
      suggestion: 'Add "register": "screen.auth.register" under "/screenRefs".',
      canGenerate: false,
    });
  }

  if (doc.methods.emailVerification && !doc.screenRefs.verification) {
    diagnostics.push({
      code: 'AUTH_MISSING_VERIFICATION_SCREEN_REF',
      severity: 'warning',
      category: 'auth',
      document: 'auth',
      jsonPath: '/screenRefs/verification',
      message: 'Email verification is enabled without a dedicated "/screenRefs/verification" screen.',
      suggestion: 'Add "verification": "screen.auth.verify" under "/screenRefs".',
      canGenerate: true,
    });
  }

  if (doc.events) {
    for (const [eventKey, entry] of Object.entries(doc.events)) {
      const flowRef = typeof entry === 'string' ? entry : entry.flowRef;
      if (flowRef && !isValidFlowId(flowRef)) {
        diagnostics.push({
          code: 'AUTH_INVALID_FLOW_REF',
          severity: 'error',
          category: 'auth',
          document: 'auth',
          jsonPath: `/events/${eventKey}`,
          message: `Event "${eventKey}" references invalid flow ID "${flowRef}".`,
          suggestion: 'Use format "flow.<domain>.<action>", e.g. "flow.auth.after-login".',
          canGenerate: false,
        });
      }
    }
  }

  if (
    doc.providers &&
    doc.provider.ref &&
    !doc.providers[doc.provider.ref] &&
    !doc.provider.config
  ) {
    diagnostics.push({
      code: 'AUTH_MISSING_PROVIDER_DEFINITION',
      severity: 'error',
      category: 'provider',
      document: 'auth',
      jsonPath: '/provider/ref',
      message: `Provider ref "${doc.provider.ref}" was not found in "/providers" and no inline "/provider/config" was supplied.`,
      suggestion: `Define "${doc.provider.ref}" under "/providers" or supply "/provider/config".`,
      canGenerate: false,
    });
  }

  return diagnostics;
}

/**
 * Semantic Validation for NavigationConfigDocument (Section 8.2, 11.F, 12, 16)
 */
export function validateNavigationSemantics(doc: NavigationConfigDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const navMap = new Map<string, NavigatorDefinition>();
  const routeMap = new Map<string, RouteDefinition>();

  doc.navigators.forEach((nav, idx) => {
    if (navMap.has(nav.id)) {
      diagnostics.push({
        code: 'NAV_DUPLICATE_NAVIGATOR_ID',
        severity: 'error',
        category: 'navigation-graph',
        document: 'navigation',
        jsonPath: `/navigators/${idx}/id`,
        message: `Duplicate navigator ID "${nav.id}".`,
        suggestion: 'Ensure every navigator has a globally unique ID.',
        canGenerate: false,
      });
    }
    navMap.set(nav.id, nav);
  });

  doc.routes.forEach((route, idx) => {
    if (routeMap.has(route.id)) {
      diagnostics.push({
        code: 'NAV_DUPLICATE_ROUTE_ID',
        severity: 'error',
        category: 'navigation-graph',
        document: 'navigation',
        jsonPath: `/routes/${idx}/id`,
        message: `Duplicate route ID "${route.id}".`,
        suggestion: 'Ensure every route has a globally unique ID.',
        canGenerate: false,
      });
    }
    routeMap.set(route.id, route);

    if (!isValidScreenId(route.screenRef)) {
      diagnostics.push({
        code: 'NAV_INVALID_SCREEN_REF',
        severity: 'error',
        category: 'navigation-graph',
        document: 'navigation',
        jsonPath: `/routes/${idx}/screenRef`,
        message: `Route "${route.id}" has invalid screenRef "${route.screenRef}".`,
        suggestion: 'Use format "screen.<domain>.<name>", e.g. "screen.app.home".',
        canGenerate: false,
      });
    }

    if (route.navigatorId && !navMap.has(route.navigatorId)) {
      diagnostics.push({
        code: 'NAV_UNKNOWN_PARENT_NAVIGATOR',
        severity: 'error',
        category: 'navigation-graph',
        document: 'navigation',
        jsonPath: `/routes/${idx}/navigatorId`,
        message: `Route "${route.id}" references non-existent navigatorId "${route.navigatorId}".`,
        suggestion: `Set navigatorId to one of: ${Array.from(navMap.keys()).join(', ')}.`,
        canGenerate: false,
      });
    }

    // Validate dynamic path segments match declared params
    const pathParamMatches = Array.from(route.path.matchAll(/:([a-zA-Z0-9_]+)/g)).map(
      (m) => m[1]
    );
    for (const paramName of pathParamMatches) {
      if (!route.params || !route.params[paramName]) {
        diagnostics.push({
          code: 'NAV_UNDECLARED_PATH_PARAM',
          severity: 'warning',
          category: 'navigation-graph',
          document: 'navigation',
          jsonPath: `/routes/${idx}/path`,
          message: `Route "${route.id}" path "${route.path}" includes dynamic parameter ":${paramName}" not declared in "/routes/${idx}/params".`,
          suggestion: `Add "${paramName}": { "type": "string", "required": true } to route params.`,
          canGenerate: true,
        });
      }
    }
  });

  if (!navMap.has(doc.rootNavigator)) {
    diagnostics.push({
      code: 'NAV_MISSING_ROOT_NAVIGATOR',
      severity: 'error',
      category: 'navigation-graph',
      document: 'navigation',
      jsonPath: '/rootNavigator',
      message: `Root navigator "${doc.rootNavigator}" does not exist in "/navigators".`,
      suggestion: `Set "/rootNavigator" to a valid navigator ID (${Array.from(navMap.keys()).join(', ')}).`,
      canGenerate: false,
    });
  }

  // Track referenced child navigators to detect orphan navigators
  const referencedNavigators = new Set<string>([doc.rootNavigator]);

  // Check navigator children and initialRoute references
  doc.navigators.forEach((nav, idx) => {
    for (const childId of nav.children) {
      if (navMap.has(childId)) {
        referencedNavigators.add(childId);
      }
      if (!navMap.has(childId) && !routeMap.has(childId)) {
        diagnostics.push({
          code: 'NAV_UNKNOWN_CHILD_REFERENCE',
          severity: 'error',
          category: 'navigation-graph',
          document: 'navigation',
          jsonPath: `/navigators/${idx}/children`,
          message: `Navigator "${nav.id}" references unknown child "${childId}" (neither a navigator nor a route).`,
          suggestion: `Define route or navigator "${childId}" or remove it from "${nav.id}.children".`,
          canGenerate: false,
        });
      }
    }

    if (nav.initialRoute && !nav.children.includes(nav.initialRoute)) {
      diagnostics.push({
        code: 'NAV_INVALID_INITIAL_ROUTE',
        severity: 'error',
        category: 'navigation-graph',
        document: 'navigation',
        jsonPath: `/navigators/${idx}/initialRoute`,
        message: `Navigator "${nav.id}" initialRoute "${nav.initialRoute}" is not listed in its children [${nav.children.join(', ')}].`,
        suggestion: `Set initialRoute to one of: ${nav.children.join(', ')}.`,
        canGenerate: false,
      });
    }
  });

  // Check for orphan navigators (Section 11.F)
  doc.navigators.forEach((nav, idx) => {
    if (!referencedNavigators.has(nav.id)) {
      diagnostics.push({
        code: 'NAV_ORPHAN_NAVIGATOR',
        severity: 'warning',
        category: 'navigation-graph',
        document: 'navigation',
        jsonPath: `/navigators/${idx}/id`,
        message: `Navigator "${nav.id}" is not the rootNavigator and is not referenced as a child of any parent navigator.`,
        suggestion: `Add "${nav.id}" to a parent navigator's children array or remove it.`,
        canGenerate: true,
      });
    }
  });

  // Detect conflicting route paths within the same navigator scope (Section 11.F)
  const pathsByNavigator = new Map<string, { routeId: string; index: number }>();
  doc.routes.forEach((route, idx) => {
    const normalizedPattern = route.path
      .trim()
      .replace(/\/+/g, '/')
      .replace(/:[a-zA-Z0-9_]+/g, ':param');
    const scopeKey = `${route.navigatorId ?? 'root'}::${normalizedPattern}`;
    const existing = pathsByNavigator.get(scopeKey);
    if (existing) {
      diagnostics.push({
        code: 'NAV_CONFLICTING_ROUTE_PATHS',
        severity: 'error',
        category: 'navigation-graph',
        document: 'navigation',
        jsonPath: `/routes/${idx}/path`,
        message: `Route "${route.id}" has path "${route.path}" which conflicts with route "${existing.routeId}" in the same navigator scope.`,
        suggestion: 'Give each route within the same navigator a distinct path pattern.',
        canGenerate: false,
      });
    } else {
      pathsByNavigator.set(scopeKey, { routeId: route.id, index: idx });
    }
  });

  // Validate Universal Links / Android App Links host allowlist (Audit Finding 9)
  if (doc.linking) {
    const needsHosts = Boolean(doc.linking.universalLinks || doc.linking.androidAppLinks);
    if (needsHosts && (!doc.linking.hosts || doc.linking.hosts.length === 0)) {
      diagnostics.push({
        code: 'NAV_UNIVERSAL_LINK_MISSING_HOSTS',
        severity: 'error',
        category: 'navigation-graph',
        document: 'navigation',
        jsonPath: '/linking/hosts',
        message:
          'Universal Links or Android App Links are enabled, but "/linking/hosts" allowlist is empty.',
        suggestion:
          'Configure at least one verified domain in "/linking/hosts" (e.g. ["app.example.com"]).',
        canGenerate: false,
      });
    }
  }

  // Detect cycles in navigator hierarchy
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(navId: string, trail: string[]): void {
    if (visiting.has(navId)) {
      diagnostics.push({
        code: 'NAV_GRAPH_CYCLE_DETECTED',
        severity: 'error',
        category: 'navigation-graph',
        document: 'navigation',
        jsonPath: '/navigators',
        message: `Cyclic navigator reference detected: ${[...trail, navId].join(' -> ')}.`,
        suggestion: 'Break the cycle in navigator children references.',
        canGenerate: false,
      });
      return;
    }
    if (visited.has(navId)) return;

    visiting.add(navId);
    const nav = navMap.get(navId);
    if (nav) {
      for (const childId of nav.children) {
        if (navMap.has(childId)) {
          dfs(childId, [...trail, navId]);
        }
      }
    }
    visiting.delete(navId);
    visited.add(navId);
  }

  if (navMap.has(doc.rootNavigator)) {
    dfs(doc.rootNavigator, []);
  }

  // Check unreachable routes from rootNavigator
  const reachableRoutes = new Set<string>();
  const reachableNavs = new Set<string>();

  function collectReachable(navId: string): void {
    if (reachableNavs.has(navId)) return;
    reachableNavs.add(navId);
    const nav = navMap.get(navId);
    if (!nav) return;
    for (const childId of nav.children) {
      if (routeMap.has(childId)) {
        reachableRoutes.add(childId);
      } else if (navMap.has(childId)) {
        collectReachable(childId);
      }
    }
  }

  if (navMap.has(doc.rootNavigator)) {
    collectReachable(doc.rootNavigator);
    doc.routes.forEach((route, idx) => {
      const viaNavigator = route.navigatorId && reachableNavs.has(route.navigatorId);
      if (!reachableRoutes.has(route.id) && !viaNavigator) {
        diagnostics.push({
          code: 'NAV_UNREACHABLE_ROUTE',
          severity: 'warning',
          category: 'navigation-graph',
          document: 'navigation',
          jsonPath: `/routes/${idx}`,
          message: `Route "${route.id}" is not reachable from rootNavigator "${doc.rootNavigator}".`,
          suggestion: `Add "${route.id}" to a reachable navigator's "children" array.`,
          canGenerate: true,
        });
      }
    });
  }

  return diagnostics;
}

/**
 * Cross-Document Integration Validation (Section 8.3, 15, 16)
 */
export function validateIntegrationSemantics(
  integration: IntegrationConfigDocument,
  navigation?: NavigationConfigDocument,
  auth?: AuthConfigDocument
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const cfg = integration.authNavigation;

  if (!cfg.enabled) {
    return diagnostics;
  }

  if (navigation) {
    const routeIds = new Set(navigation.routes.map((r) => r.id));
    const navIds = new Set(navigation.navigators.map((n) => n.id));
    const isValidTarget = (id: string) => routeIds.has(id) || navIds.has(id);

    const checkRouteTarget = (
      field: string,
      value: string | undefined,
      allowSpecialRestore = false
    ) => {
      if (!value) return;
      if (allowSpecialRestore && value === 'restore-intended-destination') return;
      if (!isValidTarget(value)) {
        diagnostics.push({
          code: 'INT_UNKNOWN_TARGET_ROUTE',
          severity: 'error',
          category: 'integration',
          document: 'integration',
          jsonPath: `/authNavigation/${field}`,
          message: `Integration "${field}" references "${value}", which does not exist in navigation routes or navigators.`,
          suggestion: `Point "/authNavigation/${field}" to a valid route ID (${Array.from(routeIds).join(', ')}).`,
          canGenerate: false,
        });
      }
    };

    checkRouteTarget('guestEntry', cfg.guestEntry);
    checkRouteTarget('authenticatedEntry', cfg.authenticatedEntry);
    checkRouteTarget('afterLogin', cfg.afterLogin, true);
    checkRouteTarget('afterRegistration', cfg.afterRegistration);
    checkRouteTarget('afterLogout', cfg.afterLogout);
    checkRouteTarget('verificationRoute', cfg.verificationRoute);
    checkRouteTarget('accessDeniedRoute', cfg.accessDeniedRoute);
    checkRouteTarget('sessionExpiredRoute', cfg.sessionExpiredRoute);
    checkRouteTarget('accountSuspendedRoute', cfg.accountSuspendedRoute);

    if (cfg.roleRouteGroups) {
      for (const [role, target] of Object.entries(cfg.roleRouteGroups)) {
        if (!isValidTarget(target)) {
          diagnostics.push({
            code: 'INT_UNKNOWN_ROLE_ROUTE_TARGET',
            severity: 'error',
            category: 'integration',
            document: 'integration',
            jsonPath: `/authNavigation/roleRouteGroups/${role}`,
            message: `Role route group "${role}" targets unknown route/navigator "${target}".`,
            suggestion: `Use a valid route or navigator ID.`,
            canGenerate: false,
          });
        }
      }
    }

    // Check if protected routes exist when authNavigation is disabled or auth is disabled
    const hasProtectedRoutes = navigation.routes.some(
      (r) => r.access && r.access !== 'public' && r.access !== 'guest'
    );
    if (hasProtectedRoutes && auth && !auth.enabled) {
      diagnostics.push({
        code: 'INT_PROTECTED_ROUTES_WITHOUT_AUTH',
        severity: 'error',
        category: 'integration',
        document: 'integration',
        jsonPath: '/authNavigation/enabled',
        message:
          'Navigation defines protected routes, but Auth configuration is disabled.',
        suggestion:
          'Enable Auth configuration or change protected route access policies to "public".',
        canGenerate: false,
      });
    }
  }

  if (cfg.events) {
    for (const [eventName, binding] of Object.entries(cfg.events)) {
      if (binding.flowRef && !isValidFlowId(binding.flowRef)) {
        diagnostics.push({
          code: 'INT_INVALID_FLOW_REF',
          severity: 'error',
          category: 'integration',
          document: 'integration',
          jsonPath: `/authNavigation/events/${eventName}/flowRef`,
          message: `Integration event "${eventName}" has invalid flowRef "${binding.flowRef}".`,
          suggestion: 'Use format "flow.<domain>.<action>".',
          canGenerate: false,
        });
      }
    }
  }

  return diagnostics;
}
