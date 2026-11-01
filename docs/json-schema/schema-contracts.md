# JSON Schema Contracts & Migrations

## Three Independent Configuration Documents

1. **`auth.json`** (`AUTH_JSON_SCHEMA`):
   - Defines provider (`rest`, `oidc`, `oauth`, `apple`, `google`, `supabase`, `firebase`, `clerk`), `session` policy, `methods` (P0–P3), `screenRefs`, `events`, and `accessControl`.
2. **`navigation.json`** (`NAVIGATION_JSON_SCHEMA`):
   - Defines `platforms` (`ios` and `android` renderer policies), `rootNavigator`, `navigators` (`stack`, `tabs`, `drawer`, `split`, `modal`), `routes` (with `id`, `path`, `screenRef`, `params`, `access`, `deepLink`), and `linking`.
3. **`integration.json`** (`INTEGRATION_JSON_SCHEMA`):
   - Defines `authNavigation` entry points (`guestEntry`, `authenticatedEntry`, `verificationRoute`, `accessDeniedRoute`), redirect policies (`afterLogin`, `afterRegistration`, `afterLogout`), `roleRouteGroups`, and `events` bindings.

## Schema Migrations

`@expo-foundation/core/schema` includes explicit, non-destructive migration routines (`migrateAuthDocument`, `migrateNavigationDocument`, `migrateIntegrationDocument`) that upgrade `0.9.0` documents to `1.0.0` defaults prior to AJV validation.
