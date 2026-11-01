import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Host, TopAppBar } from '@expo/ui/jetpack-compose';

export interface RouterStackFallbackProps {
  headerTitle?: string;
}

export function RouterStackFallback({
  headerTitle,
  children,
}: React.PropsWithChildren<RouterStackFallbackProps>) {
  const router = useRouter();

  return (
    <View style={styles.container}>
      {headerTitle ? (
        <Host>
          <TopAppBar
            title={headerTitle}
            onBackPress={() => {
              if (router.canGoBack()) {
                router.back();
              }
            }}
          />
        </Host>
      ) : null}
      <Stack screenOptions={{ headerShown: !headerTitle }}>{children}</Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
