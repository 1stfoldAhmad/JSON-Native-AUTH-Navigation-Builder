import type {
  AuthProviderAdapter,
  AuthProviderConfig,
  AuthProviderType,
} from '@expo-foundation/contracts';
import { AppleAuthProviderAdapter, GoogleAuthProviderAdapter } from './oauth-providers.js';
import { OidcAuthProviderAdapter } from './oidc-adapter.js';
import { RestAuthProviderAdapter } from './rest-adapter.js';
import {
  ClerkAuthProviderAdapter,
  FirebaseAuthProviderAdapter,
  SupabaseAuthProviderAdapter,
} from './sdk-adapters.js';

export type AuthProviderFactory = () => AuthProviderAdapter;

export class AuthProviderRegistry {
  private readonly factories = new Map<AuthProviderType, AuthProviderFactory>();

  constructor() {
    this.register('rest', () => new RestAuthProviderAdapter());
    this.register('oidc', () => new OidcAuthProviderAdapter());
    this.register('oauth', () => new OidcAuthProviderAdapter());
    this.register('apple', () => new AppleAuthProviderAdapter());
    this.register('google', () => new GoogleAuthProviderAdapter());
    this.register('supabase', () => new SupabaseAuthProviderAdapter());
    this.register('firebase', () => new FirebaseAuthProviderAdapter());
    this.register('clerk', () => new ClerkAuthProviderAdapter());
  }

  register(type: AuthProviderType, factory: AuthProviderFactory): void {
    this.factories.set(type, factory);
  }

  has(type: AuthProviderType): boolean {
    return this.factories.has(type);
  }

  create(type: AuthProviderType): AuthProviderAdapter {
    const factory = this.factories.get(type);
    if (!factory) {
      throw new Error(`No AuthProviderAdapter registered for provider type "${type}".`);
    }
    return factory();
  }

  async createAndInitialize(config: AuthProviderConfig): Promise<AuthProviderAdapter> {
    const adapter = this.create(config.type);
    await adapter.initialize(config);
    return adapter;
  }

  listSupportedTypes(): AuthProviderType[] {
    return Array.from(this.factories.keys());
  }
}

export const defaultAuthProviderRegistry = new AuthProviderRegistry();
