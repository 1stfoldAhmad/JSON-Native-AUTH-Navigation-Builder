/**
 * @expo-foundation/navigation - Route Registry & Typed Parameter Codec
 *
 * Implements Section 5.2 & Section 12.4:
 * - Route registration and lookup by ID or path pattern
 * - Dynamic path segment parsing (e.g. "/orders/:orderId")
 * - Parameter validation, default values, scalar coercion (string, number, boolean,
 *   enum, date, uuid, custom-scalar, array), and URL serialization
 */

import type { NavigationIR, RouteIR, RouteParamSchema } from '@expo-foundation/core';

export interface MatchedRouteResult {
  route: RouteIR;
  params: Record<string, unknown>;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class RouteRegistry {
  private readonly routesById = new Map<string, RouteIR>();
  private readonly routeOrder: string[] = [];

  constructor(navigationIR: NavigationIR) {
    this.routeOrder = [...navigationIR.routeOrder];
    for (const [id, route] of Object.entries(navigationIR.routes)) {
      this.routesById.set(id, route);
    }
  }

  has(routeId: string): boolean {
    return this.routesById.has(routeId);
  }

  get(routeId: string): RouteIR {
    const route = this.routesById.get(routeId);
    if (!route) {
      throw new Error(`Route "${routeId}" does not exist in RouteRegistry.`);
    }
    return route;
  }

  list(): RouteIR[] {
    return this.routeOrder
      .map((id) => this.routesById.get(id))
      .filter((r): r is RouteIR => Boolean(r));
  }

  /**
   * Validates and coerces route parameters against the route's parameter schema.
   */
  validateAndNormalizeParams(
    routeId: string,
    rawParams: Record<string, unknown> = {}
  ): Record<string, unknown> {
    const route = this.get(routeId);
    const normalized: Record<string, unknown> = { ...rawParams };

    for (const [paramName, schema] of Object.entries(route.params)) {
      let value = rawParams[paramName];

      if (value === undefined || value === null || value === '') {
        if (schema.default !== undefined) {
          value = schema.default;
          normalized[paramName] = value;
        } else if (schema.required) {
          throw new Error(
            `Missing required parameter "${paramName}" for route "${routeId}".`
          );
        } else {
          continue;
        }
      }

      normalized[paramName] = this.coerceParamValue(routeId, paramName, value, schema);
    }

    return normalized;
  }

  private coerceParamValue(
    routeId: string,
    paramName: string,
    value: unknown,
    schema: RouteParamSchema
  ): unknown {
    switch (schema.type) {
      case 'string': {
        const strVal = String(value);
        if (schema.pattern && !new RegExp(schema.pattern).test(strVal)) {
          throw new Error(
            `Parameter "${paramName}" on route "${routeId}" does not match pattern "${schema.pattern}".`
          );
        }
        return strVal;
      }
      case 'uuid': {
        const strVal = String(value);
        if (!UUID_REGEX.test(strVal)) {
          throw new Error(
            `Parameter "${paramName}" on route "${routeId}" must be a valid UUID.`
          );
        }
        return strVal;
      }
      case 'date': {
        const strVal = value instanceof Date ? value.toISOString() : String(value);
        const parsed = Date.parse(strVal);
        if (Number.isNaN(parsed)) {
          throw new Error(
            `Parameter "${paramName}" on route "${routeId}" must be a valid ISO date string.`
          );
        }
        return new Date(parsed).toISOString();
      }
      case 'custom-scalar': {
        const strVal = String(value);
        if (schema.pattern && !new RegExp(schema.pattern).test(strVal)) {
          throw new Error(
            `Parameter "${paramName}" on route "${routeId}" failed custom scalar pattern "${schema.pattern}".`
          );
        }
        return strVal;
      }
      case 'number': {
        const num = typeof value === 'number' ? value : Number(value);
        if (Number.isNaN(num)) {
          throw new Error(
            `Parameter "${paramName}" on route "${routeId}" must be a valid number, received "${String(value)}".`
          );
        }
        return num;
      }
      case 'boolean': {
        if (typeof value === 'boolean') return value;
        if (value === 'true' || value === '1') return true;
        if (value === 'false' || value === '0') return false;
        throw new Error(
          `Parameter "${paramName}" on route "${routeId}" must be a boolean, received "${String(value)}".`
        );
      }
      case 'enum': {
        const strVal = String(value);
        if (schema.enumValues && !schema.enumValues.includes(strVal)) {
          throw new Error(
            `Parameter "${paramName}" on route "${routeId}" must be one of [${schema.enumValues.join(', ')}], received "${strVal}".`
          );
        }
        return strVal;
      }
      case 'array': {
        const rawItems = Array.isArray(value)
          ? value
          : typeof value === 'string'
            ? value.split(',').filter(Boolean)
            : [value];
        const itemType = schema.itemType ?? 'string';
        return rawItems.map((item) => {
          if (itemType === 'number') {
            const num = Number(item);
            if (Number.isNaN(num)) {
              throw new Error(
                `Array parameter "${paramName}" on route "${routeId}" requires numeric items.`
              );
            }
            return num;
          }
          if (itemType === 'boolean') {
            return item === true || item === 'true' || item === '1';
          }
          return String(item);
        });
      }
      default:
        return value;
    }
  }

  /**
   * Builds a concrete URL path from a route ID and parameter map.
   */
  buildPath(routeId: string, params: Record<string, unknown> = {}): string {
    const route = this.get(routeId);
    const validatedParams = this.validateAndNormalizeParams(routeId, params);

    const usedParams = new Set<string>();
    const concretePath = route.normalizedPath.replace(
      /:([a-zA-Z0-9_]+)/g,
      (_match, paramName: string) => {
        usedParams.add(paramName);
        const val = validatedParams[paramName];
        if (val === undefined) {
          throw new Error(
            `Missing path parameter ":${paramName}" when building path for route "${routeId}".`
          );
        }
        return encodeURIComponent(String(val));
      }
    );

    const queryEntries: string[] = [];
    for (const [key, val] of Object.entries(validatedParams)) {
      if (usedParams.has(key) || val === undefined || val === null) {
        continue;
      }
      if (Array.isArray(val)) {
        queryEntries.push(
          `${encodeURIComponent(key)}=${encodeURIComponent(val.join(','))}`
        );
      } else {
        queryEntries.push(
          `${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`
        );
      }
    }

    if (queryEntries.length > 0) {
      return `${concretePath}?${queryEntries.join('&')}`;
    }
    return concretePath;
  }

  /**
   * Matches an incoming path (with optional query string) against registered routes
   * and aliases, extracting and validating parameters.
   */
  matchPath(rawPathWithQuery: string): MatchedRouteResult | null {
    const [rawPathname = '/', rawQuery = ''] = rawPathWithQuery.split('?');
    const pathname = rawPathname.startsWith('/') ? rawPathname : `/${rawPathname}`;

    const queryParams: Record<string, unknown> = {};
    if (rawQuery) {
      const searchParams = new URLSearchParams(rawQuery);
      for (const [k, v] of searchParams.entries()) {
        queryParams[k] = v;
      }
    }

    for (const route of this.list()) {
      const candidatePatterns = [
        route.normalizedPath,
        ...(route.deepLink.aliases ?? []).map((a) => (a.startsWith('/') ? a : `/${a}`)),
      ];

      for (const pattern of candidatePatterns) {
        const extracted = this.tryMatchPattern(pattern, pathname);
        if (extracted) {
          const merged = { ...queryParams, ...extracted };
          const validated = this.validateAndNormalizeParams(route.id, merged);
          return {
            route,
            params: validated,
          };
        }
      }
    }

    return null;
  }

  private tryMatchPattern(
    pattern: string,
    pathname: string
  ): Record<string, string> | null {
    const patternSegments = pattern.split('/').filter(Boolean);
    const pathSegments = pathname.split('/').filter(Boolean);

    if (patternSegments.length !== pathSegments.length) {
      return null;
    }

    const extracted: Record<string, string> = {};
    for (let i = 0; i < patternSegments.length; i += 1) {
      const pat = patternSegments[i];
      const seg = pathSegments[i];

      if (pat.startsWith(':')) {
        const paramName = pat.slice(1);
        extracted[paramName] = decodeURIComponent(seg);
      } else if (pat !== seg) {
        return null;
      }
    }

    return extracted;
  }
}
