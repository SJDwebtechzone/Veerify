import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import apiClient from '../../api/client';
import { colors } from '../../utils/styles';

export default function ChildPaymentsScreen({ route }) {
  const { childId, childName } = route.params;
  const [data, setData] = useState({ summary: { total: 0, paid: 0, pending: 0 }, payments: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get(`/parents/children/${childId}/payments`);
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

  const { summary, payments } = data;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{childName}'s Payments</Text>
        <Text style={styles.headerSubtitle}>Total: ₹{summary.total} • Pending: ₹{summary.pending}</Text>
      </View>

      <View style={{ padding: 16 }}>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          <View style={[styles.statCard, { backgroundColor: colors.dark }]}>
            <Text style={styles.statNum}>₹{summary.total}</Text>
            <Text style={styles.statLab}>Total</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.success }]}>
            <Text style={styles.statNum}>₹{summary.paid}</Text>
            <Text style={styles.statLab}>Paid</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.warning }]}>
            <Text style={styles.statNum}>₹{summary.pending}</Text>
            <Text style={styles.statLab}>Pending</Text>
          </View>
        </View>
      </View>

      <FlatList
        data={payments}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={{ padding: 16, paddingTop: 0 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListHeaderComponent={<Text style={styles.sectionTitle}>Payment History</Text>}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>💳</Text>
            <Text style={styles.emptyText}>No payment records yet</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isPaid = item.payment_status === 'paid';
          return (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.courseName}>{item.course_name}</Text>
                <Text style={styles.meta}>{item.batch_name}</Text>
                <Text style={styles.meta}>{item.institution_name}</Text>
                <Text style={styles.date}>
                  {new Date(item.enrolled_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.amount}>₹{item.amount}</Text>
                <View style={[
                  styles.statusBadge,
                  { backgroundColor: isPaid ? colors.success : colors.warning }
                ]}>
                  <Text style={styles.statusText}>{item.payment_status?.toUpperCase()}</Text>
                </View>
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

  statCard: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center' },
  statNum: { fontSize: 18, fontWeight: '700', color: colors.white },
  statLab: { fontSize: 11, color: colors.white, marginTop: 2, opacity: 0.9 },

  sectionTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 12 },

  row: { flexDirection: 'row', backgroundColor: colors.white, padding: 14, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: colors.lightGray, gap: 10 },
  courseName: { fontSize: 14, fontWeight: '600', color: colors.text },
  meta: { fontSize: 11, color: colors.textLight, marginTop: 2 },
  date: { fontSize: 11, color: colors.gray, marginTop: 4 },
  amount: { fontSize: 16, fontWeight: '700', color: colors.primary, marginBottom: 6 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { color: colors.white, fontSize: 9, fontWeight: '700' },

  emptyState: { alignItems: 'center', padding: 40 },
  emptyEmoji: { fontSize: 60, marginBottom: 8 },
  emptyText: { color: colors.textLight },
});