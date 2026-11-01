/**
 * @expo-foundation/integration - Auth-Navigation Coordinator & Bridge
 *
 * Implements Section 15 (Auth-Navigation Integration Engine) & Audit Finding 12:
 * - Coordinates AuthController, NavigationStateManager, DeepLinkManager, and RouteGuardManager
 * - Single-owner `flowRef` execution per event envelope via `eventBus.claimFlowDispatch`
 *   so external business logic flows are never dispatched twice
 * - Handles startup session restoration hold (`isNavigationReady`) to prevent initial screen flicker
 * - Automatically restores deferred deep links after login
 * - Immediately re-evaluates the current active route when access roles/permissions change
 */

import {
  FoundationEventBus,
  InMemoryFlowRegistry,
  type FlowRegistry,
  type FoundationEventEnvelope,
} from '@expo-foundation/contracts';
import type { AuthController, AuthRuntimeSnapshot } from '@expo-foundation/auth';
import type { IntegrationIR, NavigationIR } from '@expo-foundation/core';
import {
  DeepLinkManager,
  NavigationStateManager,
  type DeepLinkResolutionResult,
  type NavigationStateSnapshot,
} from '@expo-foundation/navigation';
import { RouteGuardManager } from '../route-guards/index.js';

export class AuthNavigationBridge {
  private readonly authController: AuthController;
  private readonly navigationStateManager: NavigationStateManager;
  private readonly deepLinkManager: DeepLinkManager;
  private readonly guardManager: RouteGuardManager;
  private readonly integrationIR: IntegrationIR;
  private readonly eventBus: FoundationEventBus;
  private readonly flowRegistry: FlowRegistry;

  private navigationReady = false;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(options: {
    authController: AuthController;
    navigationStateManager: NavigationStateManager;
    navigationIR: NavigationIR;
    integrationIR: IntegrationIR;
    eventBus?: FoundationEventBus;
    flowRegistry?: FlowRegistry;
  }) {
    this.authController = options.authController;
    this.navigationStateManager = options.navigationStateManager;
    this.integrationIR = options.integrationIR;
    this.eventBus = options.eventBus ?? new FoundationEventBus();
    this.flowRegistry = options.flowRegistry ?? new InMemoryFlowRegistry();

    this.guardManager = new RouteGuardManager(
      options.navigationIR,
      options.integrationIR
    );
    this.deepLinkManager = new DeepLinkManager({
      navigationIR: options.navigationIR,
      stateManager: this.navigationStateManager,
      eventBus: this.eventBus,
    });

    if (this.integrationIR.enabled) {
      this.attachIntegrationHooks();
    } else {
      this.navigationReady = true;
    }
  }

  private attachIntegrationHooks(): void {
    // 1. Install RouteGuardHook into NavigationStateManager
    this.navigationStateManager.setGuardHook((routeId, params, context) => {
      return this.guardManager.evaluateRoute(routeId, params, context);
    });

    // 2. Sync AuthController state changes to NavigationStateManager accessContext
    const unsubAuth = this.authController.subscribe(
      (snapshot: AuthRuntimeSnapshot) => {
        this.navigationStateManager.setAccessContext(snapshot.accessContext);

        if (snapshot.status === 'unknown' || snapshot.status === 'restoring') {
          this.navigationReady = false;
        } else {
          this.navigationReady = true;
        }
      }
    );
    this.unsubscribers.push(unsubAuth);

    // 3. Subscribe to Auth Lifecycle Events on EventBus (deterministic async execution)
    const unsubEvents = this.eventBus.on('*', async (envelope) => {
      await this.handleEventEnvelope(envelope);
    });
    this.unsubscribers.push(unsubEvents);
  }

