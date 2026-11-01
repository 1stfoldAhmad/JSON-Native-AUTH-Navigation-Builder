import { describe, expect, it, vi } from 'vitest';
import { AuthController, InMemoryTokenStorage } from '@expo-foundation/auth';
import {
  FoundationEventBus,
  InMemoryFlowRegistry,
  type AuthProviderAdapter,
  type AuthSession,
} from '@expo-foundation/contracts';
import {
  FoundationCompiler,
  type AuthConfigDocument,
  type IntegrationConfigDocument,
  type NavigationConfigDocument,
} from '@expo-foundation/core';
import { AuthNavigationBridge } from '@expo-foundation/integration';
import { NavigationStateManager } from '@expo-foundation/navigation';
import completeAuthDoc from '../../examples/complete-foundation/auth.json' with { type: 'json' };
import completeNavDoc from '../../examples/complete-foundation/navigation.json' with { type: 'json' };
import completeIntDoc from '../../examples/complete-foundation/integration.json' with { type: 'json' };

function createTestHarness(options?: {
  persistedSession?: AuthSession;
  requireEmailVerification?: boolean;
  userRoles?: string[];
  userPermissions?: string[];
  shouldFailRefresh?: boolean;
}) {
  const compiler = new FoundationCompiler();
  const authDocClone = structuredClone(completeAuthDoc) as unknown as AuthConfigDocument;
  if (options?.requireEmailVerification !== undefined) {
    authDocClone.accessControl = {
      ...authDocClone.accessControl,
      requireEmailVerification: options.requireEmailVerification,
    };
  }

  const projectIR = compiler.compile({
    auth: authDocClone,
    navigation: completeNavDoc as unknown as NavigationConfigDocument,
    integration: completeIntDoc as unknown as IntegrationConfigDocument,
  });

  const eventBus = new FoundationEventBus();
  const flowRegistry = new InMemoryFlowRegistry();
  for (const flowId of Object.values(projectIR.auth!.eventFlows)) {
    flowRegistry.register(flowId, () => {});
  }

  const storage = new InMemoryTokenStorage();
  const now = Date.now();
  let serverRoles = options?.userRoles ?? ['user'];
  let serverPermissions = options?.userPermissions ?? ['orders.read'];

  const customAdapter: AuthProviderAdapter = {
    providerType: 'rest',
    initialize: vi.fn(async () => {}),
    signIn: vi.fn(async (input) => {
      const session: AuthSession = {
        sessionId: `sess_${now}`,
        user: {
          id: 'usr_test_1',
          email: input.email ?? 'user@expo.dev',
          emailVerified: !(options?.requireEmailVerification ?? false),
          roles: serverRoles,
          permissions: serverPermissions,
        },
        tokens: {
          accessToken: 'jwt_access_123',
          refreshToken: 'jwt_refresh_456',
          expiresAt: now + 3600_000,
        },
        provider: 'rest',
        issuedAt: now,
        expiresAt: now + 3600_000,
      };
      return {
        status: 'authenticated' as const,
        session,
        user: session.user,
      };
    }),
    signUp: vi.fn(async (input) => {
      if (options?.requireEmailVerification) {
        return {
          status: 'verification_required' as const,
          user: {
            id: 'usr_new_unverified',
            email: input.email ?? 'new@expo.dev',
            emailVerified: false,
          },
          challenge: {
            challengeId: 'chg_email_1',
            type: 'email_verification' as const,
            deliveryMedium: 'email' as const,
          },
        };
      }
      return customAdapter.signIn(input);
    }),
    signOut: vi.fn(async () => {}),
    restoreSession: vi.fn(async () => options?.persistedSession ?? null),
    refreshSession: vi.fn(async () => {
      if (options?.shouldFailRefresh) {
        throw new Error('Refresh token revoked or expired');
      }
      return {
        sessionId: `sess_refreshed_${now}`,
        user: {
          id: 'usr_test_1',
          email: 'user@expo.dev',
          emailVerified: true,
          roles: serverRoles,
          permissions: serverPermissions,
        },
        tokens: {
          accessToken: 'jwt_access_refreshed',
          refreshToken: 'jwt_refresh_rotated',
          expiresAt: now + 3600_000,
        },
        provider: 'rest' as const,
        issuedAt: now,
        expiresAt: now + 3600_000,
      };
    }),
    requestPasswordReset: vi.fn(async () => {}),
    resetPassword: vi.fn(async () => {}),
    verifyEmail: vi.fn(async () => {}),
    getCurrentUser: vi.fn(async () => ({
      id: 'usr_test_1',
      email: 'user@expo.dev',
      emailVerified: true,
      roles: serverRoles,
      permissions: serverPermissions,
    })),
  };

  const authController = new AuthController({
    authIR: projectIR.auth!,
    adapter: customAdapter,
    storage,
    eventBus,
    flowRegistry,
    now: () => now,
  });

  const navManager = new NavigationStateManager({
    navigationIR: projectIR.navigation!,
    eventBus,
  });

  const bridge = new AuthNavigationBridge({
    authController,
    navigationStateManager: navManager,
    navigationIR: projectIR.navigation!,
    integrationIR: projectIR.integration!,
    eventBus,
    flowRegistry,
  });

  return {
    projectIR,
    authController,
    navManager,
    bridge,
    storage,
    eventBus,
    flowRegistry,
    now,
    setServerRolesAndPermissions(roles: string[], permissions: string[]) {
      serverRoles = roles;
      serverPermissions = permissions;
    },
  };
}

