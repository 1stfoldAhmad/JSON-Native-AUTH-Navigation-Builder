import { describe, expect, it } from 'vitest';
import { defaultFoundationCompiler } from '@expo-foundation/core';
import {
  AndroidNavigationAdapter,
  DeepLinkManager,
  IOSNativeNavigationAdapter,
  NavigationGraphEngine,
  NavigationStateManager,
  ParameterResolver,
  RouteRegistry,
} from '@expo-foundation/navigation';
import navOnlyJson from '../../examples/navigation-only/navigation.json' with { type: 'json' };

describe('@expo-foundation/navigation', () => {
  it('compiles and runs Navigation-Only mode independently without Auth Builder', () => {
    const compiled = defaultFoundationCompiler.compile({ navigation: navOnlyJson });
    expect(compiled.canGenerate).toBe(true);
    expect(compiled.ir?.projectMetadata.mode).toBe('navigation-only');
    expect(compiled.ir?.auth).toBeNull();
    expect(compiled.ir?.navigation).not.toBeNull();
  });

  it('builds RouteRegistry and NavigationGraphEngine with ancestor and reachability analysis', () => {
    const compiled = defaultFoundationCompiler.compile({ navigation: navOnlyJson });
    const navIR = compiled.ir!.navigation!;

    const registry = RouteRegistry.fromNavigationIR(navIR);
    expect(registry.has('catalog.home')).toBe(true);
    expect(registry.getById('catalog.product.detail')?.screenRef).toBe(
      'screen.catalog.product-detail'
    );

    const graph = NavigationGraphEngine.fromNavigationIR(navIR);
    expect(graph.resolveInitialRouteId()).toBe('catalog.home');
    expect(graph.getAncestorChain('catalog.product.detail')).toEqual([
      'root.stack',
      'app.tabs',
      'tab.home.stack',
      'catalog.product.detail',
    ]);
    expect(graph.toTree()?.id).toBe('root.stack');
  });

  it('validates, coerces, and serializes typed route parameters via ParameterResolver', () => {
    const resolver = new ParameterResolver();
    const matched = resolver.matchPath(
      '/products/:productId',
      '/products/PROD-42?page=3&featured=true'
    );
    expect(matched.matched).toBe(true);
    expect(matched.rawParams.productId).toBe('PROD-42');
    expect(matched.rawParams.page).toBe('3');

    const coerced = resolver.validateAndCoerce(
      {
        productId: { type: 'string', required: true },
        page: { type: 'number', required: false, default: 1 },
        featured: { type: 'boolean', required: false },
        sort: { type: 'enum', required: false, enumValues: ['asc', 'desc'], default: 'asc' },
      },
      matched.rawParams
    );

    expect(coerced.valid).toBe(true);
    expect(coerced.params.productId).toBe('PROD-42');
    expect(coerced.params.page).toBe(3);
    expect(coerced.params.featured).toBe(true);
    expect(coerced.params.sort).toBe('asc');

    // Invalid parameter must fail validation
    const invalid = resolver.validateAndCoerce(
      {
        productId: { type: 'string', required: true },
        page: { type: 'number', required: true },
      },
      { productId: 'PROD-42', page: 'not-a-number' }
    );
    expect(invalid.valid).toBe(false);
    expect(invalid.errors[0]).toContain('valid number');
  });

  it('synchronizes iOS SwiftUI NavigationStack controlled path and TabView per-tab stacks', () => {
    const compiled = defaultFoundationCompiler.compile({ navigation: navOnlyJson });
    const stateManager = new NavigationStateManager({
      navigationIR: compiled.ir!.navigation!,
    });
    const iosAdapter = new IOSNativeNavigationAdapter(stateManager);

    iosAdapter.onNativeTabSelect('tab.home.stack');
    stateManager.push('catalog.product.detail', { productId: 'IPHONE-17' });

    const stackDesc = iosAdapter.getNavigationStackDescriptor();
    expect(stackDesc.component).toBe('NavigationStack');
    expect(stackDesc.importSource).toBe('@expo/ui/swift-ui');
    expect(stackDesc.activeRouteId).toBe('catalog.product.detail');
    expect(stackDesc.params.productId).toBe('IPHONE-17');

    // Switch to Search tab, then return to Home tab -> preserves product detail on Home stack
    iosAdapter.onNativeTabSelect('tab.search.stack');
    expect(stateManager.getState().activeRouteId).toBe('catalog.search');

    iosAdapter.onNativeTabSelect('tab.home.stack');
    expect(stateManager.getState().activeRouteId).toBe('catalog.product.detail');

    // Native iOS interactive swipe-back pops back to catalog.home
    iosAdapter.onNativePathChange(['catalog.home']);
    expect(stateManager.getState().activeRouteId).toBe('catalog.home');
  });

  it('handles Android Jetpack Compose NavigationBar, NativeTabs fallback, and hardware back', () => {
    const compiled = defaultFoundationCompiler.compile({ navigation: navOnlyJson });
    const stateManager = new NavigationStateManager({
      navigationIR: compiled.ir!.navigation!,
    });
    const androidCompose = new AndroidNavigationAdapter(stateManager, {
      useNativeTabsFallback: false,
    });
    expect(androidCompose.getTabsDescriptor('app.tabs').barComponent).toBe('NavigationBar');

    const androidFallback = new AndroidNavigationAdapter(stateManager, {
      useNativeTabsFallback: true,
    });
    expect(androidFallback.getTabsDescriptor('app.tabs').barComponent).toBe('NativeTabs');

    // Open modal, then press Android hardware back -> closes modal first
    stateManager.openModal('modal.filter');
    expect(stateManager.getState().modalStack).toEqual(['modal.filter']);

    const afterModalBack = androidCompose.handleHardwareBack();
    expect(afterModalBack.handled).toBe(true);
    expect(afterModalBack.state.modalStack).toHaveLength(0);
  });

  it('resolves deep links and rejects untrusted hosts or external redirect injections', () => {
    const compiled = defaultFoundationCompiler.compile({ navigation: navOnlyJson });
    const stateManager = new NavigationStateManager({
      navigationIR: compiled.ir!.navigation!,
    });
    const dlManager = new DeepLinkManager(
      stateManager.registry,
      stateManager,
      compiled.ir!.navigation!.linking
    );

    const okLink = dlManager.handleIncomingUrl(
      'https://catalog.example.com/products/MACBOOK-M5'
    );
    expect(okLink.status).toBe('navigated');
    expect(okLink.matchedRouteId).toBe('catalog.product.detail');
    expect(okLink.params?.productId).toBe('MACBOOK-M5');

    const untrustedHost = dlManager.handleIncomingUrl('https://evil.example.org/products/123');
    expect(untrustedHost.status).toBe('invalid_url');

    expect(() =>
      dlManager.setIntendedDestination('https://phishing.site/steal')
    ).toThrow(/external URL/i);
  });
});
