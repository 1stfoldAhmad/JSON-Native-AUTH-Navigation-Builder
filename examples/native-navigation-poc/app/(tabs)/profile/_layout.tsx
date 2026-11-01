import React from 'react';
import { Platform } from 'react-native';
import { SwiftUIRouterStack } from '../../../src/renderers/ios/SwiftUIRouterStack.ios';
import { RouterStackFallback } from '../../../src/renderers/android/RouterStackFallback.android';

export default function ProfileStackLayout() {
  if (Platform.OS === 'ios') {
    return <SwiftUIRouterStack initialRouteName="index" headerTitle="Profile" />;
  }
  return <RouterStackFallback headerTitle="Profile" />;
}
