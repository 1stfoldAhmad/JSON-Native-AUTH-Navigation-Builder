import type { AuthController } from '@expo-foundation/auth';
import type { FlowRegistry, FoundationEventBus } from '@expo-foundation/contracts';
import type { AccessContext, IntegrationIR } from '@expo-foundation/core';
import {
  DeepLinkManager,
  type NavigationState,
  type NavigationStateManager,
} from '@expo-foundation/navigation';
import { RouteGuardManager } from '../route-guards/index.js';

export class RedirectManager {
  constructor(
    private readonly integrationIR: IntegrationIR,
    private readonly deepLinkManager: DeepLinkManager
  ) {}

  resolveAuthenticatedEntry(accessContext: AccessContext): string {
    for (const role of accessContext.roles) {
      const groupTarget = this.integrationIR.roleRouteGroups[role];
      if (groupTarget) {
        return groupTarget;
      }
    }
    return this.integrationIR.entryPoints.authenticatedEntry;
  }

  resolvePostLoginDestination(accessContext: AccessContext): {
    routeId: string;
    params: Record<string, unknown>;
    restoredFromIntended: boolean;
  } {
    const afterLoginPolicy = this.integrationIR.redirects.afterLogin;
    if (afterLoginPolicy === 'restore-intended-destination') {
      const intended = this.deepLinkManager.getIntendedDestination();
      if (intended) {
        this.deepLinkManager.clearIntendedDestination();
        return {
          routeId: intended.routeId,
          params: intended.params,
          restoredFromIntended: true,
        };
      }
    } else if (afterLoginPolicy) {
      return {
        routeId: afterLoginPolicy,
        params: {},
        restoredFromIntended: false,
      };
    }

    return {
      routeId: this.resolveAuthenticatedEntry(accessContext),
      params: {},
      restoredFromIntended: false,
    };
  }
}

export interface AuthNavigationBridgeOptions {
  integrationIR: IntegrationIR;
  authController: AuthController;
  navigationStateManager: NavigationStateManager;
  deepLinkManager?: DeepLinkManager;
  eventBus?: FoundationEventBus;
  flowRegistry?: FlowRegistry;
}

export class AuthNavigationBridge {
  readonly integrationIR: IntegrationIR;
  readonly authController: AuthController;
  readonly navigationStateManager: NavigationStateManager;
  readonly deepLinkManager: DeepLinkManager;
  readonly guardManager: RouteGuardManager;
  readonly redirectManager: RedirectManager;
  readonly eventBus: FoundationEventBus;
  readonly flowRegistry: FlowRegistry;

  private holdingProtectedEntry = false;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(options: AuthNavigationBridgeOptions) {
    this.integrationIR = options.integrationIR;
    this.authController = options.authController;
    this.navigationStateManager = options.navigationStateManager;
    this.eventBus = options.eventBus ?? options.authController.eventBus;
    this.flowRegistry = options.flowRegistry ?? options.authController.flowRegistry;

    this.deepLinkManager =
      options.deepLinkManager ??
      new DeepLinkManager(
        options.navigationStateManager.registry,
        options.navigationStateManager,
        options.navigationStateManager.navigationIR.linking
      );

    this.guardManager = new RouteGuardManager(options.integrationIR);
    this.redirectManager = new RedirectManager(options.integrationIR, this.deepLinkManager);

    this.attachEventListeners();
  }

  isHoldingProtectedEntry(): boolean {
    return this.holdingProtectedEntry;
  }

  private findEventFlowRef(authEvent: string): string | undefined {
    return this.integrationIR.eventBindings.find((b) => b.authEvent === authEvent)?.flowRef;
  }

  private async dispatchBoundFlowIfAny(
    authEvent: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const flowRef = this.findEventFlowRef(authEvent);
    if (flowRef) {
      await this.flowRegistry.dispatch(flowRef, authEvent, payload);
    }
  }

