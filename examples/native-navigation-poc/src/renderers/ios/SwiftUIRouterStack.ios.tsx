import React, { useMemo, useCallback } from 'react';
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

export interface SwiftUIRouterStackProps {
  initialRouteName?: string;
  headerTitle?: string;
}

function SwiftUIRouterStackContent({
  initialRouteName,
  headerTitle,
  children,
}: React.PropsWithChildren<SwiftUIRouterStackProps>) {
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
        const diff = currentDepth - nextPath.length;
        for (let i = 0; i < diff; i += 1) {
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
          {headerTitle ? <Toolbar title={headerTitle} /> : null}
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

export const SwiftUIRouterStack = createStandardRouterNavigator(
  SwiftUIRouterStackContent,
  StackRouter
);
