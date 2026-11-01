import type { AuthProviderConfig, AuthProviderType } from '@expo-foundation/contracts';

export type PlatformTarget = 'ios' | 'android';

export type CompilationMode = 'strict-native' | 'automatic-fallback' | 'diagnostic';

export interface DocumentMetadata {
  schemaVersion: string;
  builderVersion?: string;
  projectId?: string;
  moduleId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type AccessPolicy =
  | 'public'
  | 'guest'
  | 'authenticated'
  | 'verified'
  | {
      roles: string[];
      mode?: 'any' | 'all';
    }
  | {
      permissions: string[];
      mode?: 'any' | 'all';
    };

export type AuthStatus =
  | 'unknown'
  | 'restoring'
  | 'anonymous'
  | 'authenticating'
  | 'authenticated'
  | 'refreshing'
  | 'verifying'
  | 'challenge_required'
  | 'signing_out'
  | 'recovery_required'
  | 'error';

export interface AccessContext {
  authenticated: boolean;
  userId?: string;
  roles: string[];
  permissions: string[];
  verified: boolean;
  tenantId?: string;
  accountStatus?: string;
}

/**
 * 8.1 Auth JSON Configuration Contract
 */
export interface AuthSessionConfig {
  restoreOnLaunch: boolean;
  storage: 'secure-store' | 'memory';
  refreshEnabled: boolean;
  refreshStrategy: 'before-expiration' | 'on-401' | 'manual';
  refreshThresholdSeconds?: number;
  rotateRefreshTokens?: boolean;
  revokeOnLogout?: boolean;
}

export interface AuthMethodsConfig {
  password: boolean;
  registration: boolean;
  emailVerification: boolean;
  passwordReset: boolean;
  phone?: boolean;
  otp: boolean;
  oauth: boolean;
  oidc?: boolean;
  google?: boolean;
  apple?: boolean;
  facebook?: boolean;
  biometric?: boolean;
  mfa?: boolean;
  passkeys?: boolean;
  multiAccount?: boolean;
  multiTenant?: boolean;
}

export interface AuthEventConfigEntry {
  event: string;
  flowRef?: string;
}

export interface AuthConfigDocument extends DocumentMetadata {
  id: string;
  enabled: boolean;
  provider: {
    type: AuthProviderType;
    ref: string;
    config?: Omit<AuthProviderConfig, 'type' | 'ref'>;
  };
  providers?: Record<string, AuthProviderConfig>;
  session: AuthSessionConfig;
  methods: AuthMethodsConfig;
  screenRefs: {
    login?: string;
    register?: string;
    verification?: string;
    forgotPassword?: string;
    resetPassword?: string;
    mfa?: string;
    recovery?: string;
  };
  events?: Record<string, string | AuthEventConfigEntry>;
  accessControl?: {
    defaultRoles?: string[];
    requireEmailVerification?: boolean;
    supportedRoles?: string[];
    supportedPermissions?: string[];
  };
}

/**
 * 8.2 Navigation JSON Configuration Contract
 */
export type NavigatorType = 'stack' | 'tabs' | 'drawer' | 'split' | 'modal';

export interface StackNavigatorOptions {
  headerVisible?: boolean;
  headerTitle?: string;
  backButtonBehavior?: 'default' | 'minimal' | 'none';
  interactiveGestures?: boolean;
  transitionStyle?: 'default' | 'slide_from_right' | 'fade' | 'modal';
  presentationStyle?: 'card' | 'modal' | 'fullScreenModal' | 'transparentModal';
  preserveHistory?: boolean;
}

export interface TabItemConfig {
  routeId: string;
  label: string;
  icon: string;
  badge?: string | number;
  visible?: boolean;
  nestedNavigatorId?: string;
}

export interface TabsNavigatorOptions {
  initialTab?: string;
  preserveTabState?: boolean;
  tabs?: TabItemConfig[];
}

export interface ModalNavigatorOptions {
  presentationStyle?: 'sheet' | 'fullScreen' | 'formSheet';
  dismissible?: boolean;
  interactiveDismissal?: boolean;
  allowNestedModals?: boolean;
  returnRouteId?: string;
}

export interface SplitNavigatorOptions {
  sidebarRoutes?: string[];
  defaultSelectedRoute?: string;
  defaultDetailRoute?: string;
  columnMode?: 'two-column' | 'three-column';
  adaptiveCollapse?: boolean;
  initialCollapsed?: boolean;
}

export interface NavigatorDefinition {
  id: string;
  type: NavigatorType;
  initialRoute?: string;
  children: string[];
  stackOptions?: StackNavigatorOptions;
  tabsOptions?: TabsNavigatorOptions;
  modalOptions?: ModalNavigatorOptions;
  splitOptions?: SplitNavigatorOptions;
}

export interface RouteParamSchema {
  type: 'string' | 'number' | 'boolean' | 'enum';
  required?: boolean;
  default?: string | number | boolean;
  enumValues?: string[];
  source?: 'path' | 'query';
}

export interface RouteOptions {
  title?: string;
  headerShown?: boolean;
  presentation?: 'card' | 'modal' | 'fullScreenModal' | 'bottomSheet';
  gestureEnabled?: boolean;
  tabLabel?: string;
  tabIcon?: string;
}

export interface RouteDeepLinkConfig {
  enabled?: boolean;
  aliases?: string[];
  universalLink?: boolean;
}

export interface RouteDefinition {
  id: string;
  name?: string;
  path: string;
  screenRef: string;
  navigatorId?: string;
  params?: Record<string, RouteParamSchema>;
  access?: AccessPolicy;
  options?: RouteOptions;
  deepLink?: RouteDeepLinkConfig;
  platforms?: PlatformTarget[];
}

export interface PlatformRendererPolicy {
  ios: {
    renderer: 'expo-ui';
    strictNative: boolean;
    mode?: CompilationMode;
  };
  android: {
    renderer: 'auto' | 'expo-ui-compose' | 'expo-router';
    fallback: 'expo-router' | 'native-tabs';
    mode?: CompilationMode;
  };
}

export interface DeepLinkingConfig {
  scheme: string;
  hosts?: string[];
  universalLinks?: boolean;
  androidAppLinks?: boolean;
}

export interface NavigationConfigDocument extends DocumentMetadata {
  id: string;
  platforms: PlatformRendererPolicy;
  rootNavigator: string;
  navigators: NavigatorDefinition[];
  routes: RouteDefinition[];
  linking?: DeepLinkingConfig;
}

/**
 * 8.3 Integration JSON Configuration Contract
 */
export interface IntegrationEventBinding {
  targetRoute?: string;
  flowRef?: string;
  action?: 'navigate' | 'replace' | 'reset' | 'restore-intended-destination' | 'hold';
}

export interface IntegrationConfigDocument extends DocumentMetadata {
  id?: string;
  authNavigation: {
    enabled: boolean;
    guestEntry: string;
    authenticatedEntry: string;
    afterLogin: 'restore-intended-destination' | string;
    afterRegistration: string;
    afterLogout: string;
    verificationRoute?: string;
    accessDeniedRoute?: string;
    sessionExpiredRoute?: string;
    accountSuspendedRoute?: string;
    roleRouteGroups?: Record<string, string>;
    events?: Record<string, IntegrationEventBinding>;
  };
}

/**
 * Section 16 Diagnostics Contract
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  document: 'auth' | 'navigation' | 'integration' | 'system';
  jsonPath: string;
  message: string;
  suggestion: string;
  canGenerate: boolean;
}
