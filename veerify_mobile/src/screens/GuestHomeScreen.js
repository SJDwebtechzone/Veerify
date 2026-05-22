import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default function GuestHomeScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>👋 Browsing as Guest</Text>
      <Text style={styles.subtitle}>Browse academies without an account</Text>
      <Text style={styles.note}>🚧 Guest browsing screens coming on Day 5</Text>
      
      <TouchableOpacity style={styles.button} onPress={() => navigation.goBack()}>
        <Text style={styles.buttonText}>Back to Login</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#666', textAlign: 'center', marginBottom: 32 },
  note: { textAlign: 'center', color: '#999', fontStyle: 'italic', marginBottom: 32 },
  button: { backgroundColor: '#1a1a2e', padding: 16, borderRadius: 10, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});