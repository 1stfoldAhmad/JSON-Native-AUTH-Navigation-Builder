# iOS Native Navigation Verification Protocol (`@expo/ui/swift-ui`)

## 1. Root Stack & Host Boundary
- Every SwiftUI navigation hierarchy is mounted inside `<Host style={{ flex: 1 }}>` from `@expo/ui/swift-ui`.
- Custom Expo Router navigators are created with 2-argument `createStandardRouterNavigator(IOSNativeStackNavigator, StackRouter)` from `expo-router`.

## 2. Nested Stacks Inside Tabs
- `IOSNativeTabs` wraps `<TabView selection={activeRoute?.name} onSelectionChange={...}>` inside `<Host style={{ flex: 1 }}>` using `createStandardRouterNavigator(IOSNativeTabsNavigator, TabRouter)`.
- Each tab (`home-stack`, `search-stack`, `profile-stack`) maintains an isolated stack history in `NavigationStateManager.tabHistories` so switching tabs preserves deep stack screens without duplicating `rootHistory`.

## 3. Controlled Path Reconciliation
- `NavigationStack` binds `path={controlledPath}` and `onPathChange={handlePathChange}`.
- `IOSNativeNavigationAdapter.onNativePathChange()` delegates to `NavigationStateManager.reconcilePathSequence()`, validating all route IDs and reconciling swipe-back pops, multi-step pops, and equal-length route replacements.

## 4. Auth Root Reset
- Sign-in and sign-out invoke `NavigationStateManager.reset()`, clearing modal and guest history so back gestures cannot return to pre-auth screens.

## 5. Deep Links & Universal Links
- Custom scheme (`pocapp://`) and Universal Links (`https://poc.expo-foundation.dev/...`) validate host allowlists, coerce typed parameters, defer protected destinations when unauthenticated, and replay them after login.
