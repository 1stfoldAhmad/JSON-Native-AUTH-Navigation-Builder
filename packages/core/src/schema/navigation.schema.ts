export const NAVIGATION_JSON_SCHEMA = {
  $id: 'https://expo-foundation.dev/schemas/navigation.schema.json',
  title: 'ExpoNavigationBuilderConfig',
  type: 'object',
  required: ['schemaVersion', 'id', 'platforms', 'rootNavigator', 'navigators', 'routes'],
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
    builderVersion: { type: 'string' },
    projectId: { type: 'string' },
    moduleId: { type: 'string' },
    target: {
      type: 'object',
      additionalProperties: false,
      properties: {
        expoSdk: { type: 'number' },
        platforms: {
          type: 'array',
          items: { type: 'string', enum: ['ios', 'android'] },
        },
      },
    },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    id: { type: 'string', minLength: 1 },
    platforms: {
      type: 'object',
      required: ['ios', 'android'],
      additionalProperties: false,
      properties: {
        ios: {
          type: 'object',
          required: ['renderer', 'strictNative'],
          additionalProperties: false,
          properties: {
            renderer: { type: 'string', enum: ['expo-ui'] },
            strictNative: { type: 'boolean' },
            mode: {
              type: 'string',
              enum: ['strict-native', 'automatic-fallback', 'diagnostic'],
            },
          },
        },
        android: {
          type: 'object',
          required: ['renderer', 'fallback'],
          additionalProperties: false,
          properties: {
            renderer: {
              type: 'string',
              enum: ['auto', 'expo-ui-compose', 'expo-router'],
            },
            fallback: {
              type: 'string',
              enum: ['expo-router', 'native-tabs'],
            },
            mode: {
              type: 'string',
              enum: ['strict-native', 'automatic-fallback', 'diagnostic'],
            },
          },
        },
      },
    },
    rootNavigator: { type: 'string', minLength: 1 },
    navigators: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'type', 'children'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 1 },
          type: {
            type: 'string',
            enum: ['stack', 'tabs', 'drawer', 'split', 'modal'],
          },
          initialRoute: { type: 'string' },
          children: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
          },
          stackOptions: {
            type: 'object',
            additionalProperties: false,
            properties: {
              headerVisible: { type: 'boolean' },
              headerTitle: { type: 'string' },
              backButtonBehavior: {
                type: 'string',
                enum: ['default', 'minimal', 'none'],
              },
              interactiveGestures: { type: 'boolean' },
              transitionStyle: {
                type: 'string',
                enum: ['default', 'slide_from_right', 'fade', 'modal'],
              },
              presentationStyle: {
                type: 'string',
                enum: ['card', 'modal', 'fullScreenModal', 'transparentModal'],
              },
              preserveHistory: { type: 'boolean' },
            },
          },
          tabsOptions: {
            type: 'object',
            additionalProperties: false,
            properties: {
              initialTab: { type: 'string' },
              preserveTabState: { type: 'boolean' },
              tabs: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['routeId', 'label', 'icon'],
                  additionalProperties: false,
                  properties: {
                    routeId: { type: 'string' },
                    label: { type: 'string' },
                    icon: { type: 'string' },
                    badge: { oneOf: [{ type: 'string' }, { type: 'number' }] },
                    visible: { type: 'boolean' },
                    nestedNavigatorId: { type: 'string' },
                  },
                },
              },
            },
          },
          modalOptions: {
            type: 'object',
            additionalProperties: false,
            properties: {
              presentationStyle: {
                type: 'string',
                enum: ['sheet', 'fullScreen', 'formSheet'],
              },
              dismissible: { type: 'boolean' },
              interactiveDismissal: { type: 'boolean' },
              allowNestedModals: { type: 'boolean' },
              returnRouteId: { type: 'string' },
            },
          },
          splitOptions: {
            type: 'object',
            additionalProperties: false,
            properties: {
              sidebarRoutes: { type: 'array', items: { type: 'string' } },
              defaultSelectedRoute: { type: 'string' },
              defaultDetailRoute: { type: 'string' },
              columnMode: { type: 'string', enum: ['two-column', 'three-column'] },
              adaptiveCollapse: { type: 'boolean' },
              initialCollapsed: { type: 'boolean' },
            },
          },
        },
      },
    },
    routes: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'path', 'screenRef'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 1 },
          name: { type: 'string' },
          path: { type: 'string', minLength: 1 },
          screenRef: { type: 'string', minLength: 1 },
          navigatorId: { type: 'string' },
          params: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              required: ['type'],
              additionalProperties: false,
              properties: {
                type: {
                  type: 'string',
                  enum: [
                    'string',
                    'number',
                    'boolean',
                    'enum',
                    'date',
                    'uuid',
                    'custom-scalar',
                    'array',
                  ],
                },
                required: { type: 'boolean' },
                default: {
                  oneOf: [
                    { type: 'string' },
                    { type: 'number' },
                    { type: 'boolean' },
                    { type: 'array', items: { type: 'string' } },
                  ],
                },
                enumValues: { type: 'array', items: { type: 'string' } },
                itemType: {
                  type: 'string',
                  enum: ['string', 'number', 'boolean'],
                },
                pattern: { type: 'string' },
                source: { type: 'string', enum: ['path', 'query'] },
              },
            },
          },
          access: {
            oneOf: [
              {
                type: 'string',
                enum: ['public', 'guest', 'authenticated', 'verified'],
              },
              {
                type: 'object',
                required: ['roles'],
                additionalProperties: false,
                properties: {
                  roles: { type: 'array', minItems: 1, items: { type: 'string' } },
                  mode: { type: 'string', enum: ['any', 'all'] },
                },
              },
              {
                type: 'object',
                required: ['permissions'],
                additionalProperties: false,
                properties: {
                  permissions: {
                    type: 'array',
                    minItems: 1,
                    items: { type: 'string' },
                  },
                  mode: { type: 'string', enum: ['any', 'all'] },
                },
              },
              {
                type: 'object',
                required: ['accountStatus'],
                additionalProperties: false,
                properties: {
                  accountStatus: {
                    type: 'array',
                    minItems: 1,
                    items: { type: 'string' },
                  },
                },
              },
              {
                type: 'object',
                required: ['tenantId'],
                additionalProperties: false,
                properties: {
                  tenantId: { type: 'string', minLength: 1 },
                },
              },
            ],
          },
          options: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string' },
              headerShown: { type: 'boolean' },
              presentation: {
                type: 'string',
                enum: ['card', 'modal', 'fullScreenModal', 'bottomSheet'],
              },
              gestureEnabled: { type: 'boolean' },
              tabLabel: { type: 'string' },
              tabIcon: { type: 'string' },
            },
          },
          deepLink: {
            type: 'object',
            additionalProperties: false,
            properties: {
              enabled: { type: 'boolean' },
              aliases: { type: 'array', items: { type: 'string' } },
              universalLink: { type: 'boolean' },
            },
          },
          platforms: {
            type: 'array',
            items: { type: 'string', enum: ['ios', 'android'] },
          },
        },
      },
    },
    linking: {
      type: 'object',
      required: ['scheme'],
      additionalProperties: false,
      properties: {
        scheme: { type: 'string', minLength: 1 },
        hosts: { type: 'array', items: { type: 'string' } },
        universalLinks: { type: 'boolean' },
        androidAppLinks: { type: 'boolean' },
      },
    },
  },
} as const;
