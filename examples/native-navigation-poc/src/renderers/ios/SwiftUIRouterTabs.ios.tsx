import React from 'react';
import { Host, TabView } from '@expo/ui/swift-ui';
import {
  createStandardRouterNavigator,
  TabRouter,
  useNavigationBuilder,
} from 'expo-router';

export interface SwiftUITabDescriptor {
  routeId: string;
  label: string;
  systemImage: string;
}

export interface SwiftUIRouterTabsProps {
  initialRouteName?: string;
  tabs: SwiftUITabDescriptor[];
}

function SwiftUIRouterTabsContent({
  initialRouteName,
  tabs,
  children,
}: React.PropsWithChildren<SwiftUIRouterTabsProps>) {
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
          onSelectionChange={(nextName: string) => {
            navigation.navigate(nextName);
          }}
        >
          {state.routes.map((route) => {
            const tabMeta = tabs.find((t) => t.routeId === route.name);
            const descriptor = descriptors[route.key];
            return (
              <TabView.Tab
                key={route.key}
                id={route.name}
                title={tabMeta?.label ?? route.name}
                systemImage={tabMeta?.systemImage ?? 'circle'}
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

export const SwiftUIRouterTabs = createStandardRouterNavigator(
  SwiftUIRouterTabsContent,
  TabRouter
);
