import type {
  AuthConfigDocument,
  IntegrationConfigDocument,
  NavigationConfigDocument,
} from '../types/index.js';

export const CURRENT_SCHEMA_VERSION = '1.0.0';

export interface MigrationResult<T> {
  document: T;
  fromVersion: string;
  toVersion: string;
  migrated: boolean;
  notes: string[];
}

export function migrateAuthDocument(raw: Record<string, unknown>): MigrationResult<AuthConfigDocument> {
  const clone = structuredClone(raw);
  const fromVersion = typeof clone.schemaVersion === 'string' ? clone.schemaVersion : '0.9.0';
  const notes: string[] = [];

  if (fromVersion === '0.9.0') {
    clone.schemaVersion = CURRENT_SCHEMA_VERSION;
    if (!clone.session || typeof clone.session !== 'object') {
      clone.session = {
        restoreOnLaunch: true,
        storage: 'secure-store',
        refreshEnabled: true,
        refreshStrategy: 'before-expiration',
      };
      notes.push('Added default session configuration during 0.9.0 -> 1.0.0 migration.');
    }
    if (!clone.methods || typeof clone.methods !== 'object') {
      clone.methods = {
        password: true,
        registration: true,
        emailVerification: false,
        passwordReset: true,
        otp: false,
        oauth: false,
      };
      notes.push('Added default methods configuration during 0.9.0 -> 1.0.0 migration.');
    }
    if (!clone.screenRefs || typeof clone.screenRefs !== 'object') {
      clone.screenRefs = {
        login: 'screen.auth.login',
      };
      notes.push('Initialized screenRefs map during 0.9.0 -> 1.0.0 migration.');
    }
  }

  return {
    document: clone as unknown as AuthConfigDocument,
    fromVersion,
    toVersion: String(clone.schemaVersion ?? CURRENT_SCHEMA_VERSION),
    migrated: fromVersion !== clone.schemaVersion,
    notes,
  };
}

export function migrateNavigationDocument(
  raw: Record<string, unknown>
): MigrationResult<NavigationConfigDocument> {
  const clone = structuredClone(raw);
  const fromVersion = typeof clone.schemaVersion === 'string' ? clone.schemaVersion : '0.9.0';
  const notes: string[] = [];

  if (fromVersion === '0.9.0') {
    clone.schemaVersion = CURRENT_SCHEMA_VERSION;
    if (!clone.platforms || typeof clone.platforms !== 'object') {
      clone.platforms = {
        ios: { renderer: 'expo-ui', strictNative: true },
        android: { renderer: 'auto', fallback: 'expo-router' },
      };
      notes.push('Initialized default iOS/Android platform policies during 0.9.0 -> 1.0.0 migration.');
    }
  }

  return {
    document: clone as unknown as NavigationConfigDocument,
    fromVersion,
    toVersion: String(clone.schemaVersion ?? CURRENT_SCHEMA_VERSION),
    migrated: fromVersion !== clone.schemaVersion,
    notes,
  };
}

export function migrateIntegrationDocument(
  raw: Record<string, unknown>
): MigrationResult<IntegrationConfigDocument> {
  const clone = structuredClone(raw);
  const fromVersion = typeof clone.schemaVersion === 'string' ? clone.schemaVersion : '0.9.0';
  const notes: string[] = [];

  if (fromVersion === '0.9.0') {
    clone.schemaVersion = CURRENT_SCHEMA_VERSION;
    if (
      clone.authNavigation &&
      typeof clone.authNavigation === 'object' &&
      !(clone.authNavigation as Record<string, unknown>).afterLogin
    ) {
      (clone.authNavigation as Record<string, unknown>).afterLogin =
        'restore-intended-destination';
      notes.push('Defaulted afterLogin to restore-intended-destination in 1.0.0 migration.');
    }
  }

  return {
    document: clone as unknown as IntegrationConfigDocument,
    fromVersion,
    toVersion: String(clone.schemaVersion ?? CURRENT_SCHEMA_VERSION),
    migrated: fromVersion !== clone.schemaVersion,
    notes,
  };
}
