/**
 * @expo-foundation/navigation - Navigation State Manager & Runtime Actions
 *
 * Implements Section 12.6 & Section 13.1 (Audit Findings 10 & 11):
 * - Separate tracking for root stack history, per-tab stack histories, selected tab state,
 *   modal stack, and nested navigator state.
 * - Tab switching (`switchTab`) restores the selected tab's saved stack history without
 *   pushing duplicate entries onto the global root stack.
 * - Full sequence reconciliation (`reconcilePathSequence`) for iOS controlled NavigationStack
 *   path arrays (handles equal-length replacements, mid-stack edits, multi-pops, and pushes).
 */

import { FoundationEventBus } from '@expo-foundation/contracts';
import {
  evaluateAccessPolicy,
  type AccessContext,
  type NavigationIR,
} from '@expo-foundation/core';
import { RouteRegistry } from '../route-registry/index.js';

export interface NavigationHistoryEntry {
  key: string;
  routeId: string;
  navigatorId: string;
  path: string;
  params: Record<string, unknown>;
  timestamp: number;
}

export interface NavigatorState {
  navigatorId: string;
  type: 'stack' | 'tabs' | 'drawer' | 'split' | 'modal';
  activeRouteId: string;
  stackHistory: NavigationHistoryEntry[];
  selectedTab?: string;
}

export interface NavigationStateSnapshot {
  rootNavigatorId: string;
  activeNavigatorId: string;
  currentRouteId: string;
  currentPath: string;
  currentParams: Record<string, unknown>;
  /** Active stack history for the current context (active tab stack or root stack) */
  history: NavigationHistoryEntry[];
  /** Explicit root-level stack history */
  rootHistory: NavigationHistoryEntry[];
  /** Per-tab independent stack histories keyed by tab ID (route or nested navigator ID) */
  tabHistories: Record<string, NavigationHistoryEntry[]>;
  /** Active tab selection keyed by tabs navigator ID */
  selectedTabs: Record<string, string>;
  /** Open modal stack entries */
  modalStack: NavigationHistoryEntry[];
  /** Per-navigator state map */
  navigatorStates: Record<string, NavigatorState>;
  intendedDestination?: {
    routeId: string;
    params: Record<string, unknown>;
    path: string;
  };
}

export type RouteGuardHook = (
  routeId: string,
  params: Record<string, unknown>,
  accessContext: AccessContext
) => {
  allowed: boolean;
  redirectRouteId?: string;
  reason?: string;
};

export class NavigationStateManager {
  private readonly ir: NavigationIR;
  private readonly routeRegistry: RouteRegistry;
  private readonly eventBus: FoundationEventBus;

  private rootHistory: NavigationHistoryEntry[] = [];
  private readonly tabHistories = new Map<string, NavigationHistoryEntry[]>();
  private readonly selectedTabs = new Map<string, string>();
  private modalStack: NavigationHistoryEntry[] = [];
  private readonly navigatorStates = new Map<string, NavigatorState>();
  private activeTabsContext: { tabsNavigatorId: string; tabKey: string } | null = null;

  private accessContext: AccessContext = {
    authenticated: false,
    roles: [],
    permissions: [],
    verified: false,
  };
  private guardHook?: RouteGuardHook;
  private intendedDestination?: {
    routeId: string;
    params: Record<string, unknown>;
    path: string;
  };
  private keyCounter = 0;

  constructor(options: {
    navigationIR: NavigationIR;
    eventBus?: FoundationEventBus;
    initialAccessContext?: AccessContext;
    guardHook?: RouteGuardHook;
  }) {
    this.ir = options.navigationIR;
    this.routeRegistry = new RouteRegistry(options.navigationIR);
    this.eventBus = options.eventBus ?? new FoundationEventBus();
    if (options.initialAccessContext) {
      this.accessContext = options.initialAccessContext;
    }
    this.guardHook = options.guardHook;

    this.initializeNavigatorStates();
  }

