import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

export default function OrderDetailScreen() {
  const { orderId, tab } = useLocalSearchParams<{ orderId: string; tab?: string }>();
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Order Detail: {orderId}</Text>
      <Text style={styles.subtitle}>Active Section: {tab ?? 'summary'}</Text>
      <Pressable style={styles.button} onPress={() => router.back()}>
        <Text style={styles.buttonText}>Back to Home</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  subtitle: { fontSize: 14, opacity: 0.75, marginBottom: 16 },
  button: { backgroundColor: '#475569', paddingVertical: 10, paddingHorizontal: 18, borderRadius: 8 },
  buttonText: { color: '#ffffff', fontWeight: '600' },
});
