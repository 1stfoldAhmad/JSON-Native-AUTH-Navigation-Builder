import React from 'react';
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

export interface ComposeTabDescriptor {
  routeId: string;
  label: string;
  icon: string;
}

export interface ComposeNavigationBarProps {
  initialRouteName?: string;
  tabs: ComposeTabDescriptor[];
  useNativeTabsFallback?: boolean;
}

function ComposeNavigationBarContent({
  initialRouteName,
  tabs,
  useNativeTabsFallback = false,
  children,
}: React.PropsWithChildren<ComposeNavigationBarProps>) {
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
                />
              );
            })}
          </NavigationBar>
        </Host>
      </View>
    </NavigationContent>
  );
}

export const ComposeNavigationBar = createStandardRouterNavigator(
  ComposeNavigationBarContent,
  TabRouter
);

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1 },
});
