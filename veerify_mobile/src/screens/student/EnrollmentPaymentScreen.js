// src/screens/student/EnrollmentPaymentScreen.js
//
// Reached from EnrollmentFormScreen after the form is submitted and
// validated. Handles the REAL Razorpay payment for a self-enrolled
// student. The row was already inserted by /enrollments as
// payment_status='pending'; nothing on this screen ever flips it —
// only the server-side webhook does after Razorpay confirms the
// charge.
//
// Flow:
//   1. Order summary + amount are rendered from route params.
//   2. Tap "Pay Now" → POST /enrollments/:id/create-payment-link.
//      The backend mints a Razorpay Payment Link and returns the
//      short_url + the plink id.
//   3. Linking.openURL(payment_url) opens Razorpay in the phone's
//      browser. The student pays.
//   4. AppState listener detects when the user comes BACK to the app
//      and starts polling GET /enrollments/:id/payment-status. The
//      poll checks up to ~30s waiting for the webhook to arrive.
//   5. On payment_status='paid' → success screen + navigate to
//      MyEnrollments.
//   6. Timeout / user cancels / payment fails → row stays 'pending',
//      screen shows a "Payment Pending" state with Retry + Back
//      buttons. No enrollment is activated, matching the spec.
//
// Dev fallback: if Razorpay isn't configured (RAZORPAY_KEY_ID missing
// in backend .env), the create-payment-link endpoint responds with
// { mock: true } and we route through the existing /mock-pay
// endpoint so local development still works end-to-end.

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, Alert, Linking, AppState,
} from 'react-native';
import {
  ArrowLeft, CheckCircle, CreditCard, Building2, Calendar, Clock,
  Wallet, Star, BookOpen, Shield, ChevronRight, AlertCircle, RefreshCw,
} from 'lucide-react-native';
// Aliased to icons known to exist in older lucide versions:
const CheckCircle2 = CheckCircle;
const Sparkles = Star;
const ShieldCheck = Shield;

import apiClient from '../../api/client';
import { confirm } from '../../components/ConfirmDialog';
import { billingCycleLabel } from '../../utils/billingCycle';
import { formatBatchTimeRange } from '../../utils/formatTime';

// ─── Theme tokens ──────────────────────────────────────────────────────
const BRAND = '#E63946';
const BRAND_SOFT = '#FFE4E6';
const TEXT = '#111827';
const TEXT_MUTED = '#6B7280';
const SURFACE = '#FFFFFF';
const BG = '#F4F4F8';
const BORDER = '#E5E7EB';
const GREEN = '#10B981';
const AMBER = '#F59E0B';

// Polling budget after the user returns from the Razorpay browser.
// The webhook usually lands within 3-5 seconds; 30s gives a wide
// buffer for slow networks without leaving the user staring forever.
const POLL_INTERVAL_MS = 2500;
const POLL_MAX_MS      = 30_000;

