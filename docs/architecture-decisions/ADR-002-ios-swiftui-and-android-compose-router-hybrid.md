# ADR-002: iOS SwiftUI Native Renderer & Android Compose/Router Hybrid Architecture

- **Status**: Accepted
- **Date**: 2026-11-01

## Context

Expo SDK 58 introduces real SwiftUI navigation primitives (`NavigationStack`, `NavigationLink`, `NavigationDestination`, `TabView`, `NavigationSplitView`, `Toolbar`, `BottomSheet`) in `@expo/ui/swift-ui` and stable custom navigator APIs (`createStandardRouterNavigator`, `integrateWithRouter`) in `expo-router`. On Android, `@expo/ui/jetpack-compose` provides `NavigationBar`, `TopAppBar`, and `ModalBottomSheet`, which are UI primitives rather than a complete route stack host.

## Decision

1. **iOS (`strict-native` default)**:
   - Use `@expo/ui/swift-ui` `NavigationStack` with controlled `path` and `onPathChange` synchronized with `NavigationStateManager` via `createStandardRouterNavigator` and `integrateWithRouter`.
   - Use `@expo/ui/swift-ui` `TabView` with per-tab nested stack history synchronization.
2. **Android (`automatic-fallback` default)**:
   - Use `expo-router` `Stack` for route management paired with `@expo/ui/jetpack-compose` `TopAppBar`.
   - Use `@expo/ui/jetpack-compose` `NavigationBar` paired with `TabRouter`, with an approved fallback to `expo-router` `NativeTabs`.
   - Unify Android hardware back and gesture back handling in `AndroidNavigationAdapter` so no competing back history exists.
3. **Single Canonical JSON Contract**:
   - Both platforms consume the exact same `navigation.json` graph.
