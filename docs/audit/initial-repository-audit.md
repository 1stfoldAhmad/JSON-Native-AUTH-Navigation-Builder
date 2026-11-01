# Initial Repository Audit & Remediation Report (`expo-app-foundation`)

## Executive Summary

Following the initial implementation of `expo-app-foundation`, a comprehensive engineering and security audit identified **15 critical P0/P1 findings** across Expo SDK 58 dependency compatibility, native iOS/Android renderer integration, authentication provider adapters, route layout compilation, deep-link security, and runtime state management.

All 15 findings have been remediated and verified via automated unit, compiler, integration, and security test suites.

---

## Remediated Audit Findings Matrix

| # | Priority | Finding | Remediation Implemented |
|---|---|---|---|
| **1** | **P0** | Incompatible pre-SDK-58 package versions (`expo-router ~4.0.0`, `@expo/ui ~0.1.0`, etc.) in `compatibility/sdk-58/packages.json` | Updated `compatibility/sdk-58/packages.json` to SDK 58.x (`expo-router ~58.0.29`, `expo-secure-store ~58.0.2`, `expo-auth-session ~58.0.16`, `@expo/ui ~58.0.21`, `expo-crypto ~58.0.2`) and added `CapabilityRegistry.validatePackageVersions()` to reject incompatible versions before generation. |
| **2** | **P0** | Phase 0 Native Navigation POC runners were pure TypeScript simulations labeled `'verified'` | Updated `VerificationStatus` to `'documented' \| 'simulated' \| 'native-verified' \| 'unsupported' \| 'unverified'`, labeled headless runners `'simulated'`, and created a real Expo SDK 58 POC app structure under `examples/native-navigation-poc/app/`. |
| **3** | **P0** | Incorrect iOS `@expo/ui/swift-ui` + `expo-router` navigator integration | Updated `IOSNativeStack`, `IOSNativeTabs`, and `IOSNativeSplitView` to wrap SwiftUI views in `<Host style={{ flex: 1 }}>`, use 2-argument `createStandardRouterNavigator(NavigatorContent, StackRouter)` / `TabRouter`, and map `descriptors` to `<NavigationDestination>`. |
| **4** | **P0** | Incorrect Android Compose `<NavigationBar>` props and deprecated `unstable-native-tabs` import | Wrapped Android Compose views in `<Host>`, used `<NavigationBar>` + `<NavigationBarItem selected={...} onClick={...} />`, and updated NativeTabs import to `"expo-router/native-tabs"`. |
| **5** | **P0** | Synthetic/mock providers in production `@expo-foundation/auth` and insecure PKCE fallback | Extracted mocks into `@expo-foundation/testing` (`packages/testing`), removed `SyntheticProviderAdapter` from production registry, implemented fail-closed PKCE S256 + `state`/`nonce` + ID token validation in `OidcAuthProviderAdapter`, and added real SDK driver contracts for Apple, Google, Supabase, Firebase, and Clerk. |
| **6** | **P0** | Duplicate generated Auth runtime and `InMemoryTokenStorage` default in `AuthController` | Defaulted `AuthController` to `ExpoSecureStoreAdapter` unless `'memory'` is explicitly configured, and consolidated generated `AuthProvider.tsx` to wrap the canonical `@expo-foundation/auth` runtime. |
| **7** | **P0** | Generated `app/_layout.tsx` rendered bare `<Slot />` instead of compiled navigator hierarchy | Built `compileNavigatorLayoutFile()` in `@expo-foundation/navigation` to compile root and nested navigators (`stack`, `tabs`, `split`, `drawer`, `modal`) into real Expo Router `_layout.tsx` files. |
| **8** | **P0** | Auth-only generated `package.json` had broken `"main": "index.js"` | Added `outputTarget: 'expo-app' \| 'reusable-module'` producing either `"./src/AppEntry.tsx"` (with `registerRootComponent`) or `"./src/foundation/auth/index.ts"`. |
| **9** | **P1** | DeepLinkManager allowed authenticated users onto `'guest'` routes and accepted HTTPS URLs when `hosts` was empty | Centralized policy evaluation in `evaluateAccessPolicy()` (`@expo-foundation/core`), enforced guest-route rejection (`reason: 'guest_only'`) redirecting to `authenticatedEntry`, and required non-empty `linking.hosts` for `http`/`https` deep links. |
| **10** | **P1** | `switchTab()` pushed duplicate entries onto global `history` | Separated `rootHistory`, `tabHistories`, `selectedTabs`, and `modalStack` in `NavigationStateManager` so `switchTab()` restores per-tab stack state without duplicating `rootHistory`. |
| **11** | **P1** | `IOSNativeNavigationAdapter.onNativePathChange` compared path length only | Implemented `NavigationStateManager.reconcilePathSequence()` to validate all route IDs and reconcile equal-length replacements, mid-stack edits, multi-pops, and pushes. |
| **12** | **P1** | Synchronous-only event bus and duplicate `flowRef` execution across Auth and Integration | Added deterministic ordered `emitAsync()`, recursion protection, and `eventBus.claimFlowDispatch(eventId, flowRef)` so each `flowRef` executes at most once per event envelope. |
| **13** | **P1** | `RestAuthProviderAdapter` resolved missing env vars to `""`, retried non-idempotent POSTs, and fabricated default user claims | Made `resolveEnvTemplate()` fail closed on unresolved `${env.*}` variables, restricted retries to idempotent methods or requests with `Idempotency-Key`, and required verified server user `id` without fabricating roles or `emailVerified: true`. |
| **14** | **P1** | Unverified local `updateAccessRolesAndPermissions()` allowed client-side privilege mutation | Removed `updateAccessRolesAndPermissions()`, added `issuedAt` to `AccessContext`, and implemented `refreshAccessContextFromServer()` querying `adapter.getCurrentUser()`. |
| **15** | **P1** | Split runtime vs generator behavior | Unified generated `AuthProvider.tsx` and `NavigationProvider.tsx` around `@expo-foundation/auth` and `@expo-foundation/navigation` runtime classes. |
