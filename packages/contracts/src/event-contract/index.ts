/**
 * @expo-foundation/contracts - Event Contract
 *
 * Canonical event types and deterministic sanitized event bus for Auth, Navigation,
 * and Integration engines.
 *
 * Features (Audit Finding 12 & Section 14.7 / 15):
 * - Synchronous `emit()` and deterministic ordered `emitAsync()`
 * - Listener priority ordering
 * - Recursive loop / cycle protection (`maxRecursionDepth`)
 * - Single-owner flow dispatch deduplication per event ID
 * - Automatic redaction of raw tokens, passwords, and secrets
 */

export type AuthLifecycleEventName =
  | 'auth.session.restoring'
  | 'auth.session.restored'
  | 'auth.login.started'
  | 'auth.login.success'
  | 'auth.login.failed'
  | 'auth.registration.started'
  | 'auth.registration.completed'
  | 'auth.verification.required'
  | 'auth.challenge.required'
  | 'auth.session.refreshed'
  | 'auth.session.expired'
  | 'auth.logout.started'
  | 'auth.logout.success'
  | 'auth.account.suspended'
  | 'auth.access.changed'
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

interface RegisteredListener {
  listener: FoundationEventListener;
  priority: number;
  order: number;
}

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
  private readonly listeners = new Map<string, RegisteredListener[]>();
  private readonly wildcardListeners: RegisteredListener[] = [];
  private readonly history: FoundationEventEnvelope[] = [];
  private readonly dispatchedFlowsByEvent = new Set<string>();
  private readonly maxHistory: number;
  private readonly maxRecursionDepth: number;
  private currentRecursionDepth = 0;
  private counter = 0;
  private registrationOrder = 0;

  constructor(options?: { maxHistory?: number; maxRecursionDepth?: number }) {
    this.maxHistory = options?.maxHistory ?? 250;
    this.maxRecursionDepth = options?.maxRecursionDepth ?? 8;
  }

  on<T = Record<string, unknown>>(
    event: FoundationEventName | '*',
    listener: FoundationEventListener<T>,
    options?: { priority?: number }
  ): () => void {
    this.registrationOrder += 1;
    const entry: RegisteredListener = {
      listener: listener as FoundationEventListener,
      priority: options?.priority ?? 0,
      order: this.registrationOrder,
    };

    const sortEntries = (list: RegisteredListener[]) => {
      list.sort((a, b) =>
        b.priority !== a.priority ? b.priority - a.priority : a.order - b.order
      );
    };

    if (event === '*') {
      this.wildcardListeners.push(entry);
      sortEntries(this.wildcardListeners);
      return () => {
        const idx = this.wildcardListeners.indexOf(entry);
        if (idx >= 0) this.wildcardListeners.splice(idx, 1);
      };
    }

    let list = this.listeners.get(event);
    if (!list) {
      list = [];
      this.listeners.set(event, list);
    }
    list.push(entry);
    sortEntries(list);
    return () => {
      const targetList = this.listeners.get(event);
      if (!targetList) return;
      const idx = targetList.indexOf(entry);
      if (idx >= 0) targetList.splice(idx, 1);
    };
  }

  /**
   * Ensures a flowRef associated with a given event envelope is dispatched at most once,
   * preventing duplicate execution across AuthController and AuthNavigationCoordinator.
   */
  claimFlowDispatch(eventId: string, flowRef: string): boolean {
    const key = `${eventId}::${flowRef}`;
    if (this.dispatchedFlowsByEvent.has(key)) {
      return false;
    }
    this.dispatchedFlowsByEvent.add(key);
    return true;
  }

  private createEnvelope<T>(
    event: FoundationEventName,
    payload: T,
    options?: {
      source?: 'auth' | 'navigation' | 'integration' | 'external';
      flowRef?: string;
    }
  ): FoundationEventEnvelope<T> {
    if (this.currentRecursionDepth >= this.maxRecursionDepth) {
      throw new Error(
        `Event loop recursion depth limit (${this.maxRecursionDepth}) exceeded while emitting "${event}".`
      );
    }

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
    return envelope;
  }

  emit<T = Record<string, unknown>>(
    event: FoundationEventName,
    payload: T,
    options?: {
      source?: 'auth' | 'navigation' | 'integration' | 'external';
      flowRef?: string;
    }
  ): FoundationEventEnvelope<T> {
    const envelope = this.createEnvelope(event, payload, options);
    this.currentRecursionDepth += 1;
    try {
      const specific = [...(this.listeners.get(event) ?? [])];
      for (const entry of specific) {
        entry.listener(envelope as FoundationEventEnvelope);
      }
      const wildcards = [...this.wildcardListeners];
      for (const entry of wildcards) {
        entry.listener(envelope as FoundationEventEnvelope);
      }
      return envelope;
    } finally {
      this.currentRecursionDepth -= 1;
    }
  }

  /**
   * Deterministic ordered asynchronous emission that awaits each registered listener
   * in priority/registration order before returning to the caller.
   */
  async emitAsync<T = Record<string, unknown>>(
    event: FoundationEventName,
    payload: T,
    options?: {
      source?: 'auth' | 'navigation' | 'integration' | 'external';
      flowRef?: string;
    }
  ): Promise<FoundationEventEnvelope<T>> {
    const envelope = this.createEnvelope(event, payload, options);
    this.currentRecursionDepth += 1;
    try {
      const specific = [...(this.listeners.get(event) ?? [])];
      for (const entry of specific) {
        await entry.listener(envelope as FoundationEventEnvelope);
      }
      const wildcards = [...this.wildcardListeners];
      for (const entry of wildcards) {
        await entry.listener(envelope as FoundationEventEnvelope);
      }
      return envelope;
    } finally {
      this.currentRecursionDepth -= 1;
    }
  }

  getHistory(): readonly FoundationEventEnvelope[] {
    return this.history;
  }

  clearHistory(): void {
    this.history.length = 0;
    this.dispatchedFlowsByEvent.clear();
  }
}
