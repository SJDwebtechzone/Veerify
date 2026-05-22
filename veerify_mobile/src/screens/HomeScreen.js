import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useAuth } from '../context/AuthContext';

export default function HomeScreen() {
  const { user, logout } = useAuth();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Welcome, {user?.name}!</Text>
      
      <View style={styles.card}>
        <Text style={styles.label}>Email:</Text>
        <Text style={styles.value}>{user?.email}</Text>
        
        <Text style={styles.label}>Role:</Text>
        <Text style={styles.value}>{user?.role}</Text>
        
        <Text style={styles.label}>Institution ID:</Text>
        <Text style={styles.value}>{user?.institution_id ?? 'None'}</Text>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={logout}>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>

      <Text style={styles.note}>
        🚧 Home screens for {user?.role} coming on Day 4
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, backgroundColor: '#fff', flexGrow: 1, paddingTop: 60 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#1a1a2e', marginBottom: 24 },
  card: { backgroundColor: '#f4f4f8', padding: 20, borderRadius: 12, marginBottom: 24 },
  label: { fontSize: 12, color: '#888', marginTop: 8, textTransform: 'uppercase' },
  value: { fontSize: 16, color: '#1a1a2e', marginTop: 4, fontWeight: '500' },
  logoutButton: { backgroundColor: '#e63946', padding: 16, borderRadius: 10, alignItems: 'center' },
  logoutText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  note: { textAlign: 'center', marginTop: 32, color: '#999', fontStyle: 'italic' },
});