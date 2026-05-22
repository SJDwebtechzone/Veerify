import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, ActivityIndicator, TouchableOpacity, TextInput } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import apiClient from '../../api/client';
import { colors, commonStyles } from '../../utils/styles';

export default function AttendanceHistoryScreen({ route }) {
  const { batchId, batchName } = route.params;
  const [records, setRecords] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [filterDate, setFilterDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const url = filterDate 
        ? `/attendance/batch/${batchId}?date=${filterDate}` 
        : `/attendance/batch/${batchId}`;
      const res = await apiClient.get(url);
      setRecords(res.data.attendance);
      setFiltered(res.data.attendance);
    } catch (err) { 
      console.log('Load attendance history error:', err.message); 
    } finally { 
      setLoading(false); 
      setRefreshing(false); 
    }
  }, [batchId, filterDate]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Group records by date for nicer display
  const groupedByDate = filtered.reduce((acc, record) => {
    const dateKey = new Date(record.date).toLocaleDateString('en-IN', { 
      day: '2-digit', month: 'short', year: 'numeric' 
    });
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(record);
    return acc;
  }, {});

  const dateGroups = Object.keys(groupedByDate).map(date => ({
    date,
    records: groupedByDate[date],
    presentCount: groupedByDate[date].filter(r => r.status === 'present').length,
    totalCount: groupedByDate[date].length,
  }));

  if (loading) {
    return (
      <View style={[commonStyles.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={commonStyles.screen}>
      <View style={commonStyles.header}>
        <Text style={commonStyles.headerTitle}>Attendance History</Text>
        <Text style={commonStyles.headerSubtitle}>{batchName} • {records.length} records</Text>
      </View>

      <View style={{ padding: 16 }}>
        <Text style={commonStyles.label}>Filter by date (optional)</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            style={[commonStyles.input, { flex: 1 }]}
            value={filterDate}
            onChangeText={setFilterDate}
            placeholder="YYYY-MM-DD (e.g., 2026-05-08)"
            placeholderTextColor={colors.gray}
          />
          {filterDate ? (
            <TouchableOpacity 
              style={{ backgroundColor: colors.dark, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 10 }}
              onPress={() => setFilterDate('')}
            >
              <Text style={{ color: colors.white }}>Clear</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <FlatList
        data={dateGroups}
        keyExtractor={(item) => item.date}
        contentContainerStyle={{ padding: 16, paddingTop: 0 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListEmptyComponent={
          <View style={commonStyles.emptyState}>
            <Text style={{ fontSize: 60 }}>📋</Text>
            <Text style={commonStyles.emptyText}>
              {filterDate ? 'No records for this date' : 'No attendance history yet'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[commonStyles.card, { marginBottom: 16 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={commonStyles.cardTitle}>📅 {item.date}</Text>
              <View style={{ backgroundColor: colors.success, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }}>
                <Text style={{ color: colors.white, fontSize: 12, fontWeight: '600' }}>
                  {item.presentCount}/{item.totalCount} present
                </Text>
              </View>
            </View>

            {item.records.map((r) => {
              const statusColor = r.status === 'present' ? colors.success 
                                : r.status === 'absent' ? colors.danger 
                                : colors.warning;
              return (
                <View 
                  key={r.id} 
                  style={{ 
                    flexDirection: 'row', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    paddingVertical: 8,
                    borderTopWidth: 1,
                    borderTopColor: colors.lightGray,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '500' }}>{r.student_name}</Text>
                    <Text style={{ fontSize: 11, color: colors.textLight }}>{r.student_email}</Text>
                  </View>
                  <View style={{ backgroundColor: statusColor, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6 }}>
                    <Text style={{ color: colors.white, fontSize: 11, fontWeight: '600', textTransform: 'uppercase' }}>
                      {r.status}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      />
    </View>
  );
}