# Release & Quality Gates (`expo-app-foundation`)

Every pull request and release must pass all automated quality gates defined in `.github/workflows/`:

1. **TypeScript & Build Gate (`quality.yml`)**:
   - `npm run typecheck` (`tsc --noEmit` across all workspaces with strict mode enabled)
   - `npm run build:builder` (Vite production bundle for `apps/builder`)
2. **Unit & Integration Gate (`unit-tests.yml`)**:
   - `npm run test:unit` (Contracts, EventBus `emit`/`emitAsync`, Auth state machine, SessionManager single-flight refresh, NavigationStateManager per-tab history & path sequence reconciliation)
   - `npm run test:integration` (End-to-end Auth + Navigation + Deferred Deep Link + Role Guard scenarios)
3. **Compiler & Generator Gate (`compiler-tests.yml`)**:
   - `npm run test:compiler` (JSON Schema & semantic validation, SDK 58 dependency version enforcement, Route Layout Compiler verification, Auth-only `expo-app` vs `reusable-module` entry points)
4. **Security Gate (`security-tests.yml`)**:
   - `npm run test:security` (Token redaction in EventBus, fail-closed PKCE S256 & OIDC state/nonce/ID-token verification, fail-closed `${env.*}` resolution, safe retry policy on non-idempotent POSTs, trusted server-driven `AccessContext` refresh, untrusted deep-link host rejection, and guest-route protection)
