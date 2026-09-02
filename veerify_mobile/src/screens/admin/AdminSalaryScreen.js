// src/screens/admin/AdminSalaryScreen.js
//
// Institution admin's payroll surface. Two panes:
//
//   1. Trainer list — every trainer in the institution with their Basic
//      Salary (from the profile) shown as a hint. Tap a row to expand
//      the monthly slip editor for that trainer.
//
//   2. Monthly slip editor — for the selected trainer, the admin picks
//      a month, sees the Basic Salary auto-filled (read-only, derived
//      from the trainer profile), enters Deductions, and gets an
//      auto-computed Net Salary (Basic − Deductions).
//
// Save fires POST /api/salaries. That endpoint UPSERTs on
// (trainer_id, period), so each month gets its own slip — historical
// months are never overwritten when the admin saves a new one for a
// different period.
//
// The Save button is disabled when Basic Salary is 0 (admin hasn't set
// it on the trainer profile yet) so we never persist a zero-net slip
// by accident.

import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import {
  ArrowLeft, User, Wallet, Calendar, ChevronDown, ChevronRight,
  Save, CheckCircle2, AlertCircle,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
import { confirm } from '../../components/ConfirmDialog';
// Institution Home visual system — ambient blue wash + glass
// cards + navy accents. Reused verbatim so this screen belongs to
// the same design language as the rest of the institution UI.
import InstitutionScreenBackground, {
  INSTITUTION_BG_BASE,
} from '../../components/InstitutionScreenBackground';
import { useTheme } from '../../theme/ThemeContext';

// ── Institution-Home glass tokens ─────────────────────────────
const GLASS_FILL         = 'rgba(255,255,255,0.72)';
const GLASS_FILL_STRONG  = 'rgba(255,255,255,0.88)';
const GLASS_BORDER_LIGHT = 'rgba(255,255,255,0.55)';
const GLASS_HIGHLIGHT    = 'rgba(255,255,255,0.9)';
const GLASS_SHADOW       = '#1E40AF';
const BRAND_DARK_BLUE    = '#1E3A8A';
const BRAND_ACCENT_SOFT  = 'rgba(30,58,138,0.10)';
const HEADER_NAVY        = '#0F172A';

// Local context so nested sub-components pick up dark-mode
// overrides without prop-drilling.
const SalaryCtx = createContext({ isDark: false, dark: {} });

function buildDarkOverrides(pal) {
  return StyleSheet.create({
    screen:      { backgroundColor: pal.bg },
    header:      { backgroundColor: pal.surface, borderBottomColor: pal.border },
    headerTitle: { color: pal.text },
    headerSub:   { color: pal.textMuted },
    iconBtn:     { backgroundColor: pal.border },
    card:        { backgroundColor: pal.surface, borderColor: pal.border },
    trainerCard: { backgroundColor: pal.surface, borderColor: pal.border },
    slipCard:    { backgroundColor: pal.surface, borderColor: pal.border },
    sectionTitle:{ color: pal.textMuted },
    label:       { color: pal.textMuted },
  });
}

// ── Month utilities ─────────────────────────────────────────────────
const MONTH_LONG  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// YYYY-MM string of today's date (matches the trainer_salaries.period column).
function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Return N most-recent months as [{ value: 'YYYY-MM', label: 'Jul 2026' }, ...].
function recentMonths(n = 12) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const y = d.getFullYear();
    const m = d.getMonth();
    out.push({
      value: `${y}-${String(m + 1).padStart(2, '0')}`,
      label: `${MONTH_SHORT[m]} ${y}`,
    });
    d.setMonth(m - 1);
  }
  return out;
}

