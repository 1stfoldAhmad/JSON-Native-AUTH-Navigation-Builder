# Native Navigation Engine (`@expo-foundation/navigation`)

## Subsystems

1. **`RouteRegistry`**: Centralized registry maintaining stable route IDs, URL path templates, external `screenRef` identifiers, navigator parents, typed parameter schemas, access policies, and deep-link aliases.
2. **`NavigationGraphEngine`**: Builds the complete navigator and route hierarchy, computes reachability, detects cycles, and resolves initial routes.
3. **`ParameterResolver`**: Matches dynamic path patterns (`/orders/:orderId`), extracts query strings, validates and coerces typed parameters (`string`, `number`, `boolean`, `enum`), and serializes concrete paths.
4. **`NavigationStateManager`**: Platform-neutral state engine managing stack history, independent per-tab stack histories (`tabStacks`), modal stacks, and full history reset on logout/expiry.
5. **`DeepLinkManager`**: Resolves custom schemes (`expofoundation://`) and HTTPS universal links / App Links, checks route access policies, defers unauthenticated deep links to `guestEntry` while retaining validated internal intended destinations, and restores destinations after login.
6. **`IOSNativeNavigationAdapter`**: Bridges `NavigationStateManager` to `@expo/ui/swift-ui` (`NavigationStack` controlled `path` and `onPathChange`, `TabView` per-tab stack preservation, `NavigationSplitView`, `Toolbar`, `BottomSheet`) using `createStandardRouterNavigator` and `integrateWithRouter`.
7. **`AndroidNavigationAdapter`**: Hybrid engine pairing `expo-router` `Stack` and `TabRouter` with `@expo/ui/jetpack-compose` `TopAppBar`, `NavigationBar`, and `ModalBottomSheet` (plus `NativeTabs` fallback and unified Android hardware back handling).
