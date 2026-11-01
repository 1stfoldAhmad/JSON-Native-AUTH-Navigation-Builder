import { describe, expect, it } from 'vitest';
import {
  AuthController,
  MemorySecureStorageAdapter,
  RestAuthProviderAdapter,
} from '@expo-foundation/auth';
import { FoundationEventBus, InMemoryFlowRegistry } from '@expo-foundation/contracts';
import { defaultFoundationCompiler } from '@expo-foundation/core';
import { AuthNavigationBridge } from '@expo-foundation/integration';
import {
  AndroidNavigationAdapter,
  IOSNativeNavigationAdapter,
  NavigationStateManager,
} from '@expo-foundation/navigation';
import completeAuthJson from '../../examples/complete-foundation/auth.json' with { type: 'json' };
import completeNavJson from '../../examples/complete-foundation/navigation.json' with { type: 'json' };
import completeIntJson from '../../examples/complete-foundation/integration.json' with { type: 'json' };
import { runIOSNativeNavigationPoc } from '../../examples/native-navigation-poc/ios/ios-poc-runner.js';
import { runAndroidNativeNavigationPoc } from '../../examples/native-navigation-poc/android/android-poc-runner.js';

function createCompleteIntegrationHarness(options?: {
  shouldFailRefresh?: boolean;
  expiresInSeconds?: number;
  storage?: MemorySecureStorageAdapter;
}) {
  const compiled = defaultFoundationCompiler.compile({
    auth: completeAuthJson,
    navigation: completeNavJson,
    integration: completeIntJson,
  });
  if (!compiled.ir?.auth || !compiled.ir.navigation || !compiled.ir.integration) {
    throw new Error('Failed to compile complete foundation in test harness.');
  }

  const storage = options?.storage ?? new MemorySecureStorageAdapter();
  const eventBus = new FoundationEventBus();
  const flowRegistry = new InMemoryFlowRegistry();

  const adapter = new RestAuthProviderAdapter({
    httpClient: async (req) => {
      if (req.url.endsWith('/refresh') && options?.shouldFailRefresh) {
        return {
          status: 401,
          ok: false,
          data: { message: 'Refresh token revoked or expired' },
        };
      }
      return {
        status: 200,
        ok: true,
        data: {
          data: {
            access_token: `access_${Date.now()}`,
            refresh_token: `refresh_${Date.now()}`,
            expires_in: options?.expiresInSeconds ?? 3600,
            user: {
              id: 'usr_100',
              email: 'customer@example.com',
              emailVerified: true,
              roles: ['user'],
              permissions: ['orders.read'],
            },
          },
        },
      };
    },
  });

  const authController = new AuthController({
    authIR: compiled.ir.auth,
    storage,
    adapter,
    eventBus,
    flowRegistry,
  });

  const navStateManager = new NavigationStateManager({
    navigationIR: compiled.ir.navigation,
    eventBus,
  });

  const bridge = new AuthNavigationBridge({
    integrationIR: compiled.ir.integration,
    authController,
    navigationStateManager: navStateManager,
    eventBus,
    flowRegistry,
  });

  const iosAdapter = new IOSNativeNavigationAdapter(navStateManager);
  const androidAdapter = new AndroidNavigationAdapter(navStateManager);

  return {
    storage,
    eventBus,
    flowRegistry,
    authController,
    navStateManager,
    bridge,
    iosAdapter,
    androidAdapter,
  };
}

describe('Section 18.B — 15 End-to-End Integration Scenarios & Phase 0 POC', () => {
  it('verifies Phase 0 Native Navigation POC on iOS SwiftUI and Android Compose/Router', () => {
    const iosPoc = runIOSNativeNavigationPoc();
    expect(iosPoc.stackComponent).toBe('NavigationStack');
    expect(iosPoc.importSource).toBe('@expo/ui/swift-ui');
    expect(iosPoc.pushedRouteOnHome).toBe('app.orders.detail');
    expect(iosPoc.restoredHomeTabRouteAfterSwitch).toBe('app.orders.detail');
    expect(iosPoc.routeAfterNativeSwipeBack).toBe('app.home');

    const androidPoc = runAndroidNativeNavigationPoc();
    expect(androidPoc.barComponent).toBe('NavigationBar');
    expect(androidPoc.importSource).toBe('@expo/ui/jetpack-compose');
    expect(androidPoc.routeAfterNestedBack).toBe('app.search');
    expect(androidPoc.routeAfterTabRootBack).toBe('app.home');
  });

  it('Scenarios 1–6: Login success, session restore across restart, token expiry, refresh renewal, refresh failure -> guest state', async () => {
    const sharedStorage = new MemorySecureStorageAdapter();

    // Scenario 1: User logs in successfully
    const appRun1 = createCompleteIntegrationHarness({ storage: sharedStorage });
    await appRun1.authController.initialize();
    expect(appRun1.authController.getState().status).toBe('anonymous');

    let afterLoginFlowTriggered = false;
    appRun1.flowRegistry.register('flow.auth.after-login', () => {
      afterLoginFlowTriggered = true;
    });

    await appRun1.authController.signIn({
      email: 'customer@example.com',
      password: 'correct-password',
    });
    expect(appRun1.authController.getState().status).toBe('authenticated');
    expect(appRun1.navStateManager.getState().activeRouteId).toBe('app.home');
    expect(afterLoginFlowTriggered).toBe(true);

    // Scenario 2: Session restores after application restart
    const appRun2 = createCompleteIntegrationHarness({ storage: sharedStorage });
    await appRun2.authController.initialize();
    expect(appRun2.authController.getState().status).toBe('authenticated');
    expect(appRun2.navStateManager.getState().activeRouteId).toBe('app.home');

    // Scenario 3 & 4: Access token expires and refresh token is renewed
    const futureTime = Date.now() + 7200_000;
    const restoredAfterExpiry = await appRun2.authController.restoreSession(futureTime);
    expect(restoredAfterExpiry.status).toBe('authenticated');

    // Scenario 5 & 6: Refresh fails -> application returns to guest state (auth.login)
    const appRun3 = createCompleteIntegrationHarness({
      storage: sharedStorage,
      shouldFailRefresh: true,
    });
    await appRun3.authController.adapter.initialize(
      appRun3.authController.authIR.primaryProvider.config
    );
    const failedRefreshState = await appRun3.authController.restoreSession(futureTime);
    expect(failedRefreshState.status).toBe('anonymous');
    expect(appRun3.navStateManager.getState().activeRouteId).toBe('auth.login');
  });

  it('Scenarios 7–8: User logs out from a nested route and protected navigation history is cleared', async () => {
    const harness = createCompleteIntegrationHarness();
    await harness.authController.initialize();
    await harness.authController.signIn({
      email: 'customer@example.com',
      password: 'password',
    });

    // Navigate deep into nested routes
    harness.bridge.navigateGuarded('app.orders.detail', { orderId: 'ORD-500' });
    harness.bridge.navigateGuarded('app.notifications');
    expect(harness.navStateManager.getState().history.length).toBeGreaterThan(1);
    expect(harness.navStateManager.getState().activeRouteId).toBe('app.notifications');

    // Scenario 7 & 8: Logout from nested route -> clears protected history to single guest entry
    await harness.authController.signOut();
    const postLogoutNav = harness.navStateManager.getState();
    expect(postLogoutNav.activeRouteId).toBe('auth.login');
    expect(postLogoutNav.history).toHaveLength(1);
    expect(postLogoutNav.history[0].routeId).toBe('auth.login');
    expect(postLogoutNav.tabStacks).toEqual({});
  });

  it('Scenarios 9–10: Deep link opens authenticated destination -> defers to guest -> restores destination after login', async () => {
    const harness = createCompleteIntegrationHarness();
    await harness.authController.initialize();

    // Scenario 9: Deep link to /orders/ORD-1024 while unauthenticated
    const dlResult = harness.bridge.handleDeepLink('https://example.com/orders/ORD-1024');
    expect(dlResult.status).toBe('deferred_to_guest');
    expect(harness.navStateManager.getState().activeRouteId).toBe('auth.login');
    expect(harness.bridge.deepLinkManager.getIntendedDestination()?.routeId).toBe(
      'app.orders.detail'
    );
    expect(harness.bridge.deepLinkManager.getIntendedDestination()?.params).toEqual({
      orderId: 'ORD-1024',
    });

    // Scenario 10: Login succeeds and automatically restores /orders/ORD-1024
    await harness.authController.signIn({
      email: 'customer@example.com',
      password: 'password',
    });
    expect(harness.navStateManager.getState().activeRouteId).toBe('app.orders.detail');
    expect(harness.navStateManager.getState().params).toEqual({ orderId: 'ORD-1024' });
    expect(harness.bridge.deepLinkManager.getIntendedDestination()).toBeNull();
  });

  it('Scenarios 11–15: Tab switching, per-tab stack preservation, iOS back gesture, Android hardware back, invalid parameter rejection', async () => {
    const harness = createCompleteIntegrationHarness();
    await harness.authController.initialize();
    await harness.authController.signIn({
      email: 'customer@example.com',
      password: 'password',
    });

    // Scenario 11 & 12: Switch tabs and preserve each tab's stack
    harness.iosAdapter.onNativeTabSelect('tab.home.stack');
    harness.navStateManager.push('app.orders.detail', { orderId: 'ORD-777' });
    expect(harness.navStateManager.getState().activeRouteId).toBe('app.orders.detail');

    harness.iosAdapter.onNativeTabSelect('tab.search.stack');
    expect(harness.navStateManager.getState().activeRouteId).toBe('app.search');
    harness.navStateManager.push('app.products.detail', { productId: 'PROD-888' });
    expect(harness.navStateManager.getState().activeRouteId).toBe('app.products.detail');

    // Return to Home tab -> still on app.orders.detail
    harness.iosAdapter.onNativeTabSelect('tab.home.stack');
    expect(harness.navStateManager.getState().activeRouteId).toBe('app.orders.detail');
    expect(harness.navStateManager.getState().params).toEqual({ orderId: 'ORD-777' });

    // Scenario 13: Native iOS back gesture updates router state
    harness.iosAdapter.onNativePathChange(['app.home']);
    expect(harness.navStateManager.getState().activeRouteId).toBe('app.home');

    // Scenario 14: Android hardware back pops nested stack on Search tab
    harness.androidAdapter.onComposeTabPress('tab.search.stack');
    expect(harness.navStateManager.getState().activeRouteId).toBe('app.products.detail');
    const hwBack = harness.androidAdapter.handleHardwareBack();
    expect(hwBack.handled).toBe(true);
    expect(hwBack.state.activeRouteId).toBe('app.search');

    // Scenario 15: Invalid parameters are rejected
    expect(() =>
      harness.navStateManager.push('app.orders.detail', {})
    ).toThrow(/Missing required route parameter "orderId"/i);
  });
});
