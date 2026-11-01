import type { ScreenRegistry } from '@expo-foundation/contracts';
import type { NavigationState, NavigationStateManager } from '../runtime/state-manager.js';

export interface IOSNavigationStackDescriptor {
  component: 'NavigationStack';
  importSource: '@expo/ui/swift-ui';
  routerFactory: 'createStandardRouterNavigator';
  rootRouteId: string;
  controlledPath: string[];
  activeRouteId: string;
  activeScreenRef: string;
  params: Record<string, unknown>;
  toolbar: {
    visible: boolean;
    title: string;
    backButtonBehavior: 'default' | 'minimal' | 'none';
  };
  interactiveSwipeBackEnabled: boolean;
}

export interface IOSTabViewDescriptor {
  component: 'TabView';
  importSource: '@expo/ui/swift-ui';
  selectedTab: string;
  tabs: Array<{
    tabId: string;
    label: string;
    systemImage: string;
    badge?: string | number;
    stackPath: string[];
    activeRouteId: string;
  }>;
}

/**
 * IOSNativeNavigationAdapter
 *
 * Bridges Expo Router custom navigator state (createStandardRouterNavigator / integrateWithRouter)
 * with @expo/ui/swift-ui NavigationStack, TabView, NavigationSplitView, Toolbar, and BottomSheet.
 */
export class IOSNativeNavigationAdapter {
  readonly platform = 'ios' as const;

  constructor(
    private readonly stateManager: NavigationStateManager,
    private readonly screenRegistry?: ScreenRegistry
  ) {}

  /**
   * Produces the controlled SwiftUI NavigationStack descriptor for the current state.
   */
  getNavigationStackDescriptor(navigatorId?: string): IOSNavigationStackDescriptor {
    const state = this.stateManager.getState();
    const targetNavId = navigatorId ?? state.activeNavigatorId;
    const navDef = this.stateManager.graph.getNavigator(targetNavId);
    const activeRoute = this.stateManager.registry.getById(state.activeRouteId);

    const historyRouteIds = state.history.map((h) => h.routeId);
    const rootRouteId = historyRouteIds[0] ?? state.activeRouteId;
    const controlledPath = historyRouteIds.slice(1);

    return {
      component: 'NavigationStack',
      importSource: '@expo/ui/swift-ui',
      routerFactory: 'createStandardRouterNavigator',
      rootRouteId,
      controlledPath,
      activeRouteId: state.activeRouteId,
      activeScreenRef: activeRoute?.screenRef ?? 'screen.unknown',
      params: state.params ?? {},
      toolbar: {
        visible:
          activeRoute?.options.headerShown ??
          navDef?.stackOptions?.headerVisible ??
          true,
        title:
          activeRoute?.options.title ??
          navDef?.stackOptions?.headerTitle ??
          activeRoute?.name ??
          state.activeRouteId,
        backButtonBehavior: navDef?.stackOptions?.backButtonBehavior ?? 'default',
      },
      interactiveSwipeBackEnabled:
        activeRoute?.options.gestureEnabled ??
        navDef?.stackOptions?.interactiveGestures ??
        true,
    };
  }

  /**
   * Synchronizes native SwiftUI NavigationStack `onPathChange` updates (including interactive
   * iOS back-swipe gestures) back into the canonical NavigationStateManager.
   */
  onNativePathChange(nextControlledPath: string[]): NavigationState {
    const state = this.stateManager.getState();
    const rootRouteId = state.history[0]?.routeId;
    const fullTargetHistory = rootRouteId
      ? [rootRouteId, ...nextControlledPath]
      : [...nextControlledPath];

    const currentHistoryIds = state.history.map((h) => h.routeId);

    if (fullTargetHistory.length < currentHistoryIds.length) {
      const popCount = currentHistoryIds.length - fullTargetHistory.length;
      for (let i = 0; i < popCount; i++) {
        this.stateManager.pop();
      }
      return this.stateManager.getState();
    }

    if (fullTargetHistory.length > currentHistoryIds.length) {
      const added = fullTargetHistory.slice(currentHistoryIds.length);
      for (const routeId of added) {
        this.stateManager.push(routeId);
      }
      return this.stateManager.getState();
    }

    return this.stateManager.getState();
  }

  /**
   * Produces the controlled SwiftUI TabView descriptor with per-tab stack history preservation.
   */
  getTabViewDescriptor(tabsNavigatorId: string): IOSTabViewDescriptor {
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
      const stackPath =
        tabHistory.length > 0
          ? tabHistory.map((h) => h.routeId)
          : [this.stateManager.graph.resolveInitialRouteId(childId) ?? childId];
      return {
        tabId: childId,
        label: tabConfig?.label ?? childId,
        systemImage: tabConfig?.icon ?? 'square.grid.2x2',
        badge: tabConfig?.badge,
        stackPath,
        activeRouteId: stackPath[stackPath.length - 1],
      };
    });

    return {
      component: 'TabView',
      importSource: '@expo/ui/swift-ui',
      selectedTab,
      tabs,
    };
  }

  /**
   * Synchronizes native SwiftUI TabView selection changes with the canonical NavigationStateManager.
   */
  onNativeTabSelect(tabId: string): NavigationState {
    return this.stateManager.switchTab(tabId);
  }

  /**
   * Resolves the external screen component from ScreenRegistry for a given routeId.
   */
  resolveRouteScreenComponent(routeId: string) {
    const route = this.stateManager.registry.getById(routeId);
    if (!route || !this.screenRegistry) {
      return undefined;
    }
    return this.screenRegistry.resolve(route.screenRef);
  }
}
