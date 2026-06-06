// src/screens/student/EnrollmentPaymentScreen.js
//
// Shown right after the EnrollmentFormScreen submits. Displays an order
// summary (course / batch / amount) and a "Pay" button.
//
// For now the payment is mocked - POST /api/enrollments/:id/mock-pay flips
// the enrollment from pending to paid and records a reference id. Once
// Razorpay-for-fees lands we'll swap the button to open a Razorpay link.
//
// Successful pay → "Enrollment Complete" screen → navigate to MyEnrollments
// where the student sees their newly-paid enrollment listed.

import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import {
  ArrowLeft, CheckCircle, CreditCard, Building2, Calendar, Clock,
  Wallet, Star, BookOpen, Shield, ChevronRight,
} from 'lucide-react-native';
// Aliased to icons known to exist in older lucide versions:
const CheckCircle2 = CheckCircle;
const Sparkles = Star;
const ShieldCheck = Shield;

import apiClient from '../../api/client';

// ─── Theme tokens ──────────────────────────────────────────────────────
const BRAND = '#E63946';
const BRAND_SOFT = '#FFE4E6';
const TEXT = '#111827';
const TEXT_MUTED = '#6B7280';
const SURFACE = '#FFFFFF';
const BG = '#F4F4F8';
const BORDER = '#E5E7EB';
const GREEN = '#10B981';

