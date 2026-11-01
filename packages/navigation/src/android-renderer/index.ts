/**
 * @expo-foundation/navigation - Android Jetpack Compose + Expo Router Hybrid Renderer Adapter
 *
 * Implements Section 9.2, Section 13.2, and Audit Finding 4:
 * - Maps Android navigation primitives using @expo/ui/jetpack-compose (Host, TopAppBar,
 *   NavigationBar, NavigationBarItem, ModalBottomSheet) paired with Expo Router Stack /
 *   TabRouter / Drawer / NativeTabs ("expo-router/native-tabs")
 */

import type { NavigationIR, NavigatorIR } from '@expo-foundation/core';
import type { NativeNavigationRenderer } from '../runtime/renderer-contract.js';
import type {
  NavigationStateManager,
  NavigationStateSnapshot,
} from '../runtime/state-manager.js';

export interface AndroidNavigationDescriptor {
  navigatorId: string;
  routerComponent: 'Stack' | 'Tabs' | 'NativeTabs' | 'Drawer';
  composeChromeComponent?:
    | 'TopAppBar'
    | 'NavigationBar'
    | 'ModalBottomSheet';
  hostComponent: 'Host';
  fallbackUsed: boolean;
  activeRouteId: string;
  selectedTab?: string;
  canGoBack: boolean;
}

export class AndroidNativeNavigationAdapter implements NativeNavigationRenderer {
  readonly platform = 'android' as const;
  readonly engine = 'expo-ui-compose-router-hybrid';

  private readonly ir: NavigationIR;
  private readonly stateManager: NavigationStateManager;

  constructor(ir: NavigationIR, stateManager: NavigationStateManager) {
    this.ir = ir;
    this.stateManager = stateManager;
  }

  renderNavigatorHierarchy(ir: NavigationIR, state: NavigationStateSnapshot) {
    return {
      platform: 'android' as const,
      rootNavigatorId: ir.rootNavigator,
      activeRouteId: state.currentRouteId,
      hostComponent: 'Host' as const,
    };
  }

  getNavigatorDescriptor(navigatorId: string): AndroidNavigationDescriptor {
    const nav = this.ir.navigators[navigatorId];
    if (!nav) {
      throw new Error(`Navigator "${navigatorId}" not found in NavigationIR.`);
    }

    const state = this.stateManager.getState();
    const mapped = this.mapNavigatorToAndroid(nav);

    return {
      navigatorId: nav.id,
      routerComponent: mapped.routerComponent,
      composeChromeComponent: mapped.composeChromeComponent,
      hostComponent: 'Host',
      fallbackUsed: nav.androidCapability.fallbackUsed,
      activeRouteId: state.currentRouteId,
      selectedTab: state.navigatorStates[navigatorId]?.selectedTab,
      canGoBack: state.history.length > 1 || state.modalStack.length > 0,
    };
  }

  /**
   * Handles Android hardware back press.
   * Returns `true` if consumed by popping modal or stack, `false` if at root.
   */
  onHardwareBackPress(): { consumed: boolean; state: NavigationStateSnapshot } {
    const before = this.stateManager.getState();
    if (before.modalStack.length > 0) {
      const next = this.stateManager.dismissModal();
      return { consumed: true, state: next };
    }
    if (before.history.length > 1) {
      const next = this.stateManager.back();
      return { consumed: true, state: next };
    }
    return { consumed: false, state: before };
  }

  private mapNavigatorToAndroid(nav: NavigatorIR): {
    routerComponent: 'Stack' | 'Tabs' | 'NativeTabs' | 'Drawer';
    composeChromeComponent?: 'TopAppBar' | 'NavigationBar' | 'ModalBottomSheet';
  } {
    switch (nav.type) {
      case 'stack':
        return {
          routerComponent: 'Stack',
          composeChromeComponent: 'TopAppBar',
        };
      case 'tabs':
        if (this.ir.androidRendererPreference === 'expo-router') {
          return {
            routerComponent:
              this.ir.androidFallbackPreference === 'native-tabs'
                ? 'NativeTabs'
                : 'Tabs',
          };
        }
        return {
          routerComponent: 'Tabs',
          composeChromeComponent: 'NavigationBar',
        };
      case 'drawer':
      case 'split':
        return {
          routerComponent: 'Drawer',
          composeChromeComponent: 'TopAppBar',
        };
      case 'modal':
        return {
          routerComponent: 'Stack',
          composeChromeComponent: 'ModalBottomSheet',
        };
    }
  }
}

