import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

export default function ProfileScreen() {
  const router = useRouter();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profile Overview</Text>
      <Pressable
        style={styles.button}
        onPress={() => router.push('/(tabs)/profile/settings')}
      >
        <Text style={styles.buttonText}>Open Settings</Text>
      </Pressable>
      <Pressable
        style={styles.logoutButton}
        onPress={() => router.replace('/(guest)/login')}
      >
        <Text style={styles.logoutText}>Sign Out (Reset to Guest Stack)</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 16 },
  button: { backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8, marginBottom: 12 },
  buttonText: { color: '#ffffff', fontWeight: '600' },
  logoutButton: { paddingVertical: 10, paddingHorizontal: 18 },
  logoutText: { color: '#dc2626', fontWeight: '600' },
});
