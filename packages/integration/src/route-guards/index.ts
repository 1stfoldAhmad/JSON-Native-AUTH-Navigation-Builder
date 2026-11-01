/**
 * @expo-foundation/integration - Route Guards & Policy Evaluation
 *
 * Implements Section 12.8, Section 15.1, and Audit Finding 9:
 * - Uses the centralized `evaluateAccessPolicy` evaluator from `@expo-foundation/core`
 *   so RouteGuardManager, DeepLinkManager, and NavigationStateManager never diverge
 * - Evaluates public, guest, authenticated, verified, roles, permissions, accountStatus,
 *   and tenantId policies
 * - Determines the appropriate redirect target (`guestEntry`, `authenticatedEntry`,
 *   `verificationRoute`, `accessDeniedRoute`, or role-specific entry)
 */

import {
  evaluateAccessPolicy,
  type AccessContext,
  type AccessPolicy,
  type IntegrationIR,
  type NavigationIR,
} from '@expo-foundation/core';

export interface GuardDecision {
  allowed: boolean;
  redirectRouteId?: string;
  reason?: string;
}

export class RouteGuardManager {
  private readonly navIR: NavigationIR;
  private readonly intIR?: IntegrationIR;

  constructor(navIR: NavigationIR, intIR?: IntegrationIR) {
    this.navIR = navIR;
    this.intIR = intIR;
  }

  evaluateRoute(
    routeId: string,
    _params: Record<string, unknown>,
    context: AccessContext
  ): GuardDecision {
    const route = this.navIR.routes[routeId];
    if (!route) {
      return {
        allowed: false,
        reason: 'unknown_route',
      };
    }

    return this.evaluatePolicy(route.access, context);
  }

  evaluatePolicy(policy: AccessPolicy, context: AccessContext): GuardDecision {
    const result = evaluateAccessPolicy(policy, context);
    if (result.allowed) {
      return { allowed: true };
    }

    switch (result.reason) {
      case 'guest_only':
        return {
          allowed: false,
          redirectRouteId: this.resolveAuthenticatedEntry(context),
          reason: 'guest_only_route',
        };
      case 'unauthenticated':
        return {
          allowed: false,
          redirectRouteId: this.intIR?.guestEntry,
          reason: 'unauthenticated',
        };
      case 'unverified':
        return {
          allowed: false,
          redirectRouteId:
            this.intIR?.verificationRoute ?? this.intIR?.accessDeniedRoute,
          reason: 'unverified',
        };
      case 'insufficient_roles':
      case 'insufficient_permissions':
      case 'invalid_account_status':
      case 'invalid_tenant':
      default:
        return {
          allowed: false,
          redirectRouteId:
            this.intIR?.accessDeniedRoute ?? this.intIR?.guestEntry,
          reason: result.reason ?? 'access_denied',
        };
    }
  }

  resolveAuthenticatedEntry(context: AccessContext): string | undefined {
    if (!this.intIR) return undefined;

    if (this.intIR.roleRouteGroups) {
      for (const role of context.roles) {
        const roleTarget = this.intIR.roleRouteGroups[role];
        if (roleTarget) {
          return roleTarget;
        }
      }
    }

    return this.intIR.authenticatedEntry;
  }
}
