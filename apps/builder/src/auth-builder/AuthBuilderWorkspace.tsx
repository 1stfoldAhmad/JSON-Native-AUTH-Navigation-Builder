import React from 'react';
import type { AuthProviderType } from '@expo-foundation/contracts';
import type { AuthConfigDocument } from '@expo-foundation/core';

interface Props {
  config: AuthConfigDocument;
  onChange: (next: AuthConfigDocument) => void;
}

const PROVIDER_TYPES: AuthProviderType[] = [
  'rest',
  'oidc',
  'oauth',
  'apple',
  'google',
  'facebook',
  'supabase',
  'firebase',
  'clerk',
  'custom',
];

export function AuthBuilderWorkspace({ config, onChange }: Props) {
  const updateProviderType = (type: AuthProviderType) => {
    onChange({
      ...config,
      provider: {
        ...config.provider,
        type,
      },
    });
  };

  const updateSessionStorage = (storage: 'secure-store' | 'memory') => {
    onChange({
      ...config,
      session: {
        ...config.session,
        storage,
      },
    });
  };

  const updateRefreshStrategy = (
    refreshStrategy: 'before-expiration' | 'on-401' | 'manual'
  ) => {
    onChange({
      ...config,
      session: {
        ...config.session,
        refreshStrategy,
      },
    });
  };

  const toggleMethod = (key: keyof AuthConfigDocument['methods']) => {
    onChange({
      ...config,
      methods: {
        ...config.methods,
        [key]: !config.methods[key],
      },
    });
  };

  const updateScreenRef = (
    key: keyof AuthConfigDocument['screenRefs'],
    value: string
  ) => {
    onChange({
      ...config,
      screenRefs: {
        ...config.screenRefs,
        [key]: value,
      },
    });
  };

  const updateEventFlow = (eventKey: string, flowRef: string) => {
    onChange({
      ...config,
      events: {
        ...(config.events ?? {}),
        [eventKey]: flowRef,
      },
    });
  };

  return (
    <div className="grid-2">
      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Provider Adapter &amp; Session Security</div>
            <div className="panel-subtitle">
              Configure the AuthProviderAdapter contract and Expo SecureStore session lifecycle
            </div>
          </div>
          <span className="badge badge-info">
            SDK 58 • {config.provider.type.toUpperCase()}
          </span>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Provider Type</label>
            <select
              className="form-select"
              value={config.provider.type}
              onChange={(e) =>
                updateProviderType(e.target.value as AuthProviderType)
              }
            >
              {PROVIDER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Provider Reference ID</label>
            <input
              className="form-input"
              value={config.provider.ref}
              onChange={(e) =>
                onChange({
                  ...config,
                  provider: { ...config.provider, ref: e.target.value },
                })
              }
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Token Storage Engine</label>
            <select
              className="form-select"
              value={config.session.storage}
              onChange={(e) =>
                updateSessionStorage(
                  e.target.value as 'secure-store' | 'memory'
                )
              }
            >
              <option value="secure-store">
                secure-store (expo-secure-store Keychain / Keystore)
              </option>
              <option value="memory">
                memory (Ephemeral - Emits Security Warning)
              </option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Token Refresh Strategy</label>
            <select
              className="form-select"
              value={config.session.refreshStrategy}
              onChange={(e) =>
                updateRefreshStrategy(
                  e.target.value as 'before-expiration' | 'on-401' | 'manual'
                )
              }
            >
              <option value="before-expiration">
                before-expiration (Single-Flight Lock)
              </option>
              <option value="on-401">on-401</option>
              <option value="manual">manual</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Enabled Authentication Capabilities</label>
          <div className="checkbox-grid">
            {(
              [
                ['password', 'Email / Password'],
                ['registration', 'Registration'],
                ['emailVerification', 'Email Verification'],
                ['passwordReset', 'Password Reset'],
                ['otp', 'OTP (SMS / Email)'],
                ['oauth', 'OAuth 2.0 / OIDC PKCE'],
                ['apple', 'Sign in with Apple'],
                ['google', 'Google OAuth'],
                ['biometric', 'Biometric (FaceID/TouchID)'],
                ['mfa', 'Multi-Factor Auth (MFA)'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="checkbox-item">
                <input
                  type="checkbox"
                  checked={Boolean(config.methods[key])}
                  onChange={() => toggleMethod(key)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">
              Screen References &amp; Lifecycle Flow Bindings
            </div>
            <div className="panel-subtitle">
              Map external Screen Builder IDs (screen.*) and Flow Builder IDs (flow.*)
            </div>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Login Screen Reference</label>
            <input
              className="form-input"
              value={config.screenRefs.login ?? ''}
              onChange={(e) => updateScreenRef('login', e.target.value)}
              placeholder="screen.auth.login"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Register Screen Reference</label>
            <input
              className="form-input"
              value={config.screenRefs.register ?? ''}
              onChange={(e) => updateScreenRef('register', e.target.value)}
              placeholder="screen.auth.register"
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Verification Screen Reference</label>
            <input
              className="form-input"
              value={config.screenRefs.verification ?? ''}
              onChange={(e) => updateScreenRef('verification', e.target.value)}
              placeholder="screen.auth.verify"
            />
          </div>

          <div className="form-group">
            <label className="form-label">MFA Challenge Screen Reference</label>
            <input
              className="form-input"
              value={config.screenRefs.mfa ?? ''}
              onChange={(e) => updateScreenRef('mfa', e.target.value)}
              placeholder="screen.auth.mfa"
            />
          </div>
        </div>

        <div className="form-group" style={{ marginTop: 8 }}>
          <label className="form-label">
            External Flow Reference Bindings (flow.*)
          </label>
          {(
            [
              ['onLoginSuccess', 'After Login Flow'],
              ['onLogout', 'After Logout Flow'],
              ['onRegisterSuccess', 'After Registration Flow'],
            ] as const
          ).map(([eventKey, label]) => {
            const rawVal = config.events?.[eventKey];
            const val =
              typeof rawVal === 'string' ? rawVal : (rawVal?.flowRef ?? '');
            return (
              <div
                key={eventKey}
                className="form-row"
                style={{ marginBottom: 8, alignItems: 'center' }}
              >
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {label} (<code>{eventKey}</code>)
                </span>
                <input
                  className="form-input"
                  value={val}
                  onChange={(e) => updateEventFlow(eventKey, e.target.value)}
                  placeholder="flow.auth.after-login"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
