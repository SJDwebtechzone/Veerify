// src/screens/DeleteAccountScreen.js
//
// Self-service account deletion flow. Reached from More → Delete
// Account (institution admin) — the same screen is registered in the
// root navigator so any future role that surfaces the entry point
// can reuse it.
//
// Flow:
//   1. Warning card explains what will happen.
//   2. Password re-entry input (guards against session hijack).
//   3. Optional "Reason" input for the deletion audit trail.
//   4. Tap "Delete Account" → branded confirm dialog with the exact
//      copy the spec requires ("Are you sure you want to permanently
//      delete your account? This action cannot be undone.").
//   5. On confirm → POST /auth/delete-account with password.
//   6. On success → branded success dialog → logout + navigate to
//      Welcome. The JWT is discarded on the device; the server has
//      anonymised the users row so any leaked copy of the token
//      returns 401 on the next hit.

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import {
  ArrowLeft, AlertTriangle, ShieldAlert, Eye, EyeOff, Trash2,
} from 'lucide-react-native';

import apiClient from '../api/client';
import { useAuth } from '../context/AuthContext';
import { confirm } from '../components/ConfirmDialog';

const BRAND      = '#E63946';
const BRAND_SOFT = '#FEE2E2';
const TEXT       = '#111827';
const TEXT_MUTED = '#6B7280';
const TEXT_LIGHT = '#9CA3AF';
const SURFACE    = '#FFFFFF';
const BG         = '#F4F4F8';
const BORDER     = '#E5E7EB';
const AMBER      = '#F59E0B';
const AMBER_SOFT = '#FEF3C7';

