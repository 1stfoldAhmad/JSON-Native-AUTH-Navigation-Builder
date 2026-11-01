import type { AccessContext, AccessPolicy, DeepLinkingConfig } from '@expo-foundation/core';
import type { RegisteredRoute, RouteRegistry } from '../route-registry/index.js';
import {
  defaultParameterResolver,
  ParameterResolver,
} from '../runtime/parameter-resolver.js';
import type { NavigationStateManager } from '../runtime/state-manager.js';

export interface IntendedDestination {
  routeId: string;
  params: Record<string, unknown>;
  originalUrl: string;
  timestamp: number;
}

export interface DeepLinkResolutionResult {
  status: 'navigated' | 'deferred_to_guest' | 'invalid_url' | 'not_found' | 'invalid_params';
  matchedRouteId?: string;
  activeRouteId?: string;
  params?: Record<string, unknown>;
  intendedDestination?: IntendedDestination;
  error?: string;
}

export class DeepLinkManager {
  private intendedDestination: IntendedDestination | null = null;
  private readonly parameterResolver: ParameterResolver;

  constructor(
    private readonly registry: RouteRegistry,
    private readonly stateManager: NavigationStateManager,
    private readonly linkingConfig: DeepLinkingConfig,
    options?: {
      parameterResolver?: ParameterResolver;
    }
  ) {
    this.parameterResolver = options?.parameterResolver ?? defaultParameterResolver;
  }

  /**
   * Parses a custom scheme URL ("myapp://orders/ORD-1024") or universal HTTPS link
   * ("https://example.com/orders/ORD-1024") into an internal path ("/orders/ORD-1024").
   */
  extractInternalPath(url: string): { valid: boolean; pathWithQuery: string; error?: string } {
    const trimmed = url.trim();
    if (!trimmed) {
      return { valid: false, pathWithQuery: '', error: 'Empty deep link URL.' };
    }

    const customSchemePrefix = `${this.linkingConfig.scheme}://`;
    if (trimmed.toLowerCase().startsWith(customSchemePrefix.toLowerCase())) {
      const remainder = trimmed.slice(customSchemePrefix.length);
      const normalized = remainder.startsWith('/') ? remainder : `/${remainder}`;
      return { valid: true, pathWithQuery: normalized };
    }

    if (/^https?:\/\//i.test(trimmed)) {
      try {
        const parsed = new URL(trimmed);
        const allowedHosts = (this.linkingConfig.hosts ?? []).map((h) => h.toLowerCase());
        if (
          allowedHosts.length > 0 &&
          !allowedHosts.includes(parsed.hostname.toLowerCase())
        ) {
          return {
            valid: false,
            pathWithQuery: '',
            error: `Untrusted deep-link host "${parsed.hostname}".`,
          };
        }
        return {
          valid: true,
          pathWithQuery: `${parsed.pathname}${parsed.search}`,
        };
      } catch {
        return { valid: false, pathWithQuery: '', error: 'Malformed HTTPS URL.' };
      }
    }

    if (trimmed.startsWith('/')) {
      return { valid: true, pathWithQuery: trimmed };
    }

    return {
      valid: false,
      pathWithQuery: '',
      error: `Unsupported URL scheme in "${trimmed}".`,
    };
  }

  private evaluateAccess(policy: AccessPolicy, accessContext?: AccessContext): boolean {
    if (!policy || policy === 'public' || policy === 'guest') {
      return true;
    }
    if (!accessContext || !accessContext.authenticated) {
      return false;
    }
    if (policy === 'authenticated') {
      return true;
    }
    if (policy === 'verified') {
      return Boolean(accessContext.verified);
    }
    if ('roles' in policy) {
      const mode = policy.mode ?? 'any';
      return mode === 'all'
        ? policy.roles.every((r) => accessContext.roles.includes(r))
        : policy.roles.some((r) => accessContext.roles.includes(r));
    }
    if ('permissions' in policy) {
      const mode = policy.mode ?? 'any';
      return mode === 'all'
        ? policy.permissions.every((p) => accessContext.permissions.includes(p))
        : policy.permissions.some((p) => accessContext.permissions.includes(p));
    }
    return false;
  }

  private findMatchingRoute(pathWithQuery: string): {
    route: RegisteredRoute;
    rawParams: Record<string, string>;
  } | null {
    for (const route of this.registry.listAll()) {
      if (route.deepLink.enabled === false) continue;

      const patterns = [route.path, ...(route.deepLink.aliases ?? [])];
      for (const pattern of patterns) {
        const match = this.parameterResolver.matchPath(pattern, pathWithQuery);
        if (match.matched) {
          return { route, rawParams: match.rawParams };
        }
      }
    }
    return null;
  }