  private initializeNavigatorStates(): void {
    for (const [navId, nav] of Object.entries(this.ir.navigators)) {
      const initialRouteId = this.resolveInitialLeafRoute(navId);
      const selectedTab =
        nav.type === 'tabs'
          ? nav.tabsOptions?.initialTab ?? nav.initialRoute ?? nav.children[0]
          : undefined;

      if (nav.type === 'tabs' && selectedTab) {
        this.selectedTabs.set(navId, selectedTab);
        for (const childId of nav.children) {
          const leafRouteId = this.resolveInitialLeafRoute(childId);
          if (leafRouteId && this.routeRegistry.has(leafRouteId)) {
            const entry = this.createEntry(leafRouteId, {});
            this.tabHistories.set(childId, [entry]);
          }
        }
      }

      this.navigatorStates.set(navId, {
        navigatorId: navId,
        type: nav.type,
        activeRouteId: initialRouteId,
        stackHistory: [],
        selectedTab,
      });
    }

    const rootInitialRouteId = this.resolveInitialLeafRoute(this.ir.rootNavigator);
    if (rootInitialRouteId && this.routeRegistry.has(rootInitialRouteId)) {
      const initialEntry = this.createEntry(rootInitialRouteId, {});
      this.rootHistory.push(initialEntry);
      const navState = this.navigatorStates.get(initialEntry.navigatorId);
      if (navState) {
        navState.stackHistory.push(initialEntry);
        navState.activeRouteId = rootInitialRouteId;
      }
      this.syncTabContextForRoute(rootInitialRouteId, initialEntry);
    }
  }

  private resolveInitialLeafRoute(targetId: string): string {
    if (this.routeRegistry.has(targetId)) {
      return targetId;
    }
    const nav = this.ir.navigators[targetId];
    if (!nav) {
      return this.ir.routeOrder[0] ?? '';
    }
    const nextTarget = nav.initialRoute || nav.children[0];
    if (!nextTarget || nextTarget === targetId) {
      return this.ir.routeOrder[0] ?? '';
    }
    return this.resolveInitialLeafRoute(nextTarget);
  }

  /**
   * Determines whether a route belongs to a tab inside a tabs navigator.
   */
  private findTabOwnerForRoute(
    routeId: string
  ): { tabsNavigatorId: string; tabKey: string } | null {
    const route = this.routeRegistry.get(routeId);
    const parentNavId = route.navigatorId;

    for (const [navId, nav] of Object.entries(this.ir.navigators)) {
      if (nav.type !== 'tabs') continue;
      if (nav.children.includes(routeId)) {
        return { tabsNavigatorId: navId, tabKey: routeId };
      }
      if (nav.children.includes(parentNavId)) {
        return { tabsNavigatorId: navId, tabKey: parentNavId };
      }
    }
    return null;
  }

  private syncTabContextForRoute(routeId: string, entry: NavigationHistoryEntry): void {
    const owner = this.findTabOwnerForRoute(routeId);
    if (!owner) {
      this.activeTabsContext = null;
      return;
    }
    this.activeTabsContext = owner;
    this.selectedTabs.set(owner.tabsNavigatorId, owner.tabKey);
    const tabsNavState = this.navigatorStates.get(owner.tabsNavigatorId);
    if (tabsNavState) {
      tabsNavState.selectedTab = owner.tabKey;
      tabsNavState.activeRouteId = routeId;
    }
    const existingTabStack = this.tabHistories.get(owner.tabKey) ?? [];
    if (existingTabStack.length === 0) {
      this.tabHistories.set(owner.tabKey, [entry]);
    }
  }

  private createEntry(
    routeId: string,
    rawParams: Record<string, unknown>,
    preserveKey?: string
  ): NavigationHistoryEntry {
    const route = this.routeRegistry.get(routeId);
    const params = this.routeRegistry.validateAndNormalizeParams(routeId, rawParams);
    const path = this.routeRegistry.buildPath(routeId, params);
    this.keyCounter += 1;

    return {
      key: preserveKey ?? `${routeId}_${this.keyCounter}`,
      routeId,
      navigatorId: route.navigatorId,
      path,
      params,
      timestamp: Date.now(),
    };
  }

  setGuardHook(hook: RouteGuardHook): void {
    this.guardHook = hook;
  }

  setAccessContext(context: AccessContext): void {
    this.accessContext = context;
  }

  getAccessContext(): AccessContext {
    return this.accessContext;
  }

  getRouteRegistry(): RouteRegistry {
    return this.routeRegistry;
  }

  setIntendedDestination(
    routeId: string,
    params: Record<string, unknown> = {}
  ): void {
    const path = this.routeRegistry.buildPath(routeId, params);
    this.intendedDestination = { routeId, params, path };
  }

