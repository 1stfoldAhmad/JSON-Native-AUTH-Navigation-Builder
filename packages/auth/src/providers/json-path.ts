import { isValidJsonMappingExpression } from '@expo-foundation/core';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Evaluates a restricted JSON path expression of the form "$.data.access_token".
 * Rejects arbitrary expressions, function calls, or prototype traversal.
 */
export function extractByJsonPath<T = unknown>(source: unknown, expression: string): T | undefined {
  if (!isValidJsonMappingExpression(expression)) {
    throw new Error(
      `Unsafe or invalid JSON mapping expression "${expression}". Only restricted "$.field.subfield" expressions are allowed.`
    );
  }

  if (source === null || source === undefined || typeof source !== 'object') {
    return undefined;
  }

  const segments = expression.slice(2).split('.');
  let current: unknown = source;

  for (const segment of segments) {
    if (FORBIDDEN_KEYS.has(segment)) {
      throw new Error(`Forbidden property access "${segment}" in JSON path expression.`);
    }
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current as T;
}

/**
 * Resolves "${env.VAR_NAME}" placeholders against a supplied environment dictionary
 * without allowing arbitrary template execution.
 */
export function interpolateEnvString(
  template: string,
  env: Record<string, string | undefined> = {}
): string {
  return template.replace(/\$\{env\.([A-Z0-9_]+)\}/g, (_match, varName: string) => {
    const val = env[varName];
    return val !== undefined ? val : `https://api.example.com`;
  });
}

/**
 * Maps an input object according to a restricted field-mapping dictionary.
 */
export function mapRequestPayload(
  input: Record<string, unknown>,
  mapping?: Record<string, string>
): Record<string, unknown> {
  if (!mapping) {
    return { ...input };
  }
  const output: Record<string, unknown> = {};
  for (const [targetKey, sourceExpr] of Object.entries(mapping)) {
    if (FORBIDDEN_KEYS.has(targetKey)) {
      continue;
    }
    if (sourceExpr.startsWith('$.')) {
      output[targetKey] = extractByJsonPath(input, sourceExpr);
    } else if (Object.prototype.hasOwnProperty.call(input, sourceExpr)) {
      output[targetKey] = input[sourceExpr];
    }
  }
  return output;
}
