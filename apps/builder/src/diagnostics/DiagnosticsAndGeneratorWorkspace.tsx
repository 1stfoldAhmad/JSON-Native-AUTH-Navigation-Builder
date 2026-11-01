import React, { useMemo, useState } from 'react';
import {
  type AuthConfigDocument,
  type Diagnostic,
  type DiagnosticCategory,
  type IntegrationConfigDocument,
  type NavigationConfigDocument,
  type ProjectIR,
} from '@expo-foundation/core';
import {
  ExpoProjectGenerator,
  type GenerationOutputTarget,
} from '@expo-foundation/expo-generator';

interface Props {
  projectIR: ProjectIR;
  authConfig?: AuthConfigDocument;
  navigationConfig?: NavigationConfigDocument;
  integrationConfig?: IntegrationConfigDocument;
  onUpdateAuth: (doc: AuthConfigDocument) => void;
  onUpdateNavigation: (doc: NavigationConfigDocument) => void;
  onUpdateIntegration: (doc: IntegrationConfigDocument) => void;
}

const generator = new ExpoProjectGenerator();

export function DiagnosticsAndGeneratorWorkspace({
  projectIR,
  authConfig,
  navigationConfig,
  integrationConfig,
  onUpdateAuth,
  onUpdateNavigation,
  onUpdateIntegration,
}: Props) {
  const [selectedFile, setSelectedFile] = useState<string>('app/_layout.tsx');
  const [jsonTab, setJsonTab] = useState<'auth' | 'navigation' | 'integration'>(
    navigationConfig ? 'navigation' : 'auth'
  );
  const [jsonDraft, setJsonDraft] = useState<string>('');
  const [jsonParseError, setJsonParseError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<DiagnosticCategory | 'all'>('all');
  const [highlightedJsonPath, setHighlightedJsonPath] = useState<string | null>(null);
  const [outputTarget, setOutputTarget] = useState<GenerationOutputTarget>('expo-app');

  const generatedBundle = useMemo(() => {
    if (!projectIR.canGenerate) return null;
    try {
      return generator.generate(projectIR, {
        appName: 'expo-foundation-studio-app',
        outputTarget,
      });
    } catch {
      return null;
    }
  }, [projectIR, outputTarget]);

  const activeFilePath = useMemo(() => {
    if (!generatedBundle) return '';
    if (generatedBundle.files[selectedFile]) return selectedFile;
    return generatedBundle.fileList[0] ?? '';
  }, [generatedBundle, selectedFile]);

  const currentJsonSource = useMemo(() => {
    if (jsonTab === 'auth' && authConfig) {
      return JSON.stringify(authConfig, null, 2);
    }
    if (jsonTab === 'navigation' && navigationConfig) {
      return JSON.stringify(navigationConfig, null, 2);
    }
    if (jsonTab === 'integration' && integrationConfig) {
      return JSON.stringify(integrationConfig, null, 2);
    }
    return '// Document not enabled in current preset';
  }, [jsonTab, authConfig, navigationConfig, integrationConfig]);

  const filteredDiagnostics = useMemo(() => {
    if (categoryFilter === 'all') return projectIR.diagnostics;
    return projectIR.diagnostics.filter((d) => d.category === categoryFilter);
  }, [projectIR.diagnostics, categoryFilter]);

  const handleDiagnosticClick = (diag: Diagnostic) => {
    setHighlightedJsonPath(diag.jsonPath);
    if (
      diag.document === 'auth' ||
      diag.document === 'navigation' ||
      diag.document === 'integration'
    ) {
      setJsonTab(diag.document);
      setJsonDraft('');
      setJsonParseError(null);
    }
  };

  const applyJsonDraft = () => {
    if (!jsonDraft.trim()) return;
    try {
      const parsed = JSON.parse(jsonDraft);
      setJsonParseError(null);
      if (jsonTab === 'auth') onUpdateAuth(parsed as AuthConfigDocument);
      if (jsonTab === 'navigation')
        onUpdateNavigation(parsed as NavigationConfigDocument);
      if (jsonTab === 'integration')
        onUpdateIntegration(parsed as IntegrationConfigDocument);
      setJsonDraft('');
    } catch (err) {
      setJsonParseError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  const insertSchemaSnippet = (snippetType: 'screenRef' | 'flowRef' | 'rolePolicy') => {
    const base = jsonDraft || currentJsonSource;
    const snippets: Record<typeof snippetType, string> = {
      screenRef: '"screen.app.custom-view"',
      flowRef: '"flow.auth.custom-hook"',
      rolePolicy: '{ "roles": ["admin"], "mode": "any" }',
    };
    setJsonDraft(`${base}\n// Snippet (${snippetType}): ${snippets[snippetType]}`);
  };

  const downloadGeneratedBundle = () => {
    if (!generatedBundle) return;
    const payload = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        sdkVersion: projectIR.sdkVersion,
        outputTarget,
        files: generatedBundle.files,
      },
      null,
      2
    );
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectIR.metadata.projectId}-expo-sdk58-bundle.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="grid-2">
        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Compiler Diagnostics Engine</div>
              <div className="panel-subtitle">
                Click any diagnostic to jump to its JSON document and highlight its path
              </div>
            </div>
            <span
              className={`badge ${
                projectIR.canGenerate ? 'badge-success' : 'badge-error'
              }`}
            >
              {projectIR.canGenerate ? 'CAN GENERATE: YES' : 'BLOCKED BY ERRORS'}
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              marginBottom: 12,
            }}
          >
            {(
              [
                'all',
                'schema',
                'auth',
                'session-security',
                'navigation-graph',
                'capability',
                'integration',
                'generator',
                'build',
              ] as const
            ).map((cat) => (
              <button
                key={cat}
                className="btn"
                style={{
                  padding: '3px 8px',
                  fontSize: 11,
                  background:
                    categoryFilter === cat ? 'var(--accent)' : undefined,
                  borderColor:
                    categoryFilter === cat ? 'var(--accent)' : undefined,
                }}
                onClick={() => setCategoryFilter(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          {filteredDiagnostics.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--success)' }}>
              Zero diagnostics in selected category. All contracts and capabilities
              are valid.
            </div>
          ) : (
            filteredDiagnostics.map((d, idx) => (
              <div
                key={`${d.code}_${idx}`}
                className={`diagnostic-card ${d.severity}`}
                style={{ cursor: 'pointer' }}
                onClick={() => handleDiagnosticClick(d)}
              >
                <div className="diagnostic-header">
                  <span className="diagnostic-code">
                    [{d.severity.toUpperCase()}] {d.code}
                  </span>
                  <span className="diagnostic-path">
                    {d.document}:{d.jsonPath}
                  </span>
                </div>
                <div className="diagnostic-msg">{d.message}</div>
                <div className="diagnostic-suggestion">Fix: {d.suggestion}</div>
              </div>
            ))
          )}
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Schema-Aware JSON Source Editor</div>
              <div className="panel-subtitle">
                Bidirectional synchronization between visual editors and JSON contracts
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {authConfig && (
                <button
                  className={`btn ${jsonTab === 'auth' ? 'btn-primary' : ''}`}
                  onClick={() => {
                    setJsonTab('auth');
                    setJsonDraft('');
                    setJsonParseError(null);
                  }}
                >
                  auth.json
                </button>
              )}
              {navigationConfig && (
                <button
                  className={`btn ${
                    jsonTab === 'navigation' ? 'btn-primary' : ''
                  }`}
                  onClick={() => {
                    setJsonTab('navigation');
                    setJsonDraft('');
                    setJsonParseError(null);
                  }}
                >
                  navigation.json
                </button>
              )}
              {integrationConfig && (
                <button
                  className={`btn ${
                    jsonTab === 'integration' ? 'btn-primary' : ''
                  }`}
                  onClick={() => {
                    setJsonTab('integration');
                    setJsonDraft('');
                    setJsonParseError(null);
                  }}
                >
                  integration.json
                </button>
              )}
            </div>
          </div>

          {highlightedJsonPath && (
            <div
              style={{
                marginBottom: 8,
                padding: '6px 10px',
                borderRadius: 6,
                background: 'rgba(59, 130, 246, 0.15)',
                fontSize: 12,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>
                Focused JSON Path: <code>{highlightedJsonPath}</code>
              </span>
              <button
                className="btn"
                style={{ padding: '2px 6px', fontSize: 11 }}
                onClick={() => setHighlightedJsonPath(null)}
              >
                Clear
              </button>
            </div>
          )}

          <div
            style={{
              display: 'flex',
              gap: 6,
              marginBottom: 8,
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              Schema Autocomplete Helpers:
            </span>
            <button
              className="btn"
              style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={() => insertSchemaSnippet('screenRef')}
            >
              + screenRef
            </button>
            <button
              className="btn"
              style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={() => insertSchemaSnippet('flowRef')}
            >
              + flowRef
            </button>
            <button
              className="btn"
              style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={() => insertSchemaSnippet('rolePolicy')}
            >
              + rolePolicy
            </button>
          </div>

          <textarea
            className="form-input"
            style={{
              height: 250,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              resize: 'vertical',
            }}
            value={jsonDraft || currentJsonSource}
            onChange={(e) => setJsonDraft(e.target.value)}
          />

          {jsonParseError && (
            <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>
              JSON Parse Error: {jsonParseError}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary" onClick={applyJsonDraft}>
              Apply JSON Changes & Recompile
            </button>
            <button
              className="btn"
              onClick={() => {
                setJsonDraft('');
                setJsonParseError(null);
              }}
            >
              Reset Draft
            </button>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">
              Deterministic Expo SDK 58 Code Generator Output
            </div>
            <div className="panel-subtitle">
              Inspect compiled nested route layouts, native SwiftUI / Compose renderers, and Auth runtime files
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              className="form-select"
              style={{ width: 'auto', fontSize: 12, padding: '4px 8px' }}
              value={outputTarget}
              onChange={(e) =>
                setOutputTarget(e.target.value as GenerationOutputTarget)
              }
            >
              <option value="expo-app">Target: Runnable Expo App</option>
              <option value="reusable-module">
                Target: Reusable Module (Auth-only)
              </option>
            </select>
            {generatedBundle && (
              <>
                <span className="badge badge-info">
                  {generatedBundle.fileList.length} Files Generated
                </span>
                <button
                  className="btn btn-primary"
                  onClick={downloadGeneratedBundle}
                >
                  Export Bundle JSON
                </button>
              </>
            )}
          </div>
        </div>

        {!generatedBundle ? (
          <div style={{ color: 'var(--danger)', fontSize: 13 }}>
            Resolve blocking compiler errors above to generate the Expo SDK 58 project bundle.
          </div>
        ) : (
          <div className="grid-sidebar">
            <div className="file-tree">
              {generatedBundle.fileList.map((filePath) => (
                <button
                  key={filePath}
                  className={`file-item ${
                    filePath === activeFilePath ? 'active' : ''
                  }`}
                  onClick={() => setSelectedFile(filePath)}
                >
                  {filePath}
                </button>
              ))}
            </div>
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                  alignItems: 'center',
                }}
              >
                <code>{activeFilePath}</code>
                <span className="badge badge-success">
                  Output Validation:{' '}
                  {generatedBundle.validation.valid ? 'PASSED' : 'FAILED'}
                </span>
              </div>
              <pre className="code-viewer">
                {generatedBundle.files[activeFilePath]}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
