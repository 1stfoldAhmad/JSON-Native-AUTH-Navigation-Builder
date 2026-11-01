/**
 * @expo-foundation/contracts - Screen Reference Contract
 *
 * Defines the strict boundary between Auth/Navigation Builders and external Screen implementations.
 * Screen references contain stable identifiers and parameter schema metadata only —
 * NEVER component trees, styles, layouts, or form definitions.
 */

export type ScreenComponentType<Props = Record<string, unknown>> = (props: Props) => unknown;

export interface ScreenReference {
  /** Stable identifier e.g. "screen.auth.login", "screen.app.home" */
  id: string;
  /** Optional reference to a typed parameter schema */
  paramsSchema?: string;
  /** Whether the screen must be registered for production validation to pass */
  required?: boolean;
  /** Optional human-readable description for diagnostics */
  description?: string;
}

export interface ScreenMetadata {
  id: string;
  title?: string;
  paramsSchema?: Record<string, unknown>;
  required?: boolean;
  tags?: string[];
}

export interface ScreenRegistry {
  has(screenId: string): boolean;
  resolve(screenId: string): ScreenComponentType | undefined;
  getMetadata(screenId: string): ScreenMetadata | undefined;
  register(
    screenId: string,
    component: ScreenComponentType,
    metadata?: Omit<ScreenMetadata, 'id'>
  ): void;
  unregister(screenId: string): boolean;
  list(): string[];
}

export const SCREEN_ID_REGEX = /^screen\.[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$/;

const FORBIDDEN_LAYOUT_KEYS = new Set([
  'children',
  'components',
  'layout',
  'styles',
  'styleSheet',
  'formFields',
  'widgets',
  'jsx',
  'template',
]);

export function isValidScreenId(screenId: string): boolean {
  return typeof screenId === 'string' && SCREEN_ID_REGEX.test(screenId.trim());
}

export function validateScreenReferenceObject(ref: unknown): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
    return { valid: false, errors: ['ScreenReference must be a non-null object.'] };
  }
  const record = ref as Record<string, unknown>;
  if (typeof record.id !== 'string' || !isValidScreenId(record.id)) {
    errors.push(
      `Invalid screen reference ID "${String(record.id)}". Expected format "screen.<domain>.<name>".`
    );
  }
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_LAYOUT_KEYS.has(key)) {
      errors.push(
        `Forbidden UI/layout property "${key}" found in ScreenReference "${String(
          record.id
        )}". Screen references must not contain UI layouts or component definitions.`
      );
    }
  }
  return { valid: errors.length === 0, errors };
}

export class InMemoryScreenRegistry implements ScreenRegistry {
  private readonly components = new Map<string, ScreenComponentType>();
  private readonly metadata = new Map<string, ScreenMetadata>();

  has(screenId: string): boolean {
    return this.components.has(screenId);
  }

  resolve(screenId: string): ScreenComponentType | undefined {
    return this.components.get(screenId);
  }

  getMetadata(screenId: string): ScreenMetadata | undefined {
    return this.metadata.get(screenId);
  }

  register(
    screenId: string,
    component: ScreenComponentType,
    metadata?: Omit<ScreenMetadata, 'id'>
  ): void {
    if (!isValidScreenId(screenId)) {
      throw new Error(
        `Cannot register invalid screenId "${screenId}". Expected format "screen.<domain>.<name>".`
      );
    }
    this.components.set(screenId, component);
    this.metadata.set(screenId, {
      id: screenId,
      ...metadata,
    });
  }

  unregister(screenId: string): boolean {
    this.metadata.delete(screenId);
    return this.components.delete(screenId);
  }

  list(): string[] {
    return Array.from(this.components.keys());
  }
}
