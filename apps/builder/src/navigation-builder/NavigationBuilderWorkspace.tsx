import React, { useMemo, useState } from 'react';
import {
  defaultCapabilityRegistry,
  defaultFoundationCompiler,
  type AccessPolicy,
  type Diagnostic,
  type NavigationConfigDocument,
} from '@expo-foundation/core';
import {
  DeepLinkManager,
  NavigationGraphEngine,
  NavigationStateManager,
  RouteRegistry,
  type GraphHierarchyNode,
} from '@expo-foundation/navigation';

export interface NavigationBuilderWorkspaceProps {
  navigationConfig: NavigationConfigDocument | null;
  onChange: (next: NavigationConfigDocument) => void;
  diagnostics: Diagnostic[];
}

type NavSubSection =
  | 'overview'
  | 'graph'
  | 'routes'
  | 'deeplinks'
  | 'capabilities'
  | 'json';

function GraphTreeNodeView({ node }: { node: GraphHierarchyNode }) {
  return (
    <div className="tree-node">
      <div className={`tree-node-header ${node.kind}`}>
        <span className={`badge ${node.kind === 'navigator' ? 'badge-nav' : 'badge-route'}`}>
          {node.kind === 'navigator' ? `NAV: ${node.navigatorType}` : 'ROUTE'}
        </span>
        <strong>{node.id}</strong>
        {node.routePath && <code className="path-chip">{node.routePath}</code>}
        {node.screenRef && <span className="screen-chip">{node.screenRef}</span>}
        {node.access && (
          <span className="access-chip">
            {typeof node.access === 'string' ? node.access : JSON.stringify(node.access)}
          </span>
        )}
      </div>
      {node.children.length > 0 && (
        <div className="tree-children">
          {node.children.map((child) => (
            <GraphTreeNodeView key={child.id} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}

export function NavigationBuilderWorkspace({
  navigationConfig,
  onChange,
  diagnostics,
}: NavigationBuilderWorkspaceProps) {
  const [section, setSection] = useState<NavSubSection>('overview');
  const [rawJsonText, setRawJsonText] = useState<string>(() =>
    navigationConfig ? JSON.stringify(navigationConfig, null, 2) : ''
  );
  const [jsonError, setJsonError] = useState<string | null>(null);

  // New Route Form
  const [newRouteId, setNewRouteId] = useState('app.promo.detail');
  const [newRoutePath, setNewRoutePath] = useState('/promos/:promoId');
  const [newRouteScreenRef, setNewRouteScreenRef] = useState('screen.app.promo-detail');
  const [newRouteAccess, setNewRouteAccess] = useState<'public' | 'guest' | 'authenticated'>(
    'authenticated'
  );

  // Deep Link Interactive Tester
  const [testUrl, setTestUrl] = useState('https://example.com/orders/ORD-1024');
  const [testAuthenticated, setTestAuthenticated] = useState(false);

  const navDiagnostics = useMemo(
    () => diagnostics.filter((d) => d.document === 'navigation'),
    [diagnostics]
  );

  const capabilities = useMemo(
    () => defaultCapabilityRegistry.listCapabilities(),
    []
  );

  if (!navigationConfig) {
    return (
      <div className="panel empty-panel">
        <h3>Navigation Builder is Disabled in Auth-Only Mode</h3>
        <p>
          The Auth Builder is running standalone without a navigation graph. Switch to{' '}
          <strong>Complete Foundation</strong> or <strong>Navigation-Only Mode</strong> in the top
          bar to configure routes and native navigators.
        </p>
      </div>
    );
  }

  const graphTree = useMemo(() => {
    try {
      const engine = NavigationGraphEngine.fromDocument(navigationConfig);
      return engine.toTree();
    } catch {
      return null;
    }
  }, [navigationConfig]);

  const deepLinkPreview = useMemo(() => {
    try {
      const compiled = defaultFoundationCompiler.compile({ navigation: navigationConfig });
      if (!compiled.ir?.navigation) {
        return { error: 'Fix navigation compilation errors to test deep links.' };
      }
      const stateManager = new NavigationStateManager({
        navigationIR: compiled.ir.navigation,
      });
      const registry = RouteRegistry.fromNavigationIR(compiled.ir.navigation);
      const dlManager = new DeepLinkManager(
        registry,
        stateManager,
        compiled.ir.navigation.linking
      );
      return dlManager.handleIncomingUrl(testUrl, {
        accessContext: {
          authenticated: testAuthenticated,
          userId: testAuthenticated ? 'usr_demo' : undefined,
          roles: testAuthenticated ? ['user'] : [],
          permissions: [],
          verified: testAuthenticated,
        },
      });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, [navigationConfig, testUrl, testAuthenticated]);

  const handleAddRoute = () => {
    if (!newRouteId.trim() || !newRoutePath.trim() || !newRouteScreenRef.trim()) return;
    const firstStack =
      navigationConfig.navigators.find((n) => n.type === 'stack') ??
      navigationConfig.navigators[0];

    const paramMatches = newRoutePath.match(/:([a-zA-Z0-9_]+)/g) ?? [];
    const params: Record<string, { type: 'string'; required: true; source: 'path' }> = {};
    for (const m of paramMatches) {
      params[m.slice(1)] = { type: 'string', required: true, source: 'path' };
    }

    const updatedNavigators = navigationConfig.navigators.map((nav) =>
      nav.id === firstStack?.id && !nav.children.includes(newRouteId.trim())
        ? { ...nav, children: [...nav.children, newRouteId.trim()] }
        : nav
    );

    onChange({
      ...navigationConfig,
      navigators: updatedNavigators,
      routes: [
        ...navigationConfig.routes,
        {
          id: newRouteId.trim(),
          path: newRoutePath.trim(),
          screenRef: newRouteScreenRef.trim(),
          navigatorId: firstStack?.id,
          access: newRouteAccess,
          params: Object.keys(params).length > 0 ? params : undefined,
        },
      ],
    });
  };

  return (
    <div className="workspace-layout">
      <aside className="subnav">
        <div className="subnav-title">Navigation Builder Sections</div>
        {(
          [
            ['overview', 'Overview & Platform Policy'],
            ['graph', 'Route Graph & Navigators'],
            ['routes', 'Route Registry & Params'],
            ['deeplinks', 'Deep Link Engine & Tester'],
            ['capabilities', 'SDK 58 Capability Matrix'],
            ['json', 'navigation.json Source Editor'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={`subnav-btn ${section === id ? 'active' : ''}`}
            onClick={() => {
              if (id === 'json') {
                setRawJsonText(JSON.stringify(navigationConfig, null, 2));
                setJsonError(null);
              }
              setSection(id);
            }}
          >
            {label}
          </button>
        ))}
        <div className="scope-guard-card">
          <div className="badge badge-info">Strict Scope Boundary</div>
          <p>
            Native Navigation Engine only. Resolves screens through external{' '}
            <code>ScreenRegistry</code>; never embeds screen layouts or UI widgets.
          </p>
        </div>
      </aside>

      <main className="workspace-content">
        {section === 'overview' && (
          <div className="panel">
            <h2>Navigation Builder Overview</h2>
            <p className="subtitle">
              Shared JSON navigation graph targeting SwiftUI on iOS (<code>@expo/ui</code>) and
              Jetpack Compose + Expo Router on Android.
            </p>

            <div className="stat-grid">
              <div className="stat-card">
                <span className="stat-label">Navigators</span>
                <strong className="stat-value">{navigationConfig.navigators.length}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-label">Registered Routes</span>
                <strong className="stat-value">{navigationConfig.routes.length}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-label">iOS Renderer</span>
                <strong className="stat-value">
                  {navigationConfig.platforms.ios.renderer} (strictNative:{' '}
                  {String(navigationConfig.platforms.ios.strictNative)})
                </strong>
              </div>
              <div className="stat-card">
                <span className="stat-label">Android Renderer</span>
                <strong className="stat-value">
                  {navigationConfig.platforms.android.renderer} (fallback:{' '}
                  {navigationConfig.platforms.android.fallback})
                </strong>
              </div>
            </div>

            <h3>Platform Compilation Policy</h3>
            <div className="form-grid">
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={navigationConfig.platforms.ios.strictNative}
                  onChange={(e) =>
                    onChange({
                      ...navigationConfig,
                      platforms: {
                        ...navigationConfig.platforms,
                        ios: {
                          ...navigationConfig.platforms.ios,
                          strictNative: e.target.checked,
                        },
                      },
                    })
                  }
                />
                <span>iOS Strict Native Mode (SwiftUI NavigationStack / TabView)</span>
              </label>

              <label>
                <span>Android Renderer Policy</span>
                <select
                  value={navigationConfig.platforms.android.renderer}
                  onChange={(e) =>
                    onChange({
                      ...navigationConfig,
                      platforms: {
                        ...navigationConfig.platforms,
                        android: {
                          ...navigationConfig.platforms.android,
                          renderer: e.target.value as
                            | 'auto'
                            | 'expo-ui-compose'
                            | 'expo-router',
                        },
                      },
                    })
                  }
                >
                  <option value="auto">auto (Compose UI + Expo Router)</option>
                  <option value="expo-ui-compose">expo-ui-compose</option>
                  <option value="expo-router">expo-router</option>
                </select>
              </label>

              <label>
                <span>Android Tab Fallback Strategy</span>
                <select
                  value={navigationConfig.platforms.android.fallback}
                  onChange={(e) =>
                    onChange({
                      ...navigationConfig,
                      platforms: {
                        ...navigationConfig.platforms,
                        android: {
                          ...navigationConfig.platforms.android,
                          fallback: e.target.value as 'expo-router' | 'native-tabs',
                        },
                      },
                    })
                  }
                >
                  <option value="expo-router">expo-router (Compose Bar + TabRouter)</option>
                  <option value="native-tabs">native-tabs (Expo Router NativeTabs)</option>
                </select>
              </label>
            </div>

            {navDiagnostics.length > 0 && (
              <div className="alert alert-warn">
                <strong>{navDiagnostics.length} Navigation Diagnostic(s) Active</strong> — check
                the Diagnostics tab for full details.
              </div>
            )}
          </div>
        )}

        {section === 'graph' && (
          <div className="panel">
            <h2>Navigation Graph Hierarchy</h2>
            <p className="subtitle">
              Root Navigator: <code>{navigationConfig.rootNavigator}</code>
            </p>
            {graphTree ? (
              <div className="graph-tree-container">
                <GraphTreeNodeView node={graphTree} />
              </div>
            ) : (
              <div className="alert alert-error">
                Unable to render route graph tree. Check rootNavigator in navigation.json.
              </div>
            )}
          </div>
        )}

        {section === 'routes' && (
          <div className="panel">
            <h2>Centralized Route Registry & Typed Parameters</h2>
            <p className="subtitle">
              Route IDs remain stable across title, URL path, and external Screen Reference
              updates.
            </p>

            <table className="data-table">
              <thead>
                <tr>
                  <th>Route ID</th>
                  <th>URL Path</th>
                  <th>External Screen Ref</th>
                  <th>Navigator</th>
                  <th>Typed Params</th>
                  <th>Access Policy</th>
                </tr>
              </thead>
              <tbody>
                {navigationConfig.routes.map((route, idx) => (
                  <tr key={route.id}>
                    <td>
                      <code>{route.id}</code>
                    </td>
                    <td>
                      <code>{route.path}</code>
                    </td>
                    <td>
                      <code>{route.screenRef}</code>
                    </td>
                    <td>{route.navigatorId ?? '—'}</td>
                    <td>
                      {route.params ? Object.keys(route.params).join(', ') : 'none'}
                    </td>
                    <td>
                      <select
                        value={typeof route.access === 'string' ? route.access : 'custom'}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'custom') return;
                          const nextRoutes = [...navigationConfig.routes];
                          nextRoutes[idx] = {
                            ...route,
                            access: val as AccessPolicy,
                          };
                          onChange({
                            ...navigationConfig,
                            routes: nextRoutes,
                          });
                        }}
                      >
                        <option value="public">public</option>
                        <option value="guest">guest</option>
                        <option value="authenticated">authenticated</option>
                        <option value="verified">verified</option>
                        {typeof route.access === 'object' && (
                          <option value="custom">
                            role/perm ({JSON.stringify(route.access)})
                          </option>
                        )}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3>Register New Route</h3>
            <div className="form-grid">
              <label>
                <span>Stable Route ID</span>
                <input
                  type="text"
                  value={newRouteId}
                  onChange={(e) => setNewRouteId(e.target.value)}
                />
              </label>
              <label>
                <span>Path Template</span>
                <input
                  type="text"
                  value={newRoutePath}
                  onChange={(e) => setNewRoutePath(e.target.value)}
                />
              </label>
              <label>
                <span>External Screen Ref</span>
                <input
                  type="text"
                  value={newRouteScreenRef}
                  onChange={(e) => setNewRouteScreenRef(e.target.value)}
                />
              </label>
              <label>
                <span>Access Policy</span>
                <select
                  value={newRouteAccess}
                  onChange={(e) =>
                    setNewRouteAccess(
                      e.target.value as 'public' | 'guest' | 'authenticated'
                    )
                  }
                >
                  <option value="public">public</option>
                  <option value="guest">guest</option>
                  <option value="authenticated">authenticated</option>
                </select>
              </label>
            </div>
            <button className="btn btn-primary" onClick={handleAddRoute}>
              + Register Route in Graph
            </button>
          </div>
        )}

        {section === 'deeplinks' && (
          <div className="panel">
            <h2>Deep-Linking Engine & URL Resolution Tester</h2>
            <p className="subtitle">
              Handles custom schemes (<code>{navigationConfig.linking?.scheme ?? 'expofoundation'}://</code>
              ), HTTPS Universal Links, and Android App Links with safe post-login restoration.
            </p>

            <div className="form-grid">
              <label>
                <span>Test Incoming URL</span>
                <input
                  type="text"
                  value={testUrl}
                  onChange={(e) => setTestUrl(e.target.value)}
                />
              </label>
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={testAuthenticated}
                  onChange={(e) => setTestAuthenticated(e.target.checked)}
                />
                <span>Simulate User Currently Logged In</span>
              </label>
            </div>

            <h4>Deep Link Resolution Result</h4>
            <pre className="code-block">{JSON.stringify(deepLinkPreview, null, 2)}</pre>
          </div>
        )}

        {section === 'capabilities' && (
          <div className="panel">
            <h2>Expo SDK 58 Native Capability Matrix</h2>
            <p className="subtitle">
              Formal capability registry verifying iOS SwiftUI and Android Jetpack Compose / Expo
              Router support.
            </p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Capability ID</th>
                  <th>Platform</th>
                  <th>Support</th>
                  <th>Implementation</th>
                  <th>Approved Fallback</th>
                </tr>
              </thead>
              <tbody>
                {capabilities.map((cap) => (
                  <tr key={`${cap.id}_${cap.platform}`}>
                    <td>
                      <code>{cap.id}</code>
                    </td>
                    <td>{cap.platform.toUpperCase()}</td>
                    <td>
                      <span className={`badge badge-${cap.support}`}>{cap.support}</span>
                    </td>
                    <td>
                      <code>{cap.implementation ?? '—'}</code>
                    </td>
                    <td>
                      <code>{cap.fallback ?? '—'}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {section === 'json' && (
          <div className="panel">
            <h2>navigation.json Source Editor</h2>
            <p className="subtitle">
              Edit the canonical <code>navigation.json</code> document directly.
            </p>
            {jsonError && <div className="alert alert-error">{jsonError}</div>}
            <textarea
              className="json-textarea"
              rows={22}
              value={rawJsonText}
              onChange={(e) => {
                setRawJsonText(e.target.value);
                try {
                  const parsed = JSON.parse(e.target.value) as NavigationConfigDocument;
                  setJsonError(null);
                  onChange(parsed);
                } catch (err) {
                  setJsonError(err instanceof Error ? err.message : 'Invalid JSON');
                }
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}
