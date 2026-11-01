/**
 * Phase 0 Native Navigation POC - iOS SwiftUI Simulation Runner
 *
 * NOTE (Audit Finding 2 & Section 10):
 * This TypeScript runner verifies the iOS NavigationStateManager + IOSNativeNavigationAdapter
 * state model, controlled path reconciliation, and per-tab history isolation in a headless
 * test environment. Its verification level is explicitly `'simulated'`.
 * Physical/Simulator native UI verification is tracked in `docs/native-verification/ios-verification.md`.
 */

import {
  FoundationCompiler,
  type NavigationConfigDocument,
  type VerificationStatus,
} from '@expo-foundation/core';
import {
  DeepLinkManager,
  IOSNativeNavigationAdapter,
  NavigationStateManager,
} from '@expo-foundation/navigation';
import pocConfig from '../shared/poc-routes.json' with { type: 'json' };

export interface IOSPocVerificationReport {
  platform: 'ios';
  sdkVersion: 58;
  engine: 'expo-ui-swiftui';
  verificationStatus: VerificationStatus;
  rootStackVerified: boolean;
  nestedStackInsideTabsVerified: boolean;
  controlledPathSyncVerified: boolean;
  fullSequenceReconciliationVerified: boolean;
  tabPreservationVerified: boolean;
  rootResetVerified: boolean;
  deepLinkVerified: boolean;
  allPassed: boolean;
}

export function runIOSNativeNavigationPoc(): IOSPocVerificationReport {
  const compiler = new FoundationCompiler();
  const projectIR = compiler.compile({
    navigation: pocConfig as unknown as NavigationConfigDocument,
  });

  if (!projectIR.navigation || !projectIR.canGenerate) {
    throw new Error('Failed to compile iOS POC navigation configuration.');
  }

  const navIR = projectIR.navigation;
  const stateManager = new NavigationStateManager({
    navigationIR: navIR,
    initialAccessContext: {
      authenticated: true,
      userId: 'usr_poc_ios',
      roles: ['user'],
      permissions: [],
      verified: true,
    },
  });

  const iosAdapter = new IOSNativeNavigationAdapter(navIR, stateManager);
  const deepLinkManager = new DeepLinkManager({
    navigationIR: navIR,
    stateManager,
  });

  // 1. Verify Root Stack starts at guest login
  const initial = stateManager.getState();
  const rootStackVerified = initial.currentRouteId === 'login';

  // 2. Verify Root Reset on Login -> Main Tabs ('home')
  stateManager.reset('main-tabs');
  const afterLogin = stateManager.getState();
  const rootResetVerified =
    afterLogin.currentRouteId === 'home' && afterLogin.rootHistory.length === 1;

  // 3. Verify Nested Stack push inside Home Tab ('home' -> 'order-detail')
  stateManager.push('order-detail', { orderId: 'ORD-5801' });
  const descriptor = iosAdapter.getNavigatorDescriptor('home-stack');
  const nestedStackInsideTabsVerified =
    stateManager.getState().currentRouteId === 'order-detail' &&
    stateManager.getState().currentPath.startsWith('/orders/ORD-5801') &&
    descriptor.swiftUIComponent === 'NavigationStack' &&
    descriptor.hostComponent === 'Host' &&
    descriptor.routerFactory === 'createStandardRouterNavigator' &&
    descriptor.controlledPath.includes('order-detail');

  // 4. Verify Tab switching preserves per-tab stack state WITHOUT duplicating rootHistory
  const rootHistoryLenBeforeSwitch = stateManager.getState().rootHistory.length;
  stateManager.switchTab('main-tabs', 'search-stack');
  const onSearchTab = stateManager.getState().currentRouteId === 'search';
  stateManager.switchTab('main-tabs', 'home-stack');
  const backOnHomeTab = stateManager.getState();
  const tabPreservationVerified =
    onSearchTab &&
    backOnHomeTab.currentRouteId === 'order-detail' &&
    backOnHomeTab.navigatorStates['main-tabs']?.selectedTab === 'home-stack' &&
    backOnHomeTab.rootHistory.length === rootHistoryLenBeforeSwitch;

  // 5. Verify Controlled Path Synchronization when native swipe-back pops 'order-detail'
  iosAdapter.onNativePathChange([]);
  const controlledPathSyncVerified =
    stateManager.getState().currentRouteId === 'home' &&
    stateManager.getState().history.length === 1;

  // 6. Verify Full Sequence Reconciliation (equal-length replacement & multi-push)
  iosAdapter.onNativePathChange(['order-detail'], {
    paramsByIndex: { 1: { orderId: 'ORD-9001' } },
  });
  const afterPushSeq = stateManager.getState();
  iosAdapter.onNativePathChange(['settings'], {
    paramsByIndex: { 1: {} },
  });
  const afterEqualLenReplace = stateManager.getState();
  const fullSequenceReconciliationVerified =
    afterPushSeq.currentRouteId === 'order-detail' &&
    afterPushSeq.currentParams.orderId === 'ORD-9001' &&
    afterEqualLenReplace.currentRouteId === 'settings' &&
    afterEqualLenReplace.history.length === 2;

  // 7. Verify Deep Link resolution with typed params
  const dlResult = deepLinkManager.handleIncomingUrl(
    'pocapp://orders/ORD-9999?tab=shipment'
  );
  const deepLinkVerified =
    dlResult.status === 'navigated' &&
    dlResult.routeId === 'order-detail' &&
    stateManager.getState().currentParams.orderId === 'ORD-9999' &&
    stateManager.getState().currentParams.tab === 'shipment';

  const allPassed =
    rootStackVerified &&
    nestedStackInsideTabsVerified &&
    controlledPathSyncVerified &&
    fullSequenceReconciliationVerified &&
    tabPreservationVerified &&
    rootResetVerified &&
    deepLinkVerified;

  return {
    platform: 'ios',
    sdkVersion: 58,
    engine: 'expo-ui-swiftui',
    verificationStatus: 'simulated',
    rootStackVerified,
    nestedStackInsideTabsVerified,
    controlledPathSyncVerified,
    fullSequenceReconciliationVerified,
    tabPreservationVerified,
    rootResetVerified,
    deepLinkVerified,
    allPassed,
  };
}
