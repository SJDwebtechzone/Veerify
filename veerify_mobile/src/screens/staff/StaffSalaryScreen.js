// src/screens/staff/StaffSalaryScreen.js
//
// Step 9 of the Staff module - salary history + monthly breakdown.
//
// Layout (top to bottom):
//   1. Red hero - back button, "Salary" title, latest month's net amount with
//      status badge (Paid/Pending/etc.).
//   2. Summary cards strip - Lifetime paid / Outstanding / Slips count.
//   3. Latest slip detail card - base, bonus, deductions, net, payment ref
//      when paid. "View slip" button opens the slip detail modal.
//   4. History list - one row per past period with amount + status.
//   5. Slip detail modal - printable breakdown.
//
// Data:
//   GET /api/salaries/me  - history + summary

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, Modal, Share, Alert, RefreshControl,
} from 'react-native';
import {
  ArrowLeft, Wallet, TrendingUp, AlertTriangle, ListChecks,
  FileText, Download, X as XIcon, CheckCircle2, Clock, XCircle, PauseCircle,
  CreditCard, Calendar,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';

const STATUS_META = {
  paid:    { label: 'Paid',      icon: CheckCircle2, color: palette.green,  on: palette.green.on,  bg: palette.green.soft },
  pending: { label: 'Pending',   icon: Clock,        color: palette.orange, on: palette.orange.on, bg: palette.orange.soft },
  failed:  { label: 'Failed',    icon: XCircle,      color: palette.rose,   on: palette.rose.on,   bg: palette.rose.soft },
  on_hold: { label: 'On hold',   icon: PauseCircle,  color: palette.blue,   on: palette.blue.on,   bg: palette.blue.soft },
};

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtMoney(n) {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
function fmtPeriod(period) {
  if (!period) return '';
  const [y, m] = String(period).split('-');
  if (!y || !m) return period;
  return `${MONTH_SHORT[Number(m) - 1] || '?'} ${y}`;
}

export default function StaffSalaryScreen({ navigation }) {
  const [data, setData] = useState({ salaries: [], summary: {} });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openSlip, setOpenSlip] = useState(null); // currently-viewed slip

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/salaries/me').catch(() => ({ data: { salaries: [], summary: {} } }));
      setData(res.data || { salaries: [], summary: {} });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const salaries = data.salaries || [];
  const summary = data.summary || {};
  const latest = salaries[0];

  const lifetimePaid = Number(summary.lifetime_paid) || 0;
  const outstanding  = Number(summary.outstanding)   || 0;
  const slipsCount   = Number(summary.slips)         || salaries.length;

  return (
    <View style={styles.screen}>
      {/* Hero */}
      <View style={styles.hero}>
        <View style={styles.heroTopRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.heroIconBtn}>
            <ArrowLeft size={20} color="#fff" strokeWidth={2.4} />
          </TouchableOpacity>
          <Text style={styles.heroTitle}>Salary</Text>
          <View style={{ width: 36 }} />
        </View>
        {latest ? (
          <View style={styles.heroBody}>
            <Text style={styles.heroEyebrow}>{fmtPeriod(latest.period)}</Text>
            <Text style={styles.heroAmount}>{fmtMoney(latest.net_amount)}</Text>
            <View style={styles.heroStatusRow}>
              {renderStatusBadge(latest.status, '#fff', 'rgba(255,255,255,0.18)')}
              {latest.paid_at ? (
                <Text style={styles.heroPaidAt}>
                  Paid on {new Date(latest.paid_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={styles.heroBody}>
            <Text style={styles.heroEyebrow}>No payroll yet</Text>
            <Text style={[styles.heroAmount, { fontSize: 22 }]}>—</Text>
          </View>
        )}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.purple.vivid}
          />
        }
      >
        {/* Summary strip */}
        <View style={styles.summaryStrip}>
          <SummaryPill icon={TrendingUp}    label="Lifetime paid" value={fmtMoney(lifetimePaid)} accent={palette.green} />
          <SummaryPill icon={AlertTriangle} label="Outstanding"   value={fmtMoney(outstanding)}  accent={palette.orange} />
          <SummaryPill icon={ListChecks}    label="Slips"         value={slipsCount}             accent={palette.blue} />
        </View>

        {/* Loading / empty */}
        {loading ? (
          <ActivityIndicator size="large" color={palette.purple.vivid} style={{ marginTop: spacing.xxl }} />
        ) : salaries.length === 0 ? (
          <View style={styles.emptyCard}>
            <Wallet size={28} color={palette.textLight} strokeWidth={1.6} />
            <Text style={styles.emptyTitle}>No salary records yet</Text>
            <Text style={styles.emptySub}>
              Your slips will appear here once your academy admin adds them.
            </Text>
          </View>
        ) : (
          <>
            {/* Latest slip breakdown */}
            {latest ? (
              <Card title={`Breakdown — ${fmtPeriod(latest.period)}`} icon={FileText}>
                <BreakdownRow label="Base salary" value={fmtMoney(latest.base_amount)} />
                <Divider />
                <BreakdownRow
                  label="Bonus"
                  value={`+${fmtMoney(latest.bonus)}`}
                  positive
                />
                <Divider />
                <BreakdownRow
                  label="Deductions"
                  value={`-${fmtMoney(latest.deductions)}`}
                  negative
                />
                <View style={styles.totalDivider} />
                <BreakdownRow
                  label="Net amount"
                  value={fmtMoney(latest.net_amount)}
                  bold
                />
                {latest.payment_reference ? (
                  <Text style={styles.refLine}>
                    <Text style={styles.refLabel}>Reference: </Text>{latest.payment_reference}
                    {latest.payment_method ? ` · via ${latest.payment_method}` : ''}
                  </Text>
                ) : null}
                <TouchableOpacity
                  style={styles.viewSlipBtn}
                  onPress={() => setOpenSlip(latest)}
                  activeOpacity={0.85}
                >
                  <FileText size={14} color="#fff" strokeWidth={2.4} />
                  <Text style={styles.viewSlipText}>View / share slip</Text>
                </TouchableOpacity>
              </Card>
            ) : null}

            {/* History */}
            {salaries.length > 1 ? (
              <Card title="Salary history" icon={Calendar} subtitle={`${salaries.length - 1} earlier ${salaries.length - 1 === 1 ? 'slip' : 'slips'}`}>
                <View style={{ gap: spacing.sm }}>
                  {salaries.slice(1).map((s) => (
                    <HistoryRow
                      key={s.id}
                      slip={s}
                      onPress={() => setOpenSlip(s)}
                    />
                  ))}
                </View>
              </Card>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Slip detail modal */}
      <SlipModal slip={openSlip} onClose={() => setOpenSlip(null)} />
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function SummaryPill({ icon: Icon, label, value, accent }) {
  return (
    <View style={styles.summaryPill}>
      <View style={[styles.summaryPillIcon, { backgroundColor: accent.soft }]}>
        <Icon size={14} color={accent.vivid} strokeWidth={2.4} />
      </View>
      <Text style={styles.summaryPillValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.summaryPillLabel}>{label}</Text>
    </View>
  );
}

function Card({ title, icon: Icon, subtitle, children }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {Icon ? (
            <View style={styles.cardHeaderIcon}>
              <Icon size={12} color={palette.purple.vivid} strokeWidth={2.4} />
            </View>
          ) : null}
          <Text style={styles.cardTitle}>{title}</Text>
        </View>
        {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
      </View>
      <View style={styles.cardBody}>{children}</View>
    </View>
  );
}

function BreakdownRow({ label, value, positive, negative, bold }) {
  return (
    <View style={styles.breakdownRow}>
      <Text style={[styles.breakdownLabel, bold && styles.breakdownLabelBold]}>{label}</Text>
      <Text style={[
        styles.breakdownValue,
        positive && { color: palette.green.on },
        negative && { color: palette.rose.on },
        bold && styles.breakdownValueBold,
      ]}>
        {value}
      </Text>
    </View>
  );
}

function Divider() { return <View style={styles.divider} />; }

function HistoryRow({ slip, onPress }) {
  return (
    <TouchableOpacity style={styles.historyRow} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.historyDate}>
        <Text style={styles.historyMonth}>{MONTH_SHORT[Number(String(slip.period).split('-')[1]) - 1]}</Text>
        <Text style={styles.historyYear}>{String(slip.period).split('-')[0]}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.historyAmount}>{fmtMoney(slip.net_amount)}</Text>
        <View style={styles.historyMetaRow}>
          {renderStatusBadge(slip.status)}
          {slip.paid_at ? (
            <Text style={styles.historyPaidAt}>
              {new Date(slip.paid_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
            </Text>
          ) : null}
        </View>
      </View>
      <FileText size={14} color={palette.textLight} strokeWidth={2.2} />
    </TouchableOpacity>
  );
}

function renderStatusBadge(status, fgOverride, bgOverride) {
  const meta = STATUS_META[status] || STATUS_META.pending;
  const Icon = meta.icon;
  return (
    <View style={[styles.statusBadge, { backgroundColor: bgOverride || meta.bg }]}>
      <Icon size={11} color={fgOverride || meta.on} strokeWidth={2.4} />
      <Text style={[styles.statusBadgeText, { color: fgOverride || meta.on }]}>{meta.label}</Text>
    </View>
  );
}

// ─── Slip modal ───────────────────────────────────────────────────────────
function SlipModal({ slip, onClose }) {
  if (!slip) return null;

  const handleShare = async () => {
    try {
      const lines = [
        'VEERIFY SALARY SLIP',
        '────────────────',
        `Period: ${fmtPeriod(slip.period)}`,
        `Status: ${STATUS_META[slip.status]?.label || slip.status}`,
        '',
        `Base:        ${fmtMoney(slip.base_amount)}`,
        `Bonus:      +${fmtMoney(slip.bonus)}`,
        `Deductions: -${fmtMoney(slip.deductions)}`,
        '────────────────',
        `Net:         ${fmtMoney(slip.net_amount)}`,
        '',
        slip.payment_reference ? `Ref:    ${slip.payment_reference}` : '',
        slip.payment_method    ? `Method: ${slip.payment_method}`    : '',
        slip.paid_at           ? `Paid:   ${new Date(slip.paid_at).toLocaleDateString()}` : '',
      ].filter(Boolean).join('\n');
      await Share.share({ message: lines, title: `Salary slip · ${fmtPeriod(slip.period)}` });
    } catch (err) {
      Alert.alert('Could not share', err.message || 'Try again.');
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalEyebrow}>Salary slip</Text>
              <Text style={styles.modalTitle}>{fmtPeriod(slip.period)}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn}>
              <XIcon size={16} color={palette.text} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>

          <View style={styles.slipBox}>
            <View style={styles.slipNetRow}>
              <View>
                <Text style={styles.slipNetLabel}>Net amount</Text>
                <Text style={styles.slipNetValue}>{fmtMoney(slip.net_amount)}</Text>
              </View>
              {renderStatusBadge(slip.status)}
            </View>

            <View style={styles.slipDivider} />

            <SlipLine label="Base salary" value={fmtMoney(slip.base_amount)} />
            <SlipLine label="Bonus" value={`+${fmtMoney(slip.bonus)}`} positive />
            <SlipLine label="Deductions" value={`-${fmtMoney(slip.deductions)}`} negative />

            <View style={styles.slipDivider} />

            {slip.payment_method ? (
              <SlipLine
                label="Payment method"
                value={slip.payment_method}
                icon={CreditCard}
              />
            ) : null}
            {slip.payment_reference ? (
              <SlipLine label="Reference" value={slip.payment_reference} />
            ) : null}
            {slip.paid_at ? (
              <SlipLine
                label="Paid on"
                value={new Date(slip.paid_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
              />
            ) : null}
            {slip.notes ? (
              <View style={{ marginTop: spacing.sm }}>
                <Text style={styles.slipNotesLabel}>NOTES</Text>
                <Text style={styles.slipNotesText}>{slip.notes}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.modalActions}>
            <TouchableOpacity onPress={onClose} style={[styles.modalBtn, styles.modalBtnSecondary]}>
              <Text style={styles.modalBtnSecondaryText}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleShare} style={[styles.modalBtn, styles.modalBtnPrimary]}>
              <Download size={14} color="#fff" strokeWidth={2.4} />
              <Text style={styles.modalBtnPrimaryText}>Share slip</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SlipLine({ label, value, positive, negative, icon: Icon }) {
  return (
    <View style={styles.slipLine}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {Icon ? <Icon size={11} color={palette.textMuted} strokeWidth={2.4} /> : null}
        <Text style={styles.slipLabel}>{label}</Text>
      </View>
      <Text style={[
        styles.slipValue,
        positive && { color: palette.green.on },
        negative && { color: palette.rose.on },
      ]}>
        {value}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },

  // Hero
  hero: {
    backgroundColor: palette.purple.vivid,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl + 4,
    paddingBottom: spacing.xl + spacing.sm,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroIconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  heroTitle: { ...type.h2, color: '#fff', fontWeight: '700' },
  heroBody: { alignItems: 'center', marginTop: spacing.lg },
  heroEyebrow: { ...type.caption, color: 'rgba(255,255,255,0.85)', fontWeight: '700', letterSpacing: 0.5 },
  heroAmount: { color: '#fff', fontSize: 38, fontWeight: '800', marginTop: 4 },
  heroStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm },
  heroPaidAt: { ...type.micro, color: 'rgba(255,255,255,0.85)', fontWeight: '700' },

  // Summary strip
  summaryStrip: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    marginTop: -spacing.lg,
  },
  summaryPill: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  summaryPillIcon: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  summaryPillValue: { ...type.h1, color: palette.text, fontSize: 14 },
  summaryPillLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700' },

  // Card
  card: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    ...shadows.card,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  cardHeaderIcon: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { ...type.bodyBold, color: palette.text, fontSize: 13 },
  cardSubtitle: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  cardBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },

  // Breakdown
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  breakdownLabel: { ...type.body, color: palette.textMuted },
  breakdownLabelBold: { ...type.bodyBold, color: palette.text, fontSize: 14 },
  breakdownValue: { ...type.bodyBold, color: palette.text },
  breakdownValueBold: { ...type.h1, color: palette.purple.vivid, fontSize: 18 },
  divider: { height: 1, backgroundColor: palette.borderSoft },
  totalDivider: {
    height: 2, backgroundColor: palette.text,
    marginVertical: spacing.sm,
  },
  refLine: { ...type.micro, color: palette.textMuted, marginTop: spacing.sm },
  refLabel: { fontWeight: '800', color: palette.text },

  viewSlipBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: palette.purple.vivid,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  viewSlipText: { ...type.bodyBold, color: '#fff', fontWeight: '700' },

  // History
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: palette.bg,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  historyDate: {
    width: 50, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 6,
    backgroundColor: palette.purple.soft,
    borderRadius: radius.md,
  },
  historyMonth: { ...type.micro, color: palette.purple.on, fontWeight: '800', letterSpacing: 0.5 },
  historyYear: { ...type.bodyBold, color: palette.purple.on, fontSize: 14, marginTop: -1 },
  historyAmount: { ...type.bodyBold, color: palette.text },
  historyMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  historyPaidAt: { ...type.micro, color: palette.textMuted, fontWeight: '700' },

  // Status badge
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.pill,
  },
  statusBadgeText: { ...type.micro, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },

  // Empty
  emptyCard: {
    marginHorizontal: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.xl,
    ...shadows.card,
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, marginTop: 4 },
  emptySub: { ...type.caption, color: palette.textMuted, textAlign: 'center' },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  modalSheet: {
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadows.modal,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  modalEyebrow: { ...type.micro, color: palette.textMuted, fontWeight: '700', letterSpacing: 0.5 },
  modalTitle: { ...type.h1, color: palette.text, fontSize: 20, marginTop: 2 },
  modalCloseBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.borderSoft,
  },

  slipBox: {
    backgroundColor: palette.bg,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  slipNetRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  slipNetLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  slipNetValue: { ...type.display, color: palette.purple.vivid, fontSize: 28, marginTop: 2 },
  slipDivider: { height: 1, backgroundColor: palette.borderSoft, marginVertical: spacing.sm },
  slipLine: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 4,
  },
  slipLabel: { ...type.caption, color: palette.textMuted, fontWeight: '600' },
  slipValue: { ...type.bodyBold, color: palette.text },
  slipNotesLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700', letterSpacing: 0.5 },
  slipNotesText: { ...type.body, color: palette.text, marginTop: 2 },

  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  modalBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  modalBtnSecondary: { backgroundColor: palette.borderSoft },
  modalBtnSecondaryText: { ...type.bodyBold, color: palette.text },
  modalBtnPrimary: { backgroundColor: palette.purple.vivid },
  modalBtnPrimaryText: { ...type.bodyBold, color: '#fff' },
});
