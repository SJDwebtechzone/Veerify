// src/screens/admin/AdminBatchStudentsScreen.js
//
// Institution admin view of every student enrolled in a single batch.
// Reached by tapping a batch card on BatchesListScreen.
//
// Layout:
//   - Header strip: back button + "Batch students" title + count pill
//   - Batch summary card: course name, schedule (days + 12h time), trainer,
//     capacity progress bar
//   - List of student cards: avatar + name, phone (tap-to-call), enrolled
//     date, payment-status pill, kebab opens detail / remove
//   - Floating "+ Add Student" FAB that opens EnrollmentForm pre-bound to
//     this batch
//
// Backend: GET /api/enrollments/batch/:id
//   -> { count, enrollments: [{ id, student_id, student_name,
//        student_email, student_phone, enrolled_at, payment_status, ... }] }

import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator,
  RefreshControl, StyleSheet, Linking, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Phone, Mail, Plus, GraduationCap, BookOpen,
  Calendar, Clock, User, CircleDollarSign, CheckCircle2, AlertCircle,
} from 'lucide-react-native';

import apiClient from '../../api/client';

// ─── Theme ─────────────────────────────────────────────────────────────
const BRAND = '#E63946';
const BRAND_SOFT = '#FFE4E6';
const TEXT = '#111827';
const TEXT_MUTED = '#6B7280';
const TEXT_LIGHT = '#9CA3AF';
const SURFACE = '#FFFFFF';
const BG = '#F4F4F8';
const BORDER = '#E5E7EB';
const GREEN = '#10B981';
const GREEN_SOFT = '#D1FAE5';
const AMBER = '#F59E0B';
const AMBER_SOFT = '#FEF3C7';

// 24h "HH:MM" -> "6:00 AM" for display.
function fmtTime12(t) {
  if (!t) return '';
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const mins = m[2];
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${mins} ${period}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return '—'; }
}

function initialsFor(name) {
  return (name || '?')
    .split(' ').map(w => w[0]).filter(Boolean)
    .slice(0, 2).join('').toUpperCase() || '?';
}