  handleIncomingUrl(
    url: string,
    options?: {
      accessContext?: AccessContext;
      guestEntryRouteId?: string;
    }
  ): DeepLinkResolutionResult {
    this.stateManager.eventBus.emit(
      'nav.deeplink.received',
      { url },
      { source: 'navigation' }
    );

    const extracted = this.extractInternalPath(url);
    if (!extracted.valid) {
      return {
        status: 'invalid_url',
        error: extracted.error,
      };
    }

    const matched = this.findMatchingRoute(extracted.pathWithQuery);
    if (!matched) {
      return {
        status: 'not_found',
        error: `No registered route matches path "${extracted.pathWithQuery}".`,
      };
    }

    const paramValidation = this.parameterResolver.validateAndCoerce(
      matched.route.params,
      matched.rawParams
    );
    if (!paramValidation.valid) {
      return {
        status: 'invalid_params',
        matchedRouteId: matched.route.id,
        error: paramValidation.errors.join(' '),
      };
    }

    const allowed = this.evaluateAccess(matched.route.access, options?.accessContext);
    if (!allowed) {
      const guestRouteId =
        options?.guestEntryRouteId ??
        this.registry.listAll().find((r) => r.access === 'guest')?.id ??
        this.registry.listAll()[0]?.id;

      const intended: IntendedDestination = {
        routeId: matched.route.id,
        params: paramValidation.params,
        originalUrl: url,
        timestamp: Date.now(),
      };
      this.setIntendedDestination(intended.routeId, intended.params, url);

      if (guestRouteId && this.registry.has(guestRouteId)) {
        this.stateManager.navigate(guestRouteId);
      }

      this.stateManager.eventBus.emit(
        'nav.deeplink.deferred',
        {
          intendedRouteId: matched.route.id,
          guestRouteId,
        },
        { source: 'navigation' }
      );

      return {
        status: 'deferred_to_guest',
        matchedRouteId: matched.route.id,
        activeRouteId: guestRouteId,
        params: paramValidation.params,
        intendedDestination: intended,
      };
    }

    this.stateManager.navigate(matched.route.id, paramValidation.params);
    return {
      status: 'navigated',
      matchedRouteId: matched.route.id,
      activeRouteId: matched.route.id,
      params: paramValidation.params,
    };
  }

  /**
   * Sets a post-login intended destination. Strictly validates that the destination
   * is a registered internal route ID and never an external URL.
   */
  setIntendedDestination(
    routeId: string,
    params: Record<string, unknown> = {},
    originalUrl = ''
  ): void {
    if (/^https?:\/\//i.test(routeId) || routeId.includes('://')) {
      throw new Error(
        `Security violation: external URL "${routeId}" cannot be stored as an intended post-login destination.`
      );
    }
    if (!this.registry.has(routeId)) {
      throw new Error(
        `Invalid intended destination: "${routeId}" is not a registered internal route ID.`
      );
    }
    this.intendedDestination = {
      routeId,
      params: { ...params },
      originalUrl,
      timestamp: Date.now(),
    };
  }

  getIntendedDestination(): IntendedDestination | null {
    return this.intendedDestination ? structuredClone(this.intendedDestination) : null;
  }

  clearIntendedDestination(): void {
    this.intendedDestination = null;
  }

  restoreIntendedDestination(fallbackRouteId?: string): {
    restored: boolean;
    routeId: string | null;
    params: Record<string, unknown>;
  } {
    if (this.intendedDestination && this.registry.has(this.intendedDestination.routeId)) {
      const target = this.intendedDestination;
      this.intendedDestination = null;
      this.stateManager.navigate(target.routeId, target.params);
      this.stateManager.eventBus.emit(
        'nav.deeplink.restored',
        {
          routeId: target.routeId,
          params: target.params,
        },
        { source: 'navigation' }
      );
      return {
        restored: true,
        routeId: target.routeId,
        params: target.params,
      };
    }

    if (fallbackRouteId && this.registry.has(fallbackRouteId)) {
      this.stateManager.navigate(fallbackRouteId);
      return {
        restored: false,
        routeId: fallbackRouteId,
        params: {},
      };
    }

    return {
      restored: false,
      routeId: null,
      params: {},
    };
  }
}
