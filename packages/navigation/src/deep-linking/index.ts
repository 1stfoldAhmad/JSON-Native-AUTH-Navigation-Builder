/**
 * @expo-foundation/navigation - Deep Link & Universal Link Resolver
 *
 * Implements Section 12.7 & Audit Finding 9:
 * - Custom scheme URL parsing (`myapp://orders/123?tab=details`)
 * - Universal Links & Android App Links (`https://app.example.com/orders/123`)
 * - Strict host allowlist enforcement for HTTP/HTTPS URLs (rejects when `linking.hosts` is empty)
 * - Centralized AccessPolicy evaluation via `evaluateAccessPolicy` (correctly rejects
 *   authenticated users from `guest` routes and redirects to `authenticatedEntry`)
 * - Deferred deep-link storage when unauthenticated and automatic replay after login
 */

import { FoundationEventBus } from '@expo-foundation/contracts';
import {
  evaluateAccessPolicy,
  type AccessContext,
  type NavigationIR,
} from '@expo-foundation/core';
import { RouteRegistry } from '../route-registry/index.js';
import { NavigationStateManager } from '../runtime/state-manager.js';

export interface DeepLinkResolutionResult {
  status: 'navigated' | 'deferred' | 'rejected' | 'not_found';
  routeId?: string;
  params?: Record<string, unknown>;
  redirectRouteId?: string;
  reason?: string;
}

export class DeepLinkManager {
  private readonly ir: NavigationIR;
  private readonly routeRegistry: RouteRegistry;
  private readonly stateManager: NavigationStateManager;
  private readonly eventBus: FoundationEventBus;

  constructor(options: {
    navigationIR: NavigationIR;
    stateManager: NavigationStateManager;
    eventBus?: FoundationEventBus;
  }) {
    this.ir = options.navigationIR;
    this.routeRegistry = this.stateManagerRouteRegistry(options.stateManager);
    this.stateManager = options.stateManager;
    this.eventBus = options.eventBus ?? new FoundationEventBus();
  }

  private stateManagerRouteRegistry(sm: NavigationStateManager): RouteRegistry {
    return sm.getRouteRegistry();
  }

  /**
   * Parses and validates a scheme or universal link URL, returning its normalized path + query.
   * For http/https links, strictly requires a non-empty `linking.hosts` allowlist (Audit Finding 9).
   */
  extractPathFromUrl(rawUrl: string): {
    valid: boolean;
    pathWithQuery?: string;
    reason?: string;
  } {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
      return { valid: false, reason: 'empty_url' };
    }

    if (trimmed.startsWith('/')) {
      return { valid: true, pathWithQuery: trimmed };
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { valid: false, reason: 'malformed_url' };
    }

    const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
    const expectedScheme = this.ir.linking.scheme.toLowerCase();

    if (scheme === 'http' || scheme === 'https') {
      const allowedHosts = (this.ir.linking.hosts ?? []).map((h) => h.toLowerCase());
      if (allowedHosts.length === 0 || !allowedHosts.includes(parsed.hostname.toLowerCase())) {
        return { valid: false, reason: 'untrusted_host' };
      }
      return {
        valid: true,
        pathWithQuery: `${parsed.pathname || '/'}${parsed.search || ''}`,
      };
    }

    if (scheme !== expectedScheme) {
      return { valid: false, reason: 'unsupported_scheme' };
    }

    const hostPart = parsed.hostname ? `/${parsed.hostname}` : '';
    const pathnamePart = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
    const combinedPath = `${hostPart}${pathnamePart}` || '/';

