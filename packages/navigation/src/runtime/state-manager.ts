import { FoundationEventBus } from '@expo-foundation/contracts';
import type { NavigationIR } from '@expo-foundation/core';
import { NavigationGraphEngine } from '../graph/index.js';
import { RouteRegistry } from '../route-registry/index.js';
import {
  defaultParameterResolver,
  ParameterResolver,
} from './parameter-resolver.js';

export interface NavigationHistoryEntry {
  key: string;
  routeId: string;
  navigatorId: string;
  params: Record<string, unknown>;
  timestamp: number;
}

export interface NavigationState {
  activeNavigatorId: string;
  activeRouteId: string;
  params?: Record<string, unknown>;
  history: NavigationHistoryEntry[];
  selectedTab?: string;
  modalStack: string[];
  tabStacks: Record<string, NavigationHistoryEntry[]>;
}

export interface NavigationStateManagerOptions {
  navigationIR: NavigationIR;
  eventBus?: FoundationEventBus;
  parameterResolver?: ParameterResolver;
}

export class NavigationStateManager {
  readonly navigationIR: NavigationIR;
  readonly registry: RouteRegistry;
  readonly graph: NavigationGraphEngine;
  readonly eventBus: FoundationEventBus;
  readonly parameterResolver: ParameterResolver;

  private state: NavigationState;
  private readonly listeners = new Set<(state: NavigationState) => void>();
  private keyCounter = 0;

  constructor(options: NavigationStateManagerOptions) {
    this.navigationIR = options.navigationIR;
    this.registry = RouteRegistry.fromNavigationIR(options.navigationIR);
    this.graph = NavigationGraphEngine.fromNavigationIR(options.navigationIR);
    this.eventBus = options.eventBus ?? new FoundationEventBus();
    this.parameterResolver = options.parameterResolver ?? defaultParameterResolver;

    const initialRouteId =
      this.graph.resolveInitialRouteId(options.navigationIR.rootNavigatorId) ??
      Object.keys(options.navigationIR.routes)[0] ??
      'root';
    const initialRoute = this.registry.getById(initialRouteId);
    const activeNavigatorId =
      initialRoute?.navigatorId ?? options.navigationIR.rootNavigatorId;

    const firstEntry = this.createEntry(initialRouteId, activeNavigatorId, {});
    this.state = {
      activeNavigatorId,
      activeRouteId: initialRouteId,
      params: {},
      history: [firstEntry],
      selectedTab: undefined,
      modalStack: [],
      tabStacks: {},
    };
  }

  private createEntry(
    routeId: string,
    navigatorId: string,
    params: Record<string, unknown>
  ): NavigationHistoryEntry {
    this.keyCounter += 1;
    return {
      key: `nav_${routeId}_${this.keyCounter}`,
      routeId,
      navigatorId,
      params: { ...params },
      timestamp: Date.now(),
    };
  }

  private notify(): NavigationState {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
    return snapshot;
  }

  getState(): NavigationState {
    return structuredClone(this.state);
  }