// Soft palette for avatar backgrounds — picks a stable colour per name.
const AVATAR_PALETTE = [
  { bg: '#FEE2E2', fg: '#B91C1C' },
  { bg: '#FEF3C7', fg: '#92400E' },
  { bg: '#DCFCE7', fg: '#166534' },
  { bg: '#DBEAFE', fg: '#1E40AF' },
  { bg: '#EDE9FE', fg: '#5B21B6' },
  { bg: '#FCE7F3', fg: '#9D174D' },
];
function avatarColors(name) {
  if (!name) return AVATAR_PALETTE[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

export default function AdminBatchStudentsScreen({ route, navigation }) {
  const { batchId, batch } = route.params || {};

  const [enrollments, setEnrollments] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);

  const load = useCallback(async () => {
    if (!batchId) {
      setLoading(false);
      return;
    }
    try {
      const res = await apiClient.get(`/enrollments/batch/${batchId}`);
      setEnrollments(res.data?.enrollments || []);
    } catch (err) {
      console.log('[AdminBatchStudents] load failed:', err?.response?.data || err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [batchId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const callStudent = (phone) => {
    if (!phone) return;
    Linking.openURL(`tel:${phone}`).catch(() => {
      Alert.alert('Cannot call', 'Your device cannot place phone calls.');
    });
  };
  const mailStudent = (email) => {
    if (!email) return;
    Linking.openURL(`mailto:${email}`).catch(() => {
      Alert.alert('Cannot open mail', 'Your device cannot open email.');
    });
  };

  const capacityNum = Number(batch?.capacity || 0);
  const usedPct = useMemo(() => {
    if (!capacityNum) return 0;
    return Math.min(100, Math.round((enrollments.length / capacityNum) * 100));
  }, [enrollments.length, capacityNum]);

  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={BRAND} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.iconBtn}
          activeOpacity={0.7}
          hitSlop={8}
        >
          <ArrowLeft size={20} color={TEXT} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {batch?.name || 'Batch students'}
          </Text>
          <Text style={styles.headerSub}>
            {enrollments.length === 0
              ? 'No students yet'
              : `${enrollments.length} student${enrollments.length === 1 ? '' : 's'} enrolled`}
          </Text>
        </View>
        <View style={styles.headerCountPill}>
          <GraduationCap size={12} color={BRAND} strokeWidth={2.4} />
          <Text style={styles.headerCountPillText}>{enrollments.length}</Text>
        </View>
      </View>

      <FlatList
        data={enrollments}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={BRAND}
          />
        }
        ListHeaderComponent={
          batch ? (
            <BatchSummaryCard
              batch={batch}
              enrolled={enrollments.length}
              usedPct={usedPct}
            />
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconWrap}>
              <GraduationCap size={28} color={BRAND} strokeWidth={1.8} />
            </View>
            <Text style={styles.emptyTitle}>No students enrolled yet</Text>
            <Text style={styles.emptySub}>
              Add the first student to this batch and they'll show up here
              with their contact and payment info.
            </Text>
            <TouchableOpacity
              style={styles.emptyCta}
              onPress={() => navigation.navigate('EnrollmentForm', {
                batchId,
                batch,
                course: batch ? { id: batch.course_id, name: batch.course_name } : null,
                adminMode: true,
              })}
              activeOpacity={0.85}
            >
              <Plus size={14} color="#fff" strokeWidth={2.6} />
              <Text style={styles.emptyCtaText}>Add Student</Text>
            </TouchableOpacity>
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderItem={({ item }) => (
          <StudentCard
            enrollment={item}
            onCall={() => callStudent(item.student_phone)}
            onMail={() => mailStudent(item.student_email)}
          />
        )}
      />

      {/* ── Floating Add Student ──────────────────────────────────── */}
      {enrollments.length > 0 ? (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => navigation.navigate('EnrollmentForm', {
            batchId,
            batch,
            course: batch ? { id: batch.course_id, name: batch.course_name } : null,
            adminMode: true,
          })}
          activeOpacity={0.85}
        >
          <Plus size={22} color="#fff" strokeWidth={2.8} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ─── Batch summary card ────────────────────────────────────────────────
function BatchSummaryCard({ batch, enrolled, usedPct }) {
  const cap = Number(batch?.capacity || 0);
  const days = batch?.days_of_week || '—';
  const start = fmtTime12(batch?.start_time);
  const end   = fmtTime12(batch?.end_time);

  return (
    <View style={styles.summary}>
      <View style={styles.summaryHeaderRow}>
        <View style={styles.summaryIconWrap}>
          <BookOpen size={18} color={BRAND} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.summaryTitle} numberOfLines={1}>
            {batch?.course_name || 'Course'}
          </Text>
          <Text style={styles.summarySub} numberOfLines={1}>
            {batch?.mode === 'online' ? 'Online' : 'Offline'} batch
          </Text>
        </View>
      </View>

      <View style={styles.summaryStats}>
        <SummaryStat
          icon={Calendar}
          label="Days"
          value={days}
        />
        <SummaryStat
          icon={Clock}
          label="Time"
          value={start && end ? `${start} – ${end}` : '—'}
        />
        <SummaryStat
          icon={User}
          label="Trainer"
          value={batch?.trainer_name || 'Unassigned'}
        />
      </View>

      {cap > 0 ? (
        <View style={{ marginTop: 12 }}>
          <View style={styles.capacityRow}>
            <Text style={styles.capacityLabel}>Capacity</Text>
            <Text style={styles.capacityValue}>{enrolled} / {cap}</Text>
          </View>
          <View style={styles.capBarTrack}>
            <View
              style={[
                styles.capBarFill,
                { width: `${usedPct}%`, backgroundColor: usedPct >= 100 ? BRAND : GREEN },
              ]}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function SummaryStat({ icon: Icon, label, value }) {
  return (
    <View style={styles.summaryStat}>
      <Icon size={12} color={TEXT_MUTED} strokeWidth={2.4} />
      <View style={{ flex: 1 }}>
        <Text style={styles.summaryStatLabel}>{label}</Text>
        <Text style={styles.summaryStatValue} numberOfLines={1}>{value}</Text>
      </View>
    </View>
  );
}

// ─── Student card ──────────────────────────────────────────────────────
function StudentCard({ enrollment, onCall, onMail }) {
  const colours = avatarColors(enrollment.student_name);
  const paid = String(enrollment.payment_status || '').toLowerCase() === 'paid';
  const pendingMoney = !paid;
  return (
    <View style={styles.card}>
      {/* Top row — avatar + name + payment pill */}
      <View style={styles.cardRow}>
        <View style={[styles.avatar, { backgroundColor: colours.bg }]}>
          <Text style={[styles.avatarText, { color: colours.fg }]}>
            {initialsFor(enrollment.student_name)}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.studentName} numberOfLines={1}>
            {enrollment.student_name || 'Student'}
          </Text>
          <Text style={styles.studentMeta} numberOfLines={1}>
            Joined {fmtDate(enrollment.enrolled_at)}
          </Text>
        </View>
        <View
          style={[
            styles.payPill,
            paid ? { backgroundColor: GREEN_SOFT } : { backgroundColor: AMBER_SOFT },
          ]}
        >
          {paid ? (
            <CheckCircle2 size={11} color={GREEN} strokeWidth={2.4} />
          ) : (
            <AlertCircle size={11} color={AMBER} strokeWidth={2.4} />
          )}
          <Text
            style={[
              styles.payPillText,
              paid ? { color: GREEN } : { color: AMBER },
            ]}
          >
            {paid ? 'Paid' : (enrollment.payment_status || 'Pending')}
          </Text>
        </View>
      </View>

      {/* Contact row — phone + email pills, both tappable */}
      <View style={styles.contactRow}>
        {enrollment.student_phone ? (
          <TouchableOpacity
            style={styles.contactChip}
            onPress={onCall}
            activeOpacity={0.85}
          >
            <Phone size={12} color={BRAND} strokeWidth={2.4} />
            <Text style={styles.contactChipText} numberOfLines={1}>
              {enrollment.student_phone}
            </Text>
          </TouchableOpacity>
        ) : null}
        {enrollment.student_email ? (
          <TouchableOpacity
            style={styles.contactChip}
            onPress={onMail}
            activeOpacity={0.85}
          >
            <Mail size={12} color={BRAND} strokeWidth={2.4} />
            <Text style={styles.contactChipText} numberOfLines={1}>
              {enrollment.student_email}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Amount + payment due, if present */}
      {pendingMoney && enrollment.payment_amount ? (
        <View style={styles.dueRow}>
          <CircleDollarSign size={12} color={AMBER} strokeWidth={2.4} />
          <Text style={styles.dueText}>
            ₹{Number(enrollment.payment_amount).toLocaleString('en-IN')} due
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  // Header
  header: {
    backgroundColor: SURFACE,
    paddingTop: 48,
    paddingBottom: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: TEXT, letterSpacing: -0.2 },
  headerSub: { fontSize: 11, color: TEXT_MUTED, fontWeight: '600', marginTop: 1 },
  headerCountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: BRAND_SOFT,
    borderRadius: 999,
  },
  headerCountPillText: { fontSize: 11, fontWeight: '800', color: BRAND },

  // Batch summary card
  summary: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 12,
  },
  summaryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  summaryIconWrap: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  summaryTitle: { fontSize: 15, fontWeight: '800', color: TEXT, letterSpacing: -0.2 },
  summarySub: { fontSize: 12, color: TEXT_MUTED, marginTop: 1 },

  summaryStats: {
    backgroundColor: BG,
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  summaryStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  summaryStatLabel: {
    fontSize: 10, fontWeight: '700', color: TEXT_MUTED,
    letterSpacing: 0.4, textTransform: 'uppercase',
  },
  summaryStatValue: { fontSize: 13, color: TEXT, fontWeight: '700', marginTop: 1 },

  capacityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  capacityLabel: { fontSize: 11, fontWeight: '700', color: TEXT_MUTED, letterSpacing: 0.3, textTransform: 'uppercase' },
  capacityValue: { fontSize: 12, fontWeight: '800', color: TEXT },
  capBarTrack: { height: 6, borderRadius: 999, backgroundColor: BG, overflow: 'hidden' },
  capBarFill: { height: '100%', borderRadius: 999 },

  // Student card
  card: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 14, fontWeight: '800' },
  studentName: { fontSize: 14, fontWeight: '800', color: TEXT },
  studentMeta: { fontSize: 11, color: TEXT_MUTED, marginTop: 2 },

  payPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  payPillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3, textTransform: 'capitalize' },

  contactRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  contactChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: BRAND_SOFT,
    maxWidth: '100%',
  },
  contactChipText: { fontSize: 11, color: BRAND, fontWeight: '700' },

  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
  },
  dueText: { fontSize: 11, color: AMBER, fontWeight: '800' },

  // Empty
  emptyCard: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  emptyIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: TEXT, marginBottom: 6 },
  emptySub: {
    fontSize: 12, color: TEXT_MUTED, lineHeight: 18, textAlign: 'center',
    marginBottom: 14, paddingHorizontal: 4,
  },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: BRAND,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 999,
  },
  emptyCtaText: { color: '#fff', fontSize: 12, fontWeight: '800' },

  // FAB
  fab: {
    position: 'absolute',
    right: 18, bottom: 22,
    width: 54, height: 54, borderRadius: 27,
    backgroundColor: BRAND,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2, shadowOffset: { width: 0, height: 4 }, shadowRadius: 8,
    elevation: 6,
  },
});
