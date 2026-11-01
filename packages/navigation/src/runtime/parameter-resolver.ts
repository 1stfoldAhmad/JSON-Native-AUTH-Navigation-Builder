import type { RouteParamSchema } from '@expo-foundation/core';
import type { RegisteredRoute } from '../route-registry/index.js';

export interface ParameterResolutionResult {
  valid: boolean;
  params: Record<string, unknown>;
  errors: string[];
}

export class ParameterResolver {
  /**
   * Matches a concrete URL path (e.g. "/orders/ORD-1024?tab=items") against a route pattern
   * (e.g. "/orders/:orderId") and extracts raw path & query parameters.
   */
  matchPath(
    routePattern: string,
    concreteUrlOrPath: string
  ): { matched: boolean; rawParams: Record<string, string> } {
    const [pathname, queryString] = concreteUrlOrPath.split('?');
    const cleanPattern = routePattern.replace(/\/+$/, '') || '/';
    const cleanPath = (pathname || '/').replace(/\/+$/, '') || '/';

    const patternSegments = cleanPattern.split('/').filter(Boolean);
    const pathSegments = cleanPath.split('/').filter(Boolean);

    if (patternSegments.length !== pathSegments.length) {
      return { matched: false, rawParams: {} };
    }

    const rawParams: Record<string, string> = {};

    for (let i = 0; i < patternSegments.length; i++) {
      const patSeg = patternSegments[i];
      const pathSeg = pathSegments[i];
      if (patSeg.startsWith(':')) {
        const paramName = patSeg.slice(1);
        rawParams[paramName] = decodeURIComponent(pathSeg);
      } else if (patSeg !== pathSeg) {
        return { matched: false, rawParams: {} };
      }
    }

    if (queryString) {
      const searchParams = new URLSearchParams(queryString);
      for (const [key, val] of searchParams.entries()) {
        if (!(key in rawParams)) {
          rawParams[key] = val;
        }
      }
    }

    return { matched: true, rawParams };
  }

  /**
   * Validates and coerces parameters against the route's parameter schema.
   */
  validateAndCoerce(
    schemaMap: Record<string, RouteParamSchema>,
    inputParams: Record<string, unknown> = {}
  ): ParameterResolutionResult {
    const errors: string[] = [];
    const resolved: Record<string, unknown> = { ...inputParams };

    for (const [paramName, schema] of Object.entries(schemaMap)) {
      const rawValue = inputParams[paramName];

      if (rawValue === undefined || rawValue === null || rawValue === '') {
        if (schema.default !== undefined) {
          resolved[paramName] = schema.default;
          continue;
        }
        if (schema.required !== false) {
          errors.push(`Missing required route parameter "${paramName}".`);
        }
        continue;
      }

      switch (schema.type) {
        case 'string': {
          resolved[paramName] = String(rawValue);
          break;
        }
        case 'number': {
          const num = typeof rawValue === 'number' ? rawValue : Number(rawValue);
          if (Number.isNaN(num)) {
            errors.push(`Parameter "${paramName}" must be a valid number; received "${String(rawValue)}".`);
          } else {
            resolved[paramName] = num;
          }
          break;
        }
        case 'boolean': {
          if (typeof rawValue === 'boolean') {
            resolved[paramName] = rawValue;
          } else if (rawValue === 'true' || rawValue === '1') {
            resolved[paramName] = true;
          } else if (rawValue === 'false' || rawValue === '0') {
            resolved[paramName] = false;
          } else {
            errors.push(`Parameter "${paramName}" must be a boolean; received "${String(rawValue)}".`);
          }
          break;
        }
        case 'enum': {
          const strVal = String(rawValue);
          if (schema.enumValues && !schema.enumValues.includes(strVal)) {
            errors.push(
              `Parameter "${paramName}" must be one of [${schema.enumValues.join(', ')}]; received "${strVal}".`
            );
          } else {
            resolved[paramName] = strVal;
          }
          break;
        }
      }
    }

    return {
      valid: errors.length === 0,
      params: resolved,
      errors,
    };
  }

  /**
   * Serializes a route definition and typed parameters into a concrete URL path.
   */
  buildPath(route: Pick<RegisteredRoute, 'path' | 'params'>, params: Record<string, unknown> = {}): string {
    const validation = this.validateAndCoerce(route.params, params);
    if (!validation.valid) {
      throw new Error(`Invalid route parameters for "${route.path}": ${validation.errors.join(' ')}`);
    }

    const usedInPath = new Set<string>();
    const pathname = route.path.replace(/:([a-zA-Z0-9_]+)/g, (_match, paramName: string) => {
      usedInPath.add(paramName);
      const val = validation.params[paramName];
      if (val === undefined || val === null) {
        throw new Error(`Missing required path parameter ":${paramName}" for "${route.path}".`);
      }
      return encodeURIComponent(String(val));
    });

    const queryEntries: string[] = [];
    for (const [key, val] of Object.entries(validation.params)) {
      if (usedInPath.has(key) || val === undefined || val === null) {
        continue;
      }
      queryEntries.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
    }

    return queryEntries.length > 0 ? `${pathname}?${queryEntries.join('&')}` : pathname;
  }
}

export const defaultParameterResolver = new ParameterResolver();
