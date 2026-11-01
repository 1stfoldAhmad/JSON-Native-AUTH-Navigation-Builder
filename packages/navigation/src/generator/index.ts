/**
 * @expo-foundation/navigation - Navigation Code Generator & Route Layout Compiler
 *
 * Implements Section 13.3, Section 16, and Audit Finding 7:
 * - Compiles the NavigationIR navigator hierarchy into real nested Expo Router `_layout.tsx`
 *   files that mount the configured iOS SwiftUI (`IOSNativeStack`, `IOSNativeTabs`,
 *   `IOSNativeSplitView`) and Android Jetpack Compose + Router (`AndroidNativeStack`,
 *   `AndroidNativeTabs`, `AndroidNativeDrawer`) navigators instead of bare `<Slot />` placeholders.
 * - Generates route manifest, typed parameter interfaces, and screen wrappers.
 */

import type { NavigationIR, NavigatorIR, RouteIR } from '@expo-foundation/core';
import { generateAndroidRendererModules } from '../android-renderer/index.js';
import { generateIOSRendererModules } from '../ios-renderer/index.js';

function toPascalCase(id: string): string {
  return id
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function toExpoRouterFilePath(normalizedPath: string): string {
  if (normalizedPath === '/') {
    return 'app/index.tsx';
  }
  const segments = normalizedPath
    .split('/')
    .filter(Boolean)
    .map((seg) => (seg.startsWith(':') ? `[${seg.slice(1)}]` : seg));
  return `app/${segments.join('/')}.tsx`;
}

/**
 * Compiles a single NavigatorIR into a concrete Expo Router `_layout.tsx` component
 * that mounts the platform-appropriate iOS SwiftUI and Android Jetpack Compose / Router
 * navigator primitive (Audit Finding 7 & Section 13.3).
 */
export function compileNavigatorLayoutFile(
  nav: NavigatorIR,
  ir: NavigationIR,
  relativeImportPrefix: string,
  includeNavigationProvider: boolean
): string {
  const componentName = `${toPascalCase(nav.id)}Layout`;
  const tabsMetadata =
    nav.tabsOptions?.tabs ??
    nav.children.map((childId) => {
      const childRoute = ir.routes[childId];
      const childNav = ir.navigators[childId];
      const initialLeaf = childNav ? ir.routes[childNav.initialRoute] : childRoute;
      return {
        routeId: childId,
        label:
          initialLeaf?.options.tabLabel ??
          initialLeaf?.options.title ??
          childRoute?.name ??
          childId,
        icon: initialLeaf?.options.tabIcon ?? 'circle',
      };
    });

  let navigatorBody: string;
  const imports: string[] = [`import React from 'react';`, `import { Platform } from 'react-native';`];

  if (includeNavigationProvider) {
    imports.push(
      `import { NavigationProvider } from '${relativeImportPrefix}/src/foundation/navigation/NavigationProvider';`
    );
  }

  if (nav.type === 'tabs') {
    imports.push(
      `import { IOSNativeTabs } from '${relativeImportPrefix}/src/foundation/navigation/renderers/ios/NativeTabs.ios';`,
      `import { AndroidNativeTabs } from '${relativeImportPrefix}/src/foundation/navigation/renderers/android/NativeTabs.android';`
    );
    const tabsJson = JSON.stringify(tabsMetadata, null, 2);
    const useNativeTabsFallback =
      ir.androidRendererPreference === 'expo-router' &&
      ir.androidFallbackPreference === 'native-tabs';
    navigatorBody = `const TABS_CONFIG = ${tabsJson};

function ${componentName}Inner() {
  if (Platform.OS === 'ios') {
    return (
      <IOSNativeTabs
        navigatorId="${nav.id}"
        initialRouteName="${nav.initialRoute}"
        tabs={TABS_CONFIG}
      />
    );
  }
  return (
    <AndroidNativeTabs
      navigatorId="${nav.id}"
      initialRouteName="${nav.initialRoute}"
      tabs={TABS_CONFIG}
      useNativeTabsFallback={${String(useNativeTabsFallback)}}
    />
  );
}`;
  } else if (nav.type === 'split' || nav.type === 'drawer') {
    imports.push(
      `import { IOSNativeSplitView } from '${relativeImportPrefix}/src/foundation/navigation/renderers/ios/NativeSplitView.ios';`,
      `import { AndroidNativeDrawer } from '${relativeImportPrefix}/src/foundation/navigation/renderers/android/NativeDrawer.android';`
    );
    const columnMode = nav.splitOptions?.columnMode ?? 'two-column';
    navigatorBody = `function ${componentName}Inner() {
  if (Platform.OS === 'ios') {
    return (
      <IOSNativeSplitView
        navigatorId="${nav.id}"
        initialRouteName="${nav.initialRoute}"
        columnMode="${columnMode}"
      />
    );
  }
  return <AndroidNativeDrawer navigatorId="${nav.id}" />;
}`;
  } else {
    // stack or modal navigator
    imports.push(
      `import { IOSNativeStack } from '${relativeImportPrefix}/src/foundation/navigation/renderers/ios/NativeStack.ios';`,
      `import { AndroidNativeStack } from '${relativeImportPrefix}/src/foundation/navigation/renderers/android/NativeStack.android';`
    );
    const headerVisible = nav.stackOptions?.headerVisible ?? true;
    const headerTitle = nav.stackOptions?.headerTitle;
    navigatorBody = `function ${componentName}Inner() {
  if (Platform.OS === 'ios') {
    return (
      <IOSNativeStack
        navigatorId="${nav.id}"
        initialRouteName="${nav.initialRoute}"
        headerVisible={${String(headerVisible)}}
        ${headerTitle ? `headerTitle=${JSON.stringify(headerTitle)}` : ''}
      />
    );
  }
  return (
    <AndroidNativeStack
      navigatorId="${nav.id}"
      headerVisible={${String(headerVisible)}}
      ${headerTitle ? `headerTitle=${JSON.stringify(headerTitle)}` : ''}
    />
  );
}`;
  }

  const exportFn = includeNavigationProvider
    ? `export default function ${componentName}() {
  return (
    <NavigationProvider>
      <${componentName}Inner />
    </NavigationProvider>
  );
}`
    : `export default function ${componentName}() {
  return <${componentName}Inner />;
}`;

  return `${imports.join('\n')}\n\n${navigatorBody}\n\n${exportFn}\n`;
}

export function generateNavigationModuleFiles(
  ir: NavigationIR
): Record<string, string> {
  const files: Record<string, string> = {};

  // 1. Route Manifest & Typed Params
  const paramInterfaces: string[] = [];
  for (const route of Object.values(ir.routes)) {
    const interfaceName = `${toPascalCase(route.id)}RouteParams`;
    const entries = Object.entries(route.params);
    if (entries.length === 0) {
      paramInterfaces.push(
        `export type ${interfaceName} = Record<string, never>;`
      );
    } else {
      const fields = entries.map(([name, schema]) => {
        const optional = schema.required ? '' : '?';
        let tsType = 'string';
        if (schema.type === 'number') tsType = 'number';
        else if (schema.type === 'boolean') tsType = 'boolean';
        else if (schema.type === 'array') {
          const itemType = schema.itemType ?? 'string';
          tsType = `${itemType}[]`;
        } else if (schema.type === 'enum' && schema.enumValues?.length) {
          tsType = schema.enumValues.map((v) => `'${v}'`).join(' | ');
        }
        return `  ${name}${optional}: ${tsType};`;
      });
      paramInterfaces.push(
        `export interface ${interfaceName} {\n${fields.join('\n')}\n}`
      );
    }
  }

  files['src/foundation/navigation/routes.manifest.ts'] = `/**
 * GENERATED BY @expo-foundation/navigation - DO NOT EDIT MANUALLY
 */

${paramInterfaces.join('\n\n')}

export const NAVIGATION_IR = ${JSON.stringify(ir, null, 2)} as const;
`;

  // 2. Navigation Provider & Runtime Wrapper (reuses canonical NavigationStateManager & DeepLinkManager)
  files['src/foundation/navigation/NavigationProvider.tsx'] = `/**
 * GENERATED BY @expo-foundation/navigation - DO NOT EDIT MANUALLY
 */
import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';
import { NavigationStateManager, DeepLinkManager, type NavigationStateSnapshot } from '@expo-foundation/navigation';
import type { NavigationIR } from '@expo-foundation/core';
import { NAVIGATION_IR } from './routes.manifest';

export interface NavigationContextValue {
  state: NavigationStateSnapshot;
  navigate: (routeId: string, params?: Record<string, unknown>) => void;
  push: (routeId: string, params?: Record<string, unknown>) => void;
  replace: (routeId: string, params?: Record<string, unknown>) => void;
  back: () => void;
  popToRoot: () => void;
  reset: (routeId: string, params?: Record<string, unknown>) => void;
  switchTab: (tabsNavigatorId: string, tabId: string, params?: Record<string, unknown>) => void;
  openModal: (modalRouteId: string, params?: Record<string, unknown>) => void;
  dismissModal: () => void;
  handleDeepLink: (url: string) => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const manager = useMemo(
    () =>
      new NavigationStateManager({
        navigationIR: NAVIGATION_IR as unknown as NavigationIR,
      }),
    []
  );

  const deepLinkManager = useMemo(
    () =>
      new DeepLinkManager({
        navigationIR: NAVIGATION_IR as unknown as NavigationIR,
        stateManager: manager,
      }),
    [manager]
  );

  const [state, setState] = useState<NavigationStateSnapshot>(() => manager.getState());

  const navigate = useCallback(
    (routeId: string, params: Record<string, unknown> = {}) => {
      setState(manager.navigate(routeId, params));
    },
    [manager]
  );

  const push = useCallback(
    (routeId: string, params: Record<string, unknown> = {}) => {
      setState(manager.push(routeId, params));
    },
    [manager]
  );

  const replace = useCallback(
    (routeId: string, params: Record<string, unknown> = {}) => {
      setState(manager.replace(routeId, params));
    },
    [manager]
  );

  const back = useCallback(() => {
    setState(manager.back());
  }, [manager]);

  const popToRoot = useCallback(() => {
    setState(manager.popToRoot());
  }, [manager]);

  const reset = useCallback(
    (routeId: string, params: Record<string, unknown> = {}) => {
      setState(manager.reset(routeId, params));
    },
    [manager]
  );

  const switchTab = useCallback(
    (tabsNavigatorId: string, tabId: string, params: Record<string, unknown> = {}) => {
      setState(manager.switchTab(tabsNavigatorId, tabId, params));
    },
    [manager]
  );

  const openModal = useCallback(
    (modalRouteId: string, params: Record<string, unknown> = {}) => {
      setState(manager.openModal(modalRouteId, params));
    },
    [manager]
  );

  const dismissModal = useCallback(() => {
    setState(manager.dismissModal());
  }, [manager]);

  const handleDeepLink = useCallback(
    (url: string) => {
      deepLinkManager.handleIncomingUrl(url);
      setState(manager.getState());
    },
    [deepLinkManager, manager]
  );

  const value = useMemo<NavigationContextValue>(
    () => ({
      state,
      navigate,
      push,
      replace,
      back,
      popToRoot,
      reset,
      switchTab,
      openModal,
      dismissModal,
      handleDeepLink,
    }),
    [state, navigate, push, replace, back, popToRoot, reset, switchTab, openModal, dismissModal, handleDeepLink]
  );

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useFoundationNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) {
    throw new Error('useFoundationNavigation must be used inside <NavigationProvider>.');
  }
  return ctx;
}
`;

  // 3. Platform Renderers (iOS SwiftUI + Android Compose/Router)
  Object.assign(files, generateIOSRendererModules(ir));
  Object.assign(files, generateAndroidRendererModules(ir));

  // 4. Route Layout Compiler (Audit Finding 7 & Section 13.3)
  // Compile root layout `app/_layout.tsx` from `ir.rootNavigator`
  const rootNav =
    ir.navigators[ir.rootNavigator] ?? Object.values(ir.navigators)[0];
  if (rootNav) {
    files['app/_layout.tsx'] = compileNavigatorLayoutFile(
      rootNav,
      ir,
      '..',
      true
    );
  }

  // Compile nested navigator layouts for every non-root navigator
  for (const nav of Object.values(ir.navigators)) {
    if (nav.id === ir.rootNavigator) continue;

    // Build nested group path in app/ directory so every navigator in NavigationIR has a compiled layout
    const chain: string[] = [`(${nav.id})`];
    let parentId = nav.parentNavigatorId;
    const seen = new Set<string>([nav.id]);
    while (parentId && parentId !== ir.rootNavigator && !seen.has(parentId)) {
      seen.add(parentId);
      chain.unshift(`(${parentId})`);
      parentId = ir.navigators[parentId]?.parentNavigatorId;
    }

    const layoutPath = `app/${chain.join('/')}/_layout.tsx`;
    const depth = chain.length + 1;
    const relativePrefix = Array.from({ length: depth }, () => '..').join('/');
    files[layoutPath] = compileNavigatorLayoutFile(
      nav,
      ir,
      relativePrefix,
      false
    );
  }

  // 5. Expo Router Screen Route Files
  for (const route of Object.values(ir.routes)) {
    const filePath = toExpoRouterFilePath(route.normalizedPath);
    files[filePath] = renderRouteScreenFile(route);
  }

  files['src/foundation/navigation/index.ts'] = `export * from './routes.manifest';
export * from './NavigationProvider';
`;

  return files;
}

function renderRouteScreenFile(route: RouteIR): string {
  const componentName = `${toPascalCase(route.id)}RouteScreen`;
  return `/**
 * GENERATED BY @expo-foundation/navigation - DO NOT EDIT MANUALLY
 * Route ID: ${route.id}
 * Screen Ref: ${route.screenRef}
 */
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { resolveGeneratedScreen } from '../src/screens/registry';

export default function ${componentName}() {
  const params = useLocalSearchParams();
  const ScreenComponent = resolveGeneratedScreen('${route.screenRef}');
  return <ScreenComponent routeId="${route.id}" params={params} />;
}
`;
}
