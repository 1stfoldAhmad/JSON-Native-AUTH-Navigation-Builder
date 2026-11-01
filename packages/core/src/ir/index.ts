import type { AuthProviderConfig, AuthProviderType } from '@expo-foundation/contracts';
import type {
  AccessPolicy,
  AuthStatus,
  CompilationMode,
  DeepLinkingConfig,
  NavigatorDefinition,
  PlatformTarget,
  RouteDefinition,
  RouteParamSchema,
} from '../types/index.js';

export interface ProjectMetadataIR {
  projectId: string;
  schemaVersion: string;
  builderVersion: string;
  sdkVersion: number;
  mode: 'auth-only' | 'navigation-only' | 'complete';
  compiledAt: string;
}

export interface AuthStateTransitionIR {
  from: AuthStatus;
  event: string;
  to: AuthStatus;
}

export interface AuthEventBindingIR {
  trigger: string;
  emittedEvent: string;
  flowRef?: string;
}

export interface AuthIR {
  id: string;
  enabled: boolean;
  primaryProvider: {
    ref: string;
    type: AuthProviderType;
    config: AuthProviderConfig;
  };
  providers: Record<string, AuthProviderConfig>;
  authMethods: {
    password: boolean;
    registration: boolean;
    emailVerification: boolean;
    passwordReset: boolean;
    phone: boolean;
    otp: boolean;
    oauth: boolean;
    oidc: boolean;
    google: boolean;
    apple: boolean;
    facebook: boolean;
    biometric: boolean;
    mfa: boolean;
    passkeys: boolean;
    multiAccount: boolean;
    multiTenant: boolean;
  };
  stateMachine: {
    initialStatus: AuthStatus;
    statuses: AuthStatus[];
    transitions: AuthStateTransitionIR[];
  };
  sessionPolicy: {
    restoreOnLaunch: boolean;
    storage: 'secure-store' | 'memory';
    refreshEnabled: boolean;
    refreshStrategy: 'before-expiration' | 'on-401' | 'manual';
    refreshThresholdSeconds: number;
    rotateRefreshTokens: boolean;
    revokeOnLogout: boolean;
  };
  events: AuthEventBindingIR[];
  accessContext: {
    defaultRoles: string[];
    requireEmailVerification: boolean;
    supportedRoles: string[];
    supportedPermissions: string[];
  };
  screenRefs: Record<string, string>;
}

export interface RouteGraphNodeIR {
  id: string;
  kind: 'navigator' | 'route';
  parentId: string | null;
  childrenIds: string[];
  depth: number;
}

export interface NavigationIR {
  id: string;
  rootNavigatorId: string;
  routeGraph: {
    nodes: Record<string, RouteGraphNodeIR>;
    reachableRouteIds: string[];
    unreachableRouteIds: string[];
  };
  navigators: Record<string, NavigatorDefinition>;
  routes: Record<string, RouteDefinition>;
  routeParameters: Record<string, Record<string, RouteParamSchema>>;
  linking: DeepLinkingConfig;
  navigationPolicies: {
    ios: {
      renderer: 'expo-ui';
      strictNative: boolean;
      mode: CompilationMode;
    };
    android: {
      renderer: 'auto' | 'expo-ui-compose' | 'expo-router';
      fallback: 'expo-router' | 'native-tabs';
      mode: CompilationMode;
    };
  };
  screenRefs: string[];
}

export interface RouteGuardRuleIR {
  routeId: string;
  path: string;
  policy: AccessPolicy;
  redirectOnDeny: string;
}

export interface IntegrationIR {
  enabled: boolean;
  entryPoints: {
    guestEntry: string;
    authenticatedEntry: string;
    verificationRoute?: string;
    accessDeniedRoute?: string;
    sessionExpiredRoute?: string;
    accountSuspendedRoute?: string;
  };
  redirects: {
    afterLogin: 'restore-intended-destination' | string;
    afterRegistration: string;
    afterLogout: string;
  };
  guards: RouteGuardRuleIR[];
  roleRouteGroups: Record<string, string>;
  eventBindings: Array<{
    authEvent: string;
    action: 'navigate' | 'replace' | 'reset' | 'restore-intended-destination' | 'hold';
    targetRoute?: string;
    flowRef?: string;
  }>;
}

export interface PlatformNavigatorResolutionIR {
  navigatorId: string;
  navigatorType: NavigatorDefinition['type'];
  capabilityId: string;
  support: 'native' | 'supported' | 'fallback' | 'unsupported';
  component: string;
  importPath: string;
  adapterModule: string;
  usedFallback: boolean;
  notes: string[];
}

export interface PlatformTargetIR {
  platform: PlatformTarget;
  mode: CompilationMode;
  engine: string;
  navigatorResolutions: Record<string, PlatformNavigatorResolutionIR>;
  requiredPackages: string[];
}

export interface PlatformIR {
  ios: PlatformTargetIR;
  android: PlatformTargetIR;
}

export interface FoundationIR {
  projectMetadata: ProjectMetadataIR;
  auth: AuthIR | null;
  navigation: NavigationIR | null;
  integration: IntegrationIR | null;
  platform: PlatformIR;
}
