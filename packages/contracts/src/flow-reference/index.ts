/**
 * @expo-foundation/contracts - Flow Reference Contract
 *
 * Allows Auth and Navigation Builders to emit event references targeting external
 * business-logic workflows owned by the future Flow & Business Logic Builder.
 */

export interface FlowReference {
  /** Stable identifier e.g. "flow.auth.after-login", "flow.registration.initialize" */
  id?: string;
  flowRef: string;
  /** Associated lifecycle event name */
  event?: string;
  /** Optional input mapping from event payload keys to flow input parameters */
  inputMapping?: Record<string, string>;
  /** Optional description for builder diagnostics */
  description?: string;
  /** Whether the caller awaits completion or dispatches asynchronously */
  async?: boolean;
}

export interface FlowExecutionContext {
  flowRef: string;
  triggerEvent: string;
  eventId?: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export type FlowHandler = (context: FlowExecutionContext) => Promise<void> | void;

export interface FlowRegistry {
  has(flowRef: string): boolean;
  register(flowRef: string, handler: FlowHandler): void;
  unregister(flowRef: string): boolean;
  dispatch(
    flowRef: string,
    triggerEvent: string,
    payload?: Record<string, unknown>,
    eventId?: string
  ): Promise<boolean>;
  list(): string[];
}

export const FLOW_ID_REGEX = /^flow\.[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$/;

export function isValidFlowId(flowRef: string): boolean {
  return typeof flowRef === 'string' && FLOW_ID_REGEX.test(flowRef.trim());
}

export class InMemoryFlowRegistry implements FlowRegistry {
  private readonly handlers = new Map<string, FlowHandler>();
  private readonly executionLog: FlowExecutionContext[] = [];
  private readonly executedEventFlows = new Set<string>();

  has(flowRef: string): boolean {
    return this.handlers.has(flowRef);
  }

  register(flowRef: string, handler: FlowHandler): void {
    if (!isValidFlowId(flowRef)) {
      throw new Error(
        `Invalid flowRef "${flowRef}". Expected format "flow.<domain>.<action>".`
      );
    }
    this.handlers.set(flowRef, handler);
  }

  unregister(flowRef: string): boolean {
    return this.handlers.delete(flowRef);
  }

  async dispatch(
    flowRef: string,
    triggerEvent: string,
    payload: Record<string, unknown> = {},
    eventId?: string
  ): Promise<boolean> {
    if (eventId) {
      const dedupeKey = `${eventId}::${flowRef}`;
      if (this.executedEventFlows.has(dedupeKey)) {
        return false;
      }
      this.executedEventFlows.add(dedupeKey);
    }

    const context: FlowExecutionContext = {
      flowRef,
      triggerEvent,
      eventId,
      timestamp: new Date().toISOString(),
      payload,
    };
    this.executionLog.push(context);
    const handler = this.handlers.get(flowRef);
    if (!handler) {
      return false;
    }
    await handler(context);
    return true;
  }

  list(): string[] {
    return Array.from(this.handlers.keys());
  }

  getExecutionHistory(): readonly FlowExecutionContext[] {
    return this.executionLog;
  }
}
