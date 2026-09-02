import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import apiClient from '../../api/client';
import { useBellScrollHandler } from '../../components/bellScrollBus';
import { colors, commonStyles } from '../../utils/styles';
import { confirm } from '../../components/ConfirmDialog';
// Institution Home glass system — ambient wash + glass cards +
// dark-blue primary. Layered on top of commonStyles via inline style
// arrays so this screen matches Institution Home without changing
// the shared commonStyles module (which other screens rely on).
import InstitutionScreenBackground, {
  INSTITUTION_BG_BASE,
} from '../../components/InstitutionScreenBackground';
import { useTheme } from '../../theme/ThemeContext';

const GLASS_FILL_STRONG  = 'rgba(255,255,255,0.88)';
const GLASS_BORDER_LIGHT = 'rgba(255,255,255,0.55)';
const GLASS_HIGHLIGHT    = 'rgba(255,255,255,0.9)';
const GLASS_SHADOW       = '#1E40AF';
const BRAND_DARK_BLUE    = '#1E3A8A';
const BRAND_ACCENT_SOFT  = 'rgba(30,58,138,0.10)';
const HEADER_NAVY        = '#0F172A';

// Local overrides layered on top of commonStyles so cards/headers
// paint as Institution Home glass without touching the shared file.
const local = StyleSheet.create({
  screen:      { flex: 1, backgroundColor: INSTITUTION_BG_BASE },
  header:      {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148,163,184,0.22)',
    paddingTop: 48,
    paddingBottom: 14,
    paddingHorizontal: 16,
  },
  headerTitle:    { color: HEADER_NAVY, fontSize: 20, fontWeight: '800', letterSpacing: -0.2 },
  headerSubtitle: { color: '#64748B', fontSize: 12, fontWeight: '600', marginTop: 2 },
  card: {
    backgroundColor: GLASS_FILL_STRONG,
    borderRadius: 20,
    borderTopWidth: 1.5,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderTopColor: GLASS_HIGHLIGHT,
    borderRightColor: GLASS_BORDER_LIGHT,
    borderBottomColor: GLASS_BORDER_LIGHT,
    borderLeftColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.11,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
    marginBottom: 12,
  },
  cardTitle:    { color: HEADER_NAVY, fontWeight: '800' },
  cardSubtitle: { color: '#64748B', fontWeight: '600' },
  scheduleRow:  {
    backgroundColor: 'rgba(241,246,251,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.22)',
    borderRadius: 10,
  },
  scheduleDayPill: {
    backgroundColor: BRAND_ACCENT_SOFT,
  },
  scheduleDayText: { color: BRAND_DARK_BLUE },
  addStudentBtn: {
    backgroundColor: BRAND_DARK_BLUE,
    shadowColor: BRAND_DARK_BLUE,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  emptyState: {
    backgroundColor: GLASS_FILL_STRONG,
    borderRadius: 20,
    borderTopWidth: 1.5,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderTopColor: GLASS_HIGHLIGHT,
    borderRightColor: GLASS_BORDER_LIGHT,
    borderBottomColor: GLASS_BORDER_LIGHT,
    borderLeftColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.11,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
    padding: 24,
    marginTop: 24,
  },
  emptyText: { color: '#64748B' },
  fab: {
    backgroundColor: BRAND_DARK_BLUE,
    shadowColor: BRAND_DARK_BLUE,
    shadowOpacity: 0.32,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 8,
  },
});

// Dark-mode overrides.
function buildDarkOverrides(pal) {
  return StyleSheet.create({
    screen:         { backgroundColor: pal.bg },
    header:         { backgroundColor: pal.surface, borderBottomColor: pal.border },
    headerTitle:    { color: pal.text },
    headerSubtitle: { color: pal.textMuted },
    card:           { backgroundColor: pal.surface, borderTopColor: pal.border, borderRightColor: pal.border, borderBottomColor: pal.border, borderLeftColor: pal.border },
    cardTitle:      { color: pal.text },
    cardSubtitle:   { color: pal.textMuted },
    scheduleRow:    { backgroundColor: pal.border, borderColor: pal.border },
    emptyState:     { backgroundColor: pal.surface, borderTopColor: pal.border, borderRightColor: pal.border, borderBottomColor: pal.border, borderLeftColor: pal.border },
    emptyText:      { color: pal.textMuted },
  });
}
// Ongoing / upcoming split — a batch whose end time already passed
// today rolls forward to next week's session so past slots never
// appear at the top of the list.
import { partitionBatches } from '../../utils/batchOccurrence';

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

