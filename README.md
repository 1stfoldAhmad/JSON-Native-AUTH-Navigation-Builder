# Expo App Foundation Builder (`JSON-Native-AUTH-Navigation-Builder`)

A reusable, JSON-driven **Expo Auth Builder** and **Expo Native Navigation Builder** targeting **Expo SDK 58** (React Native 0.88, SwiftUI native navigation in `@expo/ui`, Jetpack Compose primitives in `@expo/ui`, and stable Expo Router custom navigator APIs).

---

## Architecture Highlights

- **Two Independently Executable Builders**:
  - **Auth Builder (`@expo-foundation/auth`)**: Headless, provider-independent authentication runtime with an explicit 11-state machine, `expo-secure-store` session manager, single-flight `RefreshCoordinator`, configurable REST adapter with restricted `$` JSONPath mapping, and OAuth/OIDC PKCE adapter. Works standalone without Navigation Builder.
  - **Navigation Builder (`@expo-foundation/navigation`)**: Route graph engine, centralized `RouteRegistry`, typed `ParameterResolver`, `DeepLinkManager`, iOS SwiftUI renderer (`NavigationStack`, `TabView`, `NavigationSplitView`, `Toolbar` via `createStandardRouterNavigator` & `integrateWithRouter`), and Android hybrid renderer (Jetpack Compose `NavigationBar` + `TopAppBar` + Expo Router `Stack` & `NativeTabs` fallback). Works standalone without Auth Builder.
- **Shared Core & Compiler (`@expo-foundation/core` & `@expo-foundation/contracts`)**:
  - Three independent JSON contracts (`auth.json`, `navigation.json`, `integration.json`) validated with JSON Schema 2020-12 (AJV), schema migrations (`0.9.0` → `1.0.0`), 9-stage compiler pipeline, Canonical `FoundationIR`, and SDK 58 `CapabilityRegistry`.
  - Strict scope boundaries: references external screens by stable IDs (`screen.<domain>.<name>`) via `ScreenRegistry` and external business flows (`flow.<domain>.<action>`) via `FlowRegistry` — never embeds UI layout or form component trees.
- **Integration & Deterministic Code Generator (`@expo-foundation/integration` & `@expo-foundation/expo-generator`)**:
  - Event-driven `AuthNavigationBridge`, `RouteGuardManager`, safe post-login intended-destination restoration, deterministic Expo SDK 58 code generation with `.foundation-manifest.json` checksums, user-file protection, and `GeneratedOutputValidator`.
- **Interactive Builder Studio (`apps/builder`)**:
  - Web workspace featuring the Auth Builder, Navigation Builder, Integration & Runtime Simulator, Diagnostics Center, and Generated Expo Project Explorer.

---

## Repository Structure

```text
├── apps/
│   └── builder/                # Interactive Web Builder UI (Auth, Navigation, Integration, Diagnostics)
├── packages/
│   ├── contracts/              # ScreenReference, FlowReference, FoundationEventBus, AuthProviderAdapter
│   ├── core/                   # JSON Schemas, Migrations, FoundationIR, CapabilityRegistry, Compiler
│   ├── auth/                   # AuthStateMachine, AuthSessionManager, REST/OIDC/SDK Adapters, Generator
│   ├── navigation/             # RouteRegistry, GraphEngine, DeepLinkManager, iOS & Android Renderers
│   ├── integration/            # AuthNavigationBridge, RouteGuardManager, RedirectManager
│   └── expo-generator/         # ExpoProjectGenerator, DependencyManager, GeneratedOutputValidator
├── compatibility/
│   └── sdk-58/                 # Expo SDK 58 packages, capabilities, and renderer mappings
├── examples/
│   ├── auth-only/              # Standalone Auth JSON example
│   ├── navigation-only/        # Standalone Navigation JSON example
│   ├── complete-foundation/    # Full Auth + Navigation + Integration JSON suite
│   ├── native-navigation-poc/  # Phase 0 iOS SwiftUI & Android Compose/Router POC
│   └── fixtures/               # Isolated test-only mock ScreenRegistry fixtures
├── tests/                      # Unit, Compiler, Integration (15 scenarios), and Security test suites
└── docs/                       # Master Technical Implementation Plan, ADRs, and module guides
```

---

## Quick Start

```bash
# Install dependencies
npm install

# Run full test suite (Unit, Compiler, Integration, Security)
npm test

# Typecheck all packages and builder app
npm run typecheck

# Launch the interactive Builder Studio
npm run dev:builder
```
