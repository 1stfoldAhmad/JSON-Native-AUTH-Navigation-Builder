# Expo SDK 58 Package & Capability Audit

## Authoritative SDK 58 Dependency Matrix (`compatibility/sdk-58/packages.json`)

Beginning with Expo SDK 55+, first-party Expo packages align their major version with the Expo SDK release (`58.x` for Expo SDK 58). The `CapabilityRegistry` in `@expo-foundation/core` and the output validator in `@expo-foundation/expo-generator` enforce these exact ranges and reject pre-SDK-58 legacy specifiers.

| Package | Authoritative SDK 58 Version | Purpose |
|---|---|---|
| `expo` | `~58.0.0` | Core Expo SDK 58 runtime |
| `react` | `19.2.0` | React 19 runtime |
| `react-native` | `0.84.0` | React Native New Architecture runtime |
| `expo-router` | `~58.0.29` | File-based routing, `StackRouter`, `TabRouter`, `createStandardRouterNavigator`, and `expo-router/native-tabs` |
| `@expo/ui` | `~58.0.21` | `@expo/ui/swift-ui` (`Host`, `NavigationStack`, `TabView`, `NavigationSplitView`) & `@expo/ui/jetpack-compose` (`Host`, `NavigationBar`, `NavigationBarItem`, `TopAppBar`, `ModalBottomSheet`) |
| `expo-secure-store` | `~58.0.2` | Hardware-backed Keychain / Keystore session persistence |
| `expo-auth-session` | `~58.0.16` | OAuth 2.0 / OIDC authorization sessions |
| `expo-crypto` | `~58.0.2` | Cryptographic CSPRNG and SHA-256 digest for PKCE S256 |
| `expo-linking` | `~58.0.7` | Custom URL scheme & Universal Link / App Link handling |
| `expo-web-browser` | `~58.0.4` | Secure system browser sessions for OAuth/OIDC |
| `expo-apple-authentication` | `~58.0.2` | Native Sign in with Apple |
| `expo-local-authentication` | `~58.0.2` | FaceID / TouchID / Android BiometricPrompt |
| `expo-status-bar` | `~58.0.1` | Native status bar management |
