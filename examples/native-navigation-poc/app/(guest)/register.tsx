import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

export default function GuestRegisterScreen() {
  const router = useRouter();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Registration</Text>
      <Pressable
        style={styles.button}
        onPress={() => router.push('/(guest)/verify')}
      >
        <Text style={styles.buttonText}>Continue to Verification</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 16 },
  button: { backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8 },
  buttonText: { color: '#ffffff', fontWeight: '600' },
});