  private async handleEventEnvelope(
    envelope: FoundationEventEnvelope
  ): Promise<void> {
    if (!this.integrationIR.enabled) return;

    const accessCtx = this.authController.getAccessContext();
    this.navigationStateManager.setAccessContext(accessCtx);

    const customBinding = this.integrationIR.events[envelope.event];
    // Single-owner flow dispatch deduplication (Audit Finding 12)
    if (
      customBinding?.flowRef &&
      this.eventBus.claimFlowDispatch(envelope.id, customBinding.flowRef)
    ) {
      await this.flowRegistry.dispatch(
        customBinding.flowRef,
        envelope.event,
        envelope.payload,
        envelope.id
      );
    }

    switch (envelope.event) {
      case 'auth.session.restored': {
        this.navigationReady = true;
        const restoredLink = this.deepLinkManager.restoreDeferredDeepLink();
        if (!restoredLink || restoredLink.status !== 'navigated') {
          const entryTarget =
            this.guardManager.resolveAuthenticatedEntry(accessCtx) ??
            this.integrationIR.authenticatedEntry;
          this.navigationStateManager.reset(entryTarget, {});
        }
        break;
      }

      case 'auth.login.success': {
        this.navigationReady = true;
        if (this.integrationIR.afterLogin === 'restore-intended-destination') {
          const restored = this.deepLinkManager.restoreDeferredDeepLink();
          if (restored && restored.status === 'navigated') {
            break;
          }
        } else if (this.integrationIR.afterLogin) {
          this.navigationStateManager.reset(this.integrationIR.afterLogin, {});
          break;
        }

        const entryTarget =
          this.guardManager.resolveAuthenticatedEntry(accessCtx) ??
          this.integrationIR.authenticatedEntry;
        this.navigationStateManager.reset(entryTarget, {});
        break;
      }

      case 'auth.registration.completed': {
        const verificationReq = Boolean(envelope.payload.verificationRequired);
        if (verificationReq && this.integrationIR.afterRegistration) {
          this.navigationStateManager.replace(
            this.integrationIR.afterRegistration,
            {}
          );
        }
        break;
      }

      case 'auth.verification.required': {
        const target =
          this.integrationIR.verificationRoute ??
          this.integrationIR.afterRegistration;
        if (target) {
          this.navigationStateManager.replace(target, {});
        }
        break;
      }

      case 'auth.logout.success': {
        this.navigationReady = true;
        this.navigationStateManager.reset(this.integrationIR.afterLogout, {});
        break;
      }

      case 'auth.session.expired': {
        this.navigationReady = true;
        const target =
          this.integrationIR.sessionExpiredRoute ??
          this.integrationIR.guestEntry;
        this.navigationStateManager.reset(target, {});
        break;
      }

      case 'auth.account.suspended': {
        this.navigationReady = true;
        const target =
          this.integrationIR.accountSuspendedRoute ??
          this.integrationIR.accessDeniedRoute ??
          this.integrationIR.guestEntry;
        this.navigationStateManager.reset(target, {});
        break;
      }

      case 'auth.access.changed': {
        // Re-evaluate current route immediately when user roles/permissions change
        const currentState = this.navigationStateManager.getState();
        const decision = this.guardManager.evaluateRoute(
          currentState.currentRouteId,
          currentState.currentParams,
          accessCtx
        );
        if (!decision.allowed && decision.redirectRouteId) {
          this.navigationStateManager.replace(decision.redirectRouteId, {});
        }
        break;
      }
    }
  }

  /**
   * Startup initialization sequence (Section 15.2):
   * Restores session first; if anonymous, resets navigation to guestEntry.
   */
  async initialize(): Promise<{
    auth: AuthRuntimeSnapshot;
    navigation: NavigationStateSnapshot;
    isNavigationReady: boolean;
  }> {
    const authSnap = await this.authController.initialize();
    this.navigationStateManager.setAccessContext(authSnap.accessContext);

    if (authSnap.status === 'anonymous') {
      this.navigationStateManager.reset(this.integrationIR.guestEntry, {});
    }
    this.navigationReady = true;

    return {
      auth: authSnap,
      navigation: this.navigationStateManager.getState(),
      isNavigationReady: this.navigationReady,
    };
  }

  handleDeepLink(url: string): DeepLinkResolutionResult {
    return this.deepLinkManager.handleIncomingUrl(url, {
      guestEntryRouteId: this.integrationIR.guestEntry,
      authenticatedEntryRouteId: this.integrationIR.authenticatedEntry,
      verificationRouteId: this.integrationIR.verificationRoute,
      accessDeniedRouteId: this.integrationIR.accessDeniedRoute,
    });
  }

  isNavigationReady(): boolean {
    return this.navigationReady;
  }

  dispose(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers.length = 0;
  }
}

export { AuthNavigationBridge as AuthNavigationCoordinator };

export function generateIntegrationModuleFiles(
  ir: IntegrationIR
): Record<string, string> {
  return {
    'src/foundation/integration/integration.config.ts': `/**
 * GENERATED BY @expo-foundation/integration - DO NOT EDIT MANUALLY
 */
export const INTEGRATION_IR = ${JSON.stringify(ir, null, 2)} as const;
`,
    'src/foundation/integration/AuthNavigationGate.tsx': `/**
 * GENERATED BY @expo-foundation/integration - DO NOT EDIT MANUALLY
 */
import React, { useEffect } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { useFoundationNavigation } from '../navigation/NavigationProvider';
import { INTEGRATION_IR } from './integration.config';

export function AuthNavigationGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const nav = useFoundationNavigation();

  useEffect(() => {
    if (!INTEGRATION_IR.enabled) return;
    if (auth.status === 'unknown' || auth.status === 'restoring') return;

    if (auth.status === 'anonymous') {
      nav.reset(INTEGRATION_IR.guestEntry);
    } else if (auth.status === 'verifying') {
      if (INTEGRATION_IR.verificationRoute) {
        nav.replace(INTEGRATION_IR.verificationRoute);
      }
    } else if (auth.status === 'authenticated') {
      nav.reset(INTEGRATION_IR.authenticatedEntry);
    }
  }, [auth.status]);

  if (INTEGRATION_IR.enabled && (auth.status === 'unknown' || auth.status === 'restoring')) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
`,
    'src/foundation/integration/index.ts': `export * from './integration.config';
export * from './AuthNavigationGate';
`,
  };
}
