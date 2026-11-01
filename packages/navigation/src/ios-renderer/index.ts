/**
 * @expo-foundation/navigation - iOS SwiftUI Native Renderer Adapter
 *
 * Implements Section 9.1, Section 13.1, and Audit Findings 3 & 11:
 * - Maps NavigationIR primitives to @expo/ui/swift-ui (Host, NavigationStack,
 *   NavigationDestination, NavigationLink, TabView, NavigationSplitView, Toolbar, BottomSheet)
 * - Uses 2-argument `createStandardRouterNavigator(NavigatorContent, StackRouter)` and
 *   `createStandardRouterNavigator(TabsNavigatorContent, TabRouter)` from `expo-router`
 * - Maps route `descriptors` to `<NavigationDestination>`
 * - Reconciles full controlled `path` sequences via `reconcilePathSequence`
 */

import type { NavigationIR, NavigatorIR } from '@expo-foundation/core';
import type { NativeNavigationRenderer } from '../runtime/renderer-contract.js';
import type {
  NavigationStateManager,
  NavigationStateSnapshot,
} from '../runtime/state-manager.js';

export interface IOSNavigationDescriptor {
  navigatorId: string;
  swiftUIComponent:
    | 'NavigationStack'
    | 'TabView'
    | 'NavigationSplitView'
    | 'BottomSheet';
  hostComponent: 'Host';
  routerFactory: 'createStandardRouterNavigator';
  routerType: 'StackRouter' | 'TabRouter';
  controlledPath: string[];
  activeRouteId: string;
  selectedTab?: string;
  destinations: Array<{
    routeId: string;
    screenRef: string;
    title: string;
    headerVisible: boolean;
  }>;
}

export class IOSNativeNavigationAdapter implements NativeNavigationRenderer {
  readonly platform = 'ios' as const;
  readonly engine = 'expo-ui-swiftui';

  private readonly ir: NavigationIR;
  private readonly stateManager: NavigationStateManager;

  constructor(ir: NavigationIR, stateManager: NavigationStateManager) {
    this.ir = ir;
    this.stateManager = stateManager;
  }

  renderNavigatorHierarchy(ir: NavigationIR, state: NavigationStateSnapshot) {
    return {
      platform: 'ios' as const,
      rootNavigatorId: ir.rootNavigator,
      activeRouteId: state.currentRouteId,
      hostComponent: 'Host' as const,
    };
  }

  /**
   * Builds a SwiftUI NavigationStack / TabView / NavigationSplitView descriptor
   * synchronized with the current NavigationStateSnapshot.
   */
  getNavigatorDescriptor(navigatorId: string): IOSNavigationDescriptor {
    const nav = this.ir.navigators[navigatorId];
    if (!nav) {
      throw new Error(`Navigator "${navigatorId}" not found in NavigationIR.`);
    }

    const state = this.stateManager.getState();
    const controlledPath = state.history
      .slice(1)
      .map((entry) => entry.routeId);

    const swiftUIComponent = this.mapNavigatorToSwiftUI(nav);
    const routerType = nav.type === 'tabs' ? 'TabRouter' : 'StackRouter';

    const destinations = nav.childRoutes
      .map((routeId) => this.ir.routes[routeId])
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((route) => ({
        routeId: route.id,
        screenRef: route.screenRef,
        title: route.options.title ?? route.name,
        headerVisible:
          route.options.headerShown ?? nav.stackOptions?.headerVisible ?? true,
      }));

    return {
      navigatorId: nav.id,
      swiftUIComponent,
      hostComponent: 'Host',
      routerFactory: 'createStandardRouterNavigator',
      routerType,
      controlledPath,
      activeRouteId: state.currentRouteId,
      selectedTab: state.navigatorStates[navigatorId]?.selectedTab,
      destinations,
    };
  }

  /**
   * Handles native SwiftUI NavigationStack `onPathChange` events by reconciling the full
   * route sequence (including root + pushed path entries) against `NavigationStateManager`
   * (Audit Finding 11).
   *
   * Note: `newPathRouteIds` represents the pushed stack path after the root entry, or a full
   * sequence if `includeRoot` is true.
   */
  onNativePathChange(
    newPathRouteIds: string[],
    options?: {
      includeRoot?: boolean;
      paramsByIndex?: Record<number, Record<string, unknown>>;
    }
  ): NavigationStateSnapshot {
    const currentState = this.stateManager.getState();
    const rootEntry = currentState.history[0];

    const fullSequence = options?.includeRoot
      ? newPathRouteIds
      : rootEntry
        ? [rootEntry.routeId, ...newPathRouteIds]
        : newPathRouteIds;

    return this.stateManager.reconcilePathSequence(
      fullSequence,
      options?.paramsByIndex
    );
  }

  private mapNavigatorToSwiftUI(
    nav: NavigatorIR
  ): 'NavigationStack' | 'TabView' | 'NavigationSplitView' | 'BottomSheet' {
    switch (nav.type) {
      case 'stack':
        return 'NavigationStack';
      case 'tabs':
        return 'TabView';
      case 'split':
      case 'drawer':
        return 'NavigationSplitView';
      case 'modal':
        return 'BottomSheet';
    }
  }
}

/**
 * Generates the iOS SwiftUI NativeStack and NativeTabs renderer modules for Expo SDK 58
 * (Section 13.1 & Audit Finding 3).
 */
export function generateIOSRendererModules(ir: NavigationIR): Record<string, string> {
  const stackModule = `import React, { useMemo, useCallback } from 'react';
import {
  Host,
  NavigationStack,
  NavigationDestination,
  Toolbar,
} from '@expo/ui/swift-ui';
import {
  createStandardRouterNavigator,
  StackRouter,
  useNavigationBuilder,
} from 'expo-router';

export interface IOSNativeStackProps {
  navigatorId: string;
  initialRouteName?: string;
  headerVisible?: boolean;
  headerTitle?: string;
}

function IOSNativeStackNavigator({
  initialRouteName,
  headerVisible = true,
  headerTitle,
  children,
}: React.PropsWithChildren<IOSNativeStackProps>) {
  const { state, descriptors, navigation, NavigationContent } = useNavigationBuilder(
    StackRouter,
    {
      children,
      initialRouteName,
    }
  );

  const rootRoute = state.routes[0];
  const rootDescriptor = rootRoute ? descriptors[rootRoute.key] : undefined;

  const controlledPath = useMemo(
    () => state.routes.slice(1).map((r) => r.name),
    [state.routes]
  );

  const handlePathChange = useCallback(
    (nextPath: string[]) => {
      const currentDepth = state.routes.length - 1;
      if (nextPath.length < currentDepth) {
        const popCount = currentDepth - nextPath.length;
        for (let i = 0; i < popCount; i += 1) {
          if (navigation.canGoBack()) {
            navigation.goBack();
          }
        }
      }
    },
    [state.routes, navigation]
  );

  return (
    <NavigationContent>
      <Host style={{ flex: 1 }}>
        <NavigationStack path={controlledPath} onPathChange={handlePathChange}>
          {headerVisible && headerTitle ? <Toolbar title={headerTitle} /> : null}
          {rootDescriptor ? rootDescriptor.render() : null}
          {Object.values(descriptors).map((descriptor) => (
            <NavigationDestination
              key={descriptor.route.key}
              id={descriptor.route.name}
            >
              {descriptor.render()}
            </NavigationDestination>
          ))}
        </NavigationStack>
      </Host>
    </NavigationContent>
  );
}

export const IOSNativeStack = createStandardRouterNavigator(
  IOSNativeStackNavigator,
  StackRouter
);
`;

  const tabsModule = `import React from 'react';
import { Host, TabView } from '@expo/ui/swift-ui';
import {
  createStandardRouterNavigator,
  TabRouter,
  useNavigationBuilder,
} from 'expo-router';

export interface IOSNativeTabConfig {
  routeId: string;
  label: string;
  icon: string;
  badge?: string | number;
}

export interface IOSNativeTabsProps {
  navigatorId: string;
  initialRouteName?: string;
  tabs: IOSNativeTabConfig[];
}

function IOSNativeTabsNavigator({
  initialRouteName,
  tabs,
  children,
}: React.PropsWithChildren<IOSNativeTabsProps>) {
  const { state, descriptors, navigation, NavigationContent } = useNavigationBuilder(
    TabRouter,
    {
      children,
      initialRouteName,
    }
  );

  const activeRoute = state.routes[state.index];

  return (
    <NavigationContent>
      <Host style={{ flex: 1 }}>
        <TabView
          selection={activeRoute?.name}
          onSelectionChange={(nextRouteName: string) => {
            navigation.navigate(nextRouteName);
          }}
        >
          {state.routes.map((route) => {
            const tabMeta = tabs.find((t) => t.routeId === route.name);
            const descriptor = descriptors[route.key];
            return (
              <TabView.Tab
                key={route.key}
                id={route.name}
                title={tabMeta?.label ?? descriptor?.options?.title ?? route.name}
                systemImage={tabMeta?.icon ?? 'circle'}
                badge={tabMeta?.badge}
              >
                {descriptor ? descriptor.render() : null}
              </TabView.Tab>
            );
          })}
        </TabView>
      </Host>
    </NavigationContent>
  );
}

export const IOSNativeTabs = createStandardRouterNavigator(
  IOSNativeTabsNavigator,
  TabRouter
);
`;

  const splitModule = `import React from 'react';
import { Host, NavigationSplitView } from '@expo/ui/swift-ui';
import {
  createStandardRouterNavigator,
  StackRouter,
  useNavigationBuilder,
} from 'expo-router';

export interface IOSNativeSplitViewProps {
  navigatorId: string;
  initialRouteName?: string;
  columnMode?: 'two-column' | 'three-column';
}

function IOSNativeSplitViewNavigator({
  initialRouteName,
  columnMode = 'two-column',
  children,
}: React.PropsWithChildren<IOSNativeSplitViewProps>) {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(
    StackRouter,
    {
      children,
      initialRouteName,
    }
  );

  const sidebarRoute = state.routes[0];
  const detailRoute = state.routes[state.index] ?? sidebarRoute;

  return (
    <NavigationContent>
      <Host style={{ flex: 1 }}>
        <NavigationSplitView columns={columnMode === 'three-column' ? 3 : 2}>
          <NavigationSplitView.Sidebar>
            {sidebarRoute && descriptors[sidebarRoute.key]
              ? descriptors[sidebarRoute.key].render()
              : null}
          </NavigationSplitView.Sidebar>
          <NavigationSplitView.Detail>
            {detailRoute && descriptors[detailRoute.key]
              ? descriptors[detailRoute.key].render()
              : null}
          </NavigationSplitView.Detail>
        </NavigationSplitView>
      </Host>
    </NavigationContent>
  );
}

export const IOSNativeSplitView = createStandardRouterNavigator(
  IOSNativeSplitViewNavigator,
  StackRouter
);
`;

  return {
    'src/foundation/navigation/renderers/ios/NativeStack.ios.tsx': stackModule,
    'src/foundation/navigation/renderers/ios/NativeTabs.ios.tsx': tabsModule,
    'src/foundation/navigation/renderers/ios/NativeSplitView.ios.tsx': splitModule,
    'src/foundation/navigation/renderers/ios/descriptor-manifest.json': JSON.stringify(
      {
        sdkVersion: 58,
        platform: 'ios',
        mode: ir.iosMode,
        hostComponent: 'Host',
        routerIntegration: 'createStandardRouterNavigator',
        navigators: Object.values(ir.navigators).map((n) => ({
          id: n.id,
          type: n.type,
          capability: n.iosCapability,
        })),
      },
      null,
      2
    ),
  };
}
