import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import apiClient from '../../api/client';
import { colors, commonStyles } from '../../utils/styles';

export default function TrainersListScreen({ navigation }) {
  const [trainers, setTrainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/trainers');
      setTrainers(res.data.trainers);
    } catch (err) { console.log(err.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onDelete = (trainer) => {
    Alert.alert('Delete Trainer', `Remove ${trainer.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await apiClient.delete(`/trainers/${trainer.id}`);
          load();
        } catch (err) { Alert.alert('Error', err.response?.data?.message || 'Failed'); }
      }}
    ]);
  };

  if (loading) return <View style={[commonStyles.screen, { justifyContent: 'center' }]}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <View style={commonStyles.screen}>
      <View style={commonStyles.header}>
        <Text style={commonStyles.headerTitle}>My Trainers</Text>
        <Text style={commonStyles.headerSubtitle}>{trainers.length} trainers</Text>
      </View>

      <FlatList
        data={trainers}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={{ padding: 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListEmptyComponent={<View style={commonStyles.emptyState}><Text style={{ fontSize: 60 }}>👨‍🏫</Text><Text style={commonStyles.emptyText}>No trainers yet</Text></View>}
        renderItem={({ item }) => (
          <View style={commonStyles.card}>
            <Text style={commonStyles.cardTitle}>{item.name}</Text>
            <Text style={commonStyles.cardSubtitle}>{item.email}</Text>
            {item.specialization ? <Text style={{ fontSize: 12, color: colors.primary, marginTop: 4 }}>{item.specialization}</Text> : null}
            {item.belt_level ? <Text style={{ fontSize: 12, color: colors.textLight, marginTop: 2 }}>🥋 {item.belt_level}</Text> : null}
            <Text style={{ fontSize: 12, color: colors.textLight, marginTop: 4 }}>{item.experience_years} years experience</Text>
            <TouchableOpacity onPress={() => onDelete(item)} style={{ marginTop: 8 }}>
              <Text style={{ color: colors.danger, fontWeight: '600' }}>Remove</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      <TouchableOpacity style={commonStyles.fab} onPress={() => navigation.navigate('CreateTrainer')}>
        <Text style={commonStyles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}