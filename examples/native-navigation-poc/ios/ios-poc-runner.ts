import { defaultFoundationCompiler } from '@expo-foundation/core';
import {
  IOSNativeNavigationAdapter,
  NavigationStateManager,
} from '@expo-foundation/navigation';
import { createMockScreenRegistry } from '../../fixtures/mock-screens.js';
import pocRoutesJson from '../shared/poc-routes.json' with { type: 'json' };

export function runIOSNativeNavigationPoc() {
  const screenRegistry = createMockScreenRegistry();
  const compiled = defaultFoundationCompiler.compile({
    navigation: pocRoutesJson,
    screenRegistry,
    requireRegisteredScreens: true,
  });

  if (!compiled.ir?.navigation) {
    throw new Error('POC compilation failed for iOS navigation.');
  }

  const stateManager = new NavigationStateManager({
    navigationIR: compiled.ir.navigation,
  });
  const iosAdapter = new IOSNativeNavigationAdapter(stateManager, screenRegistry);

  // 1. Select initial tab (Home) and push detail screen
  iosAdapter.onNativeTabSelect('tab.home.stack');
  stateManager.push('app.orders.detail', { orderId: 'ORD-1024' });
  const afterPush = iosAdapter.getNavigationStackDescriptor();

  // 2. Switch to Search tab, push product detail, then switch back to Home tab
  iosAdapter.onNativeTabSelect('tab.search.stack');
  stateManager.push('app.products.detail', { productId: 'PROD-99' });
  iosAdapter.onNativeTabSelect('tab.home.stack');
  const restoredHomeTab = stateManager.getState();

  // 3. Simulate iOS interactive back-swipe gesture via controlled onPathChange([])
  iosAdapter.onNativePathChange(['app.home']);
  const afterSwipeBack = stateManager.getState();

  return {
    stackComponent: afterPush.component,
    importSource: afterPush.importSource,
    pushedRouteOnHome: afterPush.activeRouteId,
    restoredHomeTabRouteAfterSwitch: restoredHomeTab.activeRouteId,
    routeAfterNativeSwipeBack: afterSwipeBack.activeRouteId,
  };
}