  private attachEventListeners(): void {
    // 1. auth.session.restoring -> hold protected application entry
    this.unsubscribers.push(
      this.eventBus.on('auth.session.restoring', async (env) => {
        this.holdingProtectedEntry = true;
        await this.dispatchBoundFlowIfAny('auth.session.restoring', env.payload);
      })
    );

    // 2. auth.session.restored -> resolve authenticated entry (or intended destination)
    this.unsubscribers.push(
      this.eventBus.on('auth.session.restored', async (env) => {
        this.holdingProtectedEntry = false;
        const accessContext = this.authController.getAccessContext();
        const dest = this.redirectManager.resolvePostLoginDestination(accessContext);
        if (this.navigationStateManager.registry.has(dest.routeId)) {
          this.navigationStateManager.reset(dest.routeId, dest.params);
        }
        await this.dispatchBoundFlowIfAny('auth.session.restored', env.payload);
      })
    );

    // 3. auth.login.success -> navigate to intended destination or authenticated entry
    this.unsubscribers.push(
      this.eventBus.on('auth.login.success', async (env) => {
        this.holdingProtectedEntry = false;
        const accessContext = this.authController.getAccessContext();
        const dest = this.redirectManager.resolvePostLoginDestination(accessContext);
        if (this.navigationStateManager.registry.has(dest.routeId)) {
          this.navigationStateManager.reset(dest.routeId, dest.params);
        }
        await this.dispatchBoundFlowIfAny('auth.login.success', env.payload);
      })
    );

    // 4. auth.registration.completed -> follow registration policy
    this.unsubscribers.push(
      this.eventBus.on('auth.registration.completed', async (env) => {
        this.holdingProtectedEntry = false;
        const target = this.integrationIR.redirects.afterRegistration;
        if (this.navigationStateManager.registry.has(target)) {
          this.navigationStateManager.navigate(target);
        }
        await this.dispatchBoundFlowIfAny('auth.registration.completed', env.payload);
      })
    );

    // 5. auth.verification.required -> navigate to verification reference
    this.unsubscribers.push(
      this.eventBus.on('auth.verification.required', async (env) => {
        this.holdingProtectedEntry = false;
        const verifyRoute =
          this.integrationIR.entryPoints.verificationRoute ??
          this.integrationIR.entryPoints.guestEntry;
        if (this.navigationStateManager.registry.has(verifyRoute)) {
          this.navigationStateManager.navigate(verifyRoute);
        }
        await this.dispatchBoundFlowIfAny('auth.verification.required', env.payload);
      })
    );

    // 6. auth.session.expired -> reset to guest entry
    this.unsubscribers.push(
      this.eventBus.on('auth.session.expired', async (env) => {
        this.holdingProtectedEntry = false;
        const target =
          this.integrationIR.entryPoints.sessionExpiredRoute ??
          this.integrationIR.entryPoints.guestEntry;
        if (this.navigationStateManager.registry.has(target)) {
          this.navigationStateManager.reset(target);
        }
        await this.dispatchBoundFlowIfAny('auth.session.expired', env.payload);
      })
    );

    // 7. auth.logout.success -> clear authenticated navigation history
    this.unsubscribers.push(
      this.eventBus.on('auth.logout.success', async (env) => {
        this.holdingProtectedEntry = false;
        this.deepLinkManager.clearIntendedDestination();
        const target =
          this.integrationIR.redirects.afterLogout ??
          this.integrationIR.entryPoints.guestEntry;
        if (this.navigationStateManager.registry.has(target)) {
          this.navigationStateManager.reset(target);
        }
        await this.dispatchBoundFlowIfAny('auth.logout.success', env.payload);
      })
    );

    // 8. auth.access.changed -> re-evaluate protected routes
    this.unsubscribers.push(
      this.eventBus.on('auth.access.changed', async (env) => {
        this.reevaluateCurrentRoute();
        await this.dispatchBoundFlowIfAny('auth.access.changed', env.payload);
      })
    );

    // 9. auth.account.suspended -> restrict application access
    this.unsubscribers.push(
      this.eventBus.on('auth.account.suspended', async (env) => {
        this.holdingProtectedEntry = false;
        const target =
          this.integrationIR.entryPoints.accountSuspendedRoute ??
          this.integrationIR.entryPoints.accessDeniedRoute ??
          this.integrationIR.entryPoints.guestEntry;
        if (this.navigationStateManager.registry.has(target)) {
          this.navigationStateManager.reset(target);
        }
        await this.dispatchBoundFlowIfAny('auth.account.suspended', env.payload);
      })
    );
  }

