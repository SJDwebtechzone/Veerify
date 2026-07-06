// src/screens/admin/BranchDashboardScreen.js
//
// Read-only Branch Dashboard reached by tapping a sub-branch card on
// BranchesListScreen. Renders:
//   1. Students strip  — Total, Active, Inactive
//   2. Revenue card    — Total-ever + ranged (from / to filter)
//   3. Attendance card — Today's roll + Monthly % (month filter)
//
// All numbers come from GET /api/branches/:id/dashboard — no local
// duplication. Filters just re-fetch with the new query string.
//
// The screen is DELIBERATELY read-only: no edit / delete affordances.
// The main-institution admin can only observe branch performance.

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet,
  RefreshControl, StatusBar, Platform, Modal, TextInput,
} from 'react-native';
import {
  ArrowLeft, Users, IndianRupee, ClipboardCheck, Building2,
  Calendar, ChevronDown, TrendingUp, X as XIcon, Check,
  UserCheck, UserX, CircleDollarSign,
} from 'lucide-react-native';
import apiClient from '../../api/client';

// ─── Palette ────────────────────────────────────────────────────────
const BRAND       = '#E63946';
const BRAND_SOFT  = '#FFE4E6';
const TEXT        = '#111827';
const TEXT_MUTED  = '#6B7280';
const TEXT_LIGHT  = '#9CA3AF';
const SURFACE     = '#FFFFFF';
const BG          = '#F4F4F8';
const BORDER      = '#E5E7EB';
const GREEN       = '#10B981';
const GREEN_SOFT  = '#D1FAE5';
const AMBER       = '#F59E0B';
const AMBER_SOFT  = '#FEF3C7';
const BLUE        = '#3B82F6';
const BLUE_SOFT   = '#DBEAFE';
const ROSE        = '#F43F5E';
const ROSE_SOFT   = '#FFE4E6';

