import type {
  NavigationConfigDocument,
  NavigationIR,
  NavigatorDefinition,
  RouteDefinition,
} from '@expo-foundation/core';

export interface GraphHierarchyNode {
  id: string;
  kind: 'navigator' | 'route';
  navigatorType?: NavigatorDefinition['type'];
  routePath?: string;
  screenRef?: string;
  access?: RouteDefinition['access'];
  parentId: string | null;
  children: GraphHierarchyNode[];
}

export class NavigationGraphEngine {
  private readonly rootNavigatorId: string;
  private readonly navigators = new Map<string, NavigatorDefinition>();
  private readonly routes = new Map<string, RouteDefinition>();
  private readonly parentOf = new Map<string, string | null>();

  constructor(config: {
    rootNavigator: string;
    navigators: NavigatorDefinition[];
    routes: RouteDefinition[];
  }) {
    this.rootNavigatorId = config.rootNavigator;
    for (const nav of config.navigators) {
      this.navigators.set(nav.id, nav);
    }
    for (const route of config.routes) {
      this.routes.set(route.id, route);
    }
    this.buildParentLinks();
  }

  static fromDocument(doc: NavigationConfigDocument): NavigationGraphEngine {
    return new NavigationGraphEngine({
      rootNavigator: doc.rootNavigator,
      navigators: doc.navigators,
      routes: doc.routes,
    });
  }

  static fromNavigationIR(ir: NavigationIR): NavigationGraphEngine {
    return new NavigationGraphEngine({
      rootNavigator: ir.rootNavigatorId,
      navigators: Object.values(ir.navigators),
      routes: Object.values(ir.routes),
    });
  }

  private buildParentLinks(): void {
    this.parentOf.set(this.rootNavigatorId, null);
    for (const nav of this.navigators.values()) {
      for (const childId of nav.children) {
        this.parentOf.set(childId, nav.id);
      }
    }
  }

  getRootNavigator(): NavigatorDefinition | undefined {
    return this.navigators.get(this.rootNavigatorId);
  }

  getNavigator(navigatorId: string): NavigatorDefinition | undefined {
    return this.navigators.get(navigatorId);
  }

  getRoute(routeId: string): RouteDefinition | undefined {
    return this.routes.get(routeId);
  }

  getParentNavigatorId(nodeId: string): string | null {
    return this.parentOf.get(nodeId) ?? this.routes.get(nodeId)?.navigatorId ?? null;
  }

  getAncestorChain(nodeId: string): string[] {
    const chain: string[] = [];
    let current: string | null = nodeId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      chain.unshift(current);
      current = this.getParentNavigatorId(current);
    }
    return chain;
  }

  resolveInitialRouteId(navigatorId = this.rootNavigatorId): string | undefined {
    const visited = new Set<string>();
    let currentId: string | undefined = navigatorId;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      if (this.routes.has(currentId)) {
        return currentId;
      }
      const nav = this.navigators.get(currentId);
      if (!nav) return undefined;
      if (nav.type === 'tabs' && nav.tabsOptions?.initialTab) {
        currentId = nav.tabsOptions.initialTab;
      } else if (nav.initialRoute) {
        currentId = nav.initialRoute;
      } else {
        currentId = nav.children[0];
      }
    }

    return undefined;
  }

  toTree(nodeId = this.rootNavigatorId, visited = new Set<string>()): GraphHierarchyNode | null {
    if (visited.has(nodeId)) {
      return null;
    }
    visited.add(nodeId);

    const route = this.routes.get(nodeId);
    if (route) {
      return {
        id: route.id,
        kind: 'route',
        routePath: route.path,
        screenRef: route.screenRef,
        access: route.access ?? 'public',
        parentId: this.getParentNavigatorId(route.id),
        children: [],
      };
    }

    const nav = this.navigators.get(nodeId);
    if (!nav) {
      return null;
    }

    const children: GraphHierarchyNode[] = [];
    for (const childId of nav.children) {
      const childNode = this.toTree(childId, new Set(visited));
      if (childNode) {
        children.push(childNode);
      }
    }

    return {
      id: nav.id,
      kind: 'navigator',
      navigatorType: nav.type,
      parentId: this.getParentNavigatorId(nav.id),
      children,
    };
  }
}
