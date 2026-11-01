import type {
  AccessPolicy,
  NavigationIR,
  PlatformTarget,
  RouteDeepLinkConfig,
  RouteDefinition,
  RouteOptions,
  RouteParamSchema,
} from '@expo-foundation/core';

export interface RegisteredRoute {
  id: string;
  name: string;
  path: string;
  screenRef: string;
  navigatorId: string;
  params: Record<string, RouteParamSchema>;
  access: AccessPolicy;
  options: RouteOptions;
  deepLink: RouteDeepLinkConfig;
  platforms: PlatformTarget[];
}

export class RouteRegistry {
  private readonly routes = new Map<string, RegisteredRoute>();

  constructor(initialRoutes?: RouteDefinition[]) {
    if (initialRoutes) {
      for (const route of initialRoutes) {
        this.register(route);
      }
    }
  }

  static fromNavigationIR(navIR: NavigationIR): RouteRegistry {
    const registry = new RouteRegistry();
    for (const route of Object.values(navIR.routes)) {
      const mergedParams = {
        ...(navIR.routeParameters[route.id] ?? {}),
        ...(route.params ?? {}),
      };
      registry.register({
        ...route,
        params: mergedParams,
      });
    }
    return registry;
  }

  register(route: RouteDefinition): RegisteredRoute {
    const normalized: RegisteredRoute = {
      id: route.id,
      name: route.name ?? route.id,
      path: route.path.startsWith('/') ? route.path : `/${route.path}`,
      screenRef: route.screenRef,
      navigatorId: route.navigatorId ?? 'root.stack',
      params: route.params ?? {},
      access: route.access ?? 'public',
      options: route.options ?? {},
      deepLink: route.deepLink ?? { enabled: true },
      platforms: route.platforms ?? ['ios', 'android'],
    };
    this.routes.set(normalized.id, normalized);
    return normalized;
  }

  has(routeId: string): boolean {
    return this.routes.has(routeId);
  }

  getById(routeId: string): RegisteredRoute | undefined {
    return this.routes.get(routeId);
  }

  getByScreenRef(screenRef: string): RegisteredRoute[] {
    return Array.from(this.routes.values()).filter((r) => r.screenRef === screenRef);
  }

  listAll(platform?: PlatformTarget): RegisteredRoute[] {
    const all = Array.from(this.routes.values());
    if (!platform) return all;
    return all.filter((r) => r.platforms.includes(platform));
  }

  listByNavigator(navigatorId: string): RegisteredRoute[] {
    return Array.from(this.routes.values()).filter((r) => r.navigatorId === navigatorId);
  }
}
