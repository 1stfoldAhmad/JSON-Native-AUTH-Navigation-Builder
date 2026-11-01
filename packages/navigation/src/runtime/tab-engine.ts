import type { NavigatorDefinition } from '@expo-foundation/core';
import type { NavigationStateManager } from './state-manager.js';

export interface TabDescriptor {
  tabId: string;
  label: string;
  icon: string;
  badge?: string | number;
  visible: boolean;
  active: boolean;
}

export class TabEngine {
  private readonly badges = new Map<string, string | number | undefined>();

  constructor(
    readonly navigator: NavigatorDefinition,
    private readonly stateManager: NavigationStateManager
  ) {
    for (const tab of navigator.tabsOptions?.tabs ?? []) {
      if (tab.badge !== undefined) {
        this.badges.set(tab.routeId, tab.badge);
      }
    }
  }

  selectTab(tabId: string) {
    if (!this.navigator.children.includes(tabId)) {
      throw new Error(
        `Tab "${tabId}" is not a child of tabs navigator "${this.navigator.id}".`
      );
    }
    return this.stateManager.switchTab(tabId);
  }

  setBadge(tabId: string, badge: string | number | undefined): void {
    this.badges.set(tabId, badge);
  }

  getTabs(): TabDescriptor[] {
    const state = this.stateManager.getState();
    const configuredTabs = this.navigator.tabsOptions?.tabs ?? [];
    const selectedTab =
      state.selectedTab ??
      this.navigator.tabsOptions?.initialTab ??
      this.navigator.children[0];

    return this.navigator.children.map((childId) => {
      const explicit = configuredTabs.find((t) => t.routeId === childId);
      return {
        tabId: childId,
        label: explicit?.label ?? childId,
        icon: explicit?.icon ?? 'circle',
        badge: this.badges.get(childId) ?? explicit?.badge,
        visible: explicit?.visible ?? true,
        active: selectedTab === childId,
      };
    });
  }
}
