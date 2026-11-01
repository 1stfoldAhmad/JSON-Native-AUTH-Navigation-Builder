import type { AccessContext, AccessPolicy, IntegrationIR } from '@expo-foundation/core';

export interface RouteGuardEvaluation {
  allowed: boolean;
  reason: string;
  redirectRouteId?: string;
  shouldRetainIntendedDestination: boolean;
}

export class RouteGuardManager {
  constructor(private readonly integrationIR: IntegrationIR) {}

  evaluatePolicy(policy: AccessPolicy, accessContext: AccessContext): RouteGuardEvaluation {
    if (!policy || policy === 'public') {
      return {
        allowed: true,
        reason: 'Route is public.',
        shouldRetainIntendedDestination: false,
      };
    }

    if (policy === 'guest') {
      if (accessContext.authenticated) {
        return {
          allowed: false,
          reason: 'Guest-only route cannot be entered while authenticated.',
          redirectRouteId: this.integrationIR.entryPoints.authenticatedEntry,
          shouldRetainIntendedDestination: false,
        };
      }
      return {
        allowed: true,
        reason: 'Guest access permitted.',
        shouldRetainIntendedDestination: false,
      };
    }

    if (!accessContext.authenticated) {
      return {
        allowed: false,
        reason: 'Authentication required to enter route.',
        redirectRouteId: this.integrationIR.entryPoints.guestEntry,
        shouldRetainIntendedDestination: true,
      };
    }

    if (accessContext.accountStatus === 'suspended') {
      return {
        allowed: false,
        reason: 'Account is suspended.',
        redirectRouteId:
          this.integrationIR.entryPoints.accountSuspendedRoute ??
          this.integrationIR.entryPoints.accessDeniedRoute ??
          this.integrationIR.entryPoints.guestEntry,
        shouldRetainIntendedDestination: false,
      };
    }

    if (policy === 'authenticated') {
      return {
        allowed: true,
        reason: 'Authenticated user permitted.',
        shouldRetainIntendedDestination: false,
      };
    }

    if (policy === 'verified') {
      if (!accessContext.verified) {
        return {
          allowed: false,
          reason: 'Email or phone verification required.',
          redirectRouteId:
            this.integrationIR.entryPoints.verificationRoute ??
            this.integrationIR.entryPoints.guestEntry,
          shouldRetainIntendedDestination: true,
        };
      }
      return {
        allowed: true,
        reason: 'Verified user permitted.',
        shouldRetainIntendedDestination: false,
      };
    }

    if ('roles' in policy) {
      const mode = policy.mode ?? 'any';
      const hasRoles =
        mode === 'all'
          ? policy.roles.every((r) => accessContext.roles.includes(r))
          : policy.roles.some((r) => accessContext.roles.includes(r));

      if (!hasRoles) {
        return {
          allowed: false,
          reason: `Missing required role (${mode} of [${policy.roles.join(', ')}]).`,
          redirectRouteId:
            this.integrationIR.entryPoints.accessDeniedRoute ??
            this.integrationIR.entryPoints.authenticatedEntry,
          shouldRetainIntendedDestination: false,
        };
      }
      return {
        allowed: true,
        reason: 'Role policy satisfied.',
        shouldRetainIntendedDestination: false,
      };
    }

    if ('permissions' in policy) {
      const mode = policy.mode ?? 'any';
      const hasPerms =
        mode === 'all'
          ? policy.permissions.every((p) => accessContext.permissions.includes(p))
          : policy.permissions.some((p) => accessContext.permissions.includes(p));

      if (!hasPerms) {
        return {
          allowed: false,
          reason: `Missing required permission (${mode} of [${policy.permissions.join(', ')}]).`,
          redirectRouteId:
            this.integrationIR.entryPoints.accessDeniedRoute ??
            this.integrationIR.entryPoints.authenticatedEntry,
          shouldRetainIntendedDestination: false,
        };
      }
      return {
        allowed: true,
        reason: 'Permission policy satisfied.',
        shouldRetainIntendedDestination: false,
      };
    }

    return {
      allowed: false,
      reason: 'Unknown access policy.',
      redirectRouteId: this.integrationIR.entryPoints.guestEntry,
      shouldRetainIntendedDestination: false,
    };
  }

  evaluateRoute(routeId: string, accessContext: AccessContext): RouteGuardEvaluation {
    const rule = this.integrationIR.guards.find((g) => g.routeId === routeId);
    const policy = rule?.policy ?? 'public';
    return this.evaluatePolicy(policy, accessContext);
  }
}
