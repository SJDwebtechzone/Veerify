// src/screens/student/StudentCertificatesScreen.js
//
// Student Login → Certificates. Two sections:
//   1. Awaiting Certificate — course_completions rows the trainer /
//      institution admin haven't dispatched yet. Student sees the
//      course, remarks state, and reason for the wait.
//   2. Certificates — every dispatched certificate. Tap a card to view
//      full-screen, Download, or Share.
//
// Backend:
//   GET /api/certificates/my → { certificates, awaiting }

import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl, Alert, Linking, Share,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Award, Clock,
  ShieldCheck,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
import resolveAssetUrl from '../../utils/assetUrl';
// Display-only belt normalization. Legacy belt certificates were
// stored with titles like "Black Belt"; the list shows just "Black".
import { stripBeltSuffix } from '../../utils/beltDisplay';
// Public verify URL builder — resolves to /certificates/verify/:token
// (never the raw /api/... JSON endpoint).
import buildPublicVerifyUrl from '../../utils/certificateVerify';

// Best-effort display helper for a belt-typed certificate title.
// Non-belt certs (tournament / completion / achievement) pass
// through untouched.
function displayCertTitle(cert) {
  if (!cert) return '';
  const raw = cert.title || '';
  if (cert.kind === 'belt') return stripBeltSuffix(raw) || raw;
  return raw;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export default function StudentCertificatesScreen({ navigation }) {
  const [certs, setCerts]     = useState([]);
  const [awaits, setAwaits]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get('/certificates/my');
      setCerts(r.data?.certificates || []);
      setAwaits(r.data?.awaiting || []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log('[StudentCertificates] load error:', err?.response?.data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const shareCert = async (cert) => {
    try {
      // Public HTML verifier — safe to share externally. Never link
      // out to the raw /api/... JSON endpoint.
      const verifyUrl = buildPublicVerifyUrl(cert);
      const courseName = displayCertTitle(cert) || 'Certificate';
      const instName = cert.institution_name || 'Academy';
      let msg = `🎓 ${courseName}\nIssued by: ${instName}\nDate: ${fmtDate(cert.issue_date)}`;
      if (cert.certificate_no) msg += `\nCertificate No: ${cert.certificate_no}`;
      if (verifyUrl) msg += `\n\nVerify: ${verifyUrl}`;
      await Share.share({ title: courseName, message: msg, url: verifyUrl });
    } catch (err) {
      // User cancelled — ignore
    }
  };

  const openDownload = async (cert) => {
    const url = cert.render_url ? resolveAssetUrl(cert.render_url) : null;
    if (url) {
      try { await Linking.openURL(url); } catch {
        Alert.alert('Error', 'Could not open the certificate file.');
      }
    } else {
      Alert.alert('Not yet available', 'Your academy is still preparing the file. Try again in a moment.');
    }
  };

  const openDetail = (cert) => {
    navigation.navigate('CertificateDetail', { certificate: cert });
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8}>
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Certificates</Text>
          <Text style={styles.subtitle}>
            {certs.length} issued · {awaits.length} awaiting
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={palette.purple.vivid} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={palette.purple.vivid}
            />
          }
        >
          {/* Awaiting section */}
          {awaits.length > 0 ? (
            <View style={{ marginBottom: spacing.lg }}>
              <Text style={styles.sectionTitle}>AWAITING CERTIFICATE</Text>
              {awaits.map((a) => (
                <View key={`await-${a.id}`} style={[styles.card, styles.awaitCard]}>
                  <View style={styles.rowHead}>
                    <View style={[styles.iconTile, { backgroundColor: palette.orange.soft }]}>
                      <Clock size={16} color={palette.orange.on} strokeWidth={2.4} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.courseName} numberOfLines={1}>{a.course_name}</Text>
                      <Text style={styles.subMeta} numberOfLines={1}>{a.institution_name || ''}</Text>
                    </View>
                    <View style={styles.awaitPill}>
                      <Text style={styles.awaitPillText}>Awaiting</Text>
                    </View>
                  </View>
                  <Text style={styles.awaitBody}>
                    {a.status === 'awaiting_test'
                      ? `You've finished the curriculum — your trainer will submit belt-test remarks shortly.`
                      : `Belt test done on ${fmtDate(a.belt_test_completed_at)}. Waiting for your academy to send the certificate.`}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Issued section */}
          <Text style={styles.sectionTitle}>ISSUED CERTIFICATES</Text>
          {certs.length === 0 ? (
            <View style={styles.emptyCard}>
              <Award size={32} color={palette.textLight} strokeWidth={1.6} />
              <Text style={styles.emptyTitle}>Nothing here yet</Text>
              <Text style={styles.emptySub}>
                Certificates issued by your academy will appear here.
              </Text>
            </View>
          ) : (
            certs.map((c) => (
              <View key={c.id} style={styles.card}>
                <View style={styles.rowHead}>
                  <View style={[styles.iconTile, { backgroundColor: palette.green.soft }]}>
                    <ShieldCheck size={16} color={palette.green.on} strokeWidth={2.4} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.courseName} numberOfLines={1}>{displayCertTitle(c)}</Text>
                    <Text style={styles.subMeta} numberOfLines={1}>
                      {c.institution_name || ''}  ·  {fmtDate(c.issue_date)}
                    </Text>
                    {c.certificate_no ? (
                      <Text style={styles.certNo} numberOfLines={1}>
                        No. {c.certificate_no}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <View style={styles.actionRow}>
                  <ActionBtn label="View"     onPress={() => openDetail(c)}      accent={palette.purple} />
                  <ActionBtn label="Download" onPress={() => openDownload(c)}    accent={palette.blue} />
                  <ActionBtn label="Share"    onPress={() => shareCert(c)}       accent={palette.green} />
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}


function ActionBtn({ label, onPress, accent }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.actionBtn, { backgroundColor: accent.soft }]}
    >
      <Text style={[styles.actionBtnText, { color: accent.on }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    ...shadows.card,
    gap: spacing.md,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.borderSoft,
  },
  title:    { ...type.h1, color: palette.text, fontSize: 18 },
  subtitle: { ...type.caption, color: palette.textMuted, marginTop: 1 },

  sectionTitle: {
    ...type.micro, color: palette.textMuted,
    fontWeight: '800', letterSpacing: 0.6,
    marginBottom: 8,
  },

  emptyCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.xxl,
    alignItems: 'center', gap: 6,
    ...shadows.card,
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, marginTop: 6 },
  emptySub:   { ...type.caption, color: palette.textMuted, textAlign: 'center' },

  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  awaitCard: { borderWidth: 1, borderColor: palette.orange.soft },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconTile: {
    width: 38, height: 38, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  courseName: { ...type.bodyBold, color: palette.text, fontSize: 15 },
  subMeta:    { ...type.micro, color: palette.textMuted, fontWeight: '700', marginTop: 2 },
  certNo:     { ...type.micro, color: palette.textLight, marginTop: 2, fontWeight: '700' },

  awaitPill: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
    backgroundColor: palette.orange.soft,
  },
  awaitPillText: {
    fontSize: 10, fontWeight: '800', color: palette.orange.on,
    letterSpacing: 0.4, textTransform: 'uppercase',
  },
  awaitBody: {
    ...type.caption, color: palette.textMuted,
    marginTop: spacing.md, lineHeight: 18,
  },

  actionRow: {
    flexDirection: 'row', gap: 6, marginTop: spacing.md,
  },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999,
  },
  actionBtnText: { fontSize: 12, fontWeight: '800' },

  viewer: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center', padding: spacing.lg,
  },
  viewerClose: {
    position: 'absolute', top: 40, right: 20,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
});
