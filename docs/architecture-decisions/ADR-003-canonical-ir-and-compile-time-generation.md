# ADR-003: Canonical Intermediate Representation (`FoundationIR`) & Deterministic Compile-Time Generation

- **Status**: Accepted
- **Date**: 2026-11-01

## Context

Compiling raw JSON directly into Expo components tightly couples the user-facing JSON contract to specific Expo SDK versions and precludes static analysis, capability resolution, and multi-mode compilation.

## Decision

1. Maintain three independently versioned JSON documents (`auth.json`, `navigation.json`, `integration.json`).
2. Run a 9-stage compiler pipeline in `@expo-foundation/core` that normalizes validated configurations into `FoundationIR` (`ProjectMetadataIR`, `AuthIR`, `NavigationIR`, `IntegrationIR`, `PlatformIR`).
3. Perform compile-time code generation in `@expo-foundation/expo-generator` producing typed TypeScript/TSX modules, `.foundation-manifest.json` with FNV-1a 64-bit checksums, and user-file ownership protection (`src/screens/registry.ts`).