// ─── Helpers ────────────────────────────────────────────────────────
function fmtINR(n) {
  const v = Number(n) || 0;
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(1)}Cr`;
  if (v >= 100000)   return `₹${(v / 100000).toFixed(1)}L`;
  if (v >= 1000)     return `₹${(v / 1000).toFixed(1)}K`;
  return `₹${v.toLocaleString('en-IN')}`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function todayISO() { return new Date().toISOString().slice(0, 10); }
function firstOfMonthISO(offset = 0) {
  const d = new Date(); d.setDate(1);
  d.setMonth(d.getMonth() - offset);
  return d.toISOString().slice(0, 10);
}
function currentYearMonth() { return new Date().toISOString().slice(0, 7); }

// ─── Screen ─────────────────────────────────────────────────────────
export default function BranchDashboardScreen({ route, navigation }) {
  const branch = route?.params?.branch || null;
  const branchId = branch?.id ?? route?.params?.branchId;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters. Revenue defaults to "This month". Attendance defaults to
  // the current calendar month.
  const [revFrom, setRevFrom] = useState(firstOfMonthISO(0));
  const [revTo, setRevTo]     = useState(todayISO());
  const [attMonth, setAttMonth] = useState(currentYearMonth());
  const [pickerOpen, setPickerOpen] = useState(null); // 'from' | 'to' | 'month' | null

  const load = useCallback(async () => {
    if (!branchId) { setLoading(false); return; }
    try {
      const qs = new URLSearchParams();
      if (revFrom) qs.set('from', revFrom);
      if (revTo)   qs.set('to',   revTo);
      if (attMonth) qs.set('month', attMonth);
      const res = await apiClient.get(`/branches/${branchId}/dashboard?${qs.toString()}`);
      setData(res.data);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log('[BranchDashboard] load error:', err?.response?.data || err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [branchId, revFrom, revTo, attMonth]);
  useEffect(() => { load(); }, [load]);

  // Series max — used to size the revenue bar chart.
  const seriesMax = useMemo(() => {
    const arr = data?.revenue?.series_last_6_months || [];
    return Math.max(1, ...arr.map((r) => r.total || 0));
  }, [data]);

  if (loading && !data) {
    return (
      <View style={[styles.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={BRAND} />
      </View>
    );
  }

  const s = data?.students || { total: 0, active: 0, inactive: 0 };
  const r = data?.revenue  || { total: 0, range: { total: 0 }, series_last_6_months: [] };
  const a = data?.attendance || { today: {}, month: {} };

  const rangeLabel = `${fmtDate(revFrom)} → ${fmtDate(revTo)}`;
  const attMonthLabel = (() => {
    const [y, m] = attMonth.split('-').map(Number);
    if (!y || !m) return attMonth;
    return new Date(y, m - 1, 1).toLocaleDateString('en-IN', {
      month: 'long', year: 'numeric',
    });
  })();

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND} />

      {/* ── Hero header ── */}
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.iconBtn}
            activeOpacity={0.85}
            hitSlop={8}
          >
            <ArrowLeft size={20} color="#fff" strokeWidth={2.4} />
          </TouchableOpacity>
          <Text style={styles.heroCaption}>BRANCH DASHBOARD</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.heroBody}>
          <View style={styles.heroIcon}>
            <Building2 size={22} color={BRAND} strokeWidth={2.4} />
          </View>
          <Text style={styles.heroName} numberOfLines={1}>
            {data?.branch?.name || branch?.name || 'Branch'}
          </Text>
          {(data?.branch?.city || branch?.city) ? (
            <Text style={styles.heroCity} numberOfLines={1}>
              {data?.branch?.city || branch?.city}
            </Text>
          ) : null}
          <View style={styles.readOnlyPill}>
            <Text style={styles.readOnlyPillText}>Read-only view</Text>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={BRAND}
          />
        }
      >
        {/* ── Students strip ── */}
        <View style={styles.section}>
          <SectionHeader icon={Users} title="Students" subtitle="Live snapshot" />
          <View style={styles.tileRow}>
            <StatTile
              icon={Users}       label="Total"   value={s.total}
              accent={BLUE}      bg={BLUE_SOFT}
            />
            <StatTile
              icon={UserCheck}   label="Active"  value={s.active}
              accent={GREEN}     bg={GREEN_SOFT}
              hint={s.total > 0 ? `${Math.round((s.active / s.total) * 100)}% of total` : null}
            />
            <StatTile
              icon={UserX}       label="Inactive" value={s.inactive}
              accent={AMBER}     bg={AMBER_SOFT}
            />
          </View>
        </View>

        {/* ── Revenue ── */}
        <View style={styles.section}>
          <SectionHeader
            icon={IndianRupee}
            title="Revenue"
            subtitle={`Total-ever + ${rangeLabel}`}
          />

          {/* Range filter */}
          <View style={styles.filterRow}>
            <FilterButton
              icon={Calendar}
              label={fmtDate(revFrom) || 'From'}
              onPress={() => setPickerOpen('from')}
            />
            <Text style={styles.filterArrow}>→</Text>
            <FilterButton
              icon={Calendar}
              label={fmtDate(revTo) || 'To'}
              onPress={() => setPickerOpen('to')}
            />
            <TouchableOpacity
              onPress={() => {
                setRevFrom(firstOfMonthISO(0));
                setRevTo(todayISO());
              }}
              style={styles.resetBtn}
              activeOpacity={0.85}
            >
              <Text style={styles.resetBtnText}>Reset</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.revCardRow}>
            <View style={[styles.revCard, { backgroundColor: BRAND }]}>
              <Text style={styles.revCardTop}>SELECTED RANGE</Text>
              <Text style={styles.revCardValue}>{fmtINR(r.range?.total || 0)}</Text>
              <Text style={styles.revCardBottom}>
                {r.range?.paid_count || 0} paid enrolments
              </Text>
            </View>
            <View style={[styles.revCard, { backgroundColor: TEXT }]}>
              <Text style={styles.revCardTop}>TOTAL EVER</Text>
              <Text style={styles.revCardValue}>{fmtINR(r.total || 0)}</Text>
              <Text style={styles.revCardBottom}>
                {r.paid_count_total || 0} total paid
              </Text>
            </View>
          </View>

          {/* 6-month trend chart */}
          {(r.series_last_6_months || []).length > 0 ? (
            <View style={styles.chartCard}>
              <View style={styles.chartHeader}>
                <TrendingUp size={12} color={BRAND} strokeWidth={2.4} />
                <Text style={styles.chartTitle}>Last 6 months</Text>
              </View>
              <View style={styles.chartRow}>
                {r.series_last_6_months.map((row) => {
                  const h = seriesMax > 0
                    ? Math.max(4, Math.round((row.total / seriesMax) * 90))
                    : 4;
                  return (
                    <View key={row.label} style={styles.chartBarWrap}>
                      <View style={[styles.chartBar, { height: h }]} />
                      <Text style={styles.chartLabel}>{row.label}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}
        </View>

        {/* ── Attendance ── */}
        <View style={styles.section}>
          <SectionHeader
            icon={ClipboardCheck}
            title="Attendance"
            subtitle={`Today + ${attMonthLabel}`}
          />

          <View style={styles.filterRow}>
            <FilterButton
              icon={Calendar}
              label={attMonthLabel}
              onPress={() => setPickerOpen('month')}
            />
            <TouchableOpacity
              onPress={() => setAttMonth(currentYearMonth())}
              style={styles.resetBtn}
              activeOpacity={0.85}
            >
              <Text style={styles.resetBtnText}>This month</Text>
            </TouchableOpacity>
          </View>

          {/* Today */}
          <View style={styles.card}>
            <Text style={styles.cardCaption}>TODAY</Text>
            <View style={styles.attTodayRow}>
              <AttChip label="Present" value={a.today?.present || 0} color={GREEN} bg={GREEN_SOFT} />
              <AttChip label="Absent"  value={a.today?.absent  || 0} color={ROSE}  bg={ROSE_SOFT}  />
              <AttChip label="Late"    value={a.today?.late    || 0} color={AMBER} bg={AMBER_SOFT} />
            </View>
            {a.today?.total ? (
              <Text style={styles.cardFoot}>
                {a.today.total} attendance record{a.today.total === 1 ? '' : 's'} for today
              </Text>
            ) : (
              <Text style={styles.cardFoot}>No attendance marked yet today.</Text>
            )}
          </View>

          {/* Month */}
          <View style={styles.card}>
            <Text style={styles.cardCaption}>{attMonthLabel.toUpperCase()}</Text>
            <View style={styles.attMonthRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.attMonthPct}>
                  {a.month?.percentage !== null && a.month?.percentage !== undefined
                    ? `${a.month.percentage}%`
                    : '—'}
                </Text>
                <Text style={styles.attMonthLabel}>Present rate</Text>
              </View>
              <View style={styles.attMonthDivider} />
              <View style={{ flex: 1 }}>
                <Text style={styles.attMonthBig}>
                  {a.month?.present || 0}
                  <Text style={styles.attMonthBigMuted}>{` / ${a.month?.total || 0}`}</Text>
                </Text>
                <Text style={styles.attMonthLabel}>Present / total</Text>
              </View>
            </View>
            <View style={styles.attMonthTrack}>
              <View
                style={[
                  styles.attMonthFill,
                  {
                    width: `${a.month?.percentage ?? 0}%`,
                    backgroundColor: (a.month?.percentage ?? 0) >= 85 ? GREEN
                                    : (a.month?.percentage ?? 0) >= 65 ? AMBER
                                    : ROSE,
                  },
                ]}
              />
            </View>
          </View>
        </View>
      </ScrollView>

      {/* ── Filter pickers ── */}
      <DatePickerModal
        open={pickerOpen === 'from' || pickerOpen === 'to'}
        title={pickerOpen === 'from' ? 'From date' : 'To date'}
        value={pickerOpen === 'from' ? revFrom : revTo}
        onClose={() => setPickerOpen(null)}
        onSave={(v) => {
          if (pickerOpen === 'from') setRevFrom(v);
          else setRevTo(v);
          setPickerOpen(null);
        }}
      />
      <MonthPickerModal
        open={pickerOpen === 'month'}
        value={attMonth}
        onClose={() => setPickerOpen(null)}
        onSave={(v) => { setAttMonth(v); setPickerOpen(null); }}
      />
    </View>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────
function SectionHeader({ icon: Icon, title, subtitle }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderIcon}>
        <Icon size={13} color={BRAND} strokeWidth={2.6} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

function StatTile({ icon: Icon, label, value, accent, bg, hint }) {
  return (
    <View style={styles.tile}>
      <View style={[styles.tileIcon, { backgroundColor: bg }]}>
        <Icon size={15} color={accent} strokeWidth={2.4} />
      </View>
      <Text style={[styles.tileValue, { color: accent }]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
      {hint ? <Text style={styles.tileHint}>{hint}</Text> : null}
    </View>
  );
}

function FilterButton({ icon: Icon, label, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.filterBtn} activeOpacity={0.85}>
      <Icon size={12} color={BRAND} strokeWidth={2.4} />
      <Text style={styles.filterBtnText} numberOfLines={1}>{label}</Text>
      <ChevronDown size={12} color={TEXT_MUTED} strokeWidth={2.4} />
    </TouchableOpacity>
  );
}

function AttChip({ label, value, color, bg }) {
  return (
    <View style={[styles.attChip, { backgroundColor: bg }]}>
      <Text style={[styles.attChipValue, { color }]}>{value}</Text>
      <Text style={styles.attChipLabel}>{label}</Text>
    </View>
  );
}

// ─── Simple date + month pickers (no external picker lib) ───────────
function DatePickerModal({ open, title, value, onClose, onSave }) {
  const [txt, setTxt] = useState(value || '');
  useEffect(() => { setTxt(value || ''); }, [value, open]);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(txt);
  return (
    <Modal transparent animationType="fade" visible={open} onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <XIcon size={16} color={TEXT_MUTED} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>
          <Text style={styles.modalHint}>Format: YYYY-MM-DD</Text>
          <TextInput
            value={txt}
            onChangeText={setTxt}
            placeholder="2026-07-06"
            placeholderTextColor={TEXT_LIGHT}
            style={styles.modalInput}
            autoCapitalize="none"
            keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
          />
          <TouchableOpacity
            onPress={() => valid && onSave(txt)}
            disabled={!valid}
            style={[styles.modalSaveBtn, !valid && { opacity: 0.5 }]}
            activeOpacity={0.85}
          >
            <Check size={14} color="#fff" strokeWidth={2.6} />
            <Text style={styles.modalSaveText}>Apply</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function MonthPickerModal({ open, value, onClose, onSave }) {
  const [txt, setTxt] = useState(value || '');
  useEffect(() => { setTxt(value || ''); }, [value, open]);
  const valid = /^\d{4}-\d{2}$/.test(txt);
  return (
    <Modal transparent animationType="fade" visible={open} onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>Pick month</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <XIcon size={16} color={TEXT_MUTED} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>
          <Text style={styles.modalHint}>Format: YYYY-MM</Text>
          <TextInput
            value={txt}
            onChangeText={setTxt}
            placeholder="2026-07"
            placeholderTextColor={TEXT_LIGHT}
            style={styles.modalInput}
            autoCapitalize="none"
            keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
          />
          <TouchableOpacity
            onPress={() => valid && onSave(txt)}
            disabled={!valid}
            style={[styles.modalSaveBtn, !valid && { opacity: 0.5 }]}
            activeOpacity={0.85}
          >
            <Check size={14} color="#fff" strokeWidth={2.6} />
            <Text style={styles.modalSaveText}>Apply</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  // Hero
  hero: {
    backgroundColor: BRAND,
    paddingTop: Platform.OS === 'ios' ? 44 : 32,
    paddingBottom: 30,
    paddingHorizontal: 16,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  heroTop: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  heroCaption: {
    color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 2,
  },
  heroBody: { alignItems: 'center', marginTop: 20 },
  heroIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 10,
  },
  heroName: {
    color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: -0.3,
  },
  heroCity: {
    color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700',
    marginTop: 2,
  },
  readOnlyPill: {
    marginTop: 10,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  readOnlyPillText: {
    color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  // Section
  section: {
    marginTop: 16,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 10,
  },
  sectionHeaderIcon: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 14, fontWeight: '800', color: TEXT, letterSpacing: -0.2,
  },
  sectionSub: {
    fontSize: 11, fontWeight: '600', color: TEXT_MUTED, marginTop: 1,
  },

  // Tiles
  tileRow: { flexDirection: 'row', gap: 10 },
  tile: {
    flex: 1,
    backgroundColor: SURFACE,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 1, borderColor: BORDER,
  },
  tileIcon: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 8,
  },
  tileValue: {
    fontSize: 20, fontWeight: '800', letterSpacing: -0.5,
  },
  tileLabel: {
    fontSize: 10, fontWeight: '800', color: TEXT_MUTED,
    letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 2,
  },
  tileHint: {
    fontSize: 10, fontWeight: '700', color: TEXT_LIGHT, marginTop: 4,
  },

  // Filters
  filterRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  filterBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: SURFACE,
    borderWidth: 1, borderColor: BORDER,
    minWidth: 130,
  },
  filterBtnText: {
    flex: 1,
    fontSize: 12, fontWeight: '700', color: TEXT,
  },
  filterArrow: {
    fontSize: 14, color: TEXT_MUTED, fontWeight: '700',
  },
  resetBtn: {
    paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: BRAND_SOFT,
  },
  resetBtnText: {
    fontSize: 11, fontWeight: '800', color: BRAND, letterSpacing: 0.2,
  },

  // Revenue cards
  revCardRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  revCard: {
    flex: 1,
    borderRadius: 14,
    padding: 14,
  },
  revCardTop: {
    color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: '800',
    letterSpacing: 0.6, textTransform: 'uppercase',
  },
  revCardValue: {
    color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 6,
    letterSpacing: -0.4,
  },
  revCardBottom: {
    color: 'rgba(255,255,255,0.8)', fontSize: 10, fontWeight: '700',
    marginTop: 4,
  },

  // Trend chart card
  chartCard: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1, borderColor: BORDER,
  },
  chartHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginBottom: 12,
  },
  chartTitle: {
    fontSize: 11, fontWeight: '800', color: TEXT, letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  chartRow: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    height: 100,
    gap: 8,
  },
  chartBarWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%',
  },
  chartBar: {
    width: '80%',
    borderRadius: 6,
    backgroundColor: BRAND,
  },
  chartLabel: {
    fontSize: 9, fontWeight: '800', color: TEXT_MUTED, marginTop: 4,
    letterSpacing: 0.5,
  },

  // Attendance cards
  card: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1, borderColor: BORDER,
    marginBottom: 12,
  },
  cardCaption: {
    fontSize: 10, fontWeight: '800', color: TEXT_MUTED,
    letterSpacing: 0.6, marginBottom: 10,
  },
  cardFoot: {
    fontSize: 11, fontWeight: '600', color: TEXT_MUTED, marginTop: 8,
  },
  attTodayRow: {
    flexDirection: 'row', gap: 8,
  },
  attChip: {
    flex: 1,
    paddingVertical: 12, paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  attChipValue: {
    fontSize: 20, fontWeight: '800', letterSpacing: -0.4,
  },
  attChipLabel: {
    fontSize: 10, fontWeight: '800', color: TEXT_MUTED,
    letterSpacing: 0.4, marginTop: 2, textTransform: 'uppercase',
  },
  attMonthRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginBottom: 12,
  },
  attMonthDivider: { width: 1, height: 40, backgroundColor: BORDER },
  attMonthPct: {
    fontSize: 22, fontWeight: '800', color: BRAND, letterSpacing: -0.4,
  },
  attMonthBig: {
    fontSize: 18, fontWeight: '800', color: TEXT, letterSpacing: -0.3,
  },
  attMonthBigMuted: {
    fontSize: 14, color: TEXT_MUTED, fontWeight: '700',
  },
  attMonthLabel: {
    fontSize: 10, fontWeight: '800', color: TEXT_MUTED,
    letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 2,
  },
  attMonthTrack: {
    height: 6, borderRadius: 3,
    backgroundColor: BG,
    overflow: 'hidden',
  },
  attMonthFill: {
    height: '100%', borderRadius: 3,
  },

  // Modals
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center', justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%', maxWidth: 340,
    backgroundColor: SURFACE,
    borderRadius: 18,
    padding: 18,
  },
  modalHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 15, fontWeight: '800', color: TEXT,
  },
  modalHint: {
    fontSize: 11, fontWeight: '600', color: TEXT_MUTED, marginBottom: 8,
  },
  modalInput: {
    borderWidth: 1, borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, fontWeight: '700', color: TEXT,
    marginBottom: 12,
  },
  modalSaveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: BRAND,
    paddingVertical: 12, borderRadius: 12,
  },
  modalSaveText: {
    color: '#fff', fontSize: 13, fontWeight: '800', letterSpacing: 0.3,
  },
});