  consumeIntendedDestination():
    | { routeId: string; params: Record<string, unknown>; path: string }
    | undefined {
    const dest = this.intendedDestination;
    this.intendedDestination = undefined;
    return dest;
  }

  private evaluateGuard(
    targetId: string,
    params: Record<string, unknown>
  ): { allowed: boolean; leafRouteId: string; redirectRouteId?: string; reason?: string } {
    const leafRouteId = this.resolveInitialLeafRoute(targetId);

    if (this.guardHook) {
      const res = this.guardHook(leafRouteId, params, this.accessContext);
      if (!res.allowed) {
        this.intendedDestination = {
          routeId: leafRouteId,
          params,
          path: this.routeRegistry.buildPath(leafRouteId, params),
        };
        this.eventBus.emit(
          'nav.guard.blocked',
          {
            blockedRouteId: leafRouteId,
            reason: res.reason ?? 'access_denied',
            redirectRouteId: res.redirectRouteId,
          },
          { source: 'navigation' }
        );
      }
      return {
        allowed: res.allowed,
        leafRouteId,
        redirectRouteId: res.redirectRouteId,
        reason: res.reason,
      };
    }

    // Default central policy check (Audit Finding 9)
    const route = this.routeRegistry.get(leafRouteId);
    const evalResult = evaluateAccessPolicy(route.access, this.accessContext);
    if (!evalResult.allowed) {
      this.intendedDestination = {
        routeId: leafRouteId,
        params,
        path: this.routeRegistry.buildPath(leafRouteId, params),
      };
      this.eventBus.emit(
        'nav.guard.blocked',
        {
          blockedRouteId: leafRouteId,
          reason: evalResult.reason ?? 'access_denied',
        },
        { source: 'navigation' }
      );
      return {
        allowed: false,
        leafRouteId,
        reason: evalResult.reason,
      };
    }

    return { allowed: true, leafRouteId };
  }

  private getActiveStackReference(): NavigationHistoryEntry[] {
    if (this.modalStack.length > 0) {
      return this.modalStack;
    }
    if (this.activeTabsContext) {
      let tabStack = this.tabHistories.get(this.activeTabsContext.tabKey);
      if (!tabStack) {
        tabStack = [];
        this.tabHistories.set(this.activeTabsContext.tabKey, tabStack);
      }
      return tabStack;
    }
    return this.rootHistory;
  }

  /**
   * 12.6 Runtime Navigation Actions
   */
  navigate(
    targetId: string,
    params: Record<string, unknown> = {}
  ): NavigationStateSnapshot {
    return this.push(targetId, params);
  }

  push(
    targetId: string,
    params: Record<string, unknown> = {}
  ): NavigationStateSnapshot {
    const guardResult = this.evaluateGuard(targetId, params);
    if (!guardResult.allowed) {
      if (guardResult.redirectRouteId) {
        return this.replace(guardResult.redirectRouteId, {});
      }
      return this.getState();
    }

    const previousState = this.getState();
    const entry = this.createEntry(guardResult.leafRouteId, params);

    this.eventBus.emit(
      'nav.route.willChange',
      {
        fromRouteId: previousState.currentRouteId,
        toRouteId: entry.routeId,
        action: 'push',
        params: entry.params,
      },
      { source: 'navigation' }
    );

    const owner = this.findTabOwnerForRoute(entry.routeId);
    if (owner) {
      this.activeTabsContext = owner;
      this.selectedTabs.set(owner.tabsNavigatorId, owner.tabKey);
      const tabStack = this.tabHistories.get(owner.tabKey) ?? [];
      tabStack.push(entry);
      this.tabHistories.set(owner.tabKey, tabStack);

      const tabsNavState = this.navigatorStates.get(owner.tabsNavigatorId);
      if (tabsNavState) {
        tabsNavState.selectedTab = owner.tabKey;
        tabsNavState.activeRouteId = entry.routeId;
      }
    } else {
      this.activeTabsContext = null;
      this.rootHistory.push(entry);
    }

    const navState = this.navigatorStates.get(entry.navigatorId);
    if (navState) {
      navState.stackHistory.push(entry);
      navState.activeRouteId = entry.routeId;
    }

    this.eventBus.emit(
      'nav.route.didChange',
      {
        routeId: entry.routeId,
        path: entry.path,
        action: 'push',
        params: entry.params,
      },
      { source: 'navigation' }
    );

    return this.getState();
  }

