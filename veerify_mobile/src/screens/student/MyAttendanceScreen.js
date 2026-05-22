import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import apiClient from '../../api/client';
import { colors, commonStyles } from '../../utils/styles';

export default function MyAttendanceScreen() {
  const [data, setData] = useState({ summary: { total: 0, present: 0, absent: 0, late: 0, percentage: 0 }, attendance: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/attendance/my');
      setData(res.data);
    } catch (err) { console.log(err.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <View style={[commonStyles.screen, { justifyContent: 'center' }]}><ActivityIndicator size="large" color={colors.primary} /></View>;

  const { summary, attendance } = data;

  return (
    <View style={commonStyles.screen}>
      <View style={commonStyles.header}>
        <Text style={commonStyles.headerTitle}>My Attendance</Text>
        <Text style={commonStyles.headerSubtitle}>{summary.percentage}% attendance rate</Text>
      </View>

      <View style={{ padding: 20 }}>
        <View style={{ backgroundColor: colors.light, padding: 20, borderRadius: 12, alignItems: 'center', marginBottom: 16 }}>
          <Text style={{ fontSize: 56, fontWeight: 'bold', color: summary.percentage >= 75 ? colors.success : colors.warning }}>
            {summary.percentage}%
          </Text>
          <Text style={{ color: colors.textLight, marginTop: 4 }}>
            {summary.present} of {summary.total} classes attended
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          <View style={{ flex: 1, backgroundColor: colors.success, padding: 12, borderRadius: 10, alignItems: 'center' }}>
            <Text style={{ color: colors.white, fontSize: 22, fontWeight: 'bold' }}>{summary.present}</Text>
            <Text style={{ color: colors.white, fontSize: 11 }}>Present</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: colors.danger, padding: 12, borderRadius: 10, alignItems: 'center' }}>
            <Text style={{ color: colors.white, fontSize: 22, fontWeight: 'bold' }}>{summary.absent}</Text>
            <Text style={{ color: colors.white, fontSize: 11 }}>Absent</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: colors.warning, padding: 12, borderRadius: 10, alignItems: 'center' }}>
            <Text style={{ color: colors.white, fontSize: 22, fontWeight: 'bold' }}>{summary.late}</Text>
            <Text style={{ color: colors.white, fontSize: 11 }}>Late</Text>
          </View>
        </View>
      </View>

      <FlatList
        data={attendance}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={{ padding: 20, paddingTop: 0 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListHeaderComponent={
          <Text style={[commonStyles.title, { fontSize: 18, marginBottom: 12 }]}>History</Text>
        }
        ListEmptyComponent={
          <View style={commonStyles.emptyState}>
            <Text style={commonStyles.emptyText}>No attendance records yet</Text>
          </View>
        }
        renderItem={({ item }) => {
          const date = new Date(item.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
          const statusColor = item.status === 'present' ? colors.success : item.status === 'absent' ? colors.danger : colors.warning;
          return (
            <View style={[commonStyles.card, { flexDirection: 'row', alignItems: 'center' }]}>
              <View style={{ flex: 1 }}>
                <Text style={commonStyles.cardTitle}>{date}</Text>
                <Text style={commonStyles.cardSubtitle}>{item.batch_name} • {item.course_name}</Text>
              </View>
              <View style={{ backgroundColor: statusColor, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8 }}>
                <Text style={{ color: colors.white, fontWeight: '600', fontSize: 12, textTransform: 'uppercase' }}>{item.status}</Text>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}