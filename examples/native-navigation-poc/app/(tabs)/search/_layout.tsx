import React from 'react';
import { Platform } from 'react-native';
import { SwiftUIRouterStack } from '../../../src/renderers/ios/SwiftUIRouterStack.ios';
import { RouterStackFallback } from '../../../src/renderers/android/RouterStackFallback.android';

export default function SearchStackLayout() {
  if (Platform.OS === 'ios') {
    return <SwiftUIRouterStack initialRouteName="index" headerTitle="Search" />;
  }
  return <RouterStackFallback headerTitle="Search" />;
}
