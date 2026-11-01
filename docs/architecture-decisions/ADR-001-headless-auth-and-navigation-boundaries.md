# ADR-001: Headless Auth & Navigation Boundaries via External Screen and Flow Contracts

- **Status**: Accepted
- **Date**: 2026-11-01

## Context

The Expo App Foundation Builder is part of a multi-builder ecosystem where the **Screen Builder**, **Component Builder**, and **Flow & Business Logic Builder** are developed separately. Coupling authentication or navigation directly to UI screen layouts or visual form components would prevent independent reuse.

## Decision

1. Introduce `@expo-foundation/contracts` with four zero-UI contracts:
   - `ScreenReference` (`screen.<domain>.<name>`) and `ScreenRegistry`
   - `FlowReference` (`flow.<domain>.<action>`) and `FlowRegistry`
   - `FoundationEventBus` with automatic token/secret redaction
   - `AuthProviderAdapter` and optional capability interfaces
2. Generated Expo Router `src/app/` files act purely as **route adapters** that resolve a `screenRef` from `src/screens/registry.ts`.
3. Reject any `ScreenReference` object containing UI layout keys (`children`, `components`, `layout`, `styles`, `formFields`, etc.).

## Consequences

- Auth Builder can run in **Auth-Only** mode without Navigation Builder.
- Navigation Builder can run in **Navigation-Only** mode without Auth Builder.
- Future Screen and Component Builders can plug into `ScreenRegistry` without modifying a single line of Auth or Navigation code.
