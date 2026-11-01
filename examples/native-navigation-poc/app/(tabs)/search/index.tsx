import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

export default function SearchScreen() {
  const router = useRouter();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Search Catalog</Text>
      <Pressable
        style={styles.button}
        onPress={() => router.push('/(tabs)/search/products/PROD-42')}
      >
        <Text style={styles.buttonText}>Open Product #PROD-42</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 16 },
  button: { backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8 },
  buttonText: { color: '#ffffff', fontWeight: '600' },
});
