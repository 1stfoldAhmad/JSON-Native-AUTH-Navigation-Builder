# Phase 0 Native Navigation POC Results (Expo SDK 58)

## Verification Level Taxonomy

Each capability in `compatibility/sdk-58/capabilities.json` and the Phase 0 POC runners is tracked using an explicit `VerificationStatus`:
- `'documented'`: Verified against Expo SDK 58 API documentation and type signatures.
- `'simulated'`: Verified via automated headless state, adapter, and compiler tests (`runIOSNativeNavigationPoc()`, `runAndroidNativeNavigationPoc()`).
- `'native-verified'`: Verified on iOS Simulator / Android Emulator native builds (`examples/native-navigation-poc/`).

## POC Application Structure (`examples/native-navigation-poc/`)

- **Expo SDK 58 App (`examples/native-navigation-poc/app/`)**:
  - `app/_layout.tsx`: Root stack switching between `(guest)` and `(tabs)`.
  - `app/(guest)/_layout.tsx`: Guest stack (`login`, `register`, `verify`).
  - `app/(tabs)/_layout.tsx`: Main tabs (`home`, `search`, `profile`) using `SwiftUIRouterTabs` on iOS and `ComposeNavigationBar` on Android.
  - `app/(tabs)/home/_layout.tsx`: Nested Home stack (`index`, `orders/[orderId]`).
  - `app/(tabs)/search/_layout.tsx`: Nested Search stack (`index`, `products/[productId]`).
  - `app/(tabs)/profile/_layout.tsx`: Nested Profile stack (`index`, `settings`).
- **Headless Simulation Runners**:
  - `examples/native-navigation-poc/ios/ios-poc-runner.ts` (`verificationStatus: 'simulated'`)
  - `examples/native-navigation-poc/android/android-poc-runner.ts` (`verificationStatus: 'simulated'`)
