// src/screens/shared/SupportScreen.js
//
// Support screen — reached from the More / Profile tab on every role.
//
// Layout (top → bottom):
//   1. Header — back button + "Support" title.
//   2. App Support card — Veerify platform team address, taps to mailto.
//   3. Institution Support card — only for student / trainer roles. Shows
//      the caller's OWN institution's registered email (fetched from
//      /institutions/me/support-email, no hardcoding). Falls back to
//      "Institution support email not available." when the row has no
//      email. Institution admins do NOT see this card.
//
// The App Support address is a compile-time constant — every install
// contacts the same platform team.

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, Linking, Alert,
} from 'react-native';
import {
  ArrowLeft, LifeBuoy, Mail, Building2, ChevronRight, HelpCircle,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { palette, spacing, radius, shadows, type } from '../../theme';

// Platform support address — the mailbox the Veerify team monitors.
// Kept as a const so the same value appears everywhere the app
// references it (and grep still turns it up).
const APP_SUPPORT_EMAIL = 'support@veerifyapp.com';

export default function SupportScreen({ navigation }) {
  const { user } = useAuth();
  const role = (user?.role || '').toLowerCase();
  // Only students and trainers see the Institution Support card. Admins
  // (institution owners / staff) manage the address themselves so
  // showing it back to them would be redundant.
  const showInstitutionCard = role === 'student' || role === 'trainer';

  const [loading, setLoading]           = useState(showInstitutionCard);
  const [supportEmail, setSupportEmail] = useState(null);
  const [instName, setInstName]         = useState(null);

  const load = useCallback(async () => {
    if (!showInstitutionCard) return;
    try {
      // Backend resolves the caller's own institution (walking up to
      // the parent for sub-branch enrolments) so this endpoint is safe
      // for every role without leaking other institutions' data.
      const r = await apiClient.get('/institutions/me/support-email');
      setSupportEmail(r.data?.support_email || null);
      setInstName(r.data?.institution_name || null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log('[Support] load error:', err?.response?.data || err?.message);
      setSupportEmail(null);
      setInstName(null);
    } finally {
      setLoading(false);
    }
  }, [showInstitutionCard]);
  useEffect(() => { load(); }, [load]);

  const openMailto = (address) => {
    if (!address) return;
    Linking.openURL(`mailto:${address}`).catch(() => {
      Alert.alert('Could not open email', `Please email ${address} from your mail app.`);
    });
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8}>
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Support</Text>
          <Text style={styles.subtitle}>Reach the right team fast</Text>
        </View>
        <View style={styles.headerIcon}>
          <LifeBuoy size={18} color={palette.purple.vivid} strokeWidth={2.2} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── App Support ─────────────────────────────────────────
            The Veerify platform team — same address for every user
            regardless of role or institution. Tap opens the OS mail
            composer via mailto:. */}
        <SupportRow
          icon={LifeBuoy}
          accent={palette.purple}
          title="App Support"
          hint="Bugs, sign-in issues, or general questions about Veerify"
          address={APP_SUPPORT_EMAIL}
          onPress={() => openMailto(APP_SUPPORT_EMAIL)}
        />

        {/* ── Institution Support ───────────────────────────────
            Student / trainer only. Populated from the caller's own
            institution row (the email entered during academy
            registration). When the row has no email we render a
            calm not-available note instead of a broken tap target. */}
        {showInstitutionCard ? (
          loading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="small" color={palette.purple.vivid} />
              <Text style={styles.loadingText}>Loading academy contact…</Text>
            </View>
          ) : supportEmail ? (
            <SupportRow
              icon={Building2}
              accent={palette.blue}
              title="Institution Support"
              hint={
                instName
                  ? `Reach out to ${instName} directly for classes, fees, or attendance`
                  : 'Reach your academy for classes, fees, or attendance'
              }
              address={supportEmail}
              onPress={() => openMailto(supportEmail)}
            />
          ) : (
            <View style={styles.emptyCard}>
              <View style={[styles.emptyIcon, { backgroundColor: palette.blue.soft }]}>
                <Building2 size={18} color={palette.blue.on} strokeWidth={2.2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.emptyTitle}>Institution Support</Text>
                <Text style={styles.emptyText}>
                  Institution support email not available.
                </Text>
              </View>
            </View>
          )
        ) : null}

        {/* ── FAQ shortcut ────────────────────────────────────────
            Cheaper than a support ticket for common questions.
            Tapping opens the shared FAQ browser — content is
            managed on the super-admin web panel and filtered on
            the caller's role. */}
        <TouchableOpacity
          onPress={() => navigation.navigate('Faq')}
          activeOpacity={0.85}
          style={[styles.card, { marginTop: spacing.sm }]}
        >
          <View style={[styles.cardIcon, { backgroundColor: palette.orange.soft }]}>
            <HelpCircle size={20} color={palette.orange.vivid} strokeWidth={2.2} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.cardTitle}>Browse FAQs</Text>
            <Text style={styles.cardHint} numberOfLines={2}>
              Common questions answered — searchable by keyword or topic.
            </Text>
          </View>
          <ChevronRight size={18} color={palette.textMuted} strokeWidth={2.2} />
        </TouchableOpacity>

        <Text style={styles.footNote}>
          We usually reply within 1–2 working days.
        </Text>
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SupportRow — one tappable card per address. Left icon + title +
// subtitle over the address, chevron on the right so the tap target
// reads as "open".
// ─────────────────────────────────────────────────────────────────────
function SupportRow({ icon: Icon, accent, title, hint, address, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.card}>
      <View style={[styles.cardIcon, { backgroundColor: accent.soft }]}>
        <Icon size={20} color={accent.vivid} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardHint} numberOfLines={2}>{hint}</Text>
        <View style={styles.addressRow}>
          <Mail size={12} color={accent.on} strokeWidth={2.4} />
          <Text style={[styles.address, { color: accent.on }]} numberOfLines={1}>
            {address}
          </Text>
        </View>
      </View>
      <ChevronRight size={18} color={palette.textMuted} strokeWidth={2.2} />
    </TouchableOpacity>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    ...shadows.card,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.borderSoft,
  },
  title:    { ...type.h1, color: palette.text, fontSize: 18 },
  subtitle: { ...type.caption, color: palette.textMuted, marginTop: 1 },
  headerIcon: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.purple.soft,
  },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  cardIcon: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { ...type.bodyBold, color: palette.text, fontSize: 15, fontWeight: '800' },
  cardHint:  { ...type.caption, color: palette.textMuted, marginTop: 2, lineHeight: 18 },
  addressRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: spacing.sm,
  },
  address: { fontSize: 13, fontWeight: '700' },

  loadingCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  loadingText: { ...type.caption, color: palette.textMuted },

  emptyCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1, borderColor: palette.borderSoft,
    borderStyle: 'dashed',
  },
  emptyIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, fontSize: 14 },
  emptyText:  { ...type.caption, color: palette.textMuted, marginTop: 2 },

  footNote: {
    ...type.caption,
    color: palette.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
    lineHeight: 18,
    paddingHorizontal: spacing.md,
  },
});