function fmtINR(n) {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString('en-IN')}`;
}

export default function EnrollmentPaymentScreen({ route, navigation }) {
  const { enrollment, batch, course, amount: amt } = route?.params || {};
  const [paying, setPaying] = useState(false);
  const [polling, setPolling] = useState(false);
  const [done, setDone] = useState(false);
  const [reference, setReference] = useState(null);
  // Payment lifecycle stage — drives the render tree:
  //   'idle'         → show summary + "Pay Now" button
  //   'awaiting'     → student is in the Razorpay browser
  //   'verifying'    → poll loop confirming with backend
  //   'pending'      → poll timed out / user came back without paying
  //   'done'         → verified paid (also flips `done` for legacy)
  const [stage, setStage] = useState('idle');
  const pollTimer  = useRef(null);
  const pollStart  = useRef(0);
  const appStateSub = useRef(null);
  const sentToRzp  = useRef(false);

  const amount = Number(enrollment?.payment_amount) || Number(amt) || Number(batch?.course_price) || 0;

  // ── Cleanup on unmount ────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
      if (appStateSub.current) appStateSub.current.remove();
    };
  }, []);

  // ── Poll payment status until webhook lands or timeout ────────────
  const pollPaymentStatus = async () => {
    if (!enrollment?.id) return;
    try {
      const r = await apiClient.get(`/enrollments/${enrollment.id}/payment-status`);
      const row = r.data?.enrollment;
      if (row?.payment_status === 'paid') {
        // Server confirmed. Now — and only now — is the student paid.
        setReference(row.payment_reference || null);
        setStage('done');
        setDone(true);
        setPolling(false);
        return;
      }
    } catch (err) {
      // Swallow — keep polling; a transient 500 shouldn't abort the loop.
      // eslint-disable-next-line no-console
      console.log('[EnrollPay] poll error:', err?.message);
    }
    // Not paid yet — schedule another tick if we still have budget.
    if (Date.now() - pollStart.current < POLL_MAX_MS) {
      pollTimer.current = setTimeout(pollPaymentStatus, POLL_INTERVAL_MS);
    } else {
      // Ran out of budget. The row stays payment_status='pending'
      // on the server (webhook hasn't arrived / user didn't complete).
      // Surface a "Payment Pending" state so the student can retry.
      setStage('pending');
      setPolling(false);
    }
  };

  const startPolling = () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollStart.current = Date.now();
    setPolling(true);
    setStage('verifying');
    // Small initial delay to let the webhook race the return-to-app.
    pollTimer.current = setTimeout(pollPaymentStatus, 800);
  };

  // Detect the user coming back to the app from the Razorpay browser
  // and kick off the polling loop. We rely on AppState 'active' rather
  // than any Razorpay callback because the Payment Link hosted page
  // doesn't push a deep link back into the RN app.
  useEffect(() => {
    if (!sentToRzp.current) return;
    const handleChange = (next) => {
      if (next === 'active' && sentToRzp.current) {
        sentToRzp.current = false;
        startPolling();
      }
    };
    appStateSub.current = AppState.addEventListener('change', handleChange);
    return () => {
      if (appStateSub.current) appStateSub.current.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // ── Pay Now ───────────────────────────────────────────────────────
  //
  // Contract: this handler NEVER marks the enrollment paid on the
  // client. It only:
  //   1. Verifies preconditions.
  //   2. Asks the backend to mint a Razorpay Payment Link.
  //   3. If the server already sees this row as `paid` (webhook
  //      landed on an earlier attempt), we jump the user to the
  //      success screen — the payment IS verified server-side.
  //   4. Otherwise, opens the Razorpay hosted page in the OS browser
  //      and enters `awaiting`. From that point on, the ONLY way we
  //      surface the success screen is by polling
  //      `/enrollments/:id/payment-status` and seeing the backend
  //      report `payment_status === 'paid'`. That flip only happens
  //      after the Razorpay webhook fires with a valid signature.
  //
  // If Razorpay isn't configured on the server (mock:true), we now
  // REFUSE to fake success. Instead we surface a clear error so the
  // student — and the operator — know payment is unavailable. This
  // removes the "Pay Now silently marks paid" foot-gun that showed
  // up when creds hadn't been reloaded on the API server.
  const handlePay = async () => {
    if (!enrollment?.id) {
      confirm({
        title:       'Nothing to pay for',
        message:     'We lost track of this enrolment. Go back and start the payment again.',
        variant:     'warning',
        confirmText: 'Got it',
        hideCancel:  true,
      });
      return;
    }
    if (amount <= 0) {
      confirm({
        title:       'No amount to charge',
        message:     'This course has no price configured. Please contact the academy.',
        variant:     'warning',
        confirmText: 'Got it',
        hideCancel:  true,
      });
      return;
    }
    setPaying(true);
    try {
      // 1. Ask the backend to mint a Razorpay Payment Link.
      const res = await apiClient.post(
        `/enrollments/${enrollment.id}/create-payment-link`,
      );
      const data = res.data || {};

      // 2. Razorpay is not configured on the server. We DO NOT
      // silently mock-pay any more — that used to grant access
      // without an actual charge. Surface a hard error instead.
      if (data.mock) {
        throw new Error(
          data.message
            || 'Online payments are not available right now. Please try again in a few minutes or contact your academy.',
        );
      }

      // 3. Idempotent short-circuit — the webhook has already flipped
      // this row to paid on a previous attempt. Server is the source
      // of truth here, so we're safe to show the success screen.
      if (data.already_paid) {
        setReference(data.transaction_id || null);
        setStage('done');
        setDone(true);
        return;
      }

      const url = data.payment_url;
      if (!url) {
        throw new Error('No payment URL returned from server');
      }

      // 4. Open Razorpay in the OS browser. sentToRzp arms the
      // AppState listener so polling starts the moment the student
      // comes back to Veerify. `stage='awaiting'` locks the UI out
      // of any code path that could accidentally mark paid — only
      // the poll loop can flip us to 'done'.
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        throw new Error('Cannot open the payment page on this device.');
      }
      sentToRzp.current = true;
      setStage('awaiting');
      await Linking.openURL(url);
    } catch (err) {
      confirm({
        title:       'Payment could not start',
        message:
          err?.response?.data?.message
            || err?.message
            || 'We could not start the payment. Your enrolment is still Pending Payment — you can retry any time.',
        variant:     'destructive',
        confirmText: 'Got it',
        hideCancel:  true,
      });
      // Keep the enrollment in 'pending' state — never mark paid
      // client-side. The user can tap Pay Now again to retry.
      setStage('idle');
      sentToRzp.current = false;
    } finally {
      setPaying(false);
    }
  };

  // Manual "check status" for the pending screen — hits the same
  // polling endpoint once so the user doesn't have to wait for the
  // periodic tick if the webhook just arrived.
  const recheckStatus = async () => {
    if (!enrollment?.id) return;
    setPolling(true);
    setStage('verifying');
    try {
      const r = await apiClient.get(`/enrollments/${enrollment.id}/payment-status`);
      const row = r.data?.enrollment;
      if (row?.payment_status === 'paid') {
        setReference(row.payment_reference || null);
        setStage('done');
        setDone(true);
      } else {
        setStage('pending');
      }
    } catch (err) {
      setStage('pending');
    } finally {
      setPolling(false);
    }
  };

  // Explicit cancel from the pending state. Doesn't mutate anything
  // server-side — the row simply stays 'pending' and shows up in the
  // student's "Pending Payment" list where they can retry later.
  const cancelAndExit = () => {
    confirm({
      title: 'Cancel this enrolment?',
      message: 'The enrolment will stay as "Pending Payment". You can complete it later from Enrolled Programs.',
      variant: 'warning',
      confirmText: 'Yes, exit',
      cancelText: 'Keep waiting',
      onConfirm: () => {
        navigation.reset({
          index: 0,
          routes: [
            { name: 'StudentTabs' },
            { name: 'MyEnrollments' },
          ],
        });
      },
    });
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

  // ── Verifying — polling for the webhook after Razorpay ────────────
  if (stage === 'awaiting' || stage === 'verifying') {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator size="large" color={BRAND} />
        <Text style={styles.verifyingTitle}>
          {stage === 'awaiting' ? 'Waiting for payment…' : 'Verifying payment…'}
        </Text>
        <Text style={styles.verifyingSub}>
          {stage === 'awaiting'
            ? 'Complete the payment in your browser, then come back to Veerify.'
            : "We're confirming your payment with Razorpay. This usually takes a few seconds."}
        </Text>
        {polling ? (
          <Text style={styles.verifyingHint}>
            Not marking your enrolment as paid until the server confirms.
          </Text>
        ) : null}
      </View>
    );
  }

  // ── Pending — poll timed out / user came back without paying ─────
  if (stage === 'pending') {
    return (
      <View style={[styles.screen, styles.centered]}>
        <View style={styles.pendingIconWrap}>
          <AlertCircle size={44} color={AMBER} strokeWidth={2.2} />
        </View>
        <Text style={styles.pendingTitle}>Payment Pending</Text>
        <Text style={styles.pendingSub}>
          We couldn't confirm your payment. Your enrolment is saved as{' '}
          <Text style={{ fontWeight: '800' }}>Pending Payment</Text> and{' '}
          <Text style={{ fontWeight: '800' }}>not yet active</Text>. If you already
          paid, tap Check again — the confirmation may still be on the way.
        </Text>

        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, { marginTop: 20 }]}
          onPress={recheckStatus}
          activeOpacity={0.85}
        >
          <RefreshCw size={16} color="#fff" strokeWidth={2.4} />
          <Text style={styles.btnPrimaryText}>Check again</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.btnGhost, { marginTop: 8 }]}
          onPress={handlePay}
          disabled={paying}
          activeOpacity={0.85}
        >
          <Text style={styles.btnGhostText}>
            {paying ? 'Please wait…' : 'Retry payment'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{ marginTop: 12, paddingVertical: 8 }}
          onPress={cancelAndExit}
          activeOpacity={0.85}
        >
          <Text style={{ color: TEXT_MUTED, fontSize: 12, fontWeight: '700' }}>
            I'll complete this later
          </Text>
        </TouchableOpacity>
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
                value={formatBatchTimeRange(batch.start_time, batch.end_time)}
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

        {/* Amount ── The fee-type chip reflects the course's
            configured billing cycle: "Monthly Fee" by default, or
            "Quarterly Fee" / "Annual Fee" / "One-Time Fee" / etc.
            when the admin has configured a different cadence. Reads
            from the row so the same wording flows through to the
            Razorpay checkout description and the invoice PDF. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Amount</Text>
          <View style={[styles.card, { alignItems: 'center', paddingVertical: 24 }]}>
            <Text style={styles.amountLabel}>Total payable</Text>
            <Text style={styles.amount}>{fmtINR(amount)}</Text>
            <View style={styles.amountChip}>
              <Wallet size={11} color={BRAND} strokeWidth={2.4} />
              <Text style={styles.amountChipText}>
                {billingCycleLabel(
                  enrollment?.course_billing_cycle
                    || batch?.course_billing_cycle
                    || course?.billing_cycle,
                )}
              </Text>
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
              Tap Pay Now to open Razorpay in your browser. Your enrolment stays
              as "Pending Payment" until we receive confirmation from Razorpay.
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
              <Text style={styles.btnPrimaryText}>Pay Now · {fmtINR(amount)}</Text>
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
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },

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

  // Verifying state
  verifyingTitle: {
    fontSize: 18, fontWeight: '800', color: TEXT,
    marginTop: 20, textAlign: 'center',
  },
  verifyingSub: {
    fontSize: 13, color: TEXT_MUTED, fontWeight: '600',
    textAlign: 'center', marginTop: 8, lineHeight: 19,
    maxWidth: 280,
  },
  verifyingHint: {
    fontSize: 11, color: TEXT_MUTED, fontStyle: 'italic',
    textAlign: 'center', marginTop: 12,
  },

  // Pending state
  pendingIconWrap: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: '#FFF7ED',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 8,
  },
  pendingTitle: {
    fontSize: 20, fontWeight: '900', color: TEXT,
    marginTop: 8,
  },
  pendingSub: {
    fontSize: 13, color: TEXT_MUTED, fontWeight: '600',
    textAlign: 'center', marginTop: 8, lineHeight: 20,
    maxWidth: 300,
  },

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
