import type { ScreenRegistry } from '@expo-foundation/contracts';
import type { NavigationState, NavigationStateManager } from '../runtime/state-manager.js';

export interface AndroidStackDescriptor {
  routerComponent: 'Stack';
  routerImportSource: 'expo-router';
  uiBarComponent: 'TopAppBar';
  uiBarImportSource: '@expo/ui/jetpack-compose';
  activeRouteId: string;
  activeScreenRef: string;
  params: Record<string, unknown>;
  canGoBack: boolean;
  topAppBar: {
    visible: boolean;
    title: string;
  };
}

export interface AndroidTabsDescriptor {
  mode: 'compose-navigation-bar' | 'expo-router-native-tabs';
  barComponent: 'NavigationBar' | 'NativeTabs';
  importSource: '@expo/ui/jetpack-compose' | 'expo-router/unstable-native-tabs';
  routerComponent: 'TabRouter';
  selectedTab: string;
  tabs: Array<{
    tabId: string;
    label: string;
    icon: string;
    badge?: string | number;
    activeRouteId: string;
  }>;
}

/**
 * AndroidNavigationAdapter
 *
 * Implements the hybrid Android navigation engine (Section 5.6):
 * - Expo Router Stack for native route management + @expo/ui/jetpack-compose TopAppBar
 * - @expo/ui/jetpack-compose NavigationBar synchronized with Expo Router TabRouter
 *   (with approved fallback to Expo Router NativeTabs)
 * - Unified Android hardware/gesture back handling without competing history.
 */
export class AndroidNavigationAdapter {
  readonly platform = 'android' as const;
  private readonly useNativeTabsFallback: boolean;

  constructor(
    private readonly stateManager: NavigationStateManager,
    options?: {
      screenRegistry?: ScreenRegistry;
      useNativeTabsFallback?: boolean;
    }
  ) {
    this.useNativeTabsFallback =
      options?.useNativeTabsFallback ??
      stateManager.navigationIR.navigationPolicies.android.fallback === 'native-tabs';
  }

  getStackDescriptor(navigatorId?: string): AndroidStackDescriptor {
    const state = this.stateManager.getState();
    const targetNavId = navigatorId ?? state.activeNavigatorId;
    const navDef = this.stateManager.graph.getNavigator(targetNavId);
    const activeRoute = this.stateManager.registry.getById(state.activeRouteId);

    return {
      routerComponent: 'Stack',
      routerImportSource: 'expo-router',
      uiBarComponent: 'TopAppBar',
      uiBarImportSource: '@expo/ui/jetpack-compose',
      activeRouteId: state.activeRouteId,
      activeScreenRef: activeRoute?.screenRef ?? 'screen.unknown',
      params: state.params ?? {},
      canGoBack: state.history.length > 1 || state.modalStack.length > 0,
      topAppBar: {
        visible:
          activeRoute?.options.headerShown ??
          navDef?.stackOptions?.headerVisible ??
          true,
        title:
          activeRoute?.options.title ??
          navDef?.stackOptions?.headerTitle ??
          activeRoute?.name ??
          state.activeRouteId,
      },
    };
  }

  getTabsDescriptor(tabsNavigatorId: string): AndroidTabsDescriptor {
    const navDef = this.stateManager.graph.getNavigator(tabsNavigatorId);
    if (!navDef || navDef.type !== 'tabs') {
      throw new Error(`Navigator "${tabsNavigatorId}" is not a tabs navigator.`);
    }

    const state = this.stateManager.getState();
    const selectedTab =
      state.selectedTab ?? navDef.tabsOptions?.initialTab ?? navDef.children[0];

    const tabs = navDef.children.map((childId) => {
      const tabConfig = navDef.tabsOptions?.tabs?.find((t) => t.routeId === childId);
      const tabHistory = state.tabStacks[childId] ?? [];
      const activeRouteId =
        tabHistory[tabHistory.length - 1]?.routeId ??
        this.stateManager.graph.resolveInitialRouteId(childId) ??
        childId;
      return {
        tabId: childId,
        label: tabConfig?.label ?? childId,
        icon: tabConfig?.icon ?? 'home',
        badge: tabConfig?.badge,
        activeRouteId,
      };
    });

    if (this.useNativeTabsFallback) {
      return {
        mode: 'expo-router-native-tabs',
        barComponent: 'NativeTabs',
        importSource: 'expo-router/unstable-native-tabs',
        routerComponent: 'TabRouter',
        selectedTab,
        tabs,
      };
    }

    return {
      mode: 'compose-navigation-bar',
      barComponent: 'NavigationBar',
      importSource: '@expo/ui/jetpack-compose',
      routerComponent: 'TabRouter',
      selectedTab,
      tabs,
    };
  }

  onComposeTabPress(tabId: string): NavigationState {
    return this.stateManager.switchTab(tabId);
  }

  /**
   * Handles Android hardware back button or system back gesture:
   * 1. If a modal is open, dismisses the top modal.
   * 2. If inside a tab with a nested stack depth > 1, pops within that tab's stack.
   * 3. If inside a non-initial tab at root, switches back to the initial tab.
   * 4. If main stack depth > 1, pops the stack.
   * 5. Otherwise returns { handled: false } so the OS can background the activity.
   */
  handleHardwareBack(): { handled: boolean; state: NavigationState } {
    const current = this.stateManager.getState();

    // 1. Modal dismissal
    if (current.modalStack.length > 0) {
      const next = this.stateManager.closeModal();
      return { handled: true, state: next };
    }

    // 2. Nested tab stack pop
    if (current.selectedTab) {
      const tabStack = current.tabStacks[current.selectedTab] ?? [];
      if (tabStack.length > 1) {
        const next = this.stateManager.pop();
        return { handled: true, state: next };
      }

      // Check if we can return to the initial tab
      const parentNavId = this.stateManager.graph.getParentNavigatorId(current.selectedTab);
      const parentNav = parentNavId
        ? this.stateManager.graph.getNavigator(parentNavId)
        : undefined;
      const initialTab =
        parentNav?.tabsOptions?.initialTab ?? parentNav?.children[0];
      if (initialTab && current.selectedTab !== initialTab) {
        const next = this.stateManager.switchTab(initialTab);
        return { handled: true, state: next };
      }
    }

    // 3. Regular stack pop
    if (current.history.length > 1) {
      const next = this.stateManager.pop();
      return { handled: true, state: next };
    }

    return { handled: false, state: current };
  }
}