function fmtINR(n) {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString('en-IN')}`;
}

export default function EnrollmentPaymentScreen({ route, navigation }) {
  const { enrollment, batch, course, amount: amt } = route?.params || {};
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState(false);
  const [reference, setReference] = useState(null);

  const amount = Number(enrollment?.payment_amount) || Number(amt) || Number(batch?.course_price) || 0;

  const handlePay = async () => {
    if (!enrollment?.id) return;
    setPaying(true);
    try {
      const res = await apiClient.post(`/enrollments/${enrollment.id}/mock-pay`);
      setReference(res.data?.reference || res.data?.enrollment?.payment_reference || null);
      setDone(true);
    } catch (err) {
      Alert.alert('Payment failed', err.response?.data?.message || 'Please try again.');
    } finally {
      setPaying(false);
    }
  };

  // ── Success screen ───────────────────────────────────────────────────
  if (done) {
    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.successBody} showsVerticalScrollIndicator={false}>
          <View style={styles.successCircle}>
            <CheckCircle2 size={56} color="#fff" strokeWidth={2.4} />
          </View>
          <Text style={styles.successTitle}>Enrollment Complete!</Text>
          <Text style={styles.successSub}>
            You're enrolled in {course?.name || batch?.course_name || 'the course'}.
            We've emailed you a confirmation.
          </Text>

          <View style={styles.receiptCard}>
            <ReceiptRow label="Amount paid"   value={fmtINR(amount)} strong />
            <Divider />
            <ReceiptRow label="Course"        value={course?.name || batch?.course_name || '-'} />
            <ReceiptRow label="Batch"         value={batch?.name || '-'} />
            <ReceiptRow label="Reference"     value={reference || '-'} mono />
            <ReceiptRow label="Status"        value="PAID" valueColor={GREEN} />
          </View>

          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, { marginTop: 24 }]}
            onPress={() => {
              navigation.reset({
                index: 0,
                routes: [
                  { name: 'StudentTabs' },
                  { name: 'MyEnrollments' },
                ],
              });
            }}
            activeOpacity={0.85}
          >
            <BookOpen size={16} color="#fff" strokeWidth={2.4} />
            <Text style={styles.btnPrimaryText}>View My Courses</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnGhost, { marginTop: 8 }]}
            onPress={() => navigation.navigate('StudentTabs')}
            activeOpacity={0.85}
          >
            <Text style={styles.btnGhostText}>Back to Home</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ── Order summary / pay screen ───────────────────────────────────────
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.iconBtn}
          activeOpacity={0.7}
          disabled={paying}
        >
          <ArrowLeft size={20} color={TEXT} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Complete Payment</Text>
          <Text style={styles.headerSub}>Step 2 of 2 · Payment</Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {/* Order summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order Summary</Text>
          <View style={styles.card}>
            <View style={styles.courseRow}>
              <View style={styles.courseIcon}>
                <BookOpen size={20} color={BRAND} strokeWidth={2.2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.courseName} numberOfLines={2}>
                  {course?.name || batch?.course_name || 'Course'}
                </Text>
                {batch?.name ? (
                  <Text style={styles.courseSub}>Batch: {batch.name}</Text>
                ) : null}
              </View>
            </View>

            <Divider />

            {batch?.days_of_week ? (
              <KVRow icon={Calendar} label="Days" value={batch.days_of_week} />
            ) : null}
            {batch?.start_time ? (
              <KVRow
                icon={Clock}
                label="Time"
                value={`${(batch.start_time || '').slice(0, 5)}${batch.end_time ? ' – ' + (batch.end_time || '').slice(0, 5) : ''}`}
              />
            ) : null}
            {batch?.institution_name || course?.institution_name ? (
              <KVRow
                icon={Building2}
                label="Academy"
                value={batch?.institution_name || course?.institution_name}
              />
            ) : null}
          </View>
        </View>

        {/* Amount */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Amount</Text>
          <View style={[styles.card, { alignItems: 'center', paddingVertical: 24 }]}>
            <Text style={styles.amountLabel}>Total payable</Text>
            <Text style={styles.amount}>{fmtINR(amount)}</Text>
            <View style={styles.amountChip}>
              <Wallet size={11} color={BRAND} strokeWidth={2.4} />
              <Text style={styles.amountChipText}>One-time course fee</Text>
            </View>
          </View>
        </View>

        {/* Payment methods */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment Methods</Text>
          <View style={styles.card}>
            <PayMethodRow icon={CreditCard} title="UPI / Cards / Net Banking"
              sub="Secured by Razorpay" selected />
            <Text style={styles.methodHint}>
              Mock payment is enabled for testing. Tap Pay below to instantly
              complete the enrollment.
            </Text>
          </View>
        </View>

        {/* Trust strip */}
        <View style={styles.trustRow}>
          <ShieldCheck size={14} color={GREEN} strokeWidth={2.4} />
          <Text style={styles.trustText}>
            Your payment details are processed securely.
          </Text>
        </View>
      </ScrollView>

      {/* Pay button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, paying && { opacity: 0.6 }]}
          onPress={handlePay}
          disabled={paying}
          activeOpacity={0.85}
        >
          {paying ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Sparkles size={16} color="#fff" strokeWidth={2.4} />
              <Text style={styles.btnPrimaryText}>Pay {fmtINR(amount)}</Text>
              <ChevronRight size={18} color="#fff" strokeWidth={2.6} />
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────
function Divider() {
  return <View style={styles.divider} />;
}
function KVRow({ icon: Icon, label, value }) {
  return (
    <View style={styles.kvRow}>
      <View style={styles.kvIcon}>
        <Icon size={12} color={BRAND} strokeWidth={2.4} />
      </View>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={styles.kvValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}
function PayMethodRow({ icon: Icon, title, sub, selected }) {
  return (
    <View style={[styles.methodRow, selected && styles.methodRowOn]}>
      <View style={styles.methodIcon}>
        <Icon size={16} color={BRAND} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.methodTitle}>{title}</Text>
        {sub ? <Text style={styles.methodSub}>{sub}</Text> : null}
      </View>
      {selected ? (
        <View style={styles.methodRadioOn}>
          <View style={styles.methodRadioDot} />
        </View>
      ) : (
        <View style={styles.methodRadio} />
      )}
    </View>
  );
}
function ReceiptRow({ label, value, strong, mono, valueColor }) {
  return (
    <View style={styles.receiptRow}>
      <Text style={styles.receiptLabel}>{label}</Text>
      <Text
        style={[
          styles.receiptValue,
          strong && styles.receiptValueStrong,
          mono && { fontFamily: 'monospace' },
          valueColor && { color: valueColor },
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 44, paddingBottom: 12,
    backgroundColor: SURFACE,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: TEXT },
  headerSub: { fontSize: 11, color: TEXT_MUTED, marginTop: 2, fontWeight: '600' },

  body: { padding: 16, paddingBottom: 32 },

  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: TEXT_MUTED, letterSpacing: 0.5, marginBottom: 8 },
  card: {
    backgroundColor: SURFACE,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1, borderColor: BORDER,
  },

  courseRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  courseIcon: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  courseName: { fontSize: 15, fontWeight: '800', color: TEXT },
  courseSub: { fontSize: 12, color: TEXT_MUTED, marginTop: 2, fontWeight: '600' },

  divider: { height: 1, backgroundColor: BORDER, marginVertical: 12 },

  kvRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  kvIcon: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  kvLabel: { fontSize: 12, color: TEXT_MUTED, fontWeight: '700', width: 70 },
  kvValue: { flex: 1, fontSize: 13, color: TEXT, fontWeight: '700' },

  amountLabel: { fontSize: 11, color: TEXT_MUTED, fontWeight: '700', letterSpacing: 0.5 },
  amount: { fontSize: 36, fontWeight: '900', color: BRAND, marginTop: 4 },
  amountChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: BRAND_SOFT,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 999,
    marginTop: 8,
  },
  amountChipText: { fontSize: 11, color: BRAND, fontWeight: '800' },

  methodRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 6,
  },
  methodRowOn: {},
  methodIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  methodTitle: { fontSize: 13, fontWeight: '800', color: TEXT },
  methodSub: { fontSize: 11, color: TEXT_MUTED, marginTop: 2, fontWeight: '600' },
  methodRadio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: BORDER,
  },
  methodRadioOn: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: BRAND,
    alignItems: 'center', justifyContent: 'center',
  },
  methodRadioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: BRAND },
  methodHint: {
    fontSize: 11, color: TEXT_MUTED, fontStyle: 'italic',
    marginTop: 8, lineHeight: 16,
  },

  trustRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    justifyContent: 'center',
    paddingVertical: 12,
  },
  trustText: { fontSize: 11, color: TEXT_MUTED, fontWeight: '600' },

  footer: {
    paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 22,
    backgroundColor: SURFACE,
    borderTopWidth: 1, borderTopColor: BORDER,
  },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, borderRadius: 12,
  },
  btnPrimary: { backgroundColor: BRAND },
  btnPrimaryText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  btnGhost: { backgroundColor: BG },
  btnGhostText: { fontSize: 14, fontWeight: '700', color: TEXT_MUTED },

  // Success screen
  successBody: { padding: 24, paddingTop: 64, alignItems: 'center' },
  successCircle: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: GREEN,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  successTitle: { fontSize: 22, fontWeight: '900', color: TEXT, marginTop: 8 },
  successSub: {
    fontSize: 13, color: TEXT_MUTED, fontWeight: '600',
    textAlign: 'center', marginTop: 8, lineHeight: 19,
    paddingHorizontal: 20,
  },
  receiptCard: {
    backgroundColor: SURFACE,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1, borderColor: BORDER,
    width: '100%',
    marginTop: 24,
  },
  receiptRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 6,
  },
  receiptLabel: { fontSize: 12, color: TEXT_MUTED, fontWeight: '700' },
  receiptValue: { fontSize: 13, color: TEXT, fontWeight: '700', maxWidth: 200, textAlign: 'right' },
  receiptValueStrong: { fontSize: 18, fontWeight: '900', color: BRAND },
});
