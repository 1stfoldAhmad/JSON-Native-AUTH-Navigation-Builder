import React, { useState } from 'react';
import {
  CapabilityRegistry,
  type AccessPolicy,
  type CompilationMode,
  type NavigationConfigDocument,
  type NavigatorDefinition,
  type NavigatorType,
  type RouteDefinition,
  type RouteParamScalarType,
} from '@expo-foundation/core';

interface Props {
  config: NavigationConfigDocument;
  onChange: (next: NavigationConfigDocument) => void;
}

const capabilityRegistry = new CapabilityRegistry();

export function NavigationBuilderWorkspace({ config, onChange }: Props) {
  const [selectedRouteIdx, setSelectedRouteIdx] = useState<number>(0);
  const [selectedNavIdx, setSelectedNavIdx] = useState<number>(0);

  // Add Navigator modal / inline form state
  const [newNavId, setNewNavId] = useState('');
  const [newNavType, setNewNavType] = useState<NavigatorType>('stack');

  // Add Route inline form state
  const [newRouteId, setNewRouteId] = useState('');
  const [newRoutePath, setNewRoutePath] = useState('');
  const [newRouteScreenRef, setNewRouteScreenRef] = useState('screen.app.new-screen');

  // Add Parameter inline form state
  const [newParamName, setNewParamName] = useState('');
  const [newParamType, setNewParamType] = useState<RouteParamScalarType>('string');
  const [newParamRequired, setNewParamRequired] = useState(true);

  const iosCaps = capabilityRegistry.listCapabilities('ios');
  const androidCaps = capabilityRegistry.listCapabilities('android');

  const selectedRoute: RouteDefinition | undefined =
    config.routes[selectedRouteIdx] ?? config.routes[0];
  const selectedNav: NavigatorDefinition | undefined =
    config.navigators[selectedNavIdx] ?? config.navigators[0];

  const updateIosMode = (mode: CompilationMode) => {
    onChange({
      ...config,
      platforms: {
        ...config.platforms,
        ios: {
          ...config.platforms.ios,
          strictNative: mode === 'strict-native',
          mode,
        },
      },
    });
  };

  const updateAndroidMode = (mode: CompilationMode) => {
    onChange({
      ...config,
      platforms: {
        ...config.platforms,
        android: {
          ...config.platforms.android,
          mode,
        },
      },
    });
  };

  const updateAndroidRenderer = (
    renderer: NavigationConfigDocument['platforms']['android']['renderer']
  ) => {
    onChange({
      ...config,
      platforms: {
        ...config.platforms,
        android: {
          ...config.platforms.android,
          renderer,
        },
      },
    });
  };

  const addNavigator = () => {
    const cleanId = newNavId.trim();
    if (!cleanId || config.navigators.some((n) => n.id === cleanId)) return;
    const nextNav: NavigatorDefinition = {
      id: cleanId,
      type: newNavType,
      children: [],
    };
    const nextNavs = [...config.navigators, nextNav];
    onChange({
      ...config,
      navigators: nextNavs,
    });
    setSelectedNavIdx(nextNavs.length - 1);
    setNewNavId('');
  };

  const deleteNavigator = (idx: number) => {
    const target = config.navigators[idx];
    if (!target || config.navigators.length <= 1) return;
    const nextNavs = config.navigators
      .filter((_, i) => i !== idx)
      .map((n) => ({
        ...n,
        children: n.children.filter((c) => c !== target.id),
      }));
    const nextRoot =
      config.rootNavigator === target.id ? nextNavs[0].id : config.rootNavigator;
    onChange({
      ...config,
      rootNavigator: nextRoot,
      navigators: nextNavs,
    });
    setSelectedNavIdx(0);
  };

  const updateSelectedNavigator = (patch: Partial<NavigatorDefinition>) => {
    if (!selectedNav) return;
    const nextNavs = config.navigators.map((nav, i) =>
      i === selectedNavIdx ? { ...nav, ...patch } : nav
    );
    onChange({ ...config, navigators: nextNavs });
  };

  const toggleNavigatorChild = (childId: string) => {
    if (!selectedNav) return;
    const hasChild = selectedNav.children.includes(childId);
    const nextChildren = hasChild
      ? selectedNav.children.filter((c) => c !== childId)
      : [...selectedNav.children, childId];
    const nextInitial =
      selectedNav.initialRoute && nextChildren.includes(selectedNav.initialRoute)
        ? selectedNav.initialRoute
        : nextChildren[0];
    updateSelectedNavigator({
      children: nextChildren,
      initialRoute: nextInitial,
    });
  };

  const addRoute = () => {
    const cleanId = newRouteId.trim();
    if (!cleanId || config.routes.some((r) => r.id === cleanId)) return;
    const path = newRoutePath.trim() || `/${cleanId}`;
    const screenRef = newRouteScreenRef.trim() || `screen.app.${cleanId}`;
    const parentNavId = selectedNav?.id ?? config.rootNavigator;

    const newRoute: RouteDefinition = {
      id: cleanId,
      name: cleanId,
      path: path.startsWith('/') ? path : `/${path}`,
      screenRef,
      navigatorId: parentNavId,
      access: 'authenticated',
      options: {
        title: cleanId,
        headerShown: true,
      },
    };

    const nextRoutes = [...config.routes, newRoute];
    const nextNavs = config.navigators.map((nav) =>
      nav.id === parentNavId && !nav.children.includes(cleanId)
        ? { ...nav, children: [...nav.children, cleanId] }
        : nav
    );

    onChange({
      ...config,
      routes: nextRoutes,
      navigators: nextNavs,
    });
    setSelectedRouteIdx(nextRoutes.length - 1);
    setNewRouteId('');
    setNewRoutePath('');
  };

  const deleteRoute = (idx: number) => {
    const target = config.routes[idx];
    if (!target || config.routes.length <= 1) return;
    const nextRoutes = config.routes.filter((_, i) => i !== idx);
    const nextNavs = config.navigators.map((nav) => {
      const filteredChildren = nav.children.filter((c) => c !== target.id);
      return {
        ...nav,
        children: filteredChildren,
        initialRoute:
          nav.initialRoute === target.id ? filteredChildren[0] : nav.initialRoute,
      };
    });
    onChange({
      ...config,
      routes: nextRoutes,
      navigators: nextNavs,
    });
    setSelectedRouteIdx(0);
  };

  const updateRouteAccess = (routeIndex: number, accessValue: string) => {
    const nextRoutes = [...config.routes];
    const target = { ...nextRoutes[routeIndex] };

    if (
      accessValue === 'public' ||
      accessValue === 'guest' ||
      accessValue === 'authenticated' ||
      accessValue === 'verified'
    ) {
      target.access = accessValue as AccessPolicy;
    } else if (accessValue === 'role:admin') {
      target.access = { roles: ['admin'], mode: 'any' };
    } else if (accessValue === 'perm:orders.read') {
      target.access = { permissions: ['orders.read'], mode: 'all' };
    }

    nextRoutes[routeIndex] = target;
    onChange({ ...config, routes: nextRoutes });
  };

  const updateRouteField = (
    routeIndex: number,
    field: 'path' | 'screenRef' | 'name' | 'navigatorId',
    value: string
  ) => {
    const nextRoutes = [...config.routes];
    nextRoutes[routeIndex] = {
      ...nextRoutes[routeIndex],
      [field]: value,
    };
    onChange({ ...config, routes: nextRoutes });
  };

  const addParamToSelectedRoute = () => {
    if (!selectedRoute || !newParamName.trim()) return;
    const nextRoutes = [...config.routes];
    const existingParams = selectedRoute.params ?? {};
    nextRoutes[selectedRouteIdx] = {
      ...selectedRoute,
      params: {
        ...existingParams,
        [newParamName.trim()]: {
          type: newParamType,
          required: newParamRequired,
        },
      },
    };
    onChange({ ...config, routes: nextRoutes });
    setNewParamName('');
  };

  const removeParamFromSelectedRoute = (paramKey: string) => {
    if (!selectedRoute || !selectedRoute.params) return;
    const nextParams = { ...selectedRoute.params };
    delete nextParams[paramKey];
    const nextRoutes = [...config.routes];
    nextRoutes[selectedRouteIdx] = {
      ...selectedRoute,
      params: nextParams,
    };
    onChange({ ...config, routes: nextRoutes });
  };

  const formatAccessSelectValue = (access?: AccessPolicy): string => {
    if (!access) return 'public';
    if (typeof access === 'string') return access;
    if ('roles' in access) return 'role:admin';
    if ('permissions' in access) return 'perm:orders.read';
    return 'authenticated';
  };

  return (
    <div className="grid-2">
      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Navigation Graph & Navigator CRUD</div>
            <div className="panel-subtitle">
              Add, edit, or remove navigators (stack, tabs, split, drawer, modal) and manage child hierarchies
            </div>
          </div>
          <span className="badge badge-info">
            Root: {config.rootNavigator}
          </span>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">iOS Compilation Mode (@expo/ui/swift-ui)</label>
            <select
              className="form-select"
              value={
                config.platforms.ios.mode ??
                (config.platforms.ios.strictNative
                  ? 'strict-native'
                  : 'automatic-fallback')
              }
              onChange={(e) => updateIosMode(e.target.value as CompilationMode)}
            >
              <option value="strict-native">strict-native (SwiftUI Host Required)</option>
              <option value="automatic-fallback">automatic-fallback</option>
              <option value="diagnostic">diagnostic</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Android Compilation Mode</label>
            <select
              className="form-select"
              value={config.platforms.android.mode ?? 'automatic-fallback'}
              onChange={(e) => updateAndroidMode(e.target.value as CompilationMode)}
            >
              <option value="automatic-fallback">
                automatic-fallback (Compose + Expo Router)
              </option>
              <option value="strict-native">
                strict-native (Errors on Router Fallbacks)
              </option>
              <option value="diagnostic">diagnostic</option>
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Android Tabs Renderer</label>
            <select
              className="form-select"
              value={config.platforms.android.renderer}
              onChange={(e) =>
                updateAndroidRenderer(
                  e.target.value as NavigationConfigDocument['platforms']['android']['renderer']
                )
              }
            >
              <option value="auto">auto (Compose NavigationBar + TabRouter)</option>
              <option value="expo-ui-compose">expo-ui-compose</option>
              <option value="expo-router">expo-router (NativeTabs Fallback)</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Root Navigator</label>
            <select
              className="form-select"
              value={config.rootNavigator}
              onChange={(e) =>
                onChange({ ...config, rootNavigator: e.target.value })
              }
            >
              {config.navigators.map((nav) => (
                <option key={nav.id} value={nav.id}>
                  {nav.id} ({nav.type})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="panel-title" style={{ marginTop: 12, marginBottom: 8 }}>
          Navigator Hierarchy ({config.navigators.length})
        </div>

        <div className="form-row" style={{ marginBottom: 10 }}>
          <input
            className="form-input"
            placeholder="New navigator ID (e.g. modal-stack)"
            value={newNavId}
            onChange={(e) => setNewNavId(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              className="form-select"
              value={newNavType}
              onChange={(e) => setNewNavType(e.target.value as NavigatorType)}
            >
              <option value="stack">stack</option>
              <option value="tabs">tabs</option>
              <option value="split">split</option>
              <option value="drawer">drawer</option>
              <option value="modal">modal</option>
            </select>
            <button className="btn btn-primary" onClick={addNavigator}>
              + Navigator
            </button>
          </div>
        </div>

        {config.navigators.map((nav, idx) => (
          <div
            key={nav.id}
            className="graph-node"
            style={{
              cursor: 'pointer',
              borderColor:
                idx === selectedNavIdx ? 'var(--accent)' : 'var(--border)',
            }}
            onClick={() => setSelectedNavIdx(idx)}
          >
            <div className="graph-node-header">
              <span className="graph-node-id">
                {nav.id}{' '}
                {nav.id === config.rootNavigator ? '(root)' : ''}
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span className="badge badge-success">{nav.type.toUpperCase()}</span>
                {config.navigators.length > 1 && (
                  <button
                    className="btn"
                    style={{ padding: '2px 8px', fontSize: 11 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteNavigator(idx);
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Initial: <code>{nav.initialRoute ?? nav.children[0] ?? 'none'}</code>
            </div>
            <div className="graph-children">
              {nav.children.map((c) => (
                <span key={c} className="chip">
                  {c}
                </span>
              ))}
            </div>
          </div>
        ))}

        {selectedNav && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 8,
              background: 'rgba(15, 23, 42, 0.55)',
              border: '1px solid var(--border)',
            }}
          >
            <div className="panel-title" style={{ marginBottom: 8 }}>
              Edit Navigator: <code>{selectedNav.id}</code>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Navigator Type</label>
                <select
                  className="form-select"
                  value={selectedNav.type}
                  onChange={(e) =>
                    updateSelectedNavigator({
                      type: e.target.value as NavigatorType,
                    })
                  }
                >
                  <option value="stack">stack</option>
                  <option value="tabs">tabs</option>
                  <option value="split">split</option>
                  <option value="drawer">drawer</option>
                  <option value="modal">modal</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Initial Child Route / Navigator</label>
                <select
                  className="form-select"
                  value={selectedNav.initialRoute ?? selectedNav.children[0] ?? ''}
                  onChange={(e) =>
                    updateSelectedNavigator({ initialRoute: e.target.value })
                  }
                >
                  {selectedNav.children.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-label" style={{ marginBottom: 6 }}>
              Toggle Assigned Child Navigators & Routes:
            </div>
            <div className="graph-children">
              {[
                ...config.navigators
                  .filter((n) => n.id !== selectedNav.id)
                  .map((n) => n.id),
                ...config.routes.map((r) => r.id),
              ].map((candidateId) => {
                const active = selectedNav.children.includes(candidateId);
                return (
                  <button
                    key={candidateId}
                    type="button"
                    className="btn"
                    style={{
                      padding: '3px 8px',
                      fontSize: 11,
                      background: active ? 'var(--accent)' : undefined,
                      borderColor: active ? 'var(--accent)' : undefined,
                    }}
                    onClick={() => toggleNavigatorChild(candidateId)}
                  >
                    {active ? '✓ ' : '+ '}
                    {candidateId}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="panel-title" style={{ marginTop: 16, marginBottom: 8 }}>
          Deep Linking & Universal Link Host Allowlist
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">URL Scheme</label>
            <input
              className="form-input"
              value={config.linking?.scheme ?? 'app'}
              onChange={(e) =>
                onChange({
                  ...config,
                  linking: {
                    scheme: e.target.value,
                    hosts: config.linking?.hosts ?? [],
                    universalLinks: config.linking?.universalLinks ?? false,
                    androidAppLinks: config.linking?.androidAppLinks ?? false,
                  },
                })
              }
            />
          </div>
          <div className="form-group">
            <label className="form-label">Allowed HTTPS Hosts (comma-separated)</label>
            <input
              className="form-input"
              placeholder="shop.expo-foundation.dev"
              value={(config.linking?.hosts ?? []).join(', ')}
              onChange={(e) =>
                onChange({
                  ...config,
                  linking: {
                    scheme: config.linking?.scheme ?? 'app',
                    hosts: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                    universalLinks: config.linking?.universalLinks ?? false,
                    androidAppLinks: config.linking?.androidAppLinks ?? false,
                  },
                })
              }
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Routes, Parameters & Access Policies</div>
              <div className="panel-subtitle">
                Create routes, bind screenRef IDs, configure typed parameters, and set route guards
              </div>
            </div>
            <span className="badge badge-info">{config.routes.length} Routes</span>
          </div>

          <div className="form-row" style={{ marginBottom: 10 }}>
            <input
              className="form-input"
              placeholder="Route ID (e.g. checkout)"
              value={newRouteId}
              onChange={(e) => setNewRouteId(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="form-input"
                placeholder="/checkout"
                value={newRoutePath}
                onChange={(e) => setNewRoutePath(e.target.value)}
              />
              <button className="btn btn-primary" onClick={addRoute}>
                + Route
              </button>
            </div>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Route ID</th>
                <th>Path</th>
                <th>ScreenRef</th>
                <th>Access Policy</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {config.routes.map((route, idx) => (
                <tr
                  key={route.id}
                  style={{
                    background:
                      idx === selectedRouteIdx
                        ? 'rgba(59, 130, 246, 0.12)'
                        : undefined,
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelectedRouteIdx(idx)}
                >
                  <td>
                    <code>{route.id}</code>
                  </td>
                  <td>
                    <input
                      className="form-input"
                      style={{ padding: '4px 8px', fontSize: 12 }}
                      value={route.path}
                      onChange={(e) =>
                        updateRouteField(idx, 'path', e.target.value)
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="form-input"
                      style={{ padding: '4px 8px', fontSize: 12 }}
                      value={route.screenRef}
                      onChange={(e) =>
                        updateRouteField(idx, 'screenRef', e.target.value)
                      }
                    />
                  </td>
                  <td>
                    <select
                      className="form-select"
                      style={{ padding: '4px 8px', fontSize: 12 }}
                      value={formatAccessSelectValue(route.access)}
                      onChange={(e) => updateRouteAccess(idx, e.target.value)}
                    >
                      <option value="public">public</option>
                      <option value="guest">guest (Unauthenticated only)</option>
                      <option value="authenticated">authenticated</option>
                      <option value="verified">verified</option>
                      <option value="role:admin">roles: [admin]</option>
                      <option value="perm:orders.read">
                        permissions: [orders.read]
                      </option>
                    </select>
                  </td>
                  <td>
                    {config.routes.length > 1 && (
                      <button
                        className="btn"
                        style={{ padding: '2px 8px', fontSize: 11 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteRoute(idx);
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {selectedRoute && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 8,
                background: 'rgba(15, 23, 42, 0.55)',
                border: '1px solid var(--border)',
              }}
            >
              <div className="panel-title" style={{ marginBottom: 8 }}>
                Route Parameter Schema: <code>{selectedRoute.id}</code>
              </div>
              <div className="graph-children" style={{ marginBottom: 10 }}>
                {Object.entries(selectedRoute.params ?? {}).map(
                  ([pName, pSchema]) => (
                    <span key={pName} className="chip">
                      {pName}: {pSchema.type}
                      {pSchema.required ? ' (req)' : ''}{' '}
                      <button
                        type="button"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--danger)',
                          cursor: 'pointer',
                          marginLeft: 4,
                        }}
                        onClick={() => removeParamFromSelectedRoute(pName)}
                      >
                        ×
                      </button>
                    </span>
                  )
                )}
                {Object.keys(selectedRoute.params ?? {}).length === 0 && (
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    No typed parameters declared on this route.
                  </span>
                )}
              </div>

              <div className="form-row">
                <input
                  className="form-input"
                  placeholder="Param name (e.g. orderId)"
                  value={newParamName}
                  onChange={(e) => setNewParamName(e.target.value)}
                />
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select
                    className="form-select"
                    value={newParamType}
                    onChange={(e) =>
                      setNewParamType(e.target.value as RouteParamScalarType)
                    }
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                    <option value="uuid">uuid</option>
                    <option value="date">date</option>
                    <option value="enum">enum</option>
                    <option value="array">array</option>
                  </select>
                  <label className="checkbox-item" style={{ padding: '4px 8px' }}>
                    <input
                      type="checkbox"
                      checked={newParamRequired}
                      onChange={(e) => setNewParamRequired(e.target.checked)}
                    />
                    Req
                  </label>
                  <button
                    className="btn btn-primary"
                    onClick={addParamToSelectedRoute}
                  >
                    + Param
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">
                Expo SDK 58 Platform Capability Matrix
              </div>
              <div className="panel-subtitle">
                Verification status: documented | simulated | native-verified
              </div>
            </div>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Capability</th>
                <th>iOS (@expo/ui/swift-ui)</th>
                <th>Android (Compose + Router)</th>
                <th>Verification</th>
              </tr>
            </thead>
            <tbody>
              {iosCaps.map((iosCap) => {
                const andCap = androidCaps.find((c) => c.id === iosCap.id);
                return (
                  <tr key={iosCap.id}>
                    <td>
                      <code>{iosCap.id}</code>
                    </td>
                    <td>
                      <span className="badge badge-success">{iosCap.support}</span>{' '}
                      <small style={{ color: 'var(--text-secondary)' }}>
                        {iosCap.implementation.split('#')[1]}
                      </small>
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          andCap?.support === 'native' ||
                          andCap?.support === 'supported'
                            ? 'badge-success'
                            : 'badge-warning'
                        }`}
                      >
                        {andCap?.support ?? 'unsupported'}
                      </span>{' '}
                      <small style={{ color: 'var(--text-secondary)' }}>
                        {andCap?.implementation.split('#')[1]}
                      </small>
                    </td>
                    <td>
                      <span className="badge badge-info">
                        {iosCap.verificationStatus}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
