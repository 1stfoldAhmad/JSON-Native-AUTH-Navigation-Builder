import React from 'react';
import { Platform } from 'react-native';
import { SwiftUIRouterTabs } from '../../src/renderers/ios/SwiftUIRouterTabs.ios';
import { ComposeNavigationBar } from '../../src/renderers/android/ComposeNavigationBar.android';

export default function MainTabsLayout() {
  if (Platform.OS === 'ios') {
    return (
      <SwiftUIRouterTabs
        initialRouteName="home"
        tabs={[
          { routeId: 'home', label: 'Home', systemImage: 'house.fill' },
          { routeId: 'search', label: 'Search', systemImage: 'magnifyingglass' },
          { routeId: 'profile', label: 'Profile', systemImage: 'person.crop.circle' },
        ]}
      />
    );
  }

  return (
    <ComposeNavigationBar
      initialRouteName="home"
      tabs={[
        { routeId: 'home', label: 'Home', icon: 'home' },
        { routeId: 'search', label: 'Search', icon: 'search' },
        { routeId: 'profile', label: 'Profile', icon: 'person' },
      ]}
    />
  );
}
