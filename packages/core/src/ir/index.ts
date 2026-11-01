import type { AuthProviderConfig, AuthProviderType } from '@expo-foundation/contracts';
import type {
  AccessPolicy,
  AuthMethodsConfig,
  AuthSessionConfig,
  CompilationMode,
  DeepLinkingConfig,
  Diagnostic,
  IntegrationEventBinding,
  ModalNavigatorOptions,
  NavigatorType,
  PlatformTarget,
  ProjectTargetProfile,
  RouteDeepLinkConfig,
  RouteOptions,
  RouteParamSchema,
  SplitNavigatorOptions,
  StackNavigatorOptions,
  TabsNavigatorOptions,
} from '../types/index.js';

export interface AuthIR {
  id: string;
  schemaVersion: string;
  enabled: boolean;
  providerType: AuthProviderType;
  providerRef: string;
  providerConfig: AuthProviderConfig;
  session: AuthSessionConfig;
  methods: AuthMethodsConfig;
  screenRefs: Record<string, string>;
  eventFlows: Record<string, string>;
  defaultRoles: string[];
  requireEmailVerification: boolean;
  requiredPackages: string[];
}

export interface ResolvedPlatformCapabilityIR {
  capabilityId: string;
  platform: PlatformTarget;
  support: 'native' | 'supported' | 'fallback' | 'unsupported';
  implementation: string;
  fallbackUsed: boolean;
  fallbackImplementation?: string;
  requiredPackages: string[];
}

export interface NavigatorIR {
  id: string;
  type: NavigatorType;
  parentNavigatorId?: string;
  initialRoute: string;
  children: string[];
  childRoutes: string[];
  childNavigators: string[];
  stackOptions?: StackNavigatorOptions;
  tabsOptions?: TabsNavigatorOptions;
  modalOptions?: ModalNavigatorOptions;
  splitOptions?: SplitNavigatorOptions;
  iosCapability: ResolvedPlatformCapabilityIR;
  androidCapability: ResolvedPlatformCapabilityIR;
}

export interface RouteIR {
  id: string;
  name: string;
  path: string;
  normalizedPath: string;
  screenRef: string;
  navigatorId: string;
  params: Record<string, RouteParamSchema>;
  access: AccessPolicy;
  options: RouteOptions;
  deepLink: RouteDeepLinkConfig;
  platforms: PlatformTarget[];
}

export interface NavigationIR {
  id: string;
  schemaVersion: string;
  iosMode: CompilationMode;
  androidMode: CompilationMode;
  androidRendererPreference: 'auto' | 'expo-ui-compose' | 'expo-router';
  androidFallbackPreference: 'expo-router' | 'native-tabs';
  rootNavigator: string;
  navigators: Record<string, NavigatorIR>;
  routes: Record<string, RouteIR>;
  routeOrder: string[];
  linking: DeepLinkingConfig;
  requiredPackages: string[];
}

export interface IntegrationIR {
  schemaVersion: string;
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
  roleRouteGroups: Record<string, string>;
  events: Record<string, IntegrationEventBinding>;
}

export interface ProjectMetadataIR {
  projectId: string;
  schemaVersion: string;
  target: ProjectTargetProfile;
}

export interface ProjectIR {
  sdkVersion: number;
  metadata: ProjectMetadataIR;
  auth?: AuthIR;
  navigation?: NavigationIR;
  integration?: IntegrationIR;
  requiredPackages: Record<string, string>;
  diagnostics: Diagnostic[];
  canGenerate: boolean;
}
