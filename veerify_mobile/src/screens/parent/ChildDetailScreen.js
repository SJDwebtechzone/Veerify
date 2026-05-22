import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import apiClient from '../../api/client';
import { colors } from '../../utils/styles';

export default function ChildDetailScreen({ route, navigation }) {
  const { childId, childName } = route.params;
  const [summary, setSummary] = useState(null);
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [summaryRes, enrollmentsRes] = await Promise.all([
        apiClient.get(`/parents/children/${childId}/summary`),
        apiClient.get(`/parents/children/${childId}/enrollments`),
      ]);
      setSummary(summaryRes.data);
      setEnrollments(enrollmentsRes.data.enrollments);
    } catch (err) { 
      console.log('Load child detail error:', err.message); 
    } finally { 
      setLoading(false); 
      setRefreshing(false); 
    }
  }, [childId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!summary) {
    return (
      <View style={[styles.screen, { padding: 24 }]}>
        <Text>Could not load child details</Text>
      </View>
    );
  }

  const { child, stats } = summary;
  const attendanceColor = stats.attendancePercent >= 75 ? colors.success 
                        : stats.attendancePercent >= 50 ? colors.warning 
                        : colors.danger;

  return (
    <ScrollView 
      style={styles.screen}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      {/* Header with avatar */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {child.name?.charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.childName}>{child.name}</Text>
        <Text style={styles.childEmail}>{child.email}</Text>
        {child.institution_name && (
          <View style={styles.instBadge}>
            <Text style={styles.instText}>🏫 {child.institution_name}</Text>
          </View>
        )}
      </View>

      {/* Quick stats */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{stats.enrollments}</Text>
          <Text style={styles.statLabel}>Enrollments</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statNumber, { color: attendanceColor }]}>
            {stats.attendancePercent}%
          </Text>
          <Text style={styles.statLabel}>Attendance</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{stats.attended}</Text>
          <Text style={styles.statLabel}>Classes Attended</Text>
        </View>
      </View>

      {/* Quick action buttons */}
      <View style={styles.actionRow}>
        <TouchableOpacity 
          style={styles.actionBtn}
          onPress={() => navigation.navigate('ChildAttendance', { childId, childName: child.name })}
        >
          <Text style={styles.actionEmoji}>✓</Text>
          <Text style={styles.actionText}>Attendance</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.actionBtn}
          onPress={() => navigation.navigate('ChildPayments', { childId, childName: child.name })}
        >
          <Text style={styles.actionEmoji}>💳</Text>
          <Text style={styles.actionText}>Payments</Text>
        </TouchableOpacity>
      </View>

      {/* Enrolled batches */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Enrolled Classes</Text>
        
        {enrollments.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyEmoji}>📚</Text>
            <Text style={styles.emptyText}>Not enrolled in any classes yet</Text>
          </View>
        ) : (
          enrollments.map((e) => (
            <View key={e.id} style={styles.enrollCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.courseName}>{e.course_name}</Text>
                <Text style={styles.batchName}>{e.batch_name}</Text>
                <Text style={styles.batchInfo}>📆 {e.days_of_week} • ⏰ {e.start_time?.slice(0,5)}</Text>
                <Text style={styles.batchInfo}>👨‍🏫 {e.trainer_name || 'TBA'}</Text>
                <Text style={styles.batchInfo}>🏫 {e.institution_name}</Text>
              </View>
              <View style={[
                styles.payBadge,
                { backgroundColor: e.payment_status === 'paid' ? colors.success : colors.warning }
              ]}>
                <Text style={styles.payText}>{e.payment_status?.toUpperCase()}</Text>
              </View>
            </View>
          ))
        )}
      </View>

      <View style={{ height: 30 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.light },
  
  header: {
    backgroundColor: colors.dark,
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 30,
    alignItems: 'center',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: { color: colors.white, fontSize: 36, fontWeight: '700' },
  childName: { fontSize: 22, fontWeight: '700', color: colors.white },
  childEmail: { fontSize: 13, color: '#a0a0c0', marginTop: 4 },
  instBadge: { 
    backgroundColor: 'rgba(255,255,255,0.15)', 
    paddingHorizontal: 12, 
    paddingVertical: 5, 
    borderRadius: 12, 
    marginTop: 10 
  },
  instText: { color: colors.white, fontSize: 12 },

  statsContainer: { 
    flexDirection: 'row', 
    padding: 16, 
    gap: 10, 
    marginTop: -20 
  },
  statCard: { 
    flex: 1, 
    backgroundColor: colors.white, 
    borderRadius: 12, 
    padding: 14, 
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.lightGray,
  },
  statNumber: { fontSize: 22, fontWeight: '700', color: colors.text },
  statLabel: { fontSize: 11, color: colors.textLight, marginTop: 4, textAlign: 'center' },

  actionRow: { 
    flexDirection: 'row', 
    paddingHorizontal: 16, 
    gap: 10, 
    marginTop: 8 
  },
  actionBtn: { 
    flex: 1, 
    backgroundColor: colors.dark, 
    padding: 14, 
    borderRadius: 12, 
    alignItems: 'center' 
  },
  actionEmoji: { fontSize: 22, marginBottom: 4 },
  actionText: { color: colors.white, fontSize: 13, fontWeight: '600' },

  section: { padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 12 },

  enrollCard: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.lightGray,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  courseName: { fontSize: 14, fontWeight: '600', color: colors.text },
  batchName: { fontSize: 12, color: colors.primary, marginTop: 2 },
  batchInfo: { fontSize: 11, color: colors.textLight, marginTop: 4 },
  payBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  payText: { color: colors.white, fontSize: 9, fontWeight: '700' },

  emptyCard: { alignItems: 'center', padding: 40, backgroundColor: colors.white, borderRadius: 12 },
  emptyEmoji: { fontSize: 50, marginBottom: 8 },
  emptyText: { color: colors.textLight, fontSize: 13 },
});