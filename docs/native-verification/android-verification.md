# Android Native Navigation Verification Protocol (`@expo/ui/jetpack-compose` + `expo-router`)

## 1. Compose NavigationBar & Host Boundary
- Android bottom tab navigation wraps `<NavigationBar>` and `<NavigationBarItem>` inside `<Host>` from `@expo/ui/jetpack-compose`.
- Each `<NavigationBarItem>` receives `selected={isSelected}`, `onClick={() => navigation.navigate(tab.routeId)}`, `label`, `icon`, and optional `badge`.
- When `useNativeTabsFallback` is enabled, the renderer imports `NativeTabs` from `"expo-router/native-tabs"` (never the deprecated `"expo-router/unstable-native-tabs"`).

## 2. Hardware Back Handling
- `AndroidNativeNavigationAdapter.onHardwareBackPress()` dismisses any open modal on `modalStack` first, then pops the active tab's nested stack (`tabHistories[activeTab]`) or `rootHistory`, and returns `{ consumed: false }` only when at the root route.

## 3. Stack Fallback & TopAppBar Chrome
- Because `@expo/ui/jetpack-compose` in Expo SDK 58 does not provide a standalone Compose `NavigationStack`, stack routing uses Expo Router `<Stack>` paired with Jetpack Compose `<Host><TopAppBar /></Host>` in `automatic-fallback` mode.
