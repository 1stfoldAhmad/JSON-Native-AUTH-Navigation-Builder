/**
 * Phase 0 Native Navigation POC - Verification Checklist & Status Matrix (Section 10.3)
 */

import type { VerificationStatus } from '@expo-foundation/core';

export interface PocChecklistItem {
  id: string;
  platform: 'ios' | 'android' | 'both';
  requirement: string;
  automatedSimulationStatus: VerificationStatus;
  nativeDeviceChecklistRef: string;
}

export const PHASE_0_POC_CHECKLIST: readonly PocChecklistItem[] = [
  {
    id: 'poc.ios.root-stack',
    platform: 'ios',
    requirement:
      'Root stack renders inside <Host><NavigationStack> via createStandardRouterNavigator(Content, StackRouter)',
    automatedSimulationStatus: 'simulated',
    nativeDeviceChecklistRef: 'docs/native-verification/ios-verification.md#1-root-stack',
  },
  {
    id: 'poc.ios.nested-stacks-in-tabs',
    platform: 'ios',
    requirement:
      'Nested stacks inside <TabView> preserve independent per-tab stack history without root stack duplication',
    automatedSimulationStatus: 'simulated',
    nativeDeviceChecklistRef: 'docs/native-verification/ios-verification.md#2-nested-stacks-in-tabs',
  },
  {
    id: 'poc.ios.controlled-path-sync',
    platform: 'ios',
    requirement:
      'Controlled path reconciliation handles swipe-back, multi-pops, and equal-length route replacements',
    automatedSimulationStatus: 'simulated',
    nativeDeviceChecklistRef: 'docs/native-verification/ios-verification.md#3-controlled-path-reconciliation',
  },
  {
    id: 'poc.android.compose-navbar',
    platform: 'android',
    requirement:
      'Compose <Host><NavigationBar><NavigationBarItem> synchronizes with Expo Router TabRouter and NativeTabs fallback ("expo-router/native-tabs")',
    automatedSimulationStatus: 'simulated',
    nativeDeviceChecklistRef: 'docs/native-verification/android-verification.md#1-compose-navigationbar',
  },
  {
    id: 'poc.android.hardware-back',
    platform: 'android',
    requirement:
      'Android hardware back pops active nested tab stack or dismisses open modal before exiting root',
    automatedSimulationStatus: 'simulated',
    nativeDeviceChecklistRef: 'docs/native-verification/android-verification.md#2-hardware-back-handling',
  },
  {
    id: 'poc.both.auth-root-reset',
    platform: 'both',
    requirement:
      'Login and logout perform full root navigation reset between Guest Stack and Main Tabs with zero back-stack leakage',
    automatedSimulationStatus: 'simulated',
    nativeDeviceChecklistRef: 'docs/native-verification/ios-verification.md#4-auth-root-reset',
  },
  {
    id: 'poc.both.deep-links',
    platform: 'both',
    requirement:
      'Deep links with typed path/query params defer when unauthenticated and restore after login',
    automatedSimulationStatus: 'simulated',
    nativeDeviceChecklistRef: 'docs/native-verification/ios-verification.md#5-deep-links',
  },
];
