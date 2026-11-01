import { defaultFoundationCompiler } from '@expo-foundation/core';
import {
  AndroidNavigationAdapter,
  NavigationStateManager,
} from '@expo-foundation/navigation';
import { createMockScreenRegistry } from '../../fixtures/mock-screens.js';
import pocRoutesJson from '../shared/poc-routes.json' with { type: 'json' };

export function runAndroidNativeNavigationPoc() {
  const screenRegistry = createMockScreenRegistry();
  const compiled = defaultFoundationCompiler.compile({
    navigation: pocRoutesJson,
    screenRegistry,
    requireRegisteredScreens: true,
  });

  if (!compiled.ir?.navigation) {
    throw new Error('POC compilation failed for Android navigation.');
  }

  const stateManager = new NavigationStateManager({
    navigationIR: compiled.ir.navigation,
  });
  const androidAdapter = new AndroidNavigationAdapter(stateManager, {
    screenRegistry,
    useNativeTabsFallback: false,
  });

  // 1. Select Search tab via Compose NavigationBar and push detail route
  androidAdapter.onComposeTabPress('tab.search.stack');
  stateManager.push('app.products.detail', { productId: 'PROD-55' });
  const tabsDesc = androidAdapter.getTabsDescriptor('app.tabs');

  // 2. First hardware back pops the nested stack in Search tab
  const back1 = androidAdapter.handleHardwareBack();

  // 3. Second hardware back returns from Search tab root to initial Home tab
  const back2 = androidAdapter.handleHardwareBack();

  return {
    barComponent: tabsDesc.barComponent,
    importSource: tabsDesc.importSource,
    routeAfterNestedBack: back1.state.activeRouteId,
    routeAfterTabRootBack: back2.state.activeRouteId,
    selectedTabAfterBack: back2.state.selectedTab,
  };
}
