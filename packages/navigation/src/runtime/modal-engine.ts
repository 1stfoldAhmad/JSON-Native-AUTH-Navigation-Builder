import type { NavigatorDefinition } from '@expo-foundation/core';
import type { NavigationStateManager } from './state-manager.js';

export class ModalEngine {
  constructor(
    readonly navigator: NavigatorDefinition,
    private readonly stateManager: NavigationStateManager
  ) {}

  present(routeId: string, params?: Record<string, unknown>) {
    const state = this.stateManager.getState();
    const allowNested = this.navigator.modalOptions?.allowNestedModals ?? true;
    if (!allowNested && state.modalStack.length > 0) {
      throw new Error(
        `Modal navigator "${this.navigator.id}" disallows nested modal presentation.`
      );
    }
    return this.stateManager.openModal(routeId, params);
  }

  dismiss() {
    if (this.navigator.modalOptions?.dismissible === false) {
      return this.stateManager.getState();
    }
    return this.stateManager.closeModal();
  }
}