  replace(
    targetId: string,
    params: Record<string, unknown> = {}
  ): NavigationStateSnapshot {
    const guardResult = this.evaluateGuard(targetId, params);
    if (!guardResult.allowed) {
      if (
        guardResult.redirectRouteId &&
        guardResult.redirectRouteId !== targetId
      ) {
        return this.replace(guardResult.redirectRouteId, {});
      }
      return this.getState();
    }

    const previousState = this.getState();
    const entry = this.createEntry(guardResult.leafRouteId, params);

    this.eventBus.emit(
      'nav.route.willChange',
      {
        fromRouteId: previousState.currentRouteId,
        toRouteId: entry.routeId,
        action: 'replace',
        params: entry.params,
      },
      { source: 'navigation' }
    );

    const owner = this.findTabOwnerForRoute(entry.routeId);
    if (owner) {
      this.activeTabsContext = owner;
      this.selectedTabs.set(owner.tabsNavigatorId, owner.tabKey);
      const tabStack = this.tabHistories.get(owner.tabKey) ?? [];
      if (tabStack.length > 0) {
        tabStack[tabStack.length - 1] = entry;
      } else {
        tabStack.push(entry);
      }
      this.tabHistories.set(owner.tabKey, tabStack);
    } else {
      this.activeTabsContext = null;
      if (this.rootHistory.length > 0) {
        this.rootHistory[this.rootHistory.length - 1] = entry;
      } else {
        this.rootHistory.push(entry);
      }
    }

    const navState = this.navigatorStates.get(entry.navigatorId);
    if (navState) {
      if (navState.stackHistory.length > 0) {
        navState.stackHistory[navState.stackHistory.length - 1] = entry;
      } else {
        navState.stackHistory.push(entry);
      }
      navState.activeRouteId = entry.routeId;
    }

    this.eventBus.emit(
      'nav.route.didChange',
      {
        routeId: entry.routeId,
        path: entry.path,
        action: 'replace',
        params: entry.params,
      },
      { source: 'navigation' }
    );

    return this.getState();
  }

  back(): NavigationStateSnapshot {
    return this.pop(1);
  }

  pop(count = 1): NavigationStateSnapshot {
    if (this.modalStack.length > 0) {
      return this.dismissModal();
    }

    const activeStack = this.getActiveStackReference();
    if (activeStack.length <= 1 || count <= 0) {
      return this.getState();
    }

    const previousState = this.getState();
    const steps = Math.min(count, activeStack.length - 1);

    for (let i = 0; i < steps; i += 1) {
      const popped = activeStack.pop();
      if (popped) {
        const navState = this.navigatorStates.get(popped.navigatorId);
        if (navState && navState.stackHistory.length > 1) {
          navState.stackHistory.pop();
          const top = navState.stackHistory[navState.stackHistory.length - 1];
          if (top) navState.activeRouteId = top.routeId;
        }
      }
    }

    const currentTop = activeStack[activeStack.length - 1];
    this.eventBus.emit(
      'nav.route.didChange',
      {
        fromRouteId: previousState.currentRouteId,
        routeId: currentTop.routeId,
        path: currentTop.path,
        action: 'pop',
        params: currentTop.params,
      },
      { source: 'navigation' }
    );

    return this.getState();
  }

  popToRoot(): NavigationStateSnapshot {
    const activeStack = this.getActiveStackReference();
    if (activeStack.length <= 1) {
      return this.getState();
    }
    return this.pop(activeStack.length - 1);
  }

  reset(
    targetId: string,
    params: Record<string, unknown> = {}
  ): NavigationStateSnapshot {
    const leafRouteId = this.resolveInitialLeafRoute(targetId);
    const entry = this.createEntry(leafRouteId, params);

    this.modalStack = [];
    this.rootHistory = [entry];

    for (const state of this.navigatorStates.values()) {
      state.stackHistory = [];
    }

    const owner = this.findTabOwnerForRoute(leafRouteId);
    if (owner) {
      this.activeTabsContext = owner;
      this.selectedTabs.set(owner.tabsNavigatorId, owner.tabKey);
      this.tabHistories.set(owner.tabKey, [entry]);
      const tabsNavState = this.navigatorStates.get(owner.tabsNavigatorId);
      if (tabsNavState) {
        tabsNavState.selectedTab = owner.tabKey;
        tabsNavState.activeRouteId = entry.routeId;
      }
    } else {
      this.activeTabsContext = null;
    }

    const navState = this.navigatorStates.get(entry.navigatorId);
    if (navState) {
      navState.stackHistory = [entry];
      navState.activeRouteId = entry.routeId;
    }

    this.eventBus.emit(
      'nav.reset',
      {
        routeId: entry.routeId,
        path: entry.path,
        params: entry.params,
      },
      { source: 'navigation' }
    );

    return this.getState();
  }

