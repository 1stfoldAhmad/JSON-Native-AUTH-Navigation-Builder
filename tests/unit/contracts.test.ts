import { describe, expect, it } from 'vitest';
import {
  FoundationEventBus,
  hasMfaCapability,
  hasOAuthCapability,
  hasOtpCapability,
  InMemoryFlowRegistry,
  InMemoryScreenRegistry,
  isValidFlowId,
  isValidScreenId,
  sanitizeEventPayload,
  validateScreenReferenceObject,
} from '@expo-foundation/contracts';
import { OidcAuthProviderAdapter, RestAuthProviderAdapter } from '@expo-foundation/auth';

describe('@expo-foundation/contracts', () => {
  it('validates screen reference IDs and rejects embedded UI layout properties', () => {
    expect(isValidScreenId('screen.auth.login')).toBe(true);
    expect(isValidScreenId('screen.app.order-detail')).toBe(true);
    expect(isValidScreenId('invalid_id')).toBe(false);

    const validRef = validateScreenReferenceObject({
      id: 'screen.auth.login',
      required: true,
    });
    expect(validRef.valid).toBe(true);

    const pollutedRef = validateScreenReferenceObject({
      id: 'screen.auth.login',
      components: ['TextInput', 'Button'],
      layout: { flex: 1 },
    });
    expect(pollutedRef.valid).toBe(false);
    expect(pollutedRef.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('registers and resolves external screens via InMemoryScreenRegistry', () => {
    const registry = new InMemoryScreenRegistry();
    const dummyScreen = () => 'LoginScreen';
    registry.register('screen.auth.login', dummyScreen, { title: 'Login', required: true });

    expect(registry.has('screen.auth.login')).toBe(true);
    expect(registry.resolve('screen.auth.login')).toBe(dummyScreen);
    expect(registry.getMetadata('screen.auth.login')?.title).toBe('Login');
    expect(() => registry.register('bad.id', dummyScreen)).toThrow();
  });

  it('registers and dispatches external Flow Builder references', async () => {
    expect(isValidFlowId('flow.auth.after-login')).toBe(true);
    expect(isValidFlowId('not_a_flow')).toBe(false);

    const flowRegistry = new InMemoryFlowRegistry();
    let receivedUserId = '';
    flowRegistry.register('flow.auth.after-login', (ctx) => {
      receivedUserId = String(ctx.payload.userId);
    });

    const dispatched = await flowRegistry.dispatch(
      'flow.auth.after-login',
      'auth.login.success',
      { userId: 'usr_99' }
    );
    expect(dispatched).toBe(true);
    expect(receivedUserId).toBe('usr_99');
    expect(flowRegistry.getExecutionHistory()).toHaveLength(1);
  });

  it('redacts sensitive tokens and secrets from FoundationEventBus payloads', () => {
    const bus = new FoundationEventBus();
    const received: unknown[] = [];
    bus.on('auth.login.success', (env) => {
      received.push(env.payload);
    });

    bus.emit(
      'auth.login.success',
      {
        userId: 'usr_1',
        accessToken: 'raw_jwt_secret',
        nested: {
          refresh_token: 'raw_refresh_secret',
          password: 'plain_password',
          safeField: 'visible',
        },
      },
      { source: 'auth' }
    );

    const logged = sanitizeEventPayload({
      accessToken: 'abc',
      clientSecret: 'xyz',
      userId: 'u1',
    });
    expect(logged.accessToken).toBe('[REDACTED]');
    expect(logged.clientSecret).toBe('[REDACTED]');
    expect(logged.userId).toBe('u1');

    const payload = received[0] as Record<string, unknown>;
    expect(payload.accessToken).toBe('[REDACTED]');
    expect((payload.nested as Record<string, unknown>).refresh_token).toBe('[REDACTED]');
    expect((payload.nested as Record<string, unknown>).password).toBe('[REDACTED]');
    expect((payload.nested as Record<string, unknown>).safeField).toBe('visible');
  });

  it('detects optional provider capabilities via type guards', () => {
    const rest = new RestAuthProviderAdapter();
    const oidc = new OidcAuthProviderAdapter();

    expect(hasOtpCapability(rest)).toBe(true);
    expect(hasMfaCapability(rest)).toBe(true);
    expect(hasOAuthCapability(oidc)).toBe(true);
    expect(hasOtpCapability(oidc)).toBe(false);
  });
});
