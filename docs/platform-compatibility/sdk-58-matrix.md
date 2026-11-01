# Expo SDK 58 Platform Capability Matrix

| Capability ID | iOS (`@expo/ui/swift-ui`) | Android (`@expo/ui/jetpack-compose` + `expo-router`) | Verification Status |
|---|---|---|---|
| `navigation.stack` | `native` (`Host` + `NavigationStack` + `createStandardRouterNavigator(Content, StackRouter)`) | `fallback` (`expo-router#Stack` + `Host` + `TopAppBar`) | `simulated` |
| `navigation.nested-stack` | `native` (`Host` + `NavigationStack`) | `fallback` (`expo-router#Stack`) | `simulated` |
| `navigation.destination` | `native` (`NavigationDestination` mapped from route `descriptors`) | `fallback` (`expo-router#Screen`) | `simulated` |
| `navigation.tabs` | `native` (`Host` + `TabView` + `createStandardRouterNavigator(Content, TabRouter)`) | `supported` (`Host` + `NavigationBar` + `NavigationBarItem` + `TabRouter` / `expo-router/native-tabs`) | `simulated` |
| `navigation.split` | `native` (`Host` + `NavigationSplitView`) | `fallback` (`expo-router/drawer#Drawer`) | `documented` |
| `navigation.drawer` | `native` (`Host` + `NavigationSplitView`) | `fallback` (`expo-router/drawer#Drawer`) | `documented` |
| `navigation.toolbar` | `native` (`Toolbar`) | `native` (`Host` + `TopAppBar`) | `documented` |
| `navigation.modal` | `native` (`Host` + `BottomSheet`) | `native` (`Host` + `ModalBottomSheet` + `ModalRoute`) | `simulated` |
| `navigation.deep-links` | `supported` (`expo-router` + `expo-linking`) | `supported` (`expo-router` + `expo-linking`) | `simulated` |
