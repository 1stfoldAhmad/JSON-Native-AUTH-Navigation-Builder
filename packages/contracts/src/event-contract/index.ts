/**
 * @expo-foundation/contracts - Event Contract
 *
 * Canonical event types and sanitized event bus for Auth, Navigation, and Integration engines.
 * Strictly redacts tokens and credentials from event payloads and logs.
 */

export type AuthLifecycleEventName =
  | 'auth.session.restoring'
  | 'auth.session.restored'
  | 'auth.login.success'
  | 'auth.registration.completed'
  | 'auth.verification.required'
  | 'auth.session.expired'
  | 'auth.logout.success'
  | 'auth.access.changed'
  | 'auth.account.suspended'
  | 'auth.error';

export type NavigationLifecycleEventName =
  | 'nav.route.willChange'
  | 'nav.route.didChange'
  | 'nav.guard.blocked'
  | 'nav.deeplink.received'
  | 'nav.deeplink.deferred'
  | 'nav.deeplink.restored'
  | 'nav.reset';

export type FoundationEventName = AuthLifecycleEventName | NavigationLifecycleEventName | string;

export interface FoundationEventEnvelope<T = Record<string, unknown>> {
  id: string;
  event: FoundationEventName;
  timestamp: string;
  source: 'auth' | 'navigation' | 'integration' | 'external';
  payload: T;
  flowRef?: string;
}

export type FoundationEventListener<T = Record<string, unknown>> = (
  envelope: FoundationEventEnvelope<T>
) => void | Promise<void>;

const SENSITIVE_FIELD_NAMES = new Set([
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'idtoken',
  'id_token',
  'password',
  'newpassword',
  'clientsecret',
  'client_secret',
  'secret',
  'privatekey',
  'private_key',
  'authorization',
  'token',
  'codeverifier',
  'code_verifier',
]);

export function sanitizeEventPayload<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeEventPayload(item)) as unknown as T;
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_FIELD_NAMES.has(key.toLowerCase())) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = sanitizeEventPayload(val);
      }
    }
    return output as T;
  }
  return value;
}

export class FoundationEventBus {
  private readonly listeners = new Map<string, Set<FoundationEventListener>>();
  private readonly wildcardListeners = new Set<FoundationEventListener>();
  private readonly history: FoundationEventEnvelope[] = [];
  private readonly maxHistory: number;
  private counter = 0;

  constructor(options?: { maxHistory?: number }) {
    this.maxHistory = options?.maxHistory ?? 250;
  }

  on<T = Record<string, unknown>>(
    event: FoundationEventName | '*',
    listener: FoundationEventListener<T>
  ): () => void {
    if (event === '*') {
      this.wildcardListeners.add(listener as FoundationEventListener);
      return () => {
        this.wildcardListeners.delete(listener as FoundationEventListener);
      };
    }
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as FoundationEventListener);
    return () => {
      set?.delete(listener as FoundationEventListener);
    };
  }

  emit<T = Record<string, unknown>>(
    event: FoundationEventName,
    payload: T,
    options?: {
      source?: 'auth' | 'navigation' | 'integration' | 'external';
      flowRef?: string;
    }
  ): FoundationEventEnvelope<T> {
    this.counter += 1;
    const sanitized = sanitizeEventPayload(payload);
    const envelope: FoundationEventEnvelope<T> = {
      id: `evt_${this.counter}_${Date.now()}`,
      event,
      timestamp: new Date().toISOString(),
      source: options?.source ?? 'external',
      payload: sanitized,
      flowRef: options?.flowRef,
    };

    this.history.push(envelope as FoundationEventEnvelope);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    const specific = this.listeners.get(event);
    if (specific) {
      for (const listener of specific) {
        listener(envelope as FoundationEventEnvelope);
      }
    }
    for (const listener of this.wildcardListeners) {
      listener(envelope as FoundationEventEnvelope);
    }

    return envelope;
  }

  getHistory(): readonly FoundationEventEnvelope[] {
    return this.history;
  }

  clearHistory(): void {
    this.history.length = 0;
  }
}
