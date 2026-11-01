import React, { useMemo, useState } from 'react';
import {
  defaultFoundationCompiler,
  type AuthConfigDocument,
  type IntegrationConfigDocument,
  type NavigationConfigDocument,
} from '@expo-foundation/core';
import { AuthBuilderWorkspace } from './auth-builder/AuthBuilderWorkspace.js';
import { DiagnosticsAndGeneratorWorkspace } from './diagnostics/DiagnosticsAndGeneratorWorkspace.js';
import { IntegrationWorkspace } from './integration/IntegrationWorkspace.js';
import { NavigationBuilderWorkspace } from './navigation-builder/NavigationBuilderWorkspace.js';
import { BUILDER_PRESETS, type BuilderPresetId } from './presets.js';

type ActiveWorkspaceTab = 'auth' | 'navigation' | 'integration' | 'diagnostics';

export function App() {
  const [presetId, setPresetId] = useState<BuilderPresetId>('complete');
  const [activeTab, setActiveTab] = useState<ActiveWorkspaceTab>('auth');

  const [authConfig, setAuthConfig] = useState<AuthConfigDocument | null>(() =>
    structuredClone(BUILDER_PRESETS.complete.auth)
  );
  const [navigationConfig, setNavigationConfig] =
    useState<NavigationConfigDocument | null>(() =>
      structuredClone(BUILDER_PRESETS.complete.navigation)
    );
  const [integrationConfig, setIntegrationConfig] =
    useState<IntegrationConfigDocument | null>(() =>
      structuredClone(BUILDER_PRESETS.complete.integration)
    );

  const loadPreset = (id: BuilderPresetId) => {
    const preset = BUILDER_PRESETS[id];
    setPresetId(id);
    setAuthConfig(preset.auth ? structuredClone(preset.auth) : null);
    setNavigationConfig(preset.navigation ? structuredClone(preset.navigation) : null);
    setIntegrationConfig(preset.integration ? structuredClone(preset.integration) : null);
    if (id === 'auth-only') {
      setActiveTab('auth');
    } else if (id === 'navigation-only') {
      setActiveTab('navigation');
    }
  };

  const compilation = useMemo(
    () =>
      defaultFoundationCompiler.compile({
        auth: authConfig,
        navigation: navigationConfig,
        integration: integrationConfig,
      }),
    [authConfig, navigationConfig, integrationConfig]
  );

  const errorCount = compilation.diagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = compilation.diagnostics.filter(
    (d) => d.severity === 'warning'
  ).length;

  const handleInjectSampleError = () => {
    if (authConfig) {
      const brokenAuth = structuredClone(authConfig);
      if (brokenAuth.provider.config?.endpoints) {
        delete brokenAuth.provider.config.endpoints.refresh;
      }
      if (brokenAuth.provider.config?.responseMapping) {
        brokenAuth.provider.config.responseMapping.accessToken = 'eval(window.token)';
      }
      delete brokenAuth.screenRefs.verification;
      setAuthConfig(brokenAuth);
    }
    if (navigationConfig) {
      const brokenNav = structuredClone(navigationConfig);
      brokenNav.navigators[0].initialRoute = 'route.does.not.exist';
      setNavigationConfig(brokenNav);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-badge">SDK 58</div>
          <div>
            <h1>Expo App Foundation Builder</h1>
            <p>
              Reusable JSON-Driven Auth Builder & Native SwiftUI / Compose Navigation Builder
            </p>
          </div>
        </div>

        <div className="topbar-controls">
          <label className="preset-selector">
            <span>Execution Mode:</span>
            <select
              value={presetId}
              onChange={(e) => loadPreset(e.target.value as BuilderPresetId)}
            >
              {Object.values(BUILDER_PRESETS).map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>

          <div
            className={`status-indicator ${
              compilation.canGenerate ? 'status-ok' : 'status-err'
            }`}
          >
            <span>{compilation.canGenerate ? 'Compile Ready' : 'Compile Blocked'}</span>
            <small>
              {errorCount} Err · {warningCount} Warn
            </small>
          </div>
        </div>
      </header>

      <nav className="main-tabs">
        <button
          className={`main-tab-btn ${activeTab === 'auth' ? 'active' : ''}`}
          onClick={() => setActiveTab('auth')}
        >
          1. Expo Auth Builder {authConfig ? '' : '(Off)'}
        </button>
        <button
          className={`main-tab-btn ${activeTab === 'navigation' ? 'active' : ''}`}
          onClick={() => setActiveTab('navigation')}
        >
          2. Expo Navigation Builder {navigationConfig ? '' : '(Off)'}
        </button>
        <button
          className={`main-tab-btn ${activeTab === 'integration' ? 'active' : ''}`}
          onClick={() => setActiveTab('integration')}
        >
          3. Auth ↔ Navigation Integration & Simulator
        </button>
        <button
          className={`main-tab-btn ${activeTab === 'diagnostics' ? 'active' : ''}`}
          onClick={() => setActiveTab('diagnostics')}
        >
          4. Diagnostics, IR & Code Generator ({compilation.diagnostics.length})
        </button>
      </nav>

      <div className="workspace-wrapper">
        {activeTab === 'auth' && (
          <AuthBuilderWorkspace
            authConfig={authConfig}
            onChange={setAuthConfig}
            diagnostics={compilation.diagnostics}
          />
        )}
        {activeTab === 'navigation' && (
          <NavigationBuilderWorkspace
            navigationConfig={navigationConfig}
            onChange={setNavigationConfig}
            diagnostics={compilation.diagnostics}
          />
        )}
        {activeTab === 'integration' && (
          <IntegrationWorkspace
            authConfig={authConfig}
            navigationConfig={navigationConfig}
            integrationConfig={integrationConfig}
            onChange={setIntegrationConfig}
          />
        )}
        {activeTab === 'diagnostics' && (
          <DiagnosticsAndGeneratorWorkspace
            compilation={compilation}
            authConfig={authConfig}
            navigationConfig={navigationConfig}
            onInjectSampleError={handleInjectSampleError}
            onResetCleanPreset={() => loadPreset(presetId)}
          />
        )}
      </div>
    </div>
  );
}
