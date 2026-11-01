import React, { useMemo, useState } from 'react';
import {
  AuthStateMachine,
  extractByJsonPath,
  type AuthMachineEvent,
} from '@expo-foundation/auth';
import type { AuthProviderType } from '@expo-foundation/contracts';
import type { AuthConfigDocument, Diagnostic } from '@expo-foundation/core';

export interface AuthBuilderWorkspaceProps {
  authConfig: AuthConfigDocument | null;
  onChange: (next: AuthConfigDocument) => void;
  diagnostics: Diagnostic[];
}

type AuthSubSection =
  | 'overview'
  | 'provider'
  | 'methods'
  | 'session'
  | 'lifecycle'
  | 'mapping'
  | 'events-access'
  | 'screens'
  | 'json';

const ALL_STATUSES = [
  'unknown',
  'restoring',
  'anonymous',
  'authenticating',
  'authenticated',
  'refreshing',
  'verifying',
  'challenge_required',
  'signing_out',
  'recovery_required',
  'error',
] as const;

export function AuthBuilderWorkspace({
  authConfig,
  onChange,
  diagnostics,
}: AuthBuilderWorkspaceProps) {
  const [section, setSection] = useState<AuthSubSection>('overview');
  const [rawJsonText, setRawJsonText] = useState<string>(() =>
    authConfig ? JSON.stringify(authConfig, null, 2) : ''
  );
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Interactive State Machine Simulator
  const [machine] = useState(() => new AuthStateMachine('unknown'));
  const [machineState, setMachineState] = useState(() => machine.getState());

  // Interactive JSONPath Mapping Tester
  const [sampleApiResponse, setSampleApiResponse] = useState<string>(() =>
    JSON.stringify(
      {
        data: {
          access_token: 'jwt_access_sample_99182',
          refresh_token: 'jwt_refresh_sample_44102',
          expires_in: 3600,
          user: {
            id: 'usr_42',
            email: 'developer@expo.dev',
            roles: ['user', 'admin'],
            emailVerified: true,
          },
        },
      },
      null,
      2
    )
  );

  const authDiagnostics = useMemo(
    () => diagnostics.filter((d) => d.document === 'auth'),
    [diagnostics]
  );

  if (!authConfig) {
    return (
      <div className="panel empty-panel">
        <h3>Auth Builder is Disabled in Navigation-Only Mode</h3>
        <p>
          The Navigation Builder is running standalone without an authentication configuration.
          Switch to <strong>Complete Foundation</strong> or <strong>Auth-Only Mode</strong> in
          the top bar to configure authentication.
        </p>
      </div>
    );
  }

  const dispatchMachineEvent = (event: AuthMachineEvent) => {
    try {
      const next = machine.transition(event);
      setMachineState(next);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const evaluateSampleMapping = () => {
    try {
      const parsed = JSON.parse(sampleApiResponse);
      const mapping = authConfig.provider.config?.responseMapping ?? {
        accessToken: '$.data.access_token',
        refreshToken: '$.data.refresh_token',
        user: '$.data.user',
        expiresIn: '$.data.expires_in',
      };
      const out: Record<string, unknown> = {};
      for (const [k, expr] of Object.entries(mapping)) {
        if (expr) {
          out[k] = extractByJsonPath(parsed, expr);
        }
      }
      return { ok: true, result: out };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  const mappingPreview = evaluateSampleMapping();

  return (
    <div className="workspace-layout">
      <aside className="subnav">
        <div className="subnav-title">Auth Builder Sections</div>
        {(
          [
            ['overview', 'Overview & Status'],
            ['provider', 'Provider Adapter'],
            ['methods', 'Auth Methods (P0–P3)'],
            ['session', 'Session & SecureStore'],
            ['lifecycle', 'State Machine & Lifecycle'],
            ['mapping', 'REST API & JSONPath Mapping'],
            ['events-access', 'Events, Flows & Access Control'],
            ['screens', 'External Screen References'],
            ['json', 'auth.json Source Editor'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={`subnav-btn ${section === id ? 'active' : ''}`}
            onClick={() => {
              if (id === 'json') {
                setRawJsonText(JSON.stringify(authConfig, null, 2));
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
            Headless Auth Engine only. Does not generate visual login forms or UI components;
            binds operations to external <code>screen.*</code> IDs.
          </p>
        </div>
      </aside>

      <main className="workspace-content">
        {section === 'overview' && (
          <div className="panel">
            <h2>Auth Builder Overview</h2>
            <p className="subtitle">
              Defines, validates, compiles, and manages headless authentication infrastructure for
              Expo SDK 58.
            </p>
            <div className="stat-grid">
              <div className="stat-card">
                <span className="stat-label">Primary Provider</span>
                <strong className="stat-value">
                  {authConfig.provider.type.toUpperCase()} ({authConfig.provider.ref})
                </strong>
              </div>
              <div className="stat-card">
                <span className="stat-label">Session Storage</span>
                <strong className="stat-value">{authConfig.session.storage}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-label">Refresh Strategy</span>
                <strong className="stat-value">
                  {authConfig.session.refreshEnabled
                    ? authConfig.session.refreshStrategy
                    : 'Disabled'}
                </strong>
              </div>
              <div className="stat-card">
                <span className="stat-label">Auth Diagnostics</span>
                <strong className="stat-value">
                  {authDiagnostics.filter((d) => d.severity === 'error').length} Errors /{' '}
                  {authDiagnostics.filter((d) => d.severity === 'warning').length} Warnings
                </strong>
              </div>
            </div>

            <h3>Workflow Pipeline</h3>
            <div className="pipeline-steps">
              {[
                '1. Select Provider Adapter',
                '2. Configure API / OIDC PKCE',
                '3. Enable Auth Methods',
                '4. Configure Session & SecureStore',
                '5. Define Events & Access Context',
                '6. Link External Screen IDs',
                '7. Validate & Compile AuthIR',
              ].map((step) => (
                <div key={step} className="pipeline-step">
                  {step}
                </div>
              ))}
            </div>
          </div>
        )}

        {section === 'provider' && (
          <div className="panel">
            <h2>Auth Provider Adapter Configuration</h2>
            <p className="subtitle">
              Every provider implements the common <code>AuthProviderAdapter</code> contract and
              optional capability interfaces (<code>OtpCapability</code>, <code>MfaCapability</code>
              , <code>OAuthCapability</code>).
            </p>
            <div className="form-grid">
              <label>
                <span>Provider Type</span>
                <select
                  value={authConfig.provider.type}
                  onChange={(e) =>
                    onChange({
                      ...authConfig,
                      provider: {
                        ...authConfig.provider,
                        type: e.target.value as AuthProviderType,
                      },
                    })
                  }
                >
                  <option value="rest">REST (Generic HTTP Adapter)</option>
                  <option value="oidc">OIDC (Expo AuthSession + PKCE)</option>
                  <option value="oauth">OAuth 2.0 (Authorization Code + PKCE)</option>
                  <option value="apple">Apple Sign-In (Native)</option>
                  <option value="google">Google Sign-In (Provider SDK)</option>
                  <option value="supabase">Supabase Adapter</option>
                  <option value="firebase">Firebase Adapter</option>
                  <option value="clerk">Clerk Adapter</option>
                </select>
              </label>

              <label>
                <span>Provider Reference ID</span>
                <input
                  type="text"
                  value={authConfig.provider.ref}
                  onChange={(e) =>
                    onChange({
                      ...authConfig,
                      provider: {
                        ...authConfig.provider,
                        ref: e.target.value,
                      },
                    })
                  }
                />
              </label>

              <label>
                <span>Base / Discovery URL</span>
                <input
                  type="text"
                  value={authConfig.provider.config?.baseUrl ?? '${env.AUTH_API_URL}'}
                  onChange={(e) =>
                    onChange({
                      ...authConfig,
                      provider: {
                        ...authConfig.provider,
                        config: {
                          ...authConfig.provider.config,
                          baseUrl: e.target.value,
                        },
                      },
                    })
                  }
                />
              </label>

              <label>
                <span>OAuth/OIDC Redirect URI</span>
                <input
                  type="text"
                  placeholder="expofoundation://auth/callback"
                  value={authConfig.provider.config?.redirectUri ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...authConfig,
                      provider: {
                        ...authConfig.provider,
                        config: {
                          ...authConfig.provider.config,
                          redirectUri: e.target.value || undefined,
                        },
                      },
                    })
                  }
                />
              </label>
            </div>
          </div>
        )}

        {section === 'methods' && (
          <div className="panel">
            <h2>Authentication Methods (P0 – P3)</h2>
            <p className="subtitle">
              Enable authentication capabilities required by the project.
            </p>
            <div className="checkbox-grid">
              {(
                [
                  ['password', 'Email / Password Login (P0)'],
                  ['registration', 'Email / Password Registration (P0)'],
                  ['emailVerification', 'Email Verification (P0)'],
                  ['passwordReset', 'Forgot & Reset Password (P0)'],
                  ['otp', 'OTP Authentication (P1)'],
                  ['phone', 'Phone Number Auth (P1)'],
                  ['oauth', 'OAuth 2.0 / PKCE (P1)'],
                  ['oidc', 'OpenID Connect (P1)'],
                  ['google', 'Google Sign-In (P1)'],
                  ['apple', 'Apple Sign-In (P1)'],
                  ['biometric', 'Biometric Reauthentication (P2)'],
                  ['mfa', 'Multi-Factor Authentication (P2)'],
                  ['passkeys', 'Passkeys (P3)'],
                  ['multiAccount', 'Multiple Accounts (P3)'],
                  ['multiTenant', 'Multi-Tenant Auth (P3)'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="checkbox-card">
                  <input
                    type="checkbox"
                    checked={Boolean(authConfig.methods[key])}
                    onChange={(e) =>
                      onChange({
                        ...authConfig,
                        methods: {
                          ...authConfig.methods,
                          [key]: e.target.checked,
                        },
                      })
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {section === 'session' && (
          <div className="panel">
            <h2>Session Manager & SecureStore Policy</h2>
            <p className="subtitle">
              Uses <code>expo-secure-store</code> (Keychain on iOS, EncryptedSharedPreferences +
              Keystore on Android) with single-flight <code>RefreshCoordinator</code>.
            </p>
            <div className="form-grid">
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={authConfig.session.restoreOnLaunch}
                  onChange={(e) =>
                    onChange({
                      ...authConfig,
                      session: {
                        ...authConfig.session,
                        restoreOnLaunch: e.target.checked,
                      },
                    })
                  }
                />
                <span>Restore Session on Application Launch</span>
              </label>

              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={authConfig.session.refreshEnabled}
                  onChange={(e) =>
                    onChange({
                      ...authConfig,
                      session: {
                        ...authConfig.session,
                        refreshEnabled: e.target.checked,
                      },
                    })
                  }
                />
                <span>Enable Access Token Refresh</span>
              </label>

              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={authConfig.session.rotateRefreshTokens ?? true}
                  onChange={(e) =>
                    onChange({
                      ...authConfig,
                      session: {
                        ...authConfig.session,
                        rotateRefreshTokens: e.target.checked,
                      },
                    })
                  }
                />
                <span>Rotate Refresh Tokens on Renewal</span>
              </label>

              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={authConfig.session.revokeOnLogout ?? true}
                  onChange={(e) =>
                    onChange({
                      ...authConfig,
                      session: {
                        ...authConfig.session,
                        revokeOnLogout: e.target.checked,
                      },
                    })
                  }
                />
                <span>Revoke Token on Server During Logout</span>
              </label>

              <label>
                <span>Storage Engine</span>
                <select
                  value={authConfig.session.storage}
                  onChange={(e) =>
                    onChange({
                      ...authConfig,
                      session: {
                        ...authConfig.session,
                        storage: e.target.value as 'secure-store' | 'memory',
                      },
                    })
                  }
                >
                  <option value="secure-store">expo-secure-store (Encrypted Native)</option>
                  <option value="memory">In-Memory Only (Ephemeral)</option>
                </select>
              </label>

              <label>
                <span>Refresh Strategy</span>
                <select
                  value={authConfig.session.refreshStrategy}
                  onChange={(e) =>
                    onChange({
                      ...authConfig,
                      session: {
                        ...authConfig.session,
                        refreshStrategy: e.target.value as
                          | 'before-expiration'
                          | 'on-401'
                          | 'manual',
                      },
                    })
                  }
                >
                  <option value="before-expiration">before-expiration</option>
                  <option value="on-401">on-401</option>
                  <option value="manual">manual</option>
                </select>
              </label>
            </div>
          </div>
        )}

        {section === 'lifecycle' && (
          <div className="panel">
            <h2>Deterministic Authentication State Machine</h2>
            <p className="subtitle">
              Authentication is modeled as an explicit 11-state machine rather than ad-hoc booleans.
              Raw tokens are strictly excluded from state snapshots and logs.
            </p>

            <div className="state-badge-grid">
              {ALL_STATUSES.map((st) => (
                <div
                  key={st}
                  className={`state-pill ${machineState.status === st ? 'active-state' : ''}`}
                >
                  <span className="dot" />
                  <code>{st}</code>
                </div>
              ))}
            </div>

            <div className="simulator-toolbar">
              <strong>Interactive Transition Trigger:</strong>
              <button
                className="btn btn-sm"
                disabled={!machine.canTransition('RESTORE_START')}
                onClick={() =>
                  dispatchMachineEvent({ type: 'RESTORE_START', provider: 'rest' })
                }
              >
                RESTORE_START
              </button>
              <button
                className="btn btn-sm"
                disabled={!machine.canTransition('RESTORE_EMPTY')}
                onClick={() => dispatchMachineEvent({ type: 'RESTORE_EMPTY' })}
              >
                RESTORE_EMPTY
              </button>
              <button
                className="btn btn-sm"
                disabled={!machine.canTransition('SIGN_IN_START')}
                onClick={() =>
                  dispatchMachineEvent({ type: 'SIGN_IN_START', provider: 'rest' })
                }
              >
                SIGN_IN_START
              </button>
              <button
                className="btn btn-sm"
                disabled={!machine.canTransition('AUTH_SUCCESS')}
                onClick={() =>
                  dispatchMachineEvent({
                    type: 'AUTH_SUCCESS',
                    session: {
                      sessionId: 'sess_demo_1',
                      provider: 'rest',
                      issuedAt: Date.now(),
                      expiresAt: Date.now() + 3600_000,
                      user: {
                        id: 'user_101',
                        email: 'user@example.com',
                        emailVerified: true,
                        roles: ['user'],
                        permissions: ['orders.read'],
                      },
                      tokens: {
                        accessToken: 'secret_access_token_never_shown',
                        refreshToken: 'secret_refresh_token_never_shown',
                        expiresAt: Date.now() + 3600_000,
                      },
                    },
                  })
                }
              >
                AUTH_SUCCESS
              </button>
              <button
                className="btn btn-sm"
                disabled={!machine.canTransition('VERIFICATION_REQUIRED')}
                onClick={() =>
                  dispatchMachineEvent({
                    type: 'VERIFICATION_REQUIRED',
                    steps: ['email_verification'],
                  })
                }
              >
                VERIFICATION_REQUIRED
              </button>
              <button
                className="btn btn-sm"
                disabled={!machine.canTransition('REFRESH_START')}
                onClick={() => dispatchMachineEvent({ type: 'REFRESH_START' })}
              >
                REFRESH_START
              </button>
              <button
                className="btn btn-sm"
                disabled={!machine.canTransition('SIGN_OUT_START')}
                onClick={() => dispatchMachineEvent({ type: 'SIGN_OUT_START' })}
              >
                SIGN_OUT_START
              </button>
              <button
                className="btn btn-sm"
                disabled={!machine.canTransition('SIGN_OUT_COMPLETE')}
                onClick={() => dispatchMachineEvent({ type: 'SIGN_OUT_COMPLETE' })}
              >
                SIGN_OUT_COMPLETE
              </button>
            </div>

            <div className="split-preview">
              <div>
                <h4>Safe State Snapshot (Tokens Redacted)</h4>
                <pre className="code-block">{JSON.stringify(machineState, null, 2)}</pre>
              </div>
              <div>
                <h4>Transition Log ({machine.getTransitionHistory().length})</h4>
                <pre className="code-block">
                  {JSON.stringify(machine.getTransitionHistory(), null, 2)}
                </pre>
              </div>
            </div>
          </div>
        )}

        {section === 'mapping' && (
          <div className="panel">
            <h2>REST API Endpoints & Restricted JSONPath Mapping</h2>
            <p className="subtitle">
              Uses validated <code>$.field.subfield</code> expressions. Arbitrary JavaScript
              execution and prototype traversal are rejected at compile and runtime.
            </p>

            <div className="form-grid">
              {(
                [
                  ['accessToken', 'Access Token JSONPath'],
                  ['refreshToken', 'Refresh Token JSONPath'],
                  ['user', 'User Object JSONPath'],
                  ['expiresIn', 'ExpiresIn Seconds JSONPath'],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input
                    type="text"
                    value={authConfig.provider.config?.responseMapping?.[key] ?? ''}
                    onChange={(e) =>
                      onChange({
                        ...authConfig,
                        provider: {
                          ...authConfig.provider,
                          config: {
                            ...authConfig.provider.config,
                            responseMapping: {
                              ...authConfig.provider.config?.responseMapping,
                              [key]: e.target.value,
                            },
                          },
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>

            <div className="split-preview">
              <div>
                <h4>Sample Provider HTTP Response</h4>
                <textarea
                  className="json-textarea"
                  rows={12}
                  value={sampleApiResponse}
                  onChange={(e) => setSampleApiResponse(e.target.value)}
                />
              </div>
              <div>
                <h4>Extracted Mapping Output</h4>
                <pre className="code-block">
                  {JSON.stringify(mappingPreview, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        )}

        {section === 'events-access' && (
          <div className="panel">
            <h2>Access Context & External Flow Event References</h2>
            <p className="subtitle">
              Configure normalized roles/permissions and link authentication events to external{' '}
              <code>flow.*</code> business-logic workflows.
            </p>
            <div className="form-grid">
              <label>
                <span>Default User Roles (comma-separated)</span>
                <input
                  type="text"
                  value={(authConfig.accessControl?.defaultRoles ?? ['user']).join(', ')}
                  onChange={(e) =>
                    onChange({
                      ...authConfig,
                      accessControl: {
                        ...authConfig.accessControl,
                        defaultRoles: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      },
                    })
                  }
                />
              </label>

              <label>
                <span>Supported Roles (comma-separated)</span>
                <input
                  type="text"
                  value={(authConfig.accessControl?.supportedRoles ?? ['user', 'admin']).join(
                    ', '
                  )}
                  onChange={(e) =>
                    onChange({
                      ...authConfig,
                      accessControl: {
                        ...authConfig.accessControl,
                        supportedRoles: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      },
                    })
                  }
                />
              </label>
            </div>

            <h3>Configured Auth Event & Flow References</h3>
            <pre className="code-block">
              {JSON.stringify(authConfig.events ?? {}, null, 2)}
            </pre>
          </div>
        )}

        {section === 'screens' && (
          <div className="panel">
            <h2>External Screen Reference Bindings</h2>
            <p className="subtitle">
              Auth Builder references external screens by stable ID (e.g.{' '}
              <code>screen.auth.login</code>) resolved at runtime through{' '}
              <code>ScreenRegistry</code>.
            </p>
            <div className="form-grid">
              {(
                [
                  ['login', 'Login Screen ID'],
                  ['register', 'Registration Screen ID'],
                  ['verification', 'Email Verification Screen ID'],
                  ['forgotPassword', 'Forgot Password Screen ID'],
                  ['resetPassword', 'Reset Password Screen ID'],
                ] as const
              ).map(([slot, label]) => (
                <label key={slot}>
                  <span>{label}</span>
                  <input
                    type="text"
                    placeholder={`screen.auth.${slot}`}
                    value={authConfig.screenRefs[slot] ?? ''}
                    onChange={(e) =>
                      onChange({
                        ...authConfig,
                        screenRefs: {
                          ...authConfig.screenRefs,
                          [slot]: e.target.value || undefined,
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        {section === 'json' && (
          <div className="panel">
            <h2>auth.json Source Editor</h2>
            <p className="subtitle">
              Edit the canonical <code>auth.json</code> document directly.
            </p>
            {jsonError && <div className="alert alert-error">{jsonError}</div>}
            <textarea
              className="json-textarea"
              rows={22}
              value={rawJsonText}
              onChange={(e) => {
                setRawJsonText(e.target.value);
                try {
                  const parsed = JSON.parse(e.target.value) as AuthConfigDocument;
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
