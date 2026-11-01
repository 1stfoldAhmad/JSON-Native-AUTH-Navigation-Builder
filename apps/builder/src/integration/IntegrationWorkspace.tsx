import React, { useMemo, useState } from 'react';
import { AuthController, RestAuthProviderAdapter } from '@expo-foundation/auth';
import { FoundationEventBus } from '@expo-foundation/contracts';
import {
  defaultFoundationCompiler,
  type AuthConfigDocument,
  type IntegrationConfigDocument,
  type NavigationConfigDocument,
} from '@expo-foundation/core';
import { AuthNavigationBridge } from '@expo-foundation/integration';
import {
  AndroidNavigationAdapter,
  IOSNativeNavigationAdapter,
  NavigationStateManager,
} from '@expo-foundation/navigation';

export interface IntegrationWorkspaceProps {
  authConfig: AuthConfigDocument | null;
  navigationConfig: NavigationConfigDocument | null;
  integrationConfig: IntegrationConfigDocument | null;
  onChange: (next: IntegrationConfigDocument) => void;
}

export function IntegrationWorkspace({
  authConfig,
  navigationConfig,
  integrationConfig,
  onChange,
}: IntegrationWorkspaceProps) {
  const [simTick, setSimTick] = useState(0);
  const [deepLinkInput, setDeepLinkInput] = useState('https://example.com/orders/ORD-1024');
  const [rawJsonText, setRawJsonText] = useState(() =>
    integrationConfig ? JSON.stringify(integrationConfig, null, 2) : ''
  );
  const [showJson, setShowJson] = useState(false);

  const runtimeHarness = useMemo(() => {
    if (!authConfig || !navigationConfig || !integrationConfig) {
      return null;
    }
    const compiled = defaultFoundationCompiler.compile({
      auth: authConfig,
      navigation: navigationConfig,
      integration: integrationConfig,
    });
    if (!compiled.ir?.auth || !compiled.ir.navigation || !compiled.ir.integration) {
      return null;
    }

    const eventBus = new FoundationEventBus();
    const adapter = new RestAuthProviderAdapter({
      httpClient: async (req) => ({
        status: 200,
        ok: true,
        data: {
          data: {
            access_token: 'sim_access_token_hidden',
            refresh_token: 'sim_refresh_token_hidden',
            expires_in: 3600,
            verification_required: req.url.endsWith('/register'),
            user: {
              id: 'usr_sim_1',
              email: 'architect@expo.dev',
              emailVerified: !req.url.endsWith('/register'),
              roles: ['user'],
              permissions: ['orders.read'],
            },
          },
        },
      }),
    });

    const authController = new AuthController({
      authIR: compiled.ir.auth,
      adapter,
      eventBus,
    });
    const navStateManager = new NavigationStateManager({
      navigationIR: compiled.ir.navigation,
      eventBus,
    });
    const bridge = new AuthNavigationBridge({
      integrationIR: compiled.ir.integration,
      authController,
      navigationStateManager: navStateManager,
      eventBus,
    });
    const iosAdapter = new IOSNativeNavigationAdapter(navStateManager);
    const androidAdapter = new AndroidNavigationAdapter(navStateManager);

    return {
      authController,
      navStateManager,
      bridge,
      iosAdapter,
      androidAdapter,
      eventBus,
    };
  }, [authConfig, navigationConfig, integrationConfig]);

  if (!integrationConfig || !authConfig || !navigationConfig) {
    return (
      <div className="panel empty-panel">
        <h3>Integration Workspace Requires Both Auth & Navigation Configs</h3>
        <p>
          Switch to <strong>Complete Foundation</strong> mode in the top bar to configure
          Auth-to-Navigation integration, route guards, and intended-destination restoration.
        </p>
      </div>
    );
  }

  const routeIds = navigationConfig.routes.map((r) => r.id);
  const bump = () => setSimTick((x) => x + 1);

  return (
    <div className="workspace-layout single-col">
      <div className="panel">
        <div className="panel-header-row">
          <div>
            <h2>Auth & Navigation Integration Engine</h2>
            <p className="subtitle">
              Connects authentication lifecycle events to route guards, entry points, and
              intended-destination restoration without coupling either builder.
            </p>
          </div>
          <button
            className="btn"
            onClick={() => {
              setRawJsonText(JSON.stringify(integrationConfig, null, 2));
              setShowJson(!showJson);
            }}
          >
            {showJson ? 'Show Visual Inspector' : 'Edit integration.json Source'}
          </button>
        </div>

        {showJson ? (
          <textarea
            className="json-textarea"
            rows={18}
            value={rawJsonText}
            onChange={(e) => {
              setRawJsonText(e.target.value);
              try {
                const parsed = JSON.parse(e.target.value) as IntegrationConfigDocument;
                onChange(parsed);
              } catch {
                // wait until valid JSON
              }
            }}
          />
        ) : (
          <div className="form-grid">
            <label>
              <span>Guest Entry Route</span>
              <select
                value={integrationConfig.authNavigation.guestEntry}
                onChange={(e) =>
                  onChange({
                    ...integrationConfig,
                    authNavigation: {
                      ...integrationConfig.authNavigation,
                      guestEntry: e.target.value,
                    },
                  })
                }
              >
                {routeIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Authenticated Entry Route</span>
              <select
                value={integrationConfig.authNavigation.authenticatedEntry}
                onChange={(e) =>
                  onChange({
                    ...integrationConfig,
                    authNavigation: {
                      ...integrationConfig.authNavigation,
                      authenticatedEntry: e.target.value,
                    },
                  })
                }
              >
                {routeIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>After Login Policy</span>
              <select
                value={integrationConfig.authNavigation.afterLogin}
                onChange={(e) =>
                  onChange({
                    ...integrationConfig,
                    authNavigation: {
                      ...integrationConfig.authNavigation,
                      afterLogin: e.target.value,
                    },
                  })
                }
              >
                <option value="restore-intended-destination">
                  restore-intended-destination
                </option>
                {routeIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>After Logout Destination</span>
              <select
                value={integrationConfig.authNavigation.afterLogout}
                onChange={(e) =>
                  onChange({
                    ...integrationConfig,
                    authNavigation: {
                      ...integrationConfig.authNavigation,
                      afterLogout: e.target.value,
                    },
                  })
                }
              >
                {routeIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {runtimeHarness && (
        <div className="panel" data-sim-tick={simTick}>
          <h3>Interactive End-to-End Auth & Native Navigation Simulator</h3>
          <p className="subtitle">
            Test deep-link deferral, login destination restoration, tab stack preservation, iOS
            native back-swipe, Android hardware back, and logout history reset in real time.
          </p>

          <div className="simulator-toolbar">
            <button
              className="btn btn-sm"
              onClick={async () => {
                await runtimeHarness.authController.initialize();
                bump();
              }}
            >
              1. App Startup / Restore
            </button>
            <button
              className="btn btn-sm"
              onClick={() => {
                runtimeHarness.bridge.handleDeepLink(deepLinkInput);
                bump();
              }}
            >
              2. Open Deep Link ({deepLinkInput})
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={async () => {
                await runtimeHarness.authController.initialize();
                await runtimeHarness.authController.signIn({
                  email: 'architect@expo.dev',
                  password: 'password123',
                });
                bump();
              }}
            >
              3. Sign In (Restores Intended Route)
            </button>
            <button
              className="btn btn-sm"
              onClick={() => {
                runtimeHarness.iosAdapter.onNativeTabSelect('tab.search.stack');
                runtimeHarness.navStateManager.push('app.products.detail', {
                  productId: 'PROD-2026',
                });
                bump();
              }}
            >
              4. Switch to Search Tab & Push Detail
            </button>
            <button
              className="btn btn-sm"
              onClick={() => {
                runtimeHarness.androidAdapter.handleHardwareBack();
                bump();
              }}
            >
              5. Android Hardware Back / iOS Swipe Back
            </button>
            <button
              className="btn btn-sm"
              onClick={async () => {
                await runtimeHarness.authController.signOut();
                bump();
              }}
            >
              6. Sign Out (Clears Protected History)
            </button>
          </div>

          <div className="form-grid" style={{ marginBottom: '12px' }}>
            <label>
              <span>Deep Link URL to Simulate</span>
              <input
                type="text"
                value={deepLinkInput}
                onChange={(e) => setDeepLinkInput(e.target.value)}
              />
            </label>
          </div>

          <div className="split-preview three-col">
            <div>
              <h4>Auth State & Access Context</h4>
              <pre className="code-block">
                {JSON.stringify(
                  {
                    status: runtimeHarness.authController.getState().status,
                    accessContext: runtimeHarness.authController.getAccessContext(),
                    intendedDestination:
                      runtimeHarness.bridge.deepLinkManager.getIntendedDestination(),
                  },
                  null,
                  2
                )}
              </pre>
            </div>

            <div>
              <h4>iOS SwiftUI & Android Compose State</h4>
              <pre className="code-block">
                {JSON.stringify(
                  {
                    activeRouteId: runtimeHarness.navStateManager.getState().activeRouteId,
                    params: runtimeHarness.navStateManager.getState().params,
                    historyDepth: runtimeHarness.navStateManager.getState().history.length,
                    iosNavigationStack:
                      runtimeHarness.iosAdapter.getNavigationStackDescriptor(),
                    androidStack: runtimeHarness.androidAdapter.getStackDescriptor(),
                  },
                  null,
                  2
                )}
              </pre>
            </div>

            <div>
              <h4>Sanitized FoundationEventBus Log</h4>
              <pre className="code-block">
                {JSON.stringify(
                  runtimeHarness.eventBus.getHistory().slice(-8),
                  null,
                  2
                )}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
