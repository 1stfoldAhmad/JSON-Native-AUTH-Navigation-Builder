# Expo SDK 58 Platform Compatibility Matrix

The compatibility profile in `compatibility/sdk-58/` defines verified capabilities and package versions for Expo SDK 58 (React Native 0.88).

## Three Compilation Modes

1. **`strict-native`** (Default on iOS): Fails compilation if a requested navigator capability requires a non-native fallback.
2. **`automatic-fallback`** (Default on Android): Selects the approved Expo Router or NativeTabs alternative when a direct Compose navigation host is not in the `@expo/ui` catalogue.
3. **`diagnostic`**: Emits warning/info diagnostics for every fallback or platform qualification without silently altering behavior.