export default function DeleteAccountScreen({ navigation }) {
  const { logout } = useAuth();
  const [password, setPassword]   = useState('');
  const [reason,   setReason]     = useState('');
  const [showPass, setShowPass]   = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const doDelete = async () => {
    setSubmitting(true);
    try {
      await apiClient.post('/auth/delete-account', {
        password: password.trim(),
        reason:   reason.trim() || undefined,
      });
      // Success — surface the exact copy the spec requires, then
      // logout + route to Welcome. `logout()` clears AsyncStorage +
      // AuthContext, which triggers the AppNavigator to re-render
      // the auth stack.
      confirm({
        title:       'Account deleted',
        message:     'Your account has been deleted successfully.',
        variant:     'success',
        confirmText: 'OK',
        hideCancel:  true,
        onConfirm:   () => {
          try { logout(); } catch (_) { /* logout handles nav internally */ }
        },
      });
    } catch (err) {
      const code = err?.response?.data?.code;
      const msg  = err?.response?.data?.message || err?.message || 'Try again.';
      if (code === 'INVALID_PASSWORD') {
        confirm({
          title:       'Password incorrect',
          message:     'The password you entered is incorrect. Try again.',
          variant:     'warning',
          confirmText: 'OK',
          hideCancel:  true,
        });
      } else if (code === 'INSTITUTION_STILL_ACTIVE') {
        confirm({
          title:       "Can't delete right now",
          message:     msg,
          variant:     'warning',
          confirmText: 'Got it',
          hideCancel:  true,
        });
      } else {
        confirm({
          title:       'Could not delete',
          message:     msg,
          variant:     'destructive',
          confirmText: 'OK',
          hideCancel:  true,
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handlePress = () => {
    if (!password.trim()) {
      confirm({
        title:       'Password required',
        message:     'Please re-enter your account password to confirm deletion.',
        variant:     'warning',
        confirmText: 'OK',
        hideCancel:  true,
      });
      return;
    }
    // Spec-mandated confirmation dialog. Exact copy per the ticket.
    confirm({
      title:       'Delete Account',
      message:
        'Are you sure you want to permanently delete your account? ' +
        'This action cannot be undone.',
      variant:     'destructive',
      confirmText: 'Delete Account',
      cancelText:  'Cancel',
      onConfirm:   doDelete,
    });
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8}>
          <ArrowLeft size={20} color={TEXT} strokeWidth={2.2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Delete Account</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Warning card */}
        <View style={styles.warnCard}>
          <View style={styles.warnIconWrap}>
            <ShieldAlert size={22} color={BRAND} strokeWidth={2.2} />
          </View>
          <Text style={styles.warnTitle}>
            Permanent — cannot be undone
          </Text>
          <Text style={styles.warnBody}>
            Deleting your account permanently removes your profile from Veerify.
            Personal details are erased; payment invoices we're legally required
            to retain will keep the minimum data needed for tax records.
          </Text>
          <View style={styles.warnList}>
            <WarnBullet>All your active sessions will be signed out.</WarnBullet>
            <WarnBullet>Your name, email, phone, and profile photo are wiped.</WarnBullet>
            <WarnBullet>You will lose access to the app on every device immediately.</WarnBullet>
            <WarnBullet>Course enrolments + payment history are anonymised, not removed.</WarnBullet>
          </View>
        </View>

        {/* Password field */}
        <Text style={styles.label}>Confirm your password</Text>
        <Text style={styles.hint}>
          Enter your current password to prove it's you.
        </Text>
        <View style={styles.passRow}>
          <TextInput
            style={styles.passInput}
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            placeholderTextColor={TEXT_LIGHT}
            secureTextEntry={!showPass}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={styles.eyeBtn}
            onPress={() => setShowPass((s) => !s)}
            hitSlop={8}
          >
            {showPass ? (
              <EyeOff size={18} color={TEXT_MUTED} strokeWidth={2.2} />
            ) : (
              <Eye size={18} color={TEXT_MUTED} strokeWidth={2.2} />
            )}
          </TouchableOpacity>
        </View>

        {/* Reason — optional */}
        <Text style={[styles.label, { marginTop: 20 }]}>Reason (optional)</Text>
        <Text style={styles.hint}>
          Share why you're leaving — helps us improve. Never shown to other users.
        </Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          value={reason}
          onChangeText={setReason}
          placeholder="e.g. Switching to a different platform, no longer running the academy…"
          placeholderTextColor={TEXT_LIGHT}
          multiline
          numberOfLines={3}
          maxLength={500}
          textAlignVertical="top"
        />

        {/* Amber note about retained records */}
        <View style={styles.retainNote}>
          <AlertTriangle size={14} color={AMBER} strokeWidth={2.4} />
          <Text style={styles.retainNoteText}>
            Legal + financial records (payments, invoices, subscriptions,
            certificates) are retained per applicable law with the minimum
            personal data required.
          </Text>
        </View>
      </ScrollView>

      {/* Footer — destructive CTA */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.deleteBtn, submitting && { opacity: 0.7 }]}
          onPress={handlePress}
          disabled={submitting}
          activeOpacity={0.9}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Trash2 size={16} color="#fff" strokeWidth={2.4} />
              <Text style={styles.deleteBtnText}>Delete Account</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={() => navigation.goBack()}
          disabled={submitting}
          activeOpacity={0.85}
        >
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function WarnBullet({ children }) {
  return (
    <View style={styles.warnBullet}>
      <View style={styles.warnDot} />
      <Text style={styles.warnBulletText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 44, paddingBottom: 12,
    backgroundColor: SURFACE,
    borderBottomWidth: 1, borderBottomColor: BORDER,
    gap: 10,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '800', color: TEXT },

  body: { padding: 16, paddingBottom: 32 },

  warnCard: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1, borderColor: BRAND_SOFT,
    marginBottom: 24,
  },
  warnIconWrap: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 10,
  },
  warnTitle: { fontSize: 15, fontWeight: '800', color: BRAND, marginBottom: 6 },
  warnBody:  { fontSize: 12, color: TEXT_MUTED, lineHeight: 18, marginBottom: 10 },
  warnList:  { gap: 6, marginTop: 4 },
  warnBullet:{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  warnDot:   {
    width: 5, height: 5, borderRadius: 3, backgroundColor: BRAND,
    marginTop: 7,
  },
  warnBulletText: { flex: 1, fontSize: 12, color: TEXT_MUTED, lineHeight: 17 },

  label: { fontSize: 13, fontWeight: '800', color: TEXT, marginBottom: 4 },
  hint:  { fontSize: 12, color: TEXT_MUTED, marginBottom: 8, lineHeight: 17 },

  input: {
    borderWidth: 1, borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: SURFACE,
    fontSize: 14, color: TEXT,
  },
  textarea: { minHeight: 84 },

  passRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: BORDER,
    borderRadius: 10,
    backgroundColor: SURFACE,
  },
  passInput: {
    flex: 1,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: TEXT,
  },
  eyeBtn: { paddingHorizontal: 12, paddingVertical: 10 },

  retainNote: {
    flexDirection: 'row', gap: 8,
    marginTop: 20,
    padding: 12,
    borderRadius: 10,
    backgroundColor: AMBER_SOFT,
    borderWidth: 1, borderColor: '#FDE68A',
  },
  retainNoteText: {
    flex: 1, fontSize: 11, color: '#78350F', lineHeight: 16, fontWeight: '600',
  },

  footer: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 22,
    backgroundColor: SURFACE,
    borderTopWidth: 1, borderTopColor: BORDER,
    gap: 8,
  },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8,
    backgroundColor: BRAND,
    paddingVertical: 14, borderRadius: 12,
  },
  deleteBtnText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  cancelBtn: {
    paddingVertical: 12, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  cancelBtnText: { fontSize: 14, fontWeight: '700', color: TEXT_MUTED },
});