  subscribe(listener: (state: NavigationState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  navigate(routeId: string, rawParams: Record<string, unknown> = {}): NavigationState {
    return this.push(routeId, rawParams);
  }

  push(routeId: string, rawParams: Record<string, unknown> = {}): NavigationState {
    const route = this.registry.getById(routeId);
    if (!route) {
      throw new Error(`Unknown routeId "${routeId}".`);
    }

    const validation = this.parameterResolver.validateAndCoerce(route.params, rawParams);
    if (!validation.valid) {
      throw new Error(
        `Invalid parameters for route "${routeId}": ${validation.errors.join(' ')}`
      );
    }

    const previousRouteId = this.state.activeRouteId;
    this.eventBus.emit(
      'nav.route.willChange',
      {
        fromRouteId: previousRouteId,
        toRouteId: routeId,
        params: validation.params,
      },
      { source: 'navigation' }
    );

    const entry = this.createEntry(routeId, route.navigatorId, validation.params);
    const history = [...this.state.history, entry];

    const tabStacks = { ...this.state.tabStacks };
    if (this.state.selectedTab) {
      const currentTabHistory = tabStacks[this.state.selectedTab] ?? [];
      tabStacks[this.state.selectedTab] = [...currentTabHistory, entry];
    }

    this.state = {
      ...this.state,
      activeNavigatorId: route.navigatorId,
      activeRouteId: routeId,
      params: validation.params,
      history,
      tabStacks,
    };

    this.eventBus.emit(
      'nav.route.didChange',
      {
        fromRouteId: previousRouteId,
        toRouteId: routeId,
        params: validation.params,
      },
      { source: 'navigation' }
    );

    return this.notify();
  }

  replace(routeId: string, rawParams: Record<string, unknown> = {}): NavigationState {
    const route = this.registry.getById(routeId);
    if (!route) {
      throw new Error(`Unknown routeId "${routeId}".`);
    }

    const validation = this.parameterResolver.validateAndCoerce(route.params, rawParams);
    if (!validation.valid) {
      throw new Error(
        `Invalid parameters for route "${routeId}": ${validation.errors.join(' ')}`
      );
    }

    const entry = this.createEntry(routeId, route.navigatorId, validation.params);
    const history =
      this.state.history.length > 0
        ? [...this.state.history.slice(0, -1), entry]
        : [entry];

    this.state = {
      ...this.state,
      activeNavigatorId: route.navigatorId,
      activeRouteId: routeId,
      params: validation.params,
      history,
    };

    this.eventBus.emit(
      'nav.route.didChange',
      {
        toRouteId: routeId,
        params: validation.params,
        mode: 'replace',
      },
      { source: 'navigation' }
    );

    return this.notify();
  }

  pop(): NavigationState {
    if (this.state.modalStack.length > 0) {
      return this.closeModal();
    }

    if (this.state.selectedTab) {
      const tabStack = this.state.tabStacks[this.state.selectedTab] ?? [];
      if (tabStack.length > 1) {
        const nextTabStack = tabStack.slice(0, -1);
        const top = nextTabStack[nextTabStack.length - 1];
        const nextHistory =
          this.state.history.length > 1
            ? this.state.history.slice(0, -1)
            : this.state.history;
        this.state = {
          ...this.state,
          activeNavigatorId: top.navigatorId,
          activeRouteId: top.routeId,
          params: top.params,
          history: nextHistory,
          tabStacks: {
            ...this.state.tabStacks,
            [this.state.selectedTab]: nextTabStack,
          },
        };
        return this.notify();
      }
    }

    if (this.state.history.length <= 1) {
      return this.getState();
    }

    const nextHistory = this.state.history.slice(0, -1);
    const top = nextHistory[nextHistory.length - 1];
    this.state = {
      ...this.state,
      activeNavigatorId: top.navigatorId,
      activeRouteId: top.routeId,
      params: top.params,
      history: nextHistory,
    };

    this.eventBus.emit(
      'nav.route.didChange',
      {
        toRouteId: top.routeId,
        params: top.params,
        mode: 'pop',
      },
      { source: 'navigation' }
    );

    return this.notify();
  }

  switchTab(tabIdOrRouteId: string): NavigationState {
    const existingTabStack = this.state.tabStacks[tabIdOrRouteId];
    if (existingTabStack && existingTabStack.length > 0) {
      const top = existingTabStack[existingTabStack.length - 1];
      this.state = {
        ...this.state,
        selectedTab: tabIdOrRouteId,
        activeNavigatorId: top.navigatorId,
        activeRouteId: top.routeId,
        params: top.params,
        history: [...this.state.history, top],
      };
      return this.notify();
    }

    const resolvedRouteId =
      this.graph.resolveInitialRouteId(tabIdOrRouteId) ?? tabIdOrRouteId;
    const route = this.registry.getById(resolvedRouteId);
    if (!route) {
      throw new Error(`Cannot switch to unknown tab/route "${tabIdOrRouteId}".`);
    }

    const entry = this.createEntry(route.id, route.navigatorId, {});
    this.state = {
      ...this.state,
      selectedTab: tabIdOrRouteId,
      activeNavigatorId: route.navigatorId,
      activeRouteId: route.id,
      params: {},
      history: [...this.state.history, entry],
      tabStacks: {
        ...this.state.tabStacks,
        [tabIdOrRouteId]: [entry],
      },
    };
    return this.notify();
  }

  openModal(modalRouteId: string, rawParams: Record<string, unknown> = {}): NavigationState {
    const route = this.registry.getById(modalRouteId);
    if (!route) {
      throw new Error(`Unknown modal route "${modalRouteId}".`);
    }
    const validation = this.parameterResolver.validateAndCoerce(route.params, rawParams);
    if (!validation.valid) {
      throw new Error(validation.errors.join(' '));
    }

    this.state = {
      ...this.state,
      activeRouteId: modalRouteId,
      params: validation.params,
      modalStack: [...this.state.modalStack, modalRouteId],
    };
    return this.notify();
  }

  closeModal(): NavigationState {
    if (this.state.modalStack.length === 0) {
      return this.getState();
    }
    const nextModals = this.state.modalStack.slice(0, -1);
    const fallbackRouteId =
      nextModals[nextModals.length - 1] ??
      this.state.history[this.state.history.length - 1]?.routeId ??
      this.state.activeRouteId;

    this.state = {
      ...this.state,
      activeRouteId: fallbackRouteId,
      modalStack: nextModals,
    };
    return this.notify();
  }

  /**
   * Resets the entire navigation history (e.g., on logout or session expiration),
   * removing all protected route history and tab stacks.
   */
  reset(targetRouteId: string, rawParams: Record<string, unknown> = {}): NavigationState {
    const route = this.registry.getById(targetRouteId);
    if (!route) {
      throw new Error(`Cannot reset navigation to unknown route "${targetRouteId}".`);
    }
    const validation = this.parameterResolver.validateAndCoerce(route.params, rawParams);
    const entry = this.createEntry(route.id, route.navigatorId, validation.params);

    this.state = {
      activeNavigatorId: route.navigatorId,
      activeRouteId: route.id,
      params: validation.params,
      history: [entry],
      selectedTab: undefined,
      modalStack: [],
      tabStacks: {},
    };

    this.eventBus.emit(
      'nav.reset',
      {
        targetRouteId: route.id,
      },
      { source: 'navigation' }
    );

    return this.notify();
  }

  restore(snapshot: NavigationState): NavigationState {
    this.state = structuredClone(snapshot);
    return this.notify();
  }
}
