# Testing & Verification Strategy

## Test Suites (`tests/`)

1. **`tests/unit/`**:
   - `contracts.test.ts`: Screen Reference validation, Flow Reference dispatch, EventBus token redaction, Provider capability guards.
   - `auth.test.ts`: 11-state `AuthStateMachine` transitions, `AuthSessionManager`, single-flight `RefreshCoordinator` race prevention, `RestAuthProviderAdapter`, `OidcAuthProviderAdapter` PKCE & state validation, `AuthController`.
   - `navigation.test.ts`: `RouteRegistry`, `NavigationGraphEngine`, `ParameterResolver`, `NavigationStateManager` per-tab stack preservation, `DeepLinkManager`, `IOSNativeNavigationAdapter`, `AndroidNavigationAdapter`.
2. **`tests/compiler/`**:
   - `compiler-and-generator.test.ts`: 9-stage `FoundationCompiler` pipeline, Auth-Only mode, Navigation-Only mode, Complete mode, schema migrations (`0.9.0` -> `1.0.0`), `CapabilityRegistry` modes (`strict-native`, `automatic-fallback`, `diagnostic`), deterministic `ExpoProjectGenerator`, user-file protection on incremental regeneration, manual modification detection, and `GeneratedOutputValidator`.
3. **`tests/integration/`**:
   - `auth-navigation-scenarios.test.ts`: All 15 end-to-end integration scenarios from Section 18.B (login, session restore, expiration, refresh renewal, refresh failure, nested logout clearing protected history, deep-link deferral & post-login restoration, tab switching with preserved stack, iOS native swipe-back, Android hardware back, invalid parameter rejection, and Phase 0 POC runners).
4. **`tests/security/`**:
   - `security.test.ts`: All 11 security controls from Section 18.E (no client secrets in config/generated code, no passwords in `SecureStorage`, token redaction in `FoundationEventBus` and `ErrorNormalizer`, PKCE & CSRF state validation, unsafe external redirect rejection, single-flight refresh race prevention).