    return {
      valid: true,
      pathWithQuery: `${combinedPath}${parsed.search || ''}`,
    };
  }

  /**
   * Resolves an incoming deep link, checks route access policy using the central
   * `evaluateAccessPolicy` evaluator, and either navigates immediately, redirects
   * (e.g. authenticated user visiting a guest route -> authenticatedEntry), or defers
   * until authentication completes.
   */
  handleIncomingUrl(
    rawUrl: string,
    options?: {
      guestEntryRouteId?: string;
      authenticatedEntryRouteId?: string;
      verificationRouteId?: string;
      accessDeniedRouteId?: string;
    }
  ): DeepLinkResolutionResult {
    const extracted = this.extractPathFromUrl(rawUrl);
    if (!extracted.valid || !extracted.pathWithQuery) {
      return {
        status: 'rejected',
        reason: extracted.reason ?? 'invalid_url',
      };
    }

    let matched;
    try {
      matched = this.routeRegistry.matchPath(extracted.pathWithQuery);
    } catch (err) {
      return {
        status: 'rejected',
        reason: err instanceof Error ? err.message : 'invalid_params',
      };
    }

    if (!matched) {
      return {
        status: 'not_found',
        reason: 'no_matching_route',
      };
    }

    if (matched.route.deepLink.enabled === false) {
      return {
        status: 'rejected',
        routeId: matched.route.id,
        reason: 'deeplink_disabled_for_route',
      };
    }

    this.eventBus.emit(
      'nav.deeplink.received',
      {
        url: rawUrl,
        routeId: matched.route.id,
        params: matched.params,
      },
      { source: 'navigation' }
    );

    const accessCtx = this.stateManager.getAccessContext();
    const policyCheck = this.evaluateRouteAccess(matched.route.id, accessCtx);

    if (!policyCheck.allowed) {
      if (policyCheck.reason === 'guest_only') {
        if (options?.authenticatedEntryRouteId) {
          this.stateManager.replace(options.authenticatedEntryRouteId, {});
          return {
            status: 'rejected',
            routeId: matched.route.id,
            redirectRouteId: options.authenticatedEntryRouteId,
            reason: 'guest_only',
          };
        }
        return {
          status: 'rejected',
          routeId: matched.route.id,
          reason: 'guest_only',
        };
      }

      if (policyCheck.reason === 'unauthenticated') {
        this.stateManager.setIntendedDestination(matched.route.id, matched.params);
        this.eventBus.emit(
          'nav.deeplink.deferred',
          {
            routeId: matched.route.id,
            params: matched.params,
            reason: 'unauthenticated',
          },
          { source: 'navigation' }
        );

        if (options?.guestEntryRouteId) {
          this.stateManager.replace(options.guestEntryRouteId, {});
        }

        return {
          status: 'deferred',
          routeId: matched.route.id,
          params: matched.params,
          redirectRouteId: options?.guestEntryRouteId,
          reason: 'unauthenticated',
        };
      }

      if (policyCheck.reason === 'unverified' && options?.verificationRouteId) {
        this.stateManager.setIntendedDestination(matched.route.id, matched.params);
        this.stateManager.replace(options.verificationRouteId, {});
        return {
          status: 'deferred',
          routeId: matched.route.id,
          params: matched.params,
          redirectRouteId: options.verificationRouteId,
          reason: 'unverified',
        };
      }

      if (options?.accessDeniedRouteId) {
        this.stateManager.replace(options.accessDeniedRouteId, {});
      }

      return {
        status: 'rejected',
        routeId: matched.route.id,
        params: matched.params,
        redirectRouteId: options?.accessDeniedRouteId,
        reason: policyCheck.reason,
      };
    }

    this.stateManager.navigate(matched.route.id, matched.params);
    return {
      status: 'navigated',
      routeId: matched.route.id,
      params: matched.params,
    };
  }

  /**
   * Replays a deferred deep link after authentication completes.
   */
  restoreDeferredDeepLink(): DeepLinkResolutionResult | null {
    const dest = this.stateManager.consumeIntendedDestination();
    if (!dest) return null;

    const accessCtx = this.stateManager.getAccessContext();
    const policyCheck = this.evaluateRouteAccess(dest.routeId, accessCtx);
    if (!policyCheck.allowed) {
      return {
        status: 'rejected',
        routeId: dest.routeId,
        params: dest.params,
        reason: policyCheck.reason,
      };
    }

    this.stateManager.replace(dest.routeId, dest.params);
    this.eventBus.emit(
      'nav.deeplink.restored',
      {
        routeId: dest.routeId,
        params: dest.params,
        path: dest.path,
      },
      { source: 'navigation' }
    );

    return {
      status: 'navigated',
      routeId: dest.routeId,
      params: dest.params,
    };
  }

  private evaluateRouteAccess(
    routeId: string,
    context: AccessContext
  ): { allowed: boolean; reason?: string } {
    const route = this.routeRegistry.get(routeId);
    return evaluateAccessPolicy(route.access, context);
  }
}
