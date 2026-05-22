import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import apiClient from '../../api/client';
import { colors } from '../../utils/styles';

export default function ChildAttendanceScreen({ route }) {
  const { childId, childName } = route.params;
  const [data, setData] = useState({ summary: { total: 0, present: 0, absent: 0, late: 0, percentage: 0 }, attendance: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get(`/parents/children/${childId}/attendance`);
      setData(res.data);
    } catch (err) { 
      console.log(err.message); 
    } finally { 
      setLoading(false); 
      setRefreshing(false); 
    }
  }, [childId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return (
    <View style={[styles.screen, { justifyContent: 'center' }]}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );

  const { summary, attendance } = data;
  const pctColor = summary.percentage >= 75 ? colors.success 
                 : summary.percentage >= 50 ? colors.warning 
                 : colors.danger;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{childName}'s Attendance</Text>
        <Text style={styles.headerSubtitle}>{summary.percentage}% attendance rate</Text>
      </View>

      <View style={{ padding: 16 }}>
        {/* Big percentage card */}
        <View style={styles.bigCard}>
          <Text style={[styles.bigPercent, { color: pctColor }]}>
            {summary.percentage}%
          </Text>
          <Text style={styles.bigLabel}>
            {summary.present} of {summary.total} classes attended
          </Text>
        </View>

        {/* 3 stat cards */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          <View style={[styles.statCard, { backgroundColor: colors.success }]}>
            <Text style={styles.statNum}>{summary.present}</Text>
            <Text style={styles.statLab}>Present</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.danger }]}>
            <Text style={styles.statNum}>{summary.absent}</Text>
            <Text style={styles.statLab}>Absent</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.warning }]}>
            <Text style={styles.statNum}>{summary.late}</Text>
            <Text style={styles.statLab}>Late</Text>
          </View>
        </View>
      </View>

      <FlatList
        data={attendance}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={{ padding: 16, paddingTop: 0 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListHeaderComponent={
          <Text style={styles.sectionTitle}>Attendance History</Text>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>📋</Text>
            <Text style={styles.emptyText}>No attendance records yet</Text>
          </View>
        }
        renderItem={({ item }) => {
          const date = new Date(item.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
          const statusColor = item.status === 'present' ? colors.success 
                            : item.status === 'absent' ? colors.danger 
                            : colors.warning;
          return (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowDate}>{date}</Text>
                <Text style={styles.rowMeta}>{item.batch_name} • {item.course_name}</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
                <Text style={styles.statusText}>{item.status?.toUpperCase()}</Text>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.light },
  header: { backgroundColor: colors.dark, paddingTop: 50, paddingHorizontal: 20, paddingBottom: 24 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: colors.white },
  headerSubtitle: { fontSize: 13, color: '#a0a0c0', marginTop: 4 },

  bigCard: { backgroundColor: colors.white, padding: 24, borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: colors.lightGray, marginBottom: 16 },
  bigPercent: { fontSize: 56, fontWeight: '700' },
  bigLabel: { fontSize: 13, color: colors.textLight, marginTop: 4 },

  statCard: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center' },
  statNum: { fontSize: 22, fontWeight: '700', color: colors.white },
  statLab: { fontSize: 11, color: colors.white, marginTop: 2 },

  sectionTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 12 },
  
  row: { flexDirection: 'row', backgroundColor: colors.white, padding: 14, borderRadius: 10, marginBottom: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.lightGray },
  rowDate: { fontSize: 14, fontWeight: '600', color: colors.text },
  rowMeta: { fontSize: 12, color: colors.textLight, marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  statusText: { color: colors.white, fontSize: 10, fontWeight: '700' },

  emptyState: { alignItems: 'center', padding: 40 },
  emptyEmoji: { fontSize: 60, marginBottom: 8 },
  emptyText: { color: colors.textLight },
});