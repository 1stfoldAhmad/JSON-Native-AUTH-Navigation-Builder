import React, { useMemo, useState } from 'react';
import type {
  AuthConfigDocument,
  CompilationResult,
  NavigationConfigDocument,
} from '@expo-foundation/core';
import {
  defaultExpoProjectGenerator,
  defaultOutputValidator,
} from '@expo-foundation/expo-generator';

export interface DiagnosticsAndGeneratorWorkspaceProps {
  compilation: CompilationResult;
  authConfig: AuthConfigDocument | null;
  navigationConfig: NavigationConfigDocument | null;
  onInjectSampleError: () => void;
  onResetCleanPreset: () => void;
}

export function DiagnosticsAndGeneratorWorkspace({
  compilation,
  onInjectSampleError,
  onResetCleanPreset,
}: DiagnosticsAndGeneratorWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<'diagnostics' | 'ir' | 'generator'>('diagnostics');
  const [selectedFilePath, setSelectedFilePath] = useState<string>('package.json');

  const generatedBundle = useMemo(() => {
    if (!compilation.ir || !compilation.canGenerate) {
      return null;
    }
    try {
      const bundle = defaultExpoProjectGenerator.generateFromIR(
        compilation.ir,
        undefined,
        compilation.diagnostics
      );
      const report = defaultOutputValidator.validate(bundle);
      return { bundle, report };
    } catch {
      return null;
    }
  }, [compilation]);

  const fileList = useMemo(
    () => (generatedBundle ? Object.keys(generatedBundle.bundle.files) : []),
    [generatedBundle]
  );

  const activeFile =
    generatedBundle?.bundle.files[selectedFilePath] ??
    (fileList[0] ? generatedBundle?.bundle.files[fileList[0]] : undefined);

  return (
    <div className="workspace-layout">
      <aside className="subnav">
        <div className="subnav-title">Compiler & Diagnostics</div>
        <button
          className={`subnav-btn ${activeTab === 'diagnostics' ? 'active' : ''}`}
          onClick={() => setActiveTab('diagnostics')}
        >
          Diagnostics ({compilation.diagnostics.length})
        </button>
        <button
          className={`subnav-btn ${activeTab === 'ir' ? 'active' : ''}`}
          onClick={() => setActiveTab('ir')}
        >
          Canonical FoundationIR
        </button>
        <button
          className={`subnav-btn ${activeTab === 'generator' ? 'active' : ''}`}
          onClick={() => setActiveTab('generator')}
        >
          Generated Expo Project ({fileList.length} files)
        </button>

        <div className="scope-guard-card">
          <div className="badge badge-info">Diagnostic Controls</div>
          <p>Test the compiler's semantic & security diagnostics engine:</p>
          <button
            className="btn btn-sm"
            style={{ width: '100%', marginBottom: '6px' }}
            onClick={onInjectSampleError}
          >
            Inject Sample Config Errors
          </button>
          <button
            className="btn btn-sm"
            style={{ width: '100%' }}
            onClick={onResetCleanPreset}
          >
            Restore Valid Preset
          </button>
        </div>
      </aside>

      <main className="workspace-content">
        {activeTab === 'diagnostics' && (
          <div className="panel">
            <div className="panel-header-row">
              <div>
                <h2>Diagnostics & Validation Center</h2>
                <p className="subtitle">
                  Structured schema, reference, semantic, capability, and security diagnostics
                  (Section 16).
                </p>
              </div>
              <div
                className={`badge ${
                  compilation.canGenerate ? 'badge-native' : 'badge-unsupported'
                }`}
              >
                {compilation.canGenerate
                  ? 'Generation Gate: READY'
                  : 'Generation Gate: BLOCKED BY ERRORS'}
              </div>
            </div>

            <h3>9-Stage Compiler Pipeline Status</h3>
            <div className="pipeline-steps">
              {compilation.stages.map((st) => (
                <div key={st.stage} className={`pipeline-step status-${st.status}`}>
                  <strong>
                    Stage {st.stage}: {st.name}
                  </strong>
                  <div>{st.summary}</div>
                </div>
              ))}
            </div>

            <h3>Diagnostic Report ({compilation.diagnostics.length})</h3>
            {compilation.diagnostics.length === 0 ? (
              <div className="alert alert-success">
                Zero errors or warnings. Configuration is valid and ready for deterministic Expo
                SDK 58 code generation.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>Code</th>
                    <th>Document</th>
                    <th>JSON Path</th>
                    <th>Explanation & Suggested Correction</th>
                    <th>Can Generate?</th>
                  </tr>
                </thead>
                <tbody>
                  {compilation.diagnostics.map((diag, idx) => (
                    <tr key={`${diag.code}_${idx}`}>
                      <td>
                        <span className={`badge badge-${diag.severity}`}>
                          {diag.severity.toUpperCase()}
                        </span>
                      </td>
                      <td>
                        <code>{diag.code}</code>
                      </td>
                      <td>{diag.document}</td>
                      <td>
                        <code>{diag.jsonPath}</code>
                      </td>
                      <td>
                        <div>{diag.message}</div>
                        <small className="suggestion-text">Fix: {diag.suggestion}</small>
                      </td>
                      <td>{diag.canGenerate ? 'Yes' : 'No (Blocking)'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'ir' && (
          <div className="panel">
            <h2>Canonical Intermediate Representation (FoundationIR)</h2>
            <p className="subtitle">
              Platform-neutral normalized IR decoupling JSON schemas from Expo SDK 58 code
              generation.
            </p>
            <pre className="code-block">
              {compilation.ir
                ? JSON.stringify(compilation.ir, null, 2)
                : 'Fix blocking schema/compiler errors to inspect FoundationIR.'}
            </pre>
          </div>
        )}

        {activeTab === 'generator' && (
          <div className="panel">
            <h2>Generated Expo SDK 58 Project Output</h2>
            <p className="subtitle">
              Compile-time JSON-to-TypeScript/TSX output with ownership boundaries, manifest
              checksums, and automated regression checks.
            </p>

            {!generatedBundle ? (
              <div className="alert alert-error">
                Code generation is blocked until blocking diagnostics are resolved.
              </div>
            ) : (
              <>
                <div className="validation-checks-row">
                  {generatedBundle.report.checks.map((chk) => (
                    <div
                      key={chk.id}
                      className={`check-pill ${chk.passed ? 'passed' : 'failed'}`}
                      title={chk.details}
                    >
                      {chk.passed ? '✓' : '✗'} {chk.name}
                    </div>
                  ))}
                </div>

                <div className="generator-explorer">
                  <div className="file-tree">
                    <div className="subnav-title">generated-expo-app/</div>
                    {fileList.map((filePath) => {
                      const f = generatedBundle.bundle.files[filePath];
                      return (
                        <button
                          key={filePath}
                          className={`file-item ${
                            activeFile?.path === filePath ? 'active' : ''
                          }`}
                          onClick={() => setSelectedFilePath(filePath)}
                        >
                          <span>{filePath}</span>
                          <small className={`ownership-tag ${f.ownership}`}>
                            {f.ownership === 'user-protected' ? 'user' : 'gen'}
                          </small>
                        </button>
                      );
                    })}
                  </div>

                  <div className="file-viewer">
                    {activeFile && (
                      <>
                        <div className="file-viewer-header">
                          <code>{activeFile.path}</code>
                          <span>
                            Ownership: <strong>{activeFile.ownership}</strong> · Checksum:{' '}
                            <code>{activeFile.checksum}</code>
                          </span>
                        </div>
                        <pre className="code-block file-code">{activeFile.content}</pre>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
