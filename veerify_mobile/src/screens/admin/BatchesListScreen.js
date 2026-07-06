import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import apiClient from '../../api/client';
import { colors, commonStyles } from '../../utils/styles';
import { confirm } from '../../components/ConfirmDialog';

// ─── Schedule helpers ────────────────────────────────────────────────
// Batches carry two schedule signals:
//   • Legacy pair `days_of_week` ("Mon,Wed,Fri") + `start_time` /
//     `end_time` — the same range for every listed day.
//   • Newer JSONB `schedule` { Mon: { start, end }, Wed: { ... } } —
//     per-day timings so a batch can run Mon 06:00-07:00, Wed 07:00-08:00.
// When the JSONB is present, we prefer it; otherwise we fall back to
// the legacy pair. Returns [{ day, start, end }] in Mon→Sun order.
const WEEKDAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_FULL  = {
  Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday',
  Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday',
};

function to12h(time24) {
  if (!time24) return '';
  const m = String(time24).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return time24;
  let h = parseInt(m[1], 10);
  const mins = m[2];
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${mins} ${period}`;
}

function buildSchedule(batch) {
  const legacyStart = batch.start_time?.slice(0, 5) || '';
  const legacyEnd   = batch.end_time?.slice(0, 5)   || '';
  const days = String(batch.days_of_week || '')
    .split(',').map((d) => d.trim()).filter(Boolean);
  const map = (batch.schedule && typeof batch.schedule === 'object') ? batch.schedule : null;

  // Union of days that appear in either signal, ordered Mon→Sun.
  const dayKeys = new Set(days);
  if (map) Object.keys(map).forEach((k) => dayKeys.add(k));

  return WEEKDAY_ORDER
    .filter((d) => dayKeys.has(d))
    .map((d) => ({
      day:   d,
      start: (map?.[d]?.start || legacyStart || '').slice(0, 5),
      end:   (map?.[d]?.end   || legacyEnd   || '').slice(0, 5),
    }));
}

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
    // Branded destructive confirm — pink shield hero + glow'd Delete
    // button. Any follow-up dialog (success / error) is delayed until
    // the first dialog finishes animating out so it doesn't get
    // swallowed by Android's modal transition.
    confirm({
      title: 'Delete batch?',
      message: `"${batch.name}" will be permanently removed. Students in this batch will be unassigned but their profiles will stay intact.`,
      variant: 'destructive',
      confirmText: 'Delete batch',
      cancelText: 'Keep batch',
      onConfirm: () => {
        (async () => {
          try {
            await apiClient.delete(`/batches/${batch.id}`);
            await load();
            setTimeout(() => {
              confirm({
                title: 'Batch deleted',
                message: `"${batch.name}" has been removed.`,
                variant: 'success',
                confirmText: 'Done',
                hideCancel: true,
              });
            }, 260);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.log('[BatchesList] delete failed:', err?.response?.status, err?.response?.data);
            setTimeout(() => {
              confirm({
                title: 'Could not delete',
                message:
                  err?.response?.data?.message ||
                  err?.message ||
                  'Something went wrong. Please try again.',
                variant: 'warning',
                confirmText: 'OK',
                hideCancel: true,
              });
            }, 260);
          }
        })();
      },
    });
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

            {/* Per-day schedule — each active weekday on its own row
                with its own start–end range. Reads batch.schedule
                JSONB when present, otherwise falls back to the shared
                start_time/end_time pair. */}
            {(() => {
              const rows = buildSchedule(item);
              if (rows.length === 0) return null;
              return (
                <View style={{ marginTop: 10, gap: 4 }}>
                  {rows.map((r) => (
                    <View
                      key={r.day}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        paddingVertical: 4,
                        paddingHorizontal: 8,
                        borderRadius: 8,
                        backgroundColor: '#FFF5F5',
                      }}
                    >
                      <View
                        style={{
                          width: 44,
                          paddingVertical: 2,
                          borderRadius: 6,
                          backgroundColor: '#FFE4E6',
                          alignItems: 'center',
                        }}
                      >
                        <Text style={{ fontSize: 10.5, fontWeight: '800', color: '#B91C1C', letterSpacing: 0.4 }}>
                          {r.day.toUpperCase()}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 12, color: colors.text, fontWeight: '700' }}>
                        {r.start && r.end ? `${to12h(r.start)} – ${to12h(r.end)}` : 'Time not set'}
                      </Text>
                    </View>
                  ))}
                </View>
              );
            })()}

            <Text style={{ fontSize: 12, marginTop: 8, color: colors.textLight }}>👨‍🏫 {item.trainer_name || 'No trainer assigned'}</Text>
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

              {/* Edit — reuses CreateBatch screen in edit mode. The screen
                  reads `route.params.batch` and pre-fills every field,
                  then submits via PUT /batches/:id instead of POST. */}
              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation?.();
                  navigation.navigate('CreateBatch', { batch: item });
                }}
              >
                <Text style={{ color: colors.primary, fontWeight: '700' }}>Edit</Text>
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