describe('End-to-End Auth + Navigation Integration Scenarios (Section 18.2)', () => {
  it('Scenario 1: App launch with no stored session -> routes to guestEntry (/login)', async () => {
    const { bridge, navManager } = createTestHarness();
    const res = await bridge.initialize();

    expect(res.auth.status).toBe('anonymous');
    expect(res.isNavigationReady).toBe(true);
    expect(navManager.getState().currentRouteId).toBe('login');
  });

  it('Scenario 2: App launch with valid stored session -> restores session and routes to authenticatedEntry (/home)', async () => {
    const now = Date.now();
    const validSession: AuthSession = {
      sessionId: 'sess_stored',
      user: {
        id: 'usr_stored',
        email: 'stored@expo.dev',
        emailVerified: true,
        roles: ['user'],
        permissions: ['orders.read'],
      },
      tokens: {
        accessToken: 'valid_token',
        refreshToken: 'valid_refresh',
        expiresAt: now + 3600_000,
      },
      provider: 'rest',
      issuedAt: now - 60_000,
      expiresAt: now + 3600_000,
    };

    const { bridge, storage, navManager } = createTestHarness({
      persistedSession: validSession,
    });
    await storage.setItem(
      'expo_foundation.auth.session.v1',
      JSON.stringify(validSession)
    );

    const res = await bridge.initialize();
    expect(res.auth.status).toBe('authenticated');
    expect(navManager.getState().currentRouteId).toBe('home');
  });

  it('Scenario 3: App launch with expired access token & valid refresh token -> refreshes and routes to /home', async () => {
    const now = Date.now();
    const expiringSession: AuthSession = {
      sessionId: 'sess_expiring',
      user: {
        id: 'usr_exp',
        email: 'exp@expo.dev',
        emailVerified: true,
        roles: ['user'],
        permissions: ['orders.read'],
      },
      tokens: {
        accessToken: 'expired_access',
        refreshToken: 'valid_refresh_token',
        expiresAt: now - 5_000,
      },
      provider: 'rest',
      issuedAt: now - 3600_000,
      expiresAt: now - 5_000,
    };

    const { bridge, storage, navManager } = createTestHarness({
      persistedSession: expiringSession,
    });
    await storage.setItem(
      'expo_foundation.auth.session.v1',
      JSON.stringify(expiringSession)
    );

    const res = await bridge.initialize();
    expect(res.auth.status).toBe('authenticated');
    expect(res.auth.session?.tokens.accessToken).toBe('jwt_access_refreshed');
    expect(navManager.getState().currentRouteId).toBe('home');
  });

  it('Scenario 4: App launch with expired refresh token -> clears session and routes to /login', async () => {
    const now = Date.now();
    const expiredSession: AuthSession = {
      sessionId: 'sess_dead',
      user: { id: 'usr_dead', email: 'dead@expo.dev' },
      tokens: {
        accessToken: 'expired_access',
        refreshToken: 'expired_refresh',
        expiresAt: now - 10_000,
      },
      provider: 'rest',
      issuedAt: now - 7200_000,
      expiresAt: now - 10_000,
    };

    const { bridge, storage, navManager } = createTestHarness({
      persistedSession: expiredSession,
      shouldFailRefresh: true,
    });
    await storage.setItem(
      'expo_foundation.auth.session.v1',
      JSON.stringify(expiredSession)
    );

    const res = await bridge.initialize();
    expect(res.auth.status).toBe('anonymous');
    expect(navManager.getState().currentRouteId).toBe('login');
  });

  it('Scenario 5 & 9: Unauthenticated user opens protected deep link -> redirected to login -> logs in -> restored to deep link with params', async () => {
    const { bridge, authController, navManager } = createTestHarness();
    await bridge.initialize();
    expect(navManager.getState().currentRouteId).toBe('login');

    const dlRes = bridge.handleDeepLink(
      'efshop://orders/ORD-4200?tab=shipment'
    );
    expect(dlRes.status).toBe('deferred');
    expect(navManager.getState().currentRouteId).toBe('login');
    expect(navManager.getState().intendedDestination?.routeId).toBe(
      'order-detail'
    );

    await authController.signIn({
      email: 'customer@expo.dev',
      password: 'Password123!',
    });

    const finalState = navManager.getState();
    expect(finalState.currentRouteId).toBe('order-detail');
    expect(finalState.currentPath).toBe('/orders/ORD-4200?tab=shipment');
    expect(finalState.currentParams).toEqual({
      orderId: 'ORD-4200',
      tab: 'shipment',
    });
  });

  it('Scenario 6: Registration requiring email verification -> routes to /verify -> verifies -> routes to /home', async () => {
    const { bridge, authController, navManager } = createTestHarness({
      requireEmailVerification: true,
    });
    await bridge.initialize();

    await authController.signUp({
      email: 'newuser@expo.dev',
      password: 'Password123!',
    });
    expect(authController.getSnapshot().status).toBe('verifying');
    expect(navManager.getState().currentRouteId).toBe('verify-email');

    await authController.verifyEmail({
      code: '123456',
      email: 'newuser@expo.dev',
    });
    expect(authController.getSnapshot().status).toBe('authenticated');
    expect(navManager.getState().currentRouteId).toBe('home');
  });

  it('Scenario 7 & 10: Authenticated user without admin role blocked from /admin -> redirected to /access-denied; server role refresh re-evaluates route (Finding 14)', async () => {
    const {
      bridge,
      authController,
      navManager,
      setServerRolesAndPermissions,
    } = createTestHarness({
      userRoles: ['user'],
      userPermissions: ['orders.read'],
    });
    await bridge.initialize();
    await authController.signIn({
      email: 'user@expo.dev',
      password: 'Password123!',
    });

    navManager.navigate('admin-dashboard');
    expect(navManager.getState().currentRouteId).toBe('access-denied');

    // Elevate to admin on the server and refresh AccessContext from server
    setServerRolesAndPermissions(
      ['admin', 'user'],
      ['orders.read', 'admin.access']
    );
    await authController.refreshAccessContextFromServer();
    navManager.navigate('admin-dashboard');
    expect(navManager.getState().currentRouteId).toBe('admin-dashboard');

    // Demote admin role on the server while on /admin -> immediately redirects to /access-denied
    setServerRolesAndPermissions(['user'], ['orders.read']);
    await authController.refreshAccessContextFromServer();
    expect(navManager.getState().currentRouteId).toBe('access-denied');
  });

  it('Scenario 8: User logs out from nested screen -> clears session and resets root stack to /login', async () => {
    const { bridge, authController, navManager, flowRegistry } =
      createTestHarness();
    await bridge.initialize();
    await authController.signIn({
      email: 'user@expo.dev',
      password: 'Password123!',
    });

    navManager.push('order-detail', { orderId: 'ORD-88' });
    expect(navManager.getState().currentRouteId).toBe('order-detail');

    await authController.signOut();
    const afterLogout = navManager.getState();
    expect(afterLogout.currentRouteId).toBe('login');
    expect(afterLogout.history).toHaveLength(1);

    // Verify single-owner flowRef execution (Finding 12: each flowRef executed once per event)
    const executedFlows = flowRegistry
      .getExecutionHistory()
      .map((f) => f.flowRef);
    expect(
      executedFlows.filter((f) => f === 'flow.auth.after-login')
    ).toHaveLength(1);
    expect(
      executedFlows.filter((f) => f === 'flow.auth.cleanup-user-cache')
    ).toHaveLength(1);
  });
});
