import { describe, expect, it } from 'vitest';
import {
  FoundationCompiler,
  type NavigationConfigDocument,
} from '@expo-foundation/core';
import {
  DeepLinkManager,
  IOSNativeNavigationAdapter,
  NavigationStateManager,
  RouteRegistry,
} from '@expo-foundation/navigation';
import completeNavDoc from '../../examples/complete-foundation/navigation.json' with { type: 'json' };
import { runIOSNativeNavigationPoc } from '../../examples/native-navigation-poc/ios/ios-poc-runner.js';
import { runAndroidNativeNavigationPoc } from '../../examples/native-navigation-poc/android/android-poc-runner.js';

describe('@expo-foundation/navigation', () => {
  const compiler = new FoundationCompiler();
  const projectIR = compiler.compile({
    navigation: completeNavDoc as unknown as NavigationConfigDocument,
  });
  const navIR = projectIR.navigation!;

  it('validates and builds typed route paths and query parameters in RouteRegistry', () => {
    const registry = new RouteRegistry(navIR);

    const path = registry.buildPath('order-detail', {
      orderId: 'ORD-500',
      tab: 'items',
    });
    expect(path).toBe('/orders/ORD-500?tab=items');

    const defaultTabPath = registry.buildPath('order-detail', {
      orderId: 'ORD-501',
    });
    expect(defaultTabPath).toBe('/orders/ORD-501?tab=summary');

    expect(() =>
      registry.buildPath('order-detail', {
        orderId: 'ORD-502',
        tab: 'invalid_enum_value',
      })
    ).toThrow(/must be one of/);
  });

  it('preserves per-tab stack history on switchTab without duplicating rootHistory (Finding 10)', () => {
    const sm = new NavigationStateManager({
      navigationIR: navIR,
      initialAccessContext: {
        authenticated: true,
        userId: 'usr_1',
        roles: ['user'],
        permissions: ['orders.read'],
        verified: true,
      },
    });

    sm.reset('main-tabs');
    expect(sm.getState().currentRouteId).toBe('home');
    expect(sm.getState().rootHistory).toHaveLength(1);

    // Push order-detail inside home-stack
    sm.push('order-detail', { orderId: 'ORD-100' });
    expect(sm.getState().currentRouteId).toBe('order-detail');
    expect(sm.getState().tabHistories['home-stack']).toHaveLength(2);

    // Switch to search-stack and push product-detail
    sm.switchTab('main-tabs', 'search-stack');
    expect(sm.getState().currentRouteId).toBe('search');
    sm.push('product-detail', { productId: 'PROD-99' });
    expect(sm.getState().currentRouteId).toBe('product-detail');
    expect(sm.getState().tabHistories['search-stack']).toHaveLength(2);

    // Switch back to home-stack -> restores order-detail without growing rootHistory!
    const restoredHome = sm.switchTab('main-tabs', 'home-stack');
    expect(restoredHome.currentRouteId).toBe('order-detail');
    expect(restoredHome.currentParams.orderId).toBe('ORD-100');
    expect(restoredHome.rootHistory).toHaveLength(1);

    // Pop inside home-stack returns to home
    const poppedHome = sm.back();
    expect(poppedHome.currentRouteId).toBe('home');
    expect(poppedHome.tabHistories['home-stack']).toHaveLength(1);
    expect(poppedHome.tabHistories['search-stack']).toHaveLength(2);
  });

  it('reconciles full route sequence in IOSNativeNavigationAdapter.onNativePathChange (Finding 11)', () => {
    const sm = new NavigationStateManager({
      navigationIR: navIR,
      initialAccessContext: {
        authenticated: true,
        userId: 'usr_1',
        roles: ['user'],
        permissions: ['orders.read'],
        verified: true,
      },
    });

    const iosAdapter = new IOSNativeNavigationAdapter(navIR, sm);
    sm.reset('main-tabs');
    sm.push('order-detail', { orderId: 'ORD-1' });
    expect(sm.getState().history.map((h) => h.routeId)).toEqual([
      'home',
      'order-detail',
    ]);

    // Equal-length route replacement at index 1 ('order-detail' -> 'notifications')
    const replaced = iosAdapter.onNativePathChange(['notifications']);
    expect(replaced.currentRouteId).toBe('notifications');
    expect(replaced.history.map((h) => h.routeId)).toEqual([
      'home',
      'notifications',
    ]);

    // Reject unregistered route ID in native path sequence
    expect(() => iosAdapter.onNativePathChange(['non-existent-route'])).toThrow(
      /unregistered route ID/
    );
  });

  it('enforces guest-only route policy and HTTPS host allowlist in DeepLinkManager (Finding 9)', () => {
    const sm = new NavigationStateManager({
      navigationIR: navIR,
      initialAccessContext: {
        authenticated: true,
        userId: 'usr_1',
        roles: ['user'],
        permissions: ['orders.read'],
        verified: true,
      },
    });

    const dl = new DeepLinkManager({
      navigationIR: navIR,
      stateManager: sm,
    });

    // Authenticated user visiting a 'guest' route (/login) is rejected and redirected to authenticatedEntry
    const guestResult = dl.handleIncomingUrl('efshop://login', {
      authenticatedEntryRouteId: 'home',
    });
    expect(guestResult.status).toBe('rejected');
    expect(guestResult.reason).toBe('guest_only');
    expect(guestResult.redirectRouteId).toBe('home');
    expect(sm.getState().currentRouteId).toBe('home');

    // HTTPS URL when linking.hosts is empty must be rejected as untrusted_host
    const noHostsIR = {
      ...navIR,
      linking: {
        ...navIR.linking,
        hosts: [],
      },
    };
    const dlNoHosts = new DeepLinkManager({
      navigationIR: noHostsIR,
      stateManager: sm,
    });
    const httpsRes = dlNoHosts.handleIncomingUrl(
      'https://any-domain.example.com/orders/ORD-1'
    );
    expect(httpsRes.status).toBe('rejected');
    expect(httpsRes.reason).toBe('untrusted_host');
  });

  it('runs Phase 0 Native Navigation POC runners with explicit simulated verification status (Finding 2)', () => {
    const iosReport = runIOSNativeNavigationPoc();
    expect(iosReport.verificationStatus).toBe('simulated');
    expect(iosReport.fullSequenceReconciliationVerified).toBe(true);
    expect(iosReport.allPassed).toBe(true);

    const androidReport = runAndroidNativeNavigationPoc();
    expect(androidReport.verificationStatus).toBe('simulated');
    expect(androidReport.allPassed).toBe(true);
  });
});
