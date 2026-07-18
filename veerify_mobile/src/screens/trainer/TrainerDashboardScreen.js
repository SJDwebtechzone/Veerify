import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import apiClient from '../../api/client';
import { useBellScrollHandler } from '../../components/bellScrollBus';
import { useAuth } from '../../context/AuthContext';
import { colors, commonStyles } from '../../utils/styles';

export default function TrainerDashboardScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/batches/trainer/my');
      setBatches(res.data.batches);
    } catch (err) { console.log(err.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const confirmLogout = () => {
    Alert.alert('Logout', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', onPress: logout, style: 'destructive' }
    ]);
  };

  if (loading) return <View style={[commonStyles.screen, { justifyContent: 'center' }]}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <View style={commonStyles.screen}>
      <View style={commonStyles.header}>
        <Text style={commonStyles.headerTitle}>Welcome, {user.name}!</Text>
        <Text style={commonStyles.headerSubtitle}>{batches.length} batches assigned</Text>
        <TouchableOpacity 
          style={{ position: 'absolute', top: 60, right: 20 }}
          onPress={confirmLogout}
        >
          <Text style={{ color: colors.white, fontSize: 12 }}>Logout</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={batches}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={{ padding: 20 }}
        onScroll={useBellScrollHandler()}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListHeaderComponent={
          <Text style={[commonStyles.title, { fontSize: 18, marginBottom: 12 }]}>My Batches</Text>
        }
        ListEmptyComponent={
          <View style={commonStyles.emptyState}>
            <Text style={{ fontSize: 60 }}>📅</Text>
            <Text style={commonStyles.emptyText}>No batches assigned yet.{'\n'}Ask your admin to assign you to a batch.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity 
            style={commonStyles.card}
            onPress={() => navigation.navigate('BatchStudents', { batchId: item.id, batchName: item.name })}
          >
            <Text style={commonStyles.cardTitle}>{item.name}</Text>
            <Text style={{ fontSize: 13, color: colors.primary, marginTop: 4 }}>{item.course_name}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 12 }}>
              {item.days_of_week ? <Text style={{ fontSize: 12, color: colors.textLight }}>📆 {item.days_of_week}</Text> : null}
              {item.start_time ? <Text style={{ fontSize: 12, color: colors.textLight }}>⏰ {item.start_time?.slice(0,5)}</Text> : null}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <Text style={{ fontSize: 12, color: colors.textLight }}>👥 {item.enrolled_count} students</Text>
              <Text style={{ color: colors.primary, fontWeight: '600' }}>Mark Attendance ›</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}