/**
 * Generates Android Jetpack Compose + Expo Router hybrid renderer modules for Expo SDK 58
 * (Section 13.2 & Audit Finding 4).
 */
export function generateAndroidRendererModules(
  ir: NavigationIR
): Record<string, string> {
  const stackModule = `import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Host, TopAppBar } from '@expo/ui/jetpack-compose';

export interface AndroidNativeStackProps {
  navigatorId: string;
  headerVisible?: boolean;
  headerTitle?: string;
}

export function AndroidNativeStack({
  headerVisible = true,
  headerTitle,
  children,
}: React.PropsWithChildren<AndroidNativeStackProps>) {
  const router = useRouter();

  return (
    <View style={styles.container}>
      {headerVisible && headerTitle ? (
        <Host>
          <TopAppBar
            title={headerTitle}
            onBackPress={() => {
              if (router.canGoBack()) {
                router.back();
              }
            }}
          />
        </Host>
      ) : null}
      <Stack screenOptions={{ headerShown: !headerTitle && headerVisible }}>
        {children}
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
`;

  const tabsModule = `import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  createStandardRouterNavigator,
  TabRouter,
  useNavigationBuilder,
} from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import {
  Host,
  NavigationBar,
  NavigationBarItem,
} from '@expo/ui/jetpack-compose';

export interface AndroidTabConfig {
  routeId: string;
  label: string;
  icon: string;
  badge?: string | number;
}

export interface AndroidNativeTabsProps {
  navigatorId: string;
  initialRouteName?: string;
  tabs: AndroidTabConfig[];
  useNativeTabsFallback?: boolean;
}

function AndroidComposeTabsNavigator({
  initialRouteName,
  tabs,
  useNativeTabsFallback = false,
  children,
}: React.PropsWithChildren<AndroidNativeTabsProps>) {
  const { state, descriptors, navigation, NavigationContent } = useNavigationBuilder(
    TabRouter,
    {
      children,
      initialRouteName,
    }
  );

  if (useNativeTabsFallback) {
    return <NativeTabs>{children}</NativeTabs>;
  }

  const activeRoute = state.routes[state.index];
  const activeDescriptor = activeRoute ? descriptors[activeRoute.key] : undefined;

  return (
    <NavigationContent>
      <View style={styles.container}>
        <View style={styles.content}>
          {activeDescriptor ? activeDescriptor.render() : null}
        </View>
        <Host>
          <NavigationBar>
            {tabs.map((tab) => {
              const isSelected = activeRoute?.name === tab.routeId;
              return (
                <NavigationBarItem
                  key={tab.routeId}
                  selected={isSelected}
                  onClick={() => navigation.navigate(tab.routeId)}
                  label={tab.label}
                  icon={tab.icon}
                  badge={tab.badge}
                />
              );
            })}
          </NavigationBar>
        </Host>
      </View>
    </NavigationContent>
  );
}

export const AndroidNativeTabs = createStandardRouterNavigator(
  AndroidComposeTabsNavigator,
  TabRouter
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});
`;

  const drawerModule = `import React from 'react';
import { Drawer } from 'expo-router/drawer';

export interface AndroidNativeDrawerProps {
  navigatorId: string;
}

export function AndroidNativeDrawer({
  children,
}: React.PropsWithChildren<AndroidNativeDrawerProps>) {
  return <Drawer>{children}</Drawer>;
}
`;

  return {
    'src/foundation/navigation/renderers/android/NativeStack.android.tsx':
      stackModule,
    'src/foundation/navigation/renderers/android/NativeTabs.android.tsx':
      tabsModule,
    'src/foundation/navigation/renderers/android/NativeDrawer.android.tsx':
      drawerModule,
    'src/foundation/navigation/renderers/android/descriptor-manifest.json':
      JSON.stringify(
        {
          sdkVersion: 58,
          platform: 'android',
          mode: ir.androidMode,
          rendererPreference: ir.androidRendererPreference,
          fallbackPreference: ir.androidFallbackPreference,
          hostComponent: 'Host',
          nativeTabsImportPath: 'expo-router/native-tabs',
          navigators: Object.values(ir.navigators).map((n) => ({
            id: n.id,
            type: n.type,
            capability: n.androidCapability,
          })),
        },
        null,
        2
      ),
  };
}
