// src/screens/admin/AccountDeletedScreen.js
//
// Shown when an academy admin logs in but their institution has been soft-
// deleted (either by themselves from the More tab, or by a super-admin from
// the web dashboard).
//
// The owner's user account is still alive — only the institution row is
// flagged with deleted_at. From here they can:
//
//   1. RESTORE — POST /onboarding/me/restore puts the institution back to
//      its previous onboarding_status (active / approved / pending /
//      plan_selected / rejected). Live academies come straight back online.
//
//   2. START FRESH — POST /onboarding/me/start-over hard-deletes the soft-
//      deleted row + cascades children + unlinks the user. They then re-enter
//      the onboarding from PlanSelection with the same login.
//
//   3. Sign out — bail without deciding.
//
// We re-check onboarding status after each action and bounce to the right
// screen so the user doesn't get stuck on this view.

import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import { Trash2, RefreshCw, RotateCcw, LogOut } from 'lucide-react-native';

import { useAuth } from '../../context/AuthContext';
import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';

export default function AccountDeletedScreen() {
  const { logout, refreshOnboardingStatus, institution } = useAuth();
  const [busy, setBusy] = useState(null); // 'restore' | 'startover' | null

  // The institution object on context may carry the deletion metadata from
  // /onboarding/my-status (deleted_at, deletion_source, deletion_reason,
  // prev_onboarding_status). Render whatever we have, but stay friendly when
  // any field is missing.
  const deletedBy = institution?.deletion_source === 'admin'
    ? 'by the Veerify support team'
    : institution?.deletion_source === 'owner'
    ? 'by you'
    : null;
  const reason = institution?.deletion_reason || null;
  const prevStatus = institution?.prev_onboarding_status || null;
  const wasActive = prevStatus === 'active';

  const handleRestore = async () => {
    setBusy('restore');
    try {
      const res = await apiClient.post('/onboarding/me/restore');
      // Pull fresh status so the navigator can re-route us based on the
      // restored onboarding_status.
      await refreshOnboardingStatus();
      Alert.alert(
        'Welcome back',
        res.data?.message || 'Your academy has been restored.',
      );
    } catch (err) {
      Alert.alert(
        'Restore failed',
        err.response?.data?.message || err.message || 'Please try again.',
      );
    } finally {
      setBusy(null);
    }
  };

  const handleStartOver = () => {
    Alert.alert(
      'Start fresh?',
      'This permanently clears the old academy and all its data. You\'ll re-enter setup from the beginning with the same login.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start fresh',
          style: 'destructive',
          onPress: async () => {
            setBusy('startover');
            try {
              await apiClient.post('/onboarding/me/start-over');
              await refreshOnboardingStatus();
            } catch (err) {
              Alert.alert(
                'Could not start over',
                err.response?.data?.message || err.message || 'Please try again.',
              );
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  const handleLogout = () => {
    Alert.alert('Sign out?', 'You can sign back in any time with the same credentials.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.card}>
        <View style={styles.iconBubble}>
          <Trash2 size={32} color={palette.rose.on} strokeWidth={2.2} />
        </View>

        <Text style={styles.title}>Your academy is deleted</Text>
        <Text style={styles.subtitle}>
          {deletedBy
            ? `It was removed ${deletedBy}.`
            : 'It was removed from Veerify.'}{' '}
          Don’t worry — your login still works. Pick what you’d like to do
          next.
        </Text>

        {reason ? (
          <View style={styles.reasonBox}>
            <Text style={styles.reasonLabel}>Reason</Text>
            <Text style={styles.reasonText}>{reason}</Text>
          </View>
        ) : null}

        {institution?.name ? (
          <View style={styles.detailBox}>
            <Text style={styles.detailKey}>Academy</Text>
            <Text style={styles.detailVal}>{institution.name}</Text>
            {prevStatus ? (
              <>
                <Text style={[styles.detailKey, { marginTop: spacing.sm }]}>Previous status</Text>
                <Text style={styles.detailVal}>{prevStatus.replace(/_/g, ' ')}</Text>
              </>
            ) : null}
          </View>
        ) : null}

        {/* ── Restore ── */}
        <TouchableOpacity
          style={[styles.restoreButton, busy && { opacity: 0.6 }]}
          onPress={handleRestore}
          disabled={!!busy}
          activeOpacity={0.9}
        >
          {busy === 'restore' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <RefreshCw size={18} color="#fff" strokeWidth={2.4} />
              <Text style={styles.restoreButtonText}>
                {wasActive ? 'Restore my live academy' : 'Restore my academy'}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* ── Start fresh ── */}
        <TouchableOpacity
          style={[styles.startOverButton, busy && { opacity: 0.6 }]}
          onPress={handleStartOver}
          disabled={!!busy}
          activeOpacity={0.9}
        >
          {busy === 'startover' ? (
            <ActivityIndicator color={palette.purple.on} />
          ) : (
            <>
              <RotateCcw size={18} color={palette.purple.on} strokeWidth={2.4} />
              <Text style={styles.startOverButtonText}>Start fresh</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.fineprint}>
          Restoring brings back every batch, course, trainer and student
          enrollment exactly as they were. Starting fresh permanently wipes
          them.
        </Text>

        <TouchableOpacity style={styles.signOutRow} onPress={handleLogout} disabled={!!busy}>
          <LogOut size={16} color={palette.rose.on} strokeWidth={2.2} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },

  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    ...shadows.card,
  },

  iconBubble: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: palette.rose.soft,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.lg,
  },

  title: {
    ...type.h1,
    color: palette.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...type.body,
    color: palette.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.lg,
  },

  reasonBox: {
    width: '100%',
    backgroundColor: palette.rose.soft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  reasonLabel: {
    ...type.micro,
    color: palette.rose.on,
    fontWeight: '700',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  reasonText: { ...type.body, color: palette.text },

  detailBox: {
    width: '100%',
    backgroundColor: palette.borderSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  detailKey: { ...type.micro, color: palette.textMuted, textTransform: 'uppercase' },
  detailVal: { ...type.bodyBold, color: palette.text },

  restoreButton: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: palette.purple.vivid,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  restoreButtonText: { ...type.bodyBold, color: '#fff' },

  startOverButton: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: palette.purple.soft,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  startOverButtonText: { ...type.bodyBold, color: palette.purple.on, fontWeight: '700' },

  fineprint: {
    ...type.caption,
    color: palette.textLight,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.lg,
  },

  signOutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
  },
  signOutText: { ...type.bodyBold, color: palette.rose.on, fontWeight: '700' },
});
