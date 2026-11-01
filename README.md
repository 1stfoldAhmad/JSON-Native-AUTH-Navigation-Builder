# `expo-app-foundation` — Reusable Expo Auth Builder & Native Navigation Builder (Expo SDK 58)

A production-ready, JSON-driven **Expo Auth Builder**, **Expo Native Navigation Builder**, **Auth-Navigation Integration Engine**, **Deterministic Expo SDK 58 Code Generator**, and **Interactive Builder Studio UI**.

---

## Architecture & Monorepo Packages

| Package / App | Path | Responsibility |
|---|---|---|
| `@expo-foundation/contracts` | `packages/contracts` | Screen Reference (`screen.*`), Flow Reference (`flow.*`), Sanitized Event Bus (`emit` + deterministic `emitAsync`, recursion protection, single-owner `claimFlowDispatch`), and `AuthProviderAdapter` + `AuthProviderCapabilities` contracts |
| `@expo-foundation/core` | `packages/core` | JSON Schemas (`auth`, `navigation`, `integration`), Semantic & Cross-Document Validators, Centralized `evaluateAccessPolicy()`, Expo SDK 58 `CapabilityRegistry` & Authoritative Version Resolver, and `FoundationCompiler` (`ProjectIR`) |
| `@expo-foundation/auth` | `packages/auth` | 11-State `AuthStateMachine`, `ExpoSecureStoreAdapter` (default) & `InMemoryTokenStorage`, Single-Flight `SessionManager`, `RestAuthProviderAdapter` (fail-closed `${env.*}`, idempotent retry policy, strict claims), `OidcAuthProviderAdapter` (fail-closed PKCE S256, `state`/`nonce`, ID token verification), Apple/Google/Supabase/Firebase/Clerk SDK Adapters, and `AuthController` (`refreshAccessContextFromServer()`) |
| `@expo-foundation/navigation` | `packages/navigation` | `RouteRegistry` (typed scalar params: `string`, `number`, `boolean`, `enum`, `uuid`, `date`, `custom-scalar`, `array`), `NavigationStateManager` (isolated `rootHistory`, `tabHistories`, `selectedTabs`, `modalStack`, and full `reconcilePathSequence()`), `DeepLinkManager` (strict HTTPS host allowlist & central access policy), `IOSNativeNavigationAdapter` (`@expo/ui/swift-ui` `<Host>` + `createStandardRouterNavigator`), `AndroidNativeNavigationAdapter` (`@expo/ui/jetpack-compose` `<Host>` + `<NavigationBar>` + `expo-router/native-tabs`), and Route Layout Compiler (`compileNavigatorLayoutFile`) |
| `@expo-foundation/integration` | `packages/integration` | `RouteGuardManager`, `AuthNavigationBridge` / `AuthNavigationCoordinator`, startup session restoration gate, deferred deep-link replay, and real-time role/permission re-evaluation |
| `@expo-foundation/expo-generator` | `packages/expo-generator` | Deterministic Expo SDK 58 project & module generator (`expo-app` and `reusable-module` targets) and Multi-Stage Output Validator |
| `@expo-foundation/testing` | `packages/testing` | Isolated test-only mock providers (`MockAuthProviderAdapter`), sessions, challenges, and screen fixtures (never bundled in production runtimes) |
| `@expo-foundation/builder` | `apps/builder` | Interactive React + Vite Builder Studio with `localStorage` project persistence, Undo/Redo revision history, visual Navigation Graph CRUD, Auth Builder, Runtime Simulator, Schema-Aware JSON Editor, and Bundle Exporter |

---

## Documentation Index

- [Initial Repository Audit & 15-Finding Remediation Report](docs/audit/initial-repository-audit.md)
- [Technical Implementation Plan](docs/architecture/technical-implementation-plan.md)
- [Expo SDK 58 Package & Version Audit](docs/compatibility/sdk-58-package-audit.md)
- [Expo SDK 58 Platform Capability Matrix](docs/platform-compatibility/sdk-58-matrix.md)
- [Phase 0 Native Navigation POC Results](docs/poc-results/phase-0-native-navigation-poc.md)
- [iOS SwiftUI Native Verification Protocol](docs/native-verification/ios-verification.md)
- [Android Compose + Router Native Verification Protocol](docs/native-verification/android-verification.md)
- [Release & CI Quality Gates](docs/development/release-quality-gates.md)

---

## Quick Start

```bash
# Install workspace dependencies
npm install

# Run strict TypeScript typecheck across all packages
npm run typecheck

# Run all 6 automated test suites (unit, compiler, integration, security)
npm test

# Build the interactive Builder Studio production bundle
npm run build:builder

# Start the interactive Builder Studio dev server
npm run dev:builder
```
