/**
 * @expo-foundation/navigation - NativeNavigationRenderer Shared Contract (Section 13.4)
 */

import type { NavigationIR } from '@expo-foundation/core';
import type { NavigationStateSnapshot } from './state-manager.js';

export interface NativeNavigationRenderer {
  readonly platform: 'ios' | 'android';
  readonly engine: string;
  renderNavigatorHierarchy(ir: NavigationIR, state: NavigationStateSnapshot): {
    platform: 'ios' | 'android';
    rootNavigatorId: string;
    activeRouteId: string;
    hostComponent: 'Host';
  };
}
