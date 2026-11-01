import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FoundationCompiler,
  type AuthConfigDocument,
  type IntegrationConfigDocument,
  type NavigationConfigDocument,
} from '@expo-foundation/core';
import { AuthBuilderWorkspace } from './auth-builder/AuthBuilderWorkspace.js';
import { DiagnosticsAndGeneratorWorkspace } from './diagnostics/DiagnosticsAndGeneratorWorkspace.js';
import { IntegrationWorkspace } from './integration/IntegrationWorkspace.js';
import { NavigationBuilderWorkspace } from './navigation-builder/NavigationBuilderWorkspace.js';
import { BUILDER_PRESETS, type BuilderPreset } from './presets.js';

const compiler = new FoundationCompiler();
const STORAGE_KEY = 'expo_foundation_builder_project_v1';

interface BuilderProjectRevision {
  presetId: string;
  authConfig?: AuthConfigDocument;
  navigationConfig?: NavigationConfigDocument;
  integrationConfig?: IntegrationConfigDocument;
}

export function App() {
  const [activeTab, setActiveTab] = useState<
    'auth' | 'navigation' | 'integration' | 'diagnostics'
  >('navigation');

  const initialRevision = useMemo<BuilderProjectRevision>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as BuilderProjectRevision;
        if (parsed.authConfig || parsed.navigationConfig) {
          return parsed;
        }
      }
    } catch {
      // Fall back to default preset
    }
    return {
      presetId: BUILDER_PRESETS[0].id,
      authConfig: structuredClone(BUILDER_PRESETS[0].auth),
      navigationConfig: structuredClone(BUILDER_PRESETS[0].navigation),
      integrationConfig: structuredClone(BUILDER_PRESETS[0].integration),
    };
  }, []);

  const [current, setCurrent] = useState<BuilderProjectRevision>(initialRevision);
  const [undoStack, setUndoStack] = useState<BuilderProjectRevision[]>([]);
  const [redoStack, setRedoStack] = useState<BuilderProjectRevision[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // Ignore storage quota errors
    }
  }, [current]);

  const commitChange = (next: BuilderProjectRevision) => {
    setUndoStack((prev) => [...prev.slice(-29), current]);
    setRedoStack([]);
    setCurrent(next);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [current, ...prev]);
    setCurrent(previous);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[0];
    setRedoStack((prev) => prev.slice(1));
    setUndoStack((prev) => [...prev, current]);
    setCurrent(next);
  };

  const loadPreset = (preset: BuilderPreset) => {
    commitChange({
      presetId: preset.id,
      authConfig: preset.auth ? structuredClone(preset.auth) : undefined,
      navigationConfig: preset.navigation
        ? structuredClone(preset.navigation)
        : undefined,
      integrationConfig: preset.integration
        ? structuredClone(preset.integration)
        : undefined,
    });
    if (!preset.navigation && preset.auth) {
      setActiveTab('auth');
    } else if (!preset.auth && preset.navigation) {
      setActiveTab('navigation');
    }
  };

  const handleExportProjectJson = () => {
    const payload = JSON.stringify(current, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expo-foundation-project-${current.presetId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportProjectJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (parsed.authConfig || parsed.navigationConfig) {
          commitChange({
            presetId: parsed.presetId ?? 'custom-imported',
            authConfig: parsed.authConfig,
            navigationConfig: parsed.navigationConfig,
            integrationConfig: parsed.integrationConfig,
          });
        }
      } catch {
        // Ignore invalid import file
      }
    };
    reader.readAsText(file);
  };

  const projectIR = useMemo(() => {
    return compiler.compile({
      auth: current.authConfig,
      navigation: current.navigationConfig,
      integration: current.integrationConfig,
    });
  }, [current]);

  const errorCount = projectIR.diagnostics.filter(
    (d) => d.severity === 'error'
  ).length;
  const warningCount = projectIR.diagnostics.filter(
    (d) => d.severity === 'warning'
  ).length;

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <div className="brand-badge">EF</div>
          <div>
            <div className="brand-title">
              Expo SDK 58 Auth &amp; Native Navigation Builder Studio
            </div>
            <div className="brand-subtitle">
              JSON-Driven Compiler • SwiftUI (@expo/ui/swift-ui) • Jetpack Compose + Expo Router
            </div>
          </div>
        </div>

        <div className="toolbar">
          <select
            className="form-select"
            style={{ width: 240 }}
            value={current.presetId}
            onChange={(e) => {
              const found = BUILDER_PRESETS.find((p) => p.id === e.target.value);
              if (found) loadPreset(found);
            }}
          >
            {BUILDER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                Preset: {p.label}
              </option>
            ))}
          </select>

          <button
            className="btn"
            disabled={undoStack.length === 0}
            onClick={handleUndo}
            title="Undo last change"
          >
            ↶ Undo ({undoStack.length})
          </button>
          <button
            className="btn"
            disabled={redoStack.length === 0}
            onClick={handleRedo}
            title="Redo change"
          >
            ↷ Redo ({redoStack.length})
          </button>

          <button className="btn" onClick={handleExportProjectJson}>
            Export Project
          </button>
          <button
            className="btn"
            onClick={() => fileInputRef.current?.click()}
          >
            Import JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={handleImportProjectJson}
          />

          <span
            className={`badge ${
              errorCount > 0 ? 'badge-error' : 'badge-success'
            }`}
          >
            {errorCount} Errors • {warningCount} Warnings
          </span>
        </div>
      </header>

      <nav className="workspace-tabs">
        <button
          className={`tab-btn ${activeTab === 'navigation' ? 'active' : ''}`}
          onClick={() => setActiveTab('navigation')}
        >
          1. Navigation Builder &amp; Graph CRUD
        </button>
        <button
          className={`tab-btn ${activeTab === 'auth' ? 'active' : ''}`}
          onClick={() => setActiveTab('auth')}
        >
          2. Auth Builder &amp; Providers
        </button>
        <button
          className={`tab-btn ${activeTab === 'integration' ? 'active' : ''}`}
          onClick={() => setActiveTab('integration')}
        >
          3. Auth-Navigation Integration &amp; Simulator
        </button>
        <button
          className={`tab-btn ${activeTab === 'diagnostics' ? 'active' : ''}`}
          onClick={() => setActiveTab('diagnostics')}
        >
          4. Diagnostics, JSON Source &amp; Code Generator ({projectIR.diagnostics.length})
        </button>
      </nav>

      <main className="main-content">
        {activeTab === 'navigation' &&
          (current.navigationConfig ? (
            <NavigationBuilderWorkspace
              config={current.navigationConfig}
              onChange={(nextNav) =>
                commitChange({ ...current, navigationConfig: nextNav })
              }
            />
          ) : (
            <div className="panel">
              <div className="panel-title">
                Navigation Module Disabled in Current Preset
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                Switch to &ldquo;Complete E-Commerce Auth + Navigation&rdquo; or
                &ldquo;Navigation-Only Catalog&rdquo; preset, or enable a Navigation configuration.
              </p>
            </div>
          ))}

        {activeTab === 'auth' &&
          (current.authConfig ? (
            <AuthBuilderWorkspace
              config={current.authConfig}
              onChange={(nextAuth) =>
                commitChange({ ...current, authConfig: nextAuth })
              }
            />
          ) : (
            <div className="panel">
              <div className="panel-title">
                Auth Module Disabled in Current Preset
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                Switch to &ldquo;Complete E-Commerce Auth + Navigation&rdquo; or
                &ldquo;Auth-Only Module&rdquo; preset to configure authentication.
              </p>
            </div>
          ))}

        {activeTab === 'integration' &&
          (current.integrationConfig ? (
            <IntegrationWorkspace
              config={current.integrationConfig}
              navigationConfig={current.navigationConfig}
              projectIR={projectIR}
              onChange={(nextInt) =>
                commitChange({ ...current, integrationConfig: nextInt })
              }
            />
          ) : (
            <div className="panel">
              <div className="panel-title">
                Integration Layer Disabled in Standalone Mode
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                Select the &ldquo;Complete E-Commerce Auth + Navigation&rdquo; preset to
                configure Auth-Navigation integration and test the runtime simulator.
              </p>
            </div>
          ))}

        {activeTab === 'diagnostics' && (
          <DiagnosticsAndGeneratorWorkspace
            projectIR={projectIR}
            authConfig={current.authConfig}
            navigationConfig={current.navigationConfig}
            integrationConfig={current.integrationConfig}
            onUpdateAuth={(nextAuth) =>
              commitChange({ ...current, authConfig: nextAuth })
            }
            onUpdateNavigation={(nextNav) =>
              commitChange({ ...current, navigationConfig: nextNav })
            }
            onUpdateIntegration={(nextInt) =>
              commitChange({ ...current, integrationConfig: nextInt })
            }
          />
        )}
      </main>
    </div>
  );
}
