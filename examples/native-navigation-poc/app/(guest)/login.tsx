import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

export default function GuestLoginScreen() {
  const router = useRouter();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Login</Text>
      <Pressable
        style={styles.button}
        onPress={() => router.replace('/(tabs)/home')}
      >
        <Text style={styles.buttonText}>Sign In (Reset to Main Tabs)</Text>
      </Pressable>
      <Pressable
        style={styles.secondaryButton}
        onPress={() => router.push('/(guest)/register')}
      >
        <Text style={styles.secondaryText}>Create Account</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 16 },
  button: { backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8, marginBottom: 12 },
  buttonText: { color: '#ffffff', fontWeight: '600' },
  secondaryButton: { paddingVertical: 8 },
  secondaryText: { color: '#2563eb' },
});