export default function BatchesListScreen({ navigation, route }) {
  const { mode, palette: themePalette } = useTheme();
  const isDark = mode === 'dark';
  const dark   = useMemo(() => buildDarkOverrides(themePalette), [themePalette]);
  // Institution Home → Branch View passes { branchId, branchName } so
  // this screen renders only that branch's batches. When absent, the
  // default main-admin scope (b.branch_id IS NULL) still applies.
  const branchIdParam   = route?.params?.branchId ?? null;
  const branchNameParam = route?.params?.branchName ?? null;

  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Read-only gate for sub-branch admins per spec: Branch Admins can
  // VIEW their branch's batches but cannot Create / Edit / Delete /
  // Add Student. We flip this by reading /institutions/me/details and
  // checking parent_institution_id — same signal MoreTab uses.
  const [isBranchAdmin, setIsBranchAdmin] = useState(false);

  const load = useCallback(async () => {
    try {
      // Forward the branch filter — the backend already accepts
      // ?branch_id=<n>|main|all so we just pass whatever the tile
      // sent through.
      const qs = branchIdParam != null
        ? `?branch_id=${encodeURIComponent(branchIdParam)}`
        : '';
      const res = await apiClient.get(`/batches${qs}`);
      setBatches(res.data.batches);
    } catch (err) { console.log(err.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, [branchIdParam]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Nudge every minute so a batch that just started / just ended
  // moves between the "Ongoing" strip and the "Upcoming" list without
  // waiting for a manual refresh.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Ongoing = a session is in progress right now. Upcoming = next
  // occurrence is strictly in the future. Rendered ongoing first so
  // the admin sees currently-live sessions at the top.
  const { ongoing, upcoming } = useMemo(
    () => partitionBatches(batches, new Date(nowTick)),
    [batches, nowTick],
  );
  const orderedBatches = useMemo(
    () => [...ongoing, ...upcoming],
    [ongoing, upcoming],
  );

  // One-shot fetch on mount — no dependency on batches list, so it
  // doesn't refire on every list refresh.
  React.useEffect(() => {
    let cancelled = false;
    apiClient
      .get('/institutions/me/details')
      .then((r) => {
        if (cancelled) return;
        const inst = r.data?.institution || r.data || {};
        setIsBranchAdmin(!!inst.parent_institution_id);
      })
      .catch(() => { /* fall back to main-admin behaviour */ });
    return () => { cancelled = true; };
  }, []);

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

  if (loading) return (
    <View style={[commonStyles.screen, local.screen, isDark && dark.screen, { justifyContent: 'center' }]}>
      {!isDark ? <InstitutionScreenBackground layer /> : null}
      <ActivityIndicator size="large" color={BRAND_DARK_BLUE} />
    </View>
  );

  return (
    <View style={[commonStyles.screen, local.screen, isDark && dark.screen]}>
      {!isDark ? <InstitutionScreenBackground layer /> : null}
      <View style={[commonStyles.header, local.header, isDark && dark.header]}>
        <Text style={[commonStyles.headerTitle, local.headerTitle, isDark && dark.headerTitle]}>
          {branchNameParam ? `${branchNameParam} — Batches` : 'My Batches'}
        </Text>
        <Text style={[commonStyles.headerSubtitle, local.headerSubtitle, isDark && dark.headerSubtitle]}>
          {batches.length} batches
        </Text>
      </View>

      <FlatList
        data={orderedBatches}
        extraData={nowTick}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={{ padding: 20 }}
        onScroll={useBellScrollHandler()}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={BRAND_DARK_BLUE}
          />
        }
        ListEmptyComponent={
          <View style={[commonStyles.emptyState, local.emptyState, isDark && dark.emptyState]}>
            <Text style={{ fontSize: 60 }}>📅</Text>
            <Text style={[commonStyles.emptyText, local.emptyText, isDark && dark.emptyText]}>
              No batches yet.{'\n'}Create a course first, then add batches.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          // Tap anywhere on the card → drill into the batch's enrolled
          // students. The two inline action buttons below stopPropagation
          // so they still work independently.
          <TouchableOpacity
            style={[commonStyles.card, local.card, isDark && dark.card]}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('AdminBatchStudents', {
              batchId: item.id,
              batch: item,
            })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[commonStyles.cardTitle, local.cardTitle, isDark && dark.cardTitle, { flexShrink: 1 }]}>{item.name}</Text>
              {item._next?.isOngoing ? (
                <View style={{
                  backgroundColor: '#dcfce7',
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: 999,
                }}>
                  <Text style={{ color: '#166534', fontSize: 10, fontWeight: '800' }}>
                    IN PROGRESS
                  </Text>
                </View>
              ) : null}
            </View>
            <Text style={[commonStyles.cardSubtitle, local.cardSubtitle, isDark && dark.cardSubtitle]}>{item.course_name}</Text>

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
                      style={[
                        {
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8,
                          paddingVertical: 4,
                          paddingHorizontal: 8,
                        },
                        local.scheduleRow,
                        isDark && dark.scheduleRow,
                      ]}
                    >
                      <View
                        style={[
                          {
                            width: 44,
                            paddingVertical: 2,
                            borderRadius: 6,
                            alignItems: 'center',
                          },
                          local.scheduleDayPill,
                        ]}
                      >
                        <Text style={[{ fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4 }, local.scheduleDayText]}>
                          {r.day.toUpperCase()}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 12, color: isDark ? themePalette.text : HEADER_NAVY, fontWeight: '700' }}>
                        {r.start && r.end ? `${to12h(r.start)} – ${to12h(r.end)}` : 'Time not set'}
                      </Text>
                    </View>
                  ))}
                </View>
              );
            })()}

            <Text style={{ fontSize: 12, marginTop: 8, color: colors.textLight }}>👨‍🏫 {item.trainer_name || 'No trainer assigned'}</Text>
            <Text style={{ fontSize: 12, marginTop: 2, color: colors.textLight }}>👥 Capacity: {item.capacity} | Mode: {item.mode}</Text>

            {/* Row-level actions — Edit and Delete are HIDDEN for
                sub-branch admins per spec (batches are read-only from
                the branch side). Add Student stays visible because
                student enrolment is a branch-admin capability. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 }}>
              {/* Add Student — opens the enrollment form pre-bound
                  to this batch in ADMIN mode. */}
              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation?.();
                  navigation.navigate('EnrollmentForm', {
                    adminMode: true,
                    batchId: item.id,
                    batch: item,
                    course: { id: item.course_id, name: item.course_name },
                  });
                }}
                style={[
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 999,
                  },
                  local.addStudentBtn,
                ]}
                activeOpacity={0.85}
              >
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>+ Add Student</Text>
              </TouchableOpacity>

              {/* Edit + Delete — main-institution admin only. Branch
                  admins get a read-only card. */}
              {!isBranchAdmin ? (
                <>
                  <TouchableOpacity
                    onPress={(e) => {
                      e.stopPropagation?.();
                      navigation.navigate('CreateBatch', { batch: item });
                    }}
                  >
                    <Text style={{ color: BRAND_DARK_BLUE, fontWeight: '700' }}>Edit</Text>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); onDelete(item); }}>
                    <Text style={{ color: colors.danger, fontWeight: '600' }}>Delete</Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>
          </TouchableOpacity>
        )}
      />

      {/* + Create Batch FAB — hidden for sub-branch admins per spec.
          Only main-institution admins can create batches; branch
          admins operate on batches provisioned by the parent. */}
      {!isBranchAdmin ? (
        <TouchableOpacity
          style={[commonStyles.fab, local.fab]}
          onPress={() => navigation.navigate('CreateBatch')}
        >
          <Text style={commonStyles.fabText}>+</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}