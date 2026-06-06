// src/screens/student/CertificateDetailScreen.js
//
// Read-only styled certificate view with a QR code that verifies the
// certificate via /api/certificates/verify/:qr_token. Tap Share to forward
// the verification URL.
//
// QR rendering: we use the free api.qrserver.com endpoint as an <Image>
// source so we don't pull in an extra dependency.

import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Image, Share, Alert,
} from 'react-native';
import {
  ArrowLeft, Share2, Award, Calendar, CheckCircle2, AlertCircle, FileText,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}

// We point the QR at the verify endpoint on the backend so a future web
// verification page can render it. For now the QR data is the URL itself —
// a browser can hit it to see JSON proof.
function buildVerifyUrl(cert) {
  const base = (apiClient?.defaults?.baseURL || '').replace(/\/api\/?$/, '');
  return `${base}/api/certificates/verify/${cert.qr_token}`;
}

function buildQrSrc(text) {
  // 240x240 px QR PNG, free CORS-friendly service.
  const enc = encodeURIComponent(text || '');
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&qzone=1&data=${enc}`;
}

export default function CertificateDetailScreen({ navigation, route }) {
  const cert = route?.params?.certificate || null;

  if (!cert) {
    return (
      <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text>Certificate not available.</Text>
      </View>
    );
  }

  const verifyUrl = buildVerifyUrl(cert);
  const qrSrc     = buildQrSrc(verifyUrl);

  const onShare = async () => {
    try {
      await Share.share({
        message:
          `${cert.title}\n\n` +
          `Issued to: ${cert.student_name || 'Student'}\n` +
          `By: ${cert.institution_name || 'Academy'}\n` +
          `Date: ${fmtDate(cert.issue_date)}\n` +
          `Certificate ID: ${cert.certificate_no}\n\n` +
          `Verify: ${verifyUrl}`,
      });
    } catch {}
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft size={20} color={palette.dark} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Certificate</Text>
          <Text style={styles.headerSubtitle}>{cert.title}</Text>
        </View>
        <TouchableOpacity onPress={onShare} style={styles.shareBtn} activeOpacity={0.85}>
          <Share2 size={16} color="#fff" strokeWidth={2.4} />
          <Text style={styles.shareText}>Share</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Verification banner */}
        <View
          style={[
            styles.verifyBanner,
            cert.status === 'verified' ? styles.verifyOk : styles.verifyBad,
          ]}
        >
          {cert.status === 'verified' ? (
            <CheckCircle2 size={16} color="#15803D" strokeWidth={2.4} />
          ) : (
            <AlertCircle size={16} color="#991B1B" strokeWidth={2.4} />
          )}
          <Text
            style={[
              styles.verifyText,
              { color: cert.status === 'verified' ? '#15803D' : '#991B1B' },
            ]}
          >
            {cert.status === 'verified'
              ? 'Verified certificate'
              : 'This certificate has been revoked'}
          </Text>
        </View>

        {/* The certificate card */}
        <View style={styles.cert}>
          <View style={styles.certBorder}>
            <Text style={styles.certEyebrow}>CERTIFICATE OF ACHIEVEMENT</Text>

            <Text style={styles.certIntro}>This certifies that</Text>
            <Text style={styles.certName}>{cert.student_name || 'Student'}</Text>

            <Text style={styles.certIntro}>has successfully achieved</Text>
            <Text style={styles.certAchievement}>{cert.title}</Text>

            <View style={styles.certMetaGrid}>
              <View style={{ flex: 1 }}>
                <Text style={styles.metaLabel}>Issued by</Text>
                <Text style={styles.metaValue}>{cert.institution_name || '—'}</Text>
              </View>
              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                <Text style={styles.metaLabel}>Date</Text>
                <Text style={styles.metaValue}>{fmtDate(cert.issue_date)}</Text>
              </View>
            </View>

            {cert.instructor_name ? (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Instructor</Text>
                <Text style={styles.metaValue}>{cert.instructor_name}</Text>
              </View>
            ) : null}

            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Certificate ID</Text>
              <Text style={[styles.metaValue, styles.mono]}>{cert.certificate_no}</Text>
            </View>

            {/* QR */}
            <View style={styles.qrWrap}>
              <Image source={{ uri: qrSrc }} style={styles.qr} resizeMode="contain" />
              <Text style={styles.qrCaption}>Scan to verify</Text>
            </View>

            {/* Signature / seal */}
            <View style={styles.signatureRow}>
              <View style={styles.signatureCol}>
                {cert.signature_url ? (
                  <Image
                    source={{ uri: cert.signature_url }}
                    style={styles.signatureImg}
                    resizeMode="contain"
                  />
                ) : (
                  <View style={styles.signatureLine} />
                )}
                <Text style={styles.signatureCaption}>Instructor signature</Text>
              </View>
              <View style={styles.signatureCol}>
                {cert.academy_seal_url ? (
                  <Image
                    source={{ uri: cert.academy_seal_url }}
                    style={styles.signatureImg}
                    resizeMode="contain"
                  />
                ) : (
                  <View style={styles.sealCircle}>
                    <Award size={20} color={palette.purple.vivid} />
                  </View>
                )}
                <Text style={styles.signatureCaption}>Academy seal</Text>
              </View>
            </View>
          </View>
        </View>

        <Text style={styles.verifyHint}>
          Anyone can verify this certificate by scanning the QR or visiting
          the URL below:
        </Text>
        <Text selectable style={styles.verifyUrl}>{verifyUrl}</Text>

        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingTop: 48, paddingHorizontal: spacing.xl, paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    borderBottomWidth: 1, borderBottomColor: palette.borderSoft,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: palette.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: palette.dark },
  headerSubtitle: { fontSize: 12, color: palette.textLight, marginTop: 1 },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: palette.purple.vivid,
    borderRadius: 999,
  },
  shareText: { color: '#fff', fontWeight: '800', fontSize: 12 },

  scrollContent: { padding: spacing.xl },

  verifyBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  verifyOk: { backgroundColor: '#DCFCE7' },
  verifyBad: { backgroundColor: '#FEE2E2' },
  verifyText: { fontSize: 13, fontWeight: '800' },

  cert: {
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    padding: 6,
    ...shadows.raised,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  certBorder: {
    borderWidth: 2, borderColor: palette.purple.vivid,
    borderRadius: radius.lg,
    padding: 18,
    alignItems: 'center',
  },
  certEyebrow: {
    fontSize: 10, color: palette.purple.vivid, fontWeight: '800',
    letterSpacing: 2, textTransform: 'uppercase',
  },
  certIntro: {
    fontSize: 12, color: palette.textLight,
    marginTop: 14, marginBottom: 6,
    fontStyle: 'italic',
  },
  certName: {
    fontSize: 22, fontWeight: '800', color: palette.dark,
    textAlign: 'center', marginBottom: 6,
    fontFamily: 'serif',
  },
  certAchievement: {
    fontSize: 18, fontWeight: '800', color: palette.purple.vivid,
    textAlign: 'center', marginBottom: 16,
    fontFamily: 'serif',
  },
  certMetaGrid: {
    flexDirection: 'row', gap: 10, width: '100%',
    paddingTop: 12, borderTopWidth: 1, borderTopColor: palette.borderSoft,
    marginTop: 10,
  },
  metaRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    width: '100%', marginTop: 8,
  },
  metaLabel: {
    fontSize: 10, color: palette.textLight, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  metaValue: { fontSize: 13, color: palette.dark, fontWeight: '700', marginTop: 2 },
  mono: { fontFamily: 'monospace', letterSpacing: 0.8 },

  qrWrap: { alignItems: 'center', marginTop: 18 },
  qr: { width: 130, height: 130, borderRadius: 8 },
  qrCaption: { fontSize: 10, color: palette.textLight, marginTop: 4, fontWeight: '700' },

  signatureRow: {
    flexDirection: 'row', gap: 16,
    marginTop: 20, width: '100%',
  },
  signatureCol: { flex: 1, alignItems: 'center' },
  signatureLine: {
    width: '80%', height: 1, backgroundColor: palette.dark, marginBottom: 6,
  },
  signatureImg: { width: 80, height: 50, marginBottom: 4 },
  sealCircle: {
    width: 54, height: 54, borderRadius: 27,
    borderWidth: 2, borderColor: palette.purple.vivid,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  signatureCaption: { fontSize: 9, color: palette.textLight, fontWeight: '700' },

  verifyHint: { fontSize: 11, color: palette.textLight, marginTop: 14 },
  verifyUrl: {
    fontSize: 11, color: palette.purple.vivid, fontWeight: '700',
    fontFamily: 'monospace', marginTop: 4,
  },
});
