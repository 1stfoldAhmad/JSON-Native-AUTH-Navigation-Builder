# Complete Technical Implementation Plan

## Reusable Expo Auth Builder & Expo Navigation Builder

- **Architecture**: Expo-first · JSON-driven · TypeScript · Native rendering
- **Baseline**: Expo SDK 58 (React Native 0.88, SwiftUI navigation components in `@expo/ui`, Jetpack Compose primitives in `@expo/ui`, and stable Expo Router custom navigator APIs `createStandardRouterNavigator` and `integrateWithRouter`)

---

## 1. Project Vision and Objectives

The **Expo App Foundation Builder** contains two independently reusable builders:

1. **Expo Auth Builder (`@expo-foundation/auth`)**: Defines, validates, compiles, and manages headless authentication systems.
2. **Expo Navigation Builder (`@expo-foundation/navigation`)**: Defines, validates, compiles, and manages native navigation systems.

Both share a canonical compiler foundation (`@expo-foundation/core` & `@expo-foundation/contracts`) and communicate through a dedicated integration layer (`@expo-foundation/integration`), outputting deterministic Expo SDK 58 project code via `@expo-foundation/expo-generator`.

### Strict Project Scope

- **Included**:
  - **Auth Builder**: Configuration, provider adapters, flows, session manager, access control, and authentication runtime.
  - **Navigation Builder**: Route graphs, stacks, tabs, nested navigation, native iOS/Android renderers, parameter resolution, and deep links.
  - **Shared Infrastructure**: JSON Schemas, TypeScript definitions, compiler, Canonical Intermediate Representation (`FoundationIR`), validators, capability registry, code generation, and integration bridge.
- **Explicitly Excluded**:
  - Screen Builder and Component Builder (developed separately in the future).
  - Neither builder contains screen layout editors, native UI component editors, JSON-to-component rendering engines, login/register screen designers, or visual form builders.
  - Screens are referenced exclusively through stable `screen.<domain>.<name>` identifiers resolved via `ScreenRegistry`.

---

## 2. Three Non-Negotiable Architectural Rules

1. **Rule 1 — Never couple authentication to a visual screen implementation.**
   The Auth Runtime provides operations, session state, and events. Screens are external consumers.
2. **Rule 2 — Never couple navigation to the screen implementation.**
   The Navigation Runtime manages route IDs, screen references, parameters, and navigators. The external `ScreenRegistry` resolves actual screen components.
3. **Rule 3 — Never allow the two platform renderers to change the canonical JSON contract.**
   iOS and Android consume the exact same `navigation.json`, `auth.json`, and `integration.json` definitions.

---

## 3. Platform Architecture (Expo SDK 58)

| Capability | Expo UI iOS (`@expo/ui/swift-ui`) | Expo UI / Router Android |
| :--- | :--- | :--- |
| Native Stack | `NavigationStack` (controlled `path` + `onPathChange`) | `expo-router` `Stack` |
| Native Links | `NavigationLink` | `expo-router` `Link` |
| Native Destination | `NavigationDestination` | `expo-router` `Screen` |
| Native Tabs | `TabView` + `createStandardRouterNavigator` | `@expo/ui/jetpack-compose` `NavigationBar` + `TabRouter` (fallback: `NativeTabs`) |
| Sidebar / Split View | `NavigationSplitView` | `expo-router` `Drawer` / Adaptive layout |
| Toolbars | `Toolbar` | `@expo/ui/jetpack-compose` `TopAppBar` |
| Modal Sheet | `BottomSheet` / `fullScreenCover` | `@expo/ui/jetpack-compose` `ModalBottomSheet` + `expo-router` Modal |
| General Route / Deep-Link | `integrateWithRouter` + `expo-linking` | `expo-router` + `expo-linking` |

---

## 4. Independent Execution Modes

- **Auth-Only Mode**: Compiles `auth.json` into `AuthIR` and generates standalone authentication runtime modules without requiring `navigation.json`.
- **Navigation-Only Mode**: Compiles `navigation.json` into `NavigationIR` and generates native iOS & Android navigation adapters without requiring `auth.json`.
- **Complete Application Mode**: Combines `auth.json`, `navigation.json`, and `integration.json` into a unified `FoundationIR` with route guards, lifecycle event bindings, and intended-destination restoration.