function fmtMoney(n) {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function periodLabel(p) {
  if (!p) return '';
  const [y, m] = String(p).split('-');
  if (!y || !m) return p;
  return `${MONTH_LONG[Number(m) - 1] || '?'} ${y}`;
}

export default function AdminSalaryScreen({ navigation }) {
  const [trainers, setTrainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTrainer, setSelectedTrainer] = useState(null);

  const monthOptions = useMemo(() => recentMonths(12), []);
  const [period, setPeriod] = useState(currentPeriod());
  const [deductions, setDeductions] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedFor, setSavedFor] = useState(null); // { trainerId, period }

  const [monthOpen, setMonthOpen] = useState(false);

  // Every trainer's per-period history so we can show "Already saved
  // this month" hints and keep the Save button honest about upserts.
  const [historyByTrainer, setHistoryByTrainer] = useState({}); // { [trainerId]: rows }

  const load = useCallback(async () => {
    try {
      const [tRes, sRes] = await Promise.all([
        apiClient.get('/trainers').catch(() => ({ data: { trainers: [] } })),
        apiClient.get('/salaries').catch(() => ({ data: { salaries: [] } })),
      ]);
      setTrainers(tRes.data?.trainers || []);
      // Bucket every salary row under its trainer_id so the list can
      // show "N slips" per row without a second round-trip.
      const buckets = {};
      (sRes.data?.salaries || []).forEach((s) => {
        const key = s.trainer_id;
        (buckets[key] = buckets[key] || []).push(s);
      });
      setHistoryByTrainer(buckets);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log('[AdminSalary] load error:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Basic salary comes from the trainer's profile row. NEVER editable
  // on this screen — the admin edits it on the Trainer create/edit
  // form. We only surface it here as a read-only value that becomes
  // this month's base_amount.
  const basicSalary = Number(selectedTrainer?.basic_salary) || 0;
  const deductionsNum = (() => {
    const n = Number(deductions);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  })();
  const netSalary = Math.max(basicSalary - deductionsNum, 0);

  // Latest existing slip for the selected trainer + period. If it
  // exists, we prefill Deductions so the admin can correct a mistake
  // instead of blindly re-entering.
  const existingSlipForPeriod = useMemo(() => {
    if (!selectedTrainer) return null;
    const bucket = historyByTrainer[selectedTrainer.id] || [];
    return bucket.find((s) => s.period === period) || null;
  }, [selectedTrainer, period, historyByTrainer]);

  // Reset the form when the admin picks a different trainer OR month.
  // Prefills Deductions from the existing slip when one is on file so
  // the admin can adjust rather than re-type from scratch.
  useEffect(() => {
    if (!selectedTrainer) return;
    if (existingSlipForPeriod) {
      setDeductions(String(existingSlipForPeriod.deductions || 0));
    } else {
      setDeductions('');
    }
    setSavedFor(null);
  }, [selectedTrainer?.id, period, existingSlipForPeriod]);

  const onSave = async () => {
    if (!selectedTrainer) return;
    if (basicSalary <= 0) {
      confirm({
        title: 'Set Basic Salary first',
        message: `${selectedTrainer.name}'s Basic Salary is not set. Edit their profile to add it, then come back here.`,
        variant: 'warning',
        confirmText: 'OK',
        hideCancel: true,
      });
      return;
    }
    setSaving(true);
    try {
      const res = await apiClient.post('/salaries', {
        trainer_id:  selectedTrainer.id,
        period,
        base_amount: basicSalary,
        deductions:  deductionsNum,
        // No bonus field on this workflow — spec only mentions Basic and
        // Deductions. Left at 0 so the backend's computeNet() gives us
        // basic - deductions exactly as displayed.
        bonus:       0,
        status:      'pending',
      });
      setSavedFor({ trainerId: selectedTrainer.id, period });
      // Merge the saved row into the local history buckets so the
      // "already saved" hint updates immediately without a full reload.
      const saved = res.data?.salary;
      if (saved) {
        setHistoryByTrainer((prev) => {
          const next = { ...prev };
          const arr  = [...(next[selectedTrainer.id] || [])];
          const idx  = arr.findIndex((s) => s.period === saved.period);
          if (idx >= 0) arr[idx] = saved; else arr.push(saved);
          next[selectedTrainer.id] = arr;
          return next;
        });
      }
    } catch (err) {
      confirm({
        title: 'Save failed',
        message: err?.response?.data?.message || 'Could not save salary. Please try again.',
        variant: 'warning',
        confirmText: 'OK',
        hideCancel: true,
      });
    } finally {
      setSaving(false);
    }
  };

  // Dark-mode overrides pulled from the shared ThemeContext.
  // Institution Home's ambient background is skipped in dark mode.
  const { mode, palette: themePalette } = useTheme();
  const isDark = mode === 'dark';
  const dark   = useMemo(() => (isDark ? buildDarkOverrides(themePalette) : {}), [isDark, themePalette]);

  if (loading) {
    return (
      <SalaryCtx.Provider value={{ isDark, dark }}>
      <View style={[styles.screen, styles.center, isDark && dark.screen]}>
        {!isDark ? <InstitutionScreenBackground layer /> : null}
        <ActivityIndicator size="large" color={BRAND_DARK_BLUE} />
      </View>
      </SalaryCtx.Provider>
    );
  }

  return (
    <SalaryCtx.Provider value={{ isDark, dark }}>
    <View style={[styles.screen, isDark && dark.screen]}>
      {/* Institution Home ambient wash — sits behind all content. */}
      {!isDark ? <InstitutionScreenBackground layer /> : null}
      {/* ── Header ────────────────────────────────────────────── */}
      <View style={[styles.header, isDark && dark.header]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={[styles.iconBtn, isDark && dark.iconBtn]}
          hitSlop={8}
        >
          <ArrowLeft size={20} color={isDark ? themePalette.text : HEADER_NAVY} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, isDark && dark.headerTitle]}>Salary</Text>
          <Text style={[styles.subtitle, isDark && dark.headerSub]}>
            Pick a trainer to record this month's payroll.
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.purple.vivid}
          />
        }
      >
        {/* ── Trainer list ──────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>TRAINERS</Text>
        {trainers.length === 0 ? (
          <View style={styles.emptyCard}>
            <User size={24} color={palette.textLight} strokeWidth={1.8} />
            <Text style={styles.emptyTitle}>No trainers yet</Text>
            <Text style={styles.emptyBody}>
              Add a trainer from More → Trainers first, then come back to
              record their salary.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {trainers.map((t) => {
              const isSel  = selectedTrainer?.id === t.id;
              const bucket = historyByTrainer[t.id] || [];
              return (
                <View key={t.id}>
                  <TouchableOpacity
                    style={[styles.trainerRow, isSel && styles.trainerRowSelected]}
                    onPress={() => setSelectedTrainer(isSel ? null : t)}
                    activeOpacity={0.9}
                  >
                    <View style={styles.trainerAvatar}>
                      <User size={16} color={palette.purple.vivid} strokeWidth={2.4} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.trainerName} numberOfLines={1}>{t.name}</Text>
                      <Text style={styles.trainerSub} numberOfLines={1}>
                        Basic {fmtMoney(t.basic_salary)}
                        {bucket.length > 0 ? ` · ${bucket.length} slip${bucket.length === 1 ? '' : 's'}` : ''}
                      </Text>
                    </View>
                    <ChevronRight
                      size={16}
                      color={palette.textMuted}
                      style={{ transform: [{ rotate: isSel ? '90deg' : '0deg' }] }}
                    />
                  </TouchableOpacity>

                  {isSel ? (
                    <SlipEditor
                      trainer={t}
                      basicSalary={basicSalary}
                      deductions={deductions}
                      setDeductions={setDeductions}
                      netSalary={netSalary}
                      period={period}
                      setPeriod={setPeriod}
                      monthOptions={monthOptions}
                      monthOpen={monthOpen}
                      setMonthOpen={setMonthOpen}
                      existingSlipForPeriod={existingSlipForPeriod}
                      saving={saving}
                      savedFor={savedFor}
                      onSave={onSave}
                      history={bucket}
                    />
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
    </SalaryCtx.Provider>
  );
}

// ── Inline slip editor ─────────────────────────────────────────────
function SlipEditor({
  trainer, basicSalary, deductions, setDeductions,
  netSalary, period, setPeriod, monthOptions, monthOpen, setMonthOpen,
  existingSlipForPeriod, saving, savedFor, onSave, history,
}) {
  const savedNow = savedFor && savedFor.trainerId === trainer.id && savedFor.period === period;
  return (
    <View style={styles.editor}>
      {/* Trainer + Month */}
      <View style={styles.editorRow}>
        <Text style={styles.editorLabel}>Trainer</Text>
        <Text style={styles.editorValue}>{trainer.name}</Text>
      </View>

      <View style={styles.editorRow}>
        <Text style={styles.editorLabel}>Month</Text>
        <TouchableOpacity
          style={styles.monthPicker}
          onPress={() => setMonthOpen((o) => !o)}
          activeOpacity={0.85}
        >
          <Calendar size={12} color={palette.purple.vivid} strokeWidth={2.4} />
          <Text style={styles.monthPickerText}>{periodLabel(period)}</Text>
          <ChevronDown
            size={14}
            color={palette.textMuted}
            style={{ transform: [{ rotate: monthOpen ? '180deg' : '0deg' }] }}
          />
        </TouchableOpacity>
      </View>
      {monthOpen ? (
        <View style={styles.monthMenu}>
          {monthOptions.map((m) => (
            <TouchableOpacity
              key={m.value}
              style={[styles.monthItem, m.value === period && styles.monthItemActive]}
              onPress={() => { setPeriod(m.value); setMonthOpen(false); }}
              activeOpacity={0.85}
            >
              <Text style={[styles.monthItemText, m.value === period && styles.monthItemTextActive]}>
                {m.label}
              </Text>
              {m.value === period ? (
                <CheckCircle2 size={12} color={palette.purple.vivid} strokeWidth={2.4} />
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {/* Basic salary (read-only, from profile) */}
      <View style={styles.editorRow}>
        <Text style={styles.editorLabel}>Basic Salary</Text>
        <View style={styles.readonlyBox}>
          <Wallet size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.readonlyText}>{fmtMoney(basicSalary)}</Text>
          <Text style={styles.readonlyHint}>from profile</Text>
        </View>
      </View>
      {basicSalary <= 0 ? (
        <View style={styles.warnBox}>
          <AlertCircle size={12} color={palette.orange.on} strokeWidth={2.4} />
          <Text style={styles.warnText}>
            Basic Salary not set on {trainer.name}'s profile. Add it from More → Trainers to enable saving.
          </Text>
        </View>
      ) : null}

      {/* Deductions (editable) */}
      <View style={styles.editorRow}>
        <Text style={styles.editorLabel}>Deductions</Text>
        <TextInput
          style={styles.deductionsInput}
          value={deductions}
          onChangeText={(v) => setDeductions(v.replace(/[^0-9.]/g, ''))}
          placeholder="0"
          placeholderTextColor={palette.textLight}
          keyboardType="decimal-pad"
          maxLength={10}
        />
      </View>

      {/* Net salary (computed) */}
      <View style={styles.netRow}>
        <Text style={styles.netLabel}>Net Salary</Text>
        <Text style={styles.netValue}>{fmtMoney(netSalary)}</Text>
      </View>
      <Text style={styles.netHint}>
        Basic {fmtMoney(basicSalary)} − Deductions {fmtMoney(Number(deductions) || 0)}
      </Text>

      {existingSlipForPeriod && !savedNow ? (
        <View style={styles.hintBox}>
          <AlertCircle size={12} color={palette.blue.on} strokeWidth={2.4} />
          <Text style={styles.hintText}>
            A slip for {periodLabel(period)} is already saved — saving will update it. Older months stay untouched.
          </Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={[
          styles.saveBtn,
          (saving || basicSalary <= 0) && { opacity: 0.5 },
        ]}
        onPress={onSave}
        disabled={saving || basicSalary <= 0}
        activeOpacity={0.85}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : savedNow ? (
          <>
            <CheckCircle2 size={14} color="#fff" strokeWidth={2.4} />
            <Text style={styles.saveBtnText}>Saved</Text>
          </>
        ) : (
          <>
            <Save size={14} color="#fff" strokeWidth={2.4} />
            <Text style={styles.saveBtnText}>Save Salary for {periodLabel(period)}</Text>
          </>
        )}
      </TouchableOpacity>

      {/* History strip */}
      {history.length > 0 ? (
        <View style={styles.history}>
          <Text style={styles.historyTitle}>Recent slips</Text>
          {history
            .slice()
            .sort((a, b) => String(b.period).localeCompare(String(a.period)))
            .slice(0, 6)
            .map((s) => (
              <View key={s.id} style={styles.historyRow}>
                <Text style={styles.historyPeriod}>{periodLabel(s.period)}</Text>
                <Text style={styles.historyBreakdown}>
                  {fmtMoney(s.base_amount)} − {fmtMoney(s.deductions)}
                </Text>
                <Text style={styles.historyNet}>{fmtMoney(s.net_amount)}</Text>
              </View>
            ))}
        </View>
      ) : null}
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Institution Home ambient page base — the wash SVG paints on top.
  screen: { flex: 1, backgroundColor: INSTITUTION_BG_BASE },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Header — glass slab with a navy title and soft blue lift shadow.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
    backgroundColor: GLASS_FILL_STRONG,
    borderBottomWidth: 1, borderBottomColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.10,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: BRAND_ACCENT_SOFT,
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
  },
  title:    { ...type.h1, color: HEADER_NAVY, fontSize: 20, letterSpacing: 0.2 },
  subtitle: { ...type.caption, color: palette.textMuted, marginTop: 2, fontWeight: '600' },

  sectionLabel: {
    ...type.micro,
    color: palette.textMuted,
    fontWeight: '800',
    letterSpacing: 0.6,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 6,
  },

  // Empty state — glass panel matching the rest of the Institution
  // Home surfaces.
  emptyCard: {
    marginHorizontal: spacing.lg,
    marginTop: 6,
    padding: spacing.xl,
    borderRadius: 16,
    backgroundColor: GLASS_FILL_STRONG,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, marginTop: 4 },
  emptyBody: { ...type.caption, color: palette.textMuted, textAlign: 'center', maxWidth: 260 },

  // Trainer list card — glass panel with matching blue lift shadow.
  list: {
    marginHorizontal: spacing.lg,
    borderRadius: 16,
    backgroundColor: GLASS_FILL_STRONG,
    overflow: 'hidden',
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  trainerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  trainerRowSelected: { backgroundColor: palette.purple.soft },
  trainerAvatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  trainerName: { ...type.bodyBold, color: palette.text, fontSize: 14 },
  trainerSub: { ...type.caption, color: palette.textMuted, marginTop: 2 },

  // ── Editor ────────────────────────────────────────────────────
  editor: {
    padding: spacing.md,
    backgroundColor: '#FDFCFF',
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
    gap: 10,
  },
  editorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  editorLabel: {
    ...type.caption,
    color: palette.textMuted,
    fontWeight: '700',
    width: 96,
  },
  editorValue: {
    flex: 1,
    ...type.bodyBold,
    color: palette.text,
    fontSize: 14,
  },

  monthPicker: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  monthPickerText: {
    flex: 1,
    ...type.bodyBold,
    color: palette.text,
    fontSize: 13,
  },
  monthMenu: {
    marginLeft: 96 + spacing.md,
    backgroundColor: palette.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    overflow: 'hidden',
    ...shadows.card,
  },
  monthItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  monthItemActive: { backgroundColor: palette.purple.soft },
  monthItemText: { ...type.body, color: palette.text, fontSize: 13 },
  monthItemTextActive: { color: palette.purple.on, fontWeight: '800' },

  readonlyBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: palette.borderSoft,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  readonlyText: {
    ...type.bodyBold,
    color: palette.text,
    fontSize: 14,
  },
  readonlyHint: {
    marginLeft: 'auto',
    ...type.micro,
    color: palette.textMuted,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  deductionsInput: {
    flex: 1,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: palette.text,
    fontWeight: '700',
  },

  netRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
    marginTop: 4,
  },
  netLabel: {
    ...type.h2,
    color: palette.text,
    fontSize: 15,
    fontWeight: '800',
  },
  netValue: {
    ...type.h2,
    color: palette.purple.vivid,
    fontSize: 20,
    fontWeight: '900',
  },
  netHint: {
    ...type.micro,
    color: palette.textMuted,
    marginTop: -4,
  },

  warnBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: palette.orange.soft,
    borderRadius: 8,
    padding: 8,
  },
  warnText: {
    flex: 1,
    ...type.caption,
    color: palette.orange.on,
    fontWeight: '600',
  },
  hintBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: palette.blue.soft,
    borderRadius: 8,
    padding: 8,
  },
  hintText: {
    flex: 1,
    ...type.caption,
    color: palette.blue.on,
    fontWeight: '600',
  },

  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: palette.purple.vivid,
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 4,
  },
  saveBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },

  history: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
    gap: 4,
  },
  historyTitle: {
    ...type.micro,
    color: palette.textMuted,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 4,
  },
  historyPeriod: {
    ...type.caption,
    color: palette.text,
    fontWeight: '700',
    width: 100,
  },
  historyBreakdown: {
    flex: 1,
    ...type.caption,
    color: palette.textMuted,
  },
  historyNet: {
    ...type.bodyBold,
    color: palette.text,
    fontSize: 13,
  },
});
