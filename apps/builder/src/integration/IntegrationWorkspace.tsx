import React, { useMemo, useState } from 'react';
import { AuthController, InMemoryTokenStorage } from '@expo-foundation/auth';
import { FoundationEventBus, InMemoryFlowRegistry } from '@expo-foundation/contracts';
import type {
  IntegrationConfigDocument,
  NavigationConfigDocument,
  ProjectIR,
} from '@expo-foundation/core';
import { AuthNavigationBridge } from '@expo-foundation/integration';
import {
  AndroidNativeNavigationAdapter,
  IOSNativeNavigationAdapter,
  NavigationStateManager,
} from '@expo-foundation/navigation';
import {
  createMockSession,
  MockAuthProviderAdapter,
} from '@expo-foundation/testing';

interface Props {
  config: IntegrationConfigDocument;
  navigationConfig?: NavigationConfigDocument;
  projectIR: ProjectIR;
  onChange: (next: IntegrationConfigDocument) => void;
}

export function IntegrationWorkspace({
  config,
  navigationConfig,
  projectIR,
  onChange,
}: Props) {
  const [simLogs, setSimLogs] = useState<string[]>([]);
  const [simDeepLinkUrl, setSimDeepLinkUrl] = useState<string>(
    'efshop://orders/ORD-7781?tab=tracking'
  );
  const [, setTick] = useState(0);

  const appendLog = (msg: string) => {
    setSimLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 29)]);
  };

  const runtime = useMemo(() => {
    if (!projectIR.auth || !projectIR.navigation || !projectIR.integration) {
      return null;
    }

    const eventBus = new FoundationEventBus();
    const flowRegistry = new InMemoryFlowRegistry();

    for (const flowId of Object.values(projectIR.auth.eventFlows)) {
      if (flowId) {
        flowRegistry.register(flowId, () => {});
      }
    }

    // Use isolated MockAuthProviderAdapter from @expo-foundation/testing for interactive UI preview
    const mockAdapter = new MockAuthProviderAdapter({
      providerType: projectIR.auth.providerType,
      defaultRoles: projectIR.auth.defaultRoles,
      defaultPermissions: ['orders.read'],
    });

    const authController = new AuthController({
      authIR: projectIR.auth,
      adapter: mockAdapter,
      storage: new InMemoryTokenStorage(),
      eventBus,
      flowRegistry,
    });

    const navManager = new NavigationStateManager({
      navigationIR: projectIR.navigation,
      eventBus,
    });

    const bridge = new AuthNavigationBridge({
      authController,
      navigationStateManager: navManager,
      navigationIR: projectIR.navigation,
      integrationIR: projectIR.integration,
      eventBus,
      flowRegistry,
    });

    const iosAdapter = new IOSNativeNavigationAdapter(
      projectIR.navigation,
      navManager
    );
    const androidAdapter = new AndroidNativeNavigationAdapter(
      projectIR.navigation,
      navManager
    );

    return {
      authController,
      mockAdapter,
      navManager,
      bridge,
      iosAdapter,
      androidAdapter,
      eventBus,
      flowRegistry,
    };
  }, [projectIR]);

  const forceRefresh = () => setTick((t) => t + 1);

  const routeOptions = useMemo(() => {
    if (!navigationConfig) return [];
    return [
      ...navigationConfig.routes.map((r) => r.id),
      ...navigationConfig.navigators.map((n) => n.id),
    ];
  }, [navigationConfig]);

  const updateField = (
    field: keyof IntegrationConfigDocument['authNavigation'],
    value: unknown
  ) => {
    onChange({
      ...config,
      authNavigation: {
        ...config.authNavigation,
        [field]: value,
      },
    });
  };

  const runInitialize = async () => {
    if (!runtime) return;
    const res = await runtime.bridge.initialize();
    appendLog(
      `Initialized runtime -> Auth: ${res.auth.status}, Active Route: ${res.navigation.currentRouteId}`
    );
    forceRefresh();
  };

  const runLogin = async (role = 'user') => {
    if (!runtime) return;
    await runtime.authController.initialize();
    const snap = await runtime.authController.signIn({
      email: role === 'admin' ? 'admin@expo.dev' : 'customer@expo.dev',
      password: 'Password123!',
    });

    if (role === 'admin' && snap.session) {
      // Simulate server returning elevated admin role via trusted provider getCurrentUser()
      const adminSession = createMockSession({
        user: {
          id: snap.session.user.id,
          email: snap.session.user.email,
          roles: ['admin', 'user'],
          permissions: ['orders.read', 'admin.access'],
          emailVerified: true,
        },
      });
      viLikeSetMockUser(runtime.mockAdapter, adminSession);
      await runtime.authController.refreshAccessContextFromServer();
    }

    const navState = runtime.navManager.getState();
    appendLog(
      `Login completed (${role}) -> Auth: ${snap.status}, Redirected to: ${navState.currentRouteId} (${navState.currentPath})`
    );
    forceRefresh();
  };

  const runLogout = async () => {
    if (!runtime) return;
    await runtime.authController.signOut();
    const navState = runtime.navManager.getState();
    appendLog(
      `Signed out -> Auth: anonymous, Reset to: ${navState.currentRouteId}`
    );
    forceRefresh();
  };

  const runDeepLink = () => {
    if (!runtime) return;
    const res = runtime.bridge.handleDeepLink(simDeepLinkUrl);
    const navState = runtime.navManager.getState();
    appendLog(
      `DeepLink "${simDeepLinkUrl}" -> status: ${res.status}, activeRoute: ${navState.currentRouteId}${
        res.reason ? ` (${res.reason})` : ''
      }`
    );
    forceRefresh();
  };

  const runNavigate = (routeId: string) => {
    if (!runtime) return;
    const next = runtime.navManager.navigate(routeId, {
      orderId: 'ORD-5801',
      productId: 'PROD-42',
    });
    appendLog(
      `Navigate("${routeId}") -> Active Route: ${next.currentRouteId} (${next.currentPath})`
    );
    forceRefresh();
  };

  const authSnap = runtime?.authController.getSnapshot();
  const navSnap = runtime?.navManager.getState();

  return (
    <div className="grid-2">
      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Auth-Navigation Integration Policy</div>
            <div className="panel-subtitle">
              Configure entry routes, post-login redirects, deferred deep-link restoration, and role groups
            </div>
          </div>
          <label className="checkbox-item" style={{ padding: '4px 10px' }}>
            <input
              type="checkbox"
              checked={config.authNavigation.enabled}
              onChange={(e) => updateField('enabled', e.target.checked)}
            />
            Enabled
          </label>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Guest Entry Route</label>
            <select
              className="form-select"
              value={config.authNavigation.guestEntry}
              onChange={(e) => updateField('guestEntry', e.target.value)}
            >
              {routeOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Authenticated Entry Route / Navigator</label>
            <select
              className="form-select"
              value={config.authNavigation.authenticatedEntry}
              onChange={(e) => updateField('authenticatedEntry', e.target.value)}
            >
              {routeOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">After Login Behavior</label>
            <select
              className="form-select"
              value={config.authNavigation.afterLogin}
              onChange={(e) => updateField('afterLogin', e.target.value)}
            >
              <option value="restore-intended-destination">
                restore-intended-destination (Replay Deferred Deep Link)
              </option>
              {routeOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">After Registration Route</label>
            <select
              className="form-select"
              value={config.authNavigation.afterRegistration}
              onChange={(e) => updateField('afterRegistration', e.target.value)}
            >
              {routeOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Verification Required Route</label>
            <select
              className="form-select"
              value={config.authNavigation.verificationRoute ?? ''}
              onChange={(e) => updateField('verificationRoute', e.target.value)}
            >
              {routeOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Access Denied Route</label>
            <select
              className="form-select"
              value={config.authNavigation.accessDeniedRoute ?? ''}
              onChange={(e) => updateField('accessDeniedRoute', e.target.value)}
            >
              {routeOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Interactive Runtime Simulator</div>
            <div className="panel-subtitle">
              Test startup session restoration, route guards, deferred deep links, and role checks
            </div>
          </div>
          {authSnap && (
            <span
              className={`badge ${
                authSnap.status === 'authenticated'
                  ? 'badge-success'
                  : 'badge-warning'
              }`}
            >
              Auth: {authSnap.status.toUpperCase()}
            </span>
          )}
        </div>

        {!runtime ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            Select the &ldquo;Complete E-Commerce Auth + Navigation&rdquo; preset to run the
            interactive Auth + Navigation simulator.
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                marginBottom: 14,
              }}
            >
              <button className="btn" onClick={runInitialize}>
                1. Boot / Restore Session
              </button>
              <button
                className="btn btn-primary"
                onClick={() => runLogin('user')}
              >
                2. Sign In (User)
              </button>
              <button
                className="btn btn-primary"
                onClick={() => runLogin('admin')}
              >
                Sign In (Admin Role)
              </button>
              <button className="btn" onClick={runLogout}>
                Sign Out
              </button>
            </div>

            <div className="form-group">
              <label className="form-label">
                Simulate Incoming Deep Link / Universal Link
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="form-input"
                  value={simDeepLinkUrl}
                  onChange={(e) => setSimDeepLinkUrl(e.target.value)}
                />
                <button className="btn btn-primary" onClick={runDeepLink}>
                  Dispatch URL
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">
                Test Route Navigation (Protected & Public Routes)
              </label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {Object.keys(projectIR.navigation?.routes ?? {}).map((rId) => (
                  <button
                    key={rId}
                    className="btn"
                    style={{ padding: '4px 10px', fontSize: 12 }}
                    onClick={() => runNavigate(rId)}
                  >
                    Go: {rId}
                  </button>
                ))}
              </div>
            </div>

            {navSnap && (
              <div
                style={{
                  background: '#090d16',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 12,
                  fontSize: 12,
                }}
              >
                <div>
                  <strong>Current Route:</strong>{' '}
                  <code>{navSnap.currentRouteId}</code> ({navSnap.currentPath})
                </div>
                <div>
                  <strong>Active Stack History:</strong>{' '}
                  {navSnap.history.map((h) => h.routeId).join(' → ')}
                </div>
                <div>
                  <strong>Deferred Intended Destination:</strong>{' '}
                  {navSnap.intendedDestination
                    ? `${navSnap.intendedDestination.routeId} (${navSnap.intendedDestination.path})`
                    : 'None'}
                </div>
                <div>
                  <strong>Access Context:</strong> Roles: [
                  {authSnap?.accessContext.roles.join(', ')}], Verified:{' '}
                  {String(authSnap?.accessContext.verified)}
                </div>
              </div>
            )}

            <div className="form-label">Runtime Event & Transition Log</div>
            <pre className="code-viewer" style={{ maxHeight: 160 }}>
              {simLogs.length > 0
                ? simLogs.join('\n')
                : 'Click "1. Boot / Restore Session" or "Dispatch URL" to trace runtime execution...'}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}

function viLikeSetMockUser(
  mockAdapter: MockAuthProviderAdapter,
  session: ReturnType<typeof createMockSession>
): void {
  (
    mockAdapter as unknown as {
      currentSession: ReturnType<typeof createMockSession>;
    }
  ).currentSession = session;
}
