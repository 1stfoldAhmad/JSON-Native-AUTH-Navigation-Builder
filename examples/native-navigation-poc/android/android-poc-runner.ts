/**
 * Phase 0 Native Navigation POC - Android Compose + Expo Router Hybrid Simulation Runner
 *
 * NOTE (Audit Finding 2 & Section 10):
 * This TypeScript runner verifies the Android NavigationStateManager + AndroidNativeNavigationAdapter
 * state model, hardware back handling, and per-tab history isolation in a headless test environment.
 * Its verification level is explicitly `'simulated'`.
 * Physical/Emulator native UI verification is tracked in `docs/native-verification/android-verification.md`.
 */

import {
  FoundationCompiler,
  type NavigationConfigDocument,
  type VerificationStatus,
} from '@expo-foundation/core';
import {
  AndroidNativeNavigationAdapter,
  DeepLinkManager,
  NavigationStateManager,
} from '@expo-foundation/navigation';
import pocConfig from '../shared/poc-routes.json' with { type: 'json' };

export interface AndroidPocVerificationReport {
  platform: 'android';
  sdkVersion: 58;
  engine: 'expo-ui-compose-router-hybrid';
  verificationStatus: VerificationStatus;
  routerStackFallbackVerified: boolean;
  composeNavigationBarVerified: boolean;
  hardwareBackHandlingVerified: boolean;
  tabPreservationVerified: boolean;
  deepLinkVerified: boolean;
  allPassed: boolean;
}

export function runAndroidNativeNavigationPoc(): AndroidPocVerificationReport {
  const compiler = new FoundationCompiler();
  const projectIR = compiler.compile({
    navigation: pocConfig as unknown as NavigationConfigDocument,
  });

  if (!projectIR.navigation || !projectIR.canGenerate) {
    throw new Error('Failed to compile Android POC navigation configuration.');
  }

  const navIR = projectIR.navigation;
  const stateManager = new NavigationStateManager({
    navigationIR: navIR,
    initialAccessContext: {
      authenticated: true,
      userId: 'usr_poc_android',
      roles: ['user'],
      permissions: [],
      verified: true,
    },
  });

  const androidAdapter = new AndroidNativeNavigationAdapter(navIR, stateManager);
  const deepLinkManager = new DeepLinkManager({
    navigationIR: navIR,
    stateManager,
  });

  // 1. Verify Stack uses Expo Router fallback + TopAppBar Chrome under Host
  const stackDesc = androidAdapter.getNavigatorDescriptor('home-stack');
  const routerStackFallbackVerified =
    stackDesc.routerComponent === 'Stack' &&
    stackDesc.composeChromeComponent === 'TopAppBar' &&
    stackDesc.hostComponent === 'Host' &&
    stackDesc.fallbackUsed === true;

  // 2. Verify Tabs use Compose NavigationBar + Expo Router Tabs under Host
  const tabsDesc = androidAdapter.getNavigatorDescriptor('main-tabs');
  const composeNavigationBarVerified =
    tabsDesc.routerComponent === 'Tabs' &&
    tabsDesc.composeChromeComponent === 'NavigationBar' &&
    tabsDesc.hostComponent === 'Host';

  // 3. Reset to main-tabs, push detail screen, and verify tab switching preserves per-tab stack
  stateManager.reset('main-tabs');
  stateManager.push('order-detail', { orderId: 'ORD-AND-01' });
  const rootHistoryLenBefore = stateManager.getState().rootHistory.length;
  stateManager.switchTab('main-tabs', 'profile-stack');
  const onProfile = stateManager.getState().currentRouteId === 'profile';
  stateManager.switchTab('main-tabs', 'home-stack');
  const restoredHome = stateManager.getState();
  const tabPreservationVerified =
    onProfile &&
    restoredHome.currentRouteId === 'order-detail' &&
    restoredHome.rootHistory.length === rootHistoryLenBefore;

  // 4. Verify Android Hardware Back Press pops stack and returns consumed: true
  const backRes = androidAdapter.onHardwareBackPress();
  const rootBackRes = androidAdapter.onHardwareBackPress();
  const hardwareBackHandlingVerified =
    backRes.consumed === true &&
    backRes.state.currentRouteId === 'home' &&
    rootBackRes.consumed === false;

  // 5. Verify Deep Link resolution on Android
  const dlResult = deepLinkManager.handleIncomingUrl(
    'https://poc.expo-foundation.dev/orders/ORD-AND-77?tab=items'
  );
  const deepLinkVerified =
    dlResult.status === 'navigated' &&
    dlResult.routeId === 'order-detail' &&
    stateManager.getState().currentParams.orderId === 'ORD-AND-77';

  const allPassed =
    routerStackFallbackVerified &&
    composeNavigationBarVerified &&
    hardwareBackHandlingVerified &&
    tabPreservationVerified &&
    deepLinkVerified;

  return {
    platform: 'android',
    sdkVersion: 58,
    engine: 'expo-ui-compose-router-hybrid',
    verificationStatus: 'simulated',
    routerStackFallbackVerified,
    composeNavigationBarVerified,
    hardwareBackHandlingVerified,
    tabPreservationVerified,
    deepLinkVerified,
    allPassed,
  };
}