  /**
   * Switches active tab in a Tabs Navigator and restores that tab's independent stack
   * history without pushing duplicate entries onto the global root history (Audit Finding 10).
   */
  switchTab(
    tabsNavigatorId: string,
    tabTargetId: string,
    params: Record<string, unknown> = {}
  ): NavigationStateSnapshot {
    const nav = this.ir.navigators[tabsNavigatorId];
    if (!nav || nav.type !== 'tabs') {
      throw new Error(`Navigator "${tabsNavigatorId}" is not a tabs navigator.`);
    }
    if (!nav.children.includes(tabTargetId)) {
      throw new Error(
        `Tab "${tabTargetId}" is not a child of tabs navigator "${tabsNavigatorId}".`
      );
    }

    const savedTabStack = this.tabHistories.get(tabTargetId) ?? [];
    const targetLeafRouteId =
      savedTabStack.length > 0
        ? savedTabStack[savedTabStack.length - 1].routeId
        : this.resolveInitialLeafRoute(tabTargetId);

    const guardResult = this.evaluateGuard(targetLeafRouteId, params);
    if (!guardResult.allowed) {
      if (guardResult.redirectRouteId) {
        return this.replace(guardResult.redirectRouteId, {});
      }
      return this.getState();
    }

    const previousState = this.getState();
    this.activeTabsContext = { tabsNavigatorId, tabKey: tabTargetId };
    this.selectedTabs.set(tabsNavigatorId, tabTargetId);

    const navState = this.navigatorStates.get(tabsNavigatorId);
    if (navState) {
      navState.selectedTab = tabTargetId;
    }

    let tabStack = this.tabHistories.get(tabTargetId);
    if (!tabStack || tabStack.length === 0) {
      const initialEntry = this.createEntry(guardResult.leafRouteId, params);
      tabStack = [initialEntry];
      this.tabHistories.set(tabTargetId, tabStack);
    } else if (Object.keys(params).length > 0) {
      const top = tabStack[tabStack.length - 1];
      tabStack[tabStack.length - 1] = this.createEntry(top.routeId, params, top.key);
    }

    const activeEntry = tabStack[tabStack.length - 1];
    if (navState) {
      navState.activeRouteId = activeEntry.routeId;
    }

    const childNavState = this.navigatorStates.get(activeEntry.navigatorId);
    if (childNavState) {
      childNavState.stackHistory = [...tabStack];
      childNavState.activeRouteId = activeEntry.routeId;
    }

    this.eventBus.emit(
      'nav.route.willChange',
      {
        fromRouteId: previousState.currentRouteId,
        toRouteId: activeEntry.routeId,
        action: 'switchTab',
        tabsNavigatorId,
        selectedTab: tabTargetId,
      },
      { source: 'navigation' }
    );

    this.eventBus.emit(
      'nav.route.didChange',
      {
        routeId: activeEntry.routeId,
        path: activeEntry.path,
        action: 'switchTab',
        tabsNavigatorId,
        selectedTab: tabTargetId,
        params: activeEntry.params,
      },
      { source: 'navigation' }
    );

    return this.getState();
  }

  openModal(
    modalRouteId: string,
    params: Record<string, unknown> = {}
  ): NavigationStateSnapshot {
    const guardResult = this.evaluateGuard(modalRouteId, params);
    if (!guardResult.allowed) {
      return this.getState();
    }
    const entry = this.createEntry(guardResult.leafRouteId, params);
    this.modalStack.push(entry);

    this.eventBus.emit(
      'nav.route.didChange',
      {
        routeId: entry.routeId,
        path: entry.path,
        action: 'openModal',
        params: entry.params,
      },
      { source: 'navigation' }
    );
    return this.getState();
  }

  dismissModal(): NavigationStateSnapshot {
    if (this.modalStack.length === 0) {
      return this.getState();
    }
    const popped = this.modalStack.pop();
    const nextState = this.getState();
    this.eventBus.emit(
      'nav.route.didChange',
      {
        dismissedModalRouteId: popped?.routeId,
        routeId: nextState.currentRouteId,
        path: nextState.currentPath,
        action: 'dismissModal',
      },
      { source: 'navigation' }
    );
    return nextState;
  }

  /**
   * Reconciles the active stack against a complete sequence of route IDs reported by a native
   * controlled NavigationStack (Audit Finding 11).
   * Handles equal-length replacements, mid-stack modifications, multi-pops, and pushes,
   * and rejects invalid route IDs cleanly.
   */
  reconcilePathSequence(
    newRouteIds: string[],
    paramsByIndex?: Record<number, Record<string, unknown>>
  ): NavigationStateSnapshot {
    if (!Array.isArray(newRouteIds) || newRouteIds.length === 0) {
      throw new Error('Cannot reconcile an empty native navigation path sequence.');
    }

    for (const routeId of newRouteIds) {
      if (!this.routeRegistry.has(routeId)) {
        throw new Error(
          `Native path sequence contains unregistered route ID "${routeId}".`
        );
      }
    }

    const activeStack = this.getActiveStackReference();
    const reconciled: NavigationHistoryEntry[] = [];

    for (let idx = 0; idx < newRouteIds.length; idx += 1) {
      const routeId = newRouteIds[idx];
      const existingAtIdx = activeStack[idx];
      const overrideParams = paramsByIndex?.[idx];

      if (existingAtIdx && existingAtIdx.routeId === routeId && !overrideParams) {
        reconciled.push(existingAtIdx);
      } else {
        const defaultParams: Record<string, unknown> = {};
        const route = this.routeRegistry.get(routeId);
        for (const [paramKey, schema] of Object.entries(route.params)) {
          if (schema.default !== undefined) {
            defaultParams[paramKey] = schema.default;
          } else if (schema.required) {
            defaultParams[paramKey] = schema.type === 'number' ? 1 : 'default';
          }
        }
        reconciled.push(
          this.createEntry(routeId, overrideParams ?? defaultParams)
        );
      }
    }

    activeStack.splice(0, activeStack.length, ...reconciled);
    const top = activeStack[activeStack.length - 1];

    const navState = this.navigatorStates.get(top.navigatorId);
    if (navState) {
      navState.stackHistory = [...activeStack];
      navState.activeRouteId = top.routeId;
    }

    this.eventBus.emit(
      'nav.route.didChange',
      {
        routeId: top.routeId,
        path: top.path,
        action: 'reconcilePathSequence',
        params: top.params,
      },
      { source: 'navigation' }
    );

    return this.getState();
  }

  getState(): NavigationStateSnapshot {
    const activeStack = this.getActiveStackReference();
    const current = activeStack[activeStack.length - 1];
    const navigatorStatesObj: Record<string, NavigatorState> = {};
    for (const [id, st] of this.navigatorStates.entries()) {
      navigatorStatesObj[id] = {
        ...st,
        stackHistory: [...st.stackHistory],
      };
    }

    const tabHistoriesObj: Record<string, NavigationHistoryEntry[]> = {};
    for (const [tabKey, stack] of this.tabHistories.entries()) {
      tabHistoriesObj[tabKey] = [...stack];
    }

    const selectedTabsObj: Record<string, string> = {};
    for (const [navId, tabKey] of this.selectedTabs.entries()) {
      selectedTabsObj[navId] = tabKey;
    }

    return {
      rootNavigatorId: this.ir.rootNavigator,
      activeNavigatorId: current?.navigatorId ?? this.ir.rootNavigator,
      currentRouteId: current?.routeId ?? '',
      currentPath: current?.path ?? '/',
      currentParams: current ? { ...current.params } : {},
      history: [...activeStack],
      rootHistory: [...this.rootHistory],
      tabHistories: tabHistoriesObj,
      selectedTabs: selectedTabsObj,
      modalStack: [...this.modalStack],
      navigatorStates: navigatorStatesObj,
      intendedDestination: this.intendedDestination
        ? { ...this.intendedDestination }
        : undefined,
    };
  }
}
