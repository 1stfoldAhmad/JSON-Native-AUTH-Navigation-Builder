import { InMemoryScreenRegistry, type ScreenRegistry } from '@expo-foundation/contracts';

export function createTestScreenRegistry(): ScreenRegistry {
  const registry = new InMemoryScreenRegistry();

  const screenIds = [
    'screen.auth.login',
    'screen.auth.register',
    'screen.auth.verify',
    'screen.auth.access-denied',
    'screen.app.home',
    'screen.app.order-detail',
    'screen.app.notifications',
    'screen.app.search',
    'screen.app.product-detail',
    'screen.app.profile',
    'screen.app.settings',
    'screen.admin.dashboard',
    'screen.catalog.home',
    'screen.catalog.product-detail',
    'screen.catalog.search',
    'screen.modal.filter',
  ];

  for (const id of screenIds) {
    registry.register(
      id,
      (props: Record<string, unknown>) => ({
        screenId: id,
        renderedWithProps: props,
      }),
      {
        title: id,
        required: true,
      }
    );
  }

  return registry;
}
