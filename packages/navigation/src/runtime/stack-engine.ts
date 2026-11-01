import type { NavigatorDefinition } from '@expo-foundation/core';
import type { NavigationStateManager } from './state-manager.js';

export class StackEngine {
  constructor(
    readonly navigator: NavigatorDefinition,
    private readonly stateManager: NavigationStateManager
  ) {}

  getControlledPath(): string[] {
    const state = this.stateManager.getState();
    return state.history.map((entry) => entry.routeId);
  }

  push(routeId: string, params?: Record<string, unknown>) {
    return this.stateManager.push(routeId, params);
  }

  pop() {
    return this.stateManager.pop();
  }

  /**
   * Synchronizes external controlled path changes (e.g., iOS SwiftUI NavigationStack onPathChange
   * when user performs native back-swipe gesture).
   */
  synchronizeControlledPath(nextPathRouteIds: string[]) {
    const currentPath = this.getControlledPath();
    if (nextPathRouteIds.length < currentPath.length) {
      const popCount = currentPath.length - nextPathRouteIds.length;
      for (let i = 0; i < popCount; i++) {
        this.stateManager.pop();
      }
      return this.stateManager.getState();
    }
    if (nextPathRouteIds.length > currentPath.length) {
      const newRoutes = nextPathRouteIds.slice(currentPath.length);
      for (const routeId of newRoutes) {
        this.stateManager.push(routeId);
      }
      return this.stateManager.getState();
    }
    return this.stateManager.getState();
  }
}
