import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import apiClient from '../../api/client';
import { colors, commonStyles } from '../../utils/styles';

export default function BatchesListScreen({ navigation }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/batches');
      setBatches(res.data.batches);
    } catch (err) { console.log(err.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onDelete = (batch) => {
    Alert.alert('Delete Batch', `Delete "${batch.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await apiClient.delete(`/batches/${batch.id}`); load(); }
        catch (err) { Alert.alert('Error', err.response?.data?.message || 'Failed'); }
      }}
    ]);
  };

  if (loading) return <View style={[commonStyles.screen, { justifyContent: 'center' }]}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <View style={commonStyles.screen}>
      <View style={commonStyles.header}>
        <Text style={commonStyles.headerTitle}>My Batches</Text>
        <Text style={commonStyles.headerSubtitle}>{batches.length} batches</Text>
      </View>

      <FlatList
        data={batches}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={{ padding: 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListEmptyComponent={<View style={commonStyles.emptyState}><Text style={{ fontSize: 60 }}>📅</Text><Text style={commonStyles.emptyText}>No batches yet.{'\n'}Create a course first, then add batches.</Text></View>}
        renderItem={({ item }) => (
          // Tap anywhere on the card → drill into the batch's enrolled
          // students. The two inline action buttons below stopPropagation
          // so they still work independently.
          <TouchableOpacity
            style={commonStyles.card}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('AdminBatchStudents', {
              batchId: item.id,
              batch: item,
            })}
          >
            <Text style={commonStyles.cardTitle}>{item.name}</Text>
            <Text style={commonStyles.cardSubtitle}>{item.course_name}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 8 }}>
              {item.days_of_week ? <Text style={{ fontSize: 12, color: colors.textLight }}>📆 {item.days_of_week}</Text> : null}
              {item.start_time ? <Text style={{ fontSize: 12, color: colors.textLight }}>⏰ {item.start_time?.slice(0,5)} - {item.end_time?.slice(0,5)}</Text> : null}
            </View>
            <Text style={{ fontSize: 12, marginTop: 6, color: colors.textLight }}>👨‍🏫 {item.trainer_name || 'No trainer assigned'}</Text>
            <Text style={{ fontSize: 12, marginTop: 2, color: colors.textLight }}>👥 Capacity: {item.capacity} | Mode: {item.mode}</Text>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 }}>
              {/* Add Student — opens the enrollment form pre-bound to this
                  batch. Lets the institution admin register a student
                  directly into the picked batch in one tap. */}
              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation?.();
                  navigation.navigate('EnrollmentForm', {
                    batchId: item.id,
                    batch: item,
                    course: { id: item.course_id, name: item.course_name },
                  });
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: '#E63946',
                }}
                activeOpacity={0.85}
              >
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>+ Add Student</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); onDelete(item); }}>
                <Text style={{ color: colors.danger, fontWeight: '600' }}>Delete</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}
      />

      <TouchableOpacity style={commonStyles.fab} onPress={() => navigation.navigate('CreateBatch')}>
        <Text style={commonStyles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}