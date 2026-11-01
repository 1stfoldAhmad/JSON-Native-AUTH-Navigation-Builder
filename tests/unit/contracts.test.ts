import { describe, expect, it } from 'vitest';
import {
  FoundationEventBus,
  InMemoryFlowRegistry,
  InMemoryScreenRegistry,
  isValidFlowId,
  isValidScreenId,
} from '@expo-foundation/contracts';

describe('@expo-foundation/contracts', () => {
  it('validates screenRef and flowRef identifiers', () => {
    expect(isValidScreenId('screen.auth.login')).toBe(true);
    expect(isValidScreenId('screen.app.order-detail')).toBe(true);
    expect(isValidScreenId('invalid_screen')).toBe(false);

    expect(isValidFlowId('flow.auth.after-login')).toBe(true);
    expect(isValidFlowId('flow.invalid')).toBe(false);
  });

  it('registers and resolves screen references in InMemoryScreenRegistry', () => {
    const registry = new InMemoryScreenRegistry();
    const dummyScreen = () => 'LoginScreen';
    registry.register('screen.auth.login', dummyScreen, { title: 'Sign In' });

    expect(registry.has('screen.auth.login')).toBe(true);
    expect(registry.resolve('screen.auth.login')).toBe(dummyScreen);
    expect(registry.list()).toEqual(['screen.auth.login']);
  });

  it('dispatches flow references and records execution history with eventId deduplication', async () => {
    const flows = new InMemoryFlowRegistry();
    let count = 0;

    flows.register('flow.auth.after-login', (ctx) => {
      count += Number(ctx.payload.increment ?? 1);
    });

    const first = await flows.dispatch(
      'flow.auth.after-login',
      'auth.login.success',
      { increment: 2 },
      'evt_100'
    );
    const duplicate = await flows.dispatch(
      'flow.auth.after-login',
      'auth.login.success',
      { increment: 2 },
      'evt_100'
    );

    expect(first).toBe(true);
    expect(duplicate).toBe(false);
    expect(count).toBe(2);
    expect(flows.getExecutionHistory()).toHaveLength(1);
  });

  it('supports deterministic ordered emitAsync() and recursion protection (Finding 12)', async () => {
    const bus = new FoundationEventBus({ maxRecursionDepth: 3 });
    const order: string[] = [];

    bus.on(
      'auth.login.success',
      async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push('low-priority');
      },
      { priority: 1 }
    );

    bus.on(
      'auth.login.success',
      async () => {
        await new Promise((r) => setTimeout(r, 5));
        order.push('high-priority');
      },
      { priority: 10 }
    );

    const envelope = await bus.emitAsync('auth.login.success', { userId: 'usr_1' });
    expect(order).toEqual(['high-priority', 'low-priority']);
    expect(bus.claimFlowDispatch(envelope.id, 'flow.auth.after-login')).toBe(true);
    expect(bus.claimFlowDispatch(envelope.id, 'flow.auth.after-login')).toBe(false);

    // Recursion limit test
    bus.on('nav.reset', () => {
      bus.emit('nav.reset', {});
    });
    expect(() => bus.emit('nav.reset', {})).toThrow(/recursion depth limit/i);
  });

  it('redacts sensitive token and password fields in FoundationEventBus', () => {
    const bus = new FoundationEventBus();
    const envelope = bus.emit('auth.login.success', {
      userId: 'usr_1',
      accessToken: 'secret_jwt_123',
      refreshToken: 'secret_refresh_456',
      codeVerifier: 'secret_pkce_verifier',
      nested: {
        password: 'MyPlainPassword',
      },
    });

    expect(envelope.payload.userId).toBe('usr_1');
    expect(envelope.payload.accessToken).toBe('[REDACTED]');
    expect(envelope.payload.refreshToken).toBe('[REDACTED]');
    expect(envelope.payload.codeVerifier).toBe('[REDACTED]');
    expect((envelope.payload.nested as Record<string, unknown>).password).toBe(
      '[REDACTED]'
    );
  });
});