  /**
   * Navigates to a route while enforcing route access policies.
   * Never displays unauthorized navigation as successful.
   */
  navigateGuarded(
    routeId: string,
    params: Record<string, unknown> = {}
  ): {
    allowed: boolean;
    activeRouteId: string;
    redirectedTo?: string;
    reason: string;
    state: NavigationState;
  } {
    const accessContext = this.authController.getAccessContext();
    const evaluation = this.guardManager.evaluateRoute(routeId, accessContext);

    if (evaluation.allowed) {
      const state = this.navigationStateManager.navigate(routeId, params);
      return {
        allowed: true,
        activeRouteId: state.activeRouteId,
        reason: evaluation.reason,
        state,
      };
    }

    if (evaluation.shouldRetainIntendedDestination) {
      this.deepLinkManager.setIntendedDestination(routeId, params);
    }

    const fallbackRouteId =
      evaluation.redirectRouteId ?? this.integrationIR.entryPoints.guestEntry;

    this.eventBus.emit(
      'nav.guard.blocked',
      {
        blockedRouteId: routeId,
        redirectRouteId: fallbackRouteId,
        reason: evaluation.reason,
      },
      { source: 'integration' }
    );

    let state = this.navigationStateManager.getState();
    if (
      this.navigationStateManager.registry.has(fallbackRouteId) &&
      state.activeRouteId !== fallbackRouteId
    ) {
      state = this.navigationStateManager.navigate(fallbackRouteId);
    }

    return {
      allowed: false,
      activeRouteId: state.activeRouteId,
      redirectedTo: fallbackRouteId,
      reason: evaluation.reason,
      state,
    };
  }

  handleDeepLink(url: string) {
    return this.deepLinkManager.handleIncomingUrl(url, {
      accessContext: this.authController.getAccessContext(),
      guestEntryRouteId: this.integrationIR.entryPoints.guestEntry,
    });
  }

  reevaluateCurrentRoute(): {
    allowed: boolean;
    redirectedTo?: string;
  } {
    const current = this.navigationStateManager.getState();
    const accessContext = this.authController.getAccessContext();
    const evaluation = this.guardManager.evaluateRoute(
      current.activeRouteId,
      accessContext
    );

    if (evaluation.allowed) {
      return { allowed: true };
    }

    const redirectRouteId =
      evaluation.redirectRouteId ?? this.integrationIR.entryPoints.guestEntry;
    if (this.navigationStateManager.registry.has(redirectRouteId)) {
      this.navigationStateManager.replace(redirectRouteId);
    }
    return {
      allowed: false,
      redirectedTo: redirectRouteId,
    };
  }

  dispose(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers.length = 0;
  }
}

export interface GeneratedIntegrationFile {
  path: string;
  content: string;
  ownership: 'generated';
}

const GENERATED_HEADER = `/**
 * @generated by @expo-foundation/integration
 * DO NOT EDIT MANUALLY — deterministic output from integration.json via Canonical IntegrationIR.
 */`;

export function generateIntegrationFiles(
  integrationIR: IntegrationIR
): GeneratedIntegrationFile[] {
  return [
    {
      path: 'src/foundation/config/integration.generated.ts',
      ownership: 'generated',
      content: `${GENERATED_HEADER}

export const INTEGRATION_CONFIG = ${JSON.stringify(integrationIR, null, 2)} as const;
export type GeneratedIntegrationConfig = typeof INTEGRATION_CONFIG;
`,
    },
    {
      path: 'src/foundation/integration/RouteGuardManager.ts',
      ownership: 'generated',
      content: `${GENERATED_HEADER}
import { INTEGRATION_CONFIG } from '../config/integration.generated';
import type { AccessContext } from '../auth/AuthStateMachine';

export class GeneratedRouteGuardManager {
  readonly guards = INTEGRATION_CONFIG.guards;

  canAccess(routeId: string, context: AccessContext): { allowed: boolean; redirectRouteId?: string } {
    const rule = this.guards.find((g) => g.routeId === routeId);
    if (!rule || rule.policy === 'public') {
      return { allowed: true };
    }
    if (rule.policy === 'guest') {
      return context.authenticated
        ? { allowed: false, redirectRouteId: INTEGRATION_CONFIG.entryPoints.authenticatedEntry }
        : { allowed: true };
    }
    if (!context.authenticated) {
      return { allowed: false, redirectRouteId: INTEGRATION_CONFIG.entryPoints.guestEntry };
    }
    if (rule.policy === 'verified' && !context.verified) {
      return {
        allowed: false,
        redirectRouteId:
          INTEGRATION_CONFIG.entryPoints.verificationRoute ??
          INTEGRATION_CONFIG.entryPoints.guestEntry,
      };
    }
    if (typeof rule.policy === 'object' && 'roles' in rule.policy) {
      const roles = rule.policy.roles as readonly string[];
      const mode = rule.policy.mode ?? 'any';
      const ok =
        mode === 'all'
          ? roles.every((r) => context.roles.includes(r))
          : roles.some((r) => context.roles.includes(r));
      return ok ? { allowed: true } : { allowed: false, redirectRouteId: rule.redirectOnDeny };
    }
    if (typeof rule.policy === 'object' && 'permissions' in rule.policy) {
      const perms = rule.policy.permissions as readonly string[];
      const mode = rule.policy.mode ?? 'any';
      const ok =
        mode === 'all'
          ? perms.every((p) => context.permissions.includes(p))
          : perms.some((p) => context.permissions.includes(p));
      return ok ? { allowed: true } : { allowed: false, redirectRouteId: rule.redirectOnDeny };
    }
    return { allowed: true };
  }
}
`,
    },
    {
      path: 'src/foundation/integration/RedirectManager.ts',
      ownership: 'generated',
      content: `${GENERATED_HEADER}
import { INTEGRATION_CONFIG } from '../config/integration.generated';
import { deepLinkManager } from '../navigation/DeepLinkManager';

export class GeneratedRedirectManager {
  resolveAfterLogin(): { routeId: string; params: Record<string, unknown> } {
    if (INTEGRATION_CONFIG.redirects.afterLogin === 'restore-intended-destination') {
      const intended = deepLinkManager.consumeIntendedDestination();
      if (intended) {
        return intended;
      }
    }
    return {
      routeId: INTEGRATION_CONFIG.entryPoints.authenticatedEntry,
      params: {},
    };
  }
}
`,
    },
    {
      path: 'src/foundation/integration/AuthNavigationBridge.ts',
      ownership: 'generated',
      content: `${GENERATED_HEADER}
import { INTEGRATION_CONFIG } from '../config/integration.generated';
import { GeneratedRouteGuardManager } from './RouteGuardManager';
import { GeneratedRedirectManager } from './RedirectManager';

export class GeneratedAuthNavigationBridge {
  readonly guardManager = new GeneratedRouteGuardManager();
  readonly redirectManager = new GeneratedRedirectManager();
  readonly config = INTEGRATION_CONFIG;
}
`,
    },
  ];
}
