// src/screens/student/CertificateDetailScreen.js
//
// Renders the CERTIFICATE THE INSTITUTION DISPATCHED — no more
// auto-generated "CERTIFICATE OF ACHIEVEMENT" boilerplate, no more
// inline QR overlay that ends up wrong when the qr_token can't be
// resolved. The layout is a 1:1 replay of the admin's template
// canvas:
//
//   • Background image = certificate_templates.background_url
//     (canvas_width × canvas_height defines the aspect ratio)
//   • Each active placeholder pin from placeholder_data renders at
//     its normalised (x, y) with the merged VALUE (for text pins)
//     or IMAGE_URL (for signature / seal). This matches exactly
//     what the admin approved in the preview modal and dispatched
//     via POST /course-completions/:id/send-certificate.
//
// Fallback: when the certificate has no template_id (older rows or
// a template that was deleted), we show a plain informational card
// with the certificate's key metadata — no fake artwork.
//
// The header "Share" action still shares the verification link so
// third parties can confirm the certificate at
// /api/certificates/verify/:qr_token.

import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Image, Share,
  Alert, Linking, Dimensions, ActivityIndicator,
} from 'react-native';
import {
  ArrowLeft, Share2, Award, Calendar, CheckCircle2, AlertCircle,
  Download,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
import resolveAssetUrl from '../../utils/assetUrl';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}

function buildVerifyUrl(cert) {
  if (!cert?.qr_token) return null;
  const base = (apiClient?.defaults?.baseURL || '').replace(/\/api\/?$/, '');
  return `${base}/api/certificates/verify/${cert.qr_token}`;
}

// ── Placeholder pin renderer ──────────────────────────────────────
// One replay of the admin template canvas. Pins carry:
//   x, y                 — normalised 0-1 position (centre-anchored)
//   font_size, color,    — text style (defaults match the editor)
//   align, bold, italic
//   value                — merged student data (from send-certificate)
//   image_url            — resolved URL for signature / seal
//   width, height        — normalised 0-1 sizing (image pins only)
//   active               — false = hide (already filtered upstream)
function TemplatePin({ pin, canvasW, canvasH }) {
  const isImage = pin?.key === 'digital_signature' || pin?.key === 'seal';

  if (isImage) {
    const w = Math.max(40, (pin.width  || 0.20) * canvasW);
    const h = Math.max(24, (pin.height || 0.10) * canvasH);
    const left = pin.x * canvasW - w / 2;
    const top  = pin.y * canvasH - h / 2;
    const uri  = pin.image_url ? resolveAssetUrl(pin.image_url) : null;
    if (!uri) return null;
    return (
      <View style={{ position: 'absolute', left, top, width: w, height: h }}>
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
        />
      </View>
    );
  }

  const text = (pin.value != null && pin.value !== '')
    ? String(pin.value)
    : '';
  if (!text) return null; // Blank placeholder — hide per spec.

  const fontSize = Math.max(8, Number(pin.font_size) || 16);
  // Estimate text-box width so we can centre / left / right align
  // exactly like the admin canvas — no bounding box crop.
  const est = Math.max(60, text.length * fontSize * 0.55);
  const left = pin.x * canvasW - est / 2;
  const top  = pin.y * canvasH - fontSize;

  return (
    <Text
      numberOfLines={2}
      style={{
        position: 'absolute',
        left, top,
        width: est,
        fontSize,
        fontWeight: pin.bold ? '800' : '600',
        fontStyle: pin.italic ? 'italic' : 'normal',
        color: pin.color || '#111827',
        textAlign: pin.align || 'center',
      }}
    >
      {text}
    </Text>
  );
}

export default function CertificateDetailScreen({ navigation, route }) {
  const cert = route?.params?.certificate || null;
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  if (!cert) {
    return (
      <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text>Certificate not available.</Text>
      </View>
    );
  }

  const verifyUrl = buildVerifyUrl(cert);

  // Template artwork + canvas dimensions. When any of these is
  // missing (old row, template deleted) we fall through to the
  // metadata-only card below.
  const bgUri = cert.template_background_url
    ? resolveAssetUrl(cert.template_background_url)
    : null;
  const canvasW = Number(cert.template_canvas_width)  || 1000;
  const canvasH = Number(cert.template_canvas_height) || 700;
  const hasTemplate = !!bgUri;

  // Scale the canvas to the phone width while keeping the exact
  // aspect ratio the admin designed against — placeholder pins keep
  // their positions because they're stored as 0-1 relative values.
  const screenW = Dimensions.get('window').width;
  const canvasScreenW = screenW - spacing.xl * 2;
  const canvasScreenH = (canvasScreenW * canvasH) / canvasW;

  const placeholders = useMemo(() => {
    if (!Array.isArray(cert.placeholder_data)) return [];
    return cert.placeholder_data.filter((p) => p && p.active !== false);
  }, [cert.placeholder_data]);

  const onShare = async () => {
    try {
      const msg = [
        cert.title || 'Certificate',
        `Issued to: ${cert.student_name || 'Student'}`,
        `By: ${cert.institution_name || 'Academy'}`,
        `Date: ${fmtDate(cert.issue_date)}`,
        cert.certificate_no ? `Certificate ID: ${cert.certificate_no}` : null,
        verifyUrl ? `\nVerify: ${verifyUrl}` : null,
      ].filter(Boolean).join('\n');
      await Share.share({ message: msg, url: verifyUrl || undefined });
    } catch { /* user cancelled */ }
  };

  const onDownload = async () => {
    const url = cert.render_url ? resolveAssetUrl(cert.render_url) : null;
    if (!url) {
      Alert.alert(
        'Not yet available',
        'Your academy is still preparing the downloadable file. The certificate above is the exact copy dispatched to you.',
      );
      return;
    }
    try { await Linking.openURL(url); }
    catch { Alert.alert('Error', 'Could not open the certificate file.'); }
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
        {/* Verification banner — reads status straight from the row. */}
        <View
          style={[
            styles.verifyBanner,
            cert.status === 'revoked' ? styles.verifyBad : styles.verifyOk,
          ]}
        >
          {cert.status === 'revoked' ? (
            <AlertCircle size={16} color="#991B1B" strokeWidth={2.4} />
          ) : (
            <CheckCircle2 size={16} color="#15803D" strokeWidth={2.4} />
          )}
          <Text
            style={[
              styles.verifyText,
              { color: cert.status === 'revoked' ? '#991B1B' : '#15803D' },
            ]}
          >
            {cert.status === 'revoked'
              ? 'This certificate has been revoked'
              : 'Issued by your academy'}
          </Text>
        </View>

        {/* ── Dispatched template — the exact layout the admin ── */}
        {/*    dispatched. Background + placeholder pins.        ── */}
        {hasTemplate ? (
          <View
            style={[
              styles.templateCard,
              { width: canvasScreenW, height: canvasScreenH },
            ]}
          >
            {imgFailed ? (
              <View style={[StyleSheet.absoluteFill, styles.imgFail]}>
                <AlertCircle size={22} color={palette.textLight} />
                <Text style={styles.imgFailText}>
                  Certificate artwork couldn't load.
                </Text>
              </View>
            ) : (
              <Image
                source={{ uri: bgUri }}
                style={StyleSheet.absoluteFill}
                resizeMode="contain"
                onLoad={() => setImgLoaded(true)}
                onError={() => setImgFailed(true)}
              />
            )}
            {!imgLoaded && !imgFailed ? (
              <View style={styles.imgLoading}>
                <ActivityIndicator size="small" color={palette.purple.vivid} />
              </View>
            ) : null}
            {/* Placeholder pins overlay — only paint after the
                artwork has loaded so text doesn't flash on grey. */}
            {imgLoaded && !imgFailed
              ? placeholders.map((pin, i) => (
                  <TemplatePin
                    key={`${pin.key}-${i}`}
                    pin={pin}
                    canvasW={canvasScreenW}
                    canvasH={canvasScreenH}
                  />
                ))
              : null}
          </View>
        ) : (
          // No template was attached (older row / deleted template).
          // Show a plain metadata card — no fake artwork, no
          // auto-generated QR.
          <View style={styles.fallbackCard}>
            <Award size={28} color={palette.purple.vivid} />
            <Text style={styles.fallbackTitle}>{cert.title}</Text>
            <Text style={styles.fallbackMeta}>
              Issued by {cert.institution_name || 'your academy'}
            </Text>
            <Text style={styles.fallbackMeta}>
              Date: {fmtDate(cert.issue_date)}
            </Text>
            {cert.certificate_no ? (
              <Text style={styles.fallbackMeta}>
                Certificate ID: {cert.certificate_no}
              </Text>
            ) : null}
            <Text style={styles.fallbackHint}>
              No template artwork was attached to this certificate.
            </Text>
          </View>
        )}

        {/* ── Metadata strip under the certificate ── */}
        <View style={styles.metaCard}>
          <View style={styles.metaRow}>
            <View style={styles.metaCol}>
              <Text style={styles.metaLabel}>Certificate ID</Text>
              <Text style={[styles.metaValue, styles.mono]}>
                {cert.certificate_no || '—'}
              </Text>
            </View>
            <View style={styles.metaCol}>
              <Text style={styles.metaLabel}>Issue Date</Text>
              <Text style={styles.metaValue}>{fmtDate(cert.issue_date)}</Text>
            </View>
          </View>
          {cert.instructor_name ? (
            <View style={[styles.metaRow, { marginTop: spacing.md }]}>
              <View style={styles.metaCol}>
                <Text style={styles.metaLabel}>Instructor</Text>
                <Text style={styles.metaValue}>{cert.instructor_name}</Text>
              </View>
              <View style={styles.metaCol}>
                <Text style={styles.metaLabel}>Institution</Text>
                <Text style={styles.metaValue}>
                  {cert.institution_name || '—'}
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        {/* ── Download button — only when a rendered artefact exists. */}
        {cert.render_url ? (
          <TouchableOpacity
            onPress={onDownload}
            activeOpacity={0.85}
            style={styles.downloadBtn}
          >
            <Download size={16} color="#fff" strokeWidth={2.4} />
            <Text style={styles.downloadBtnText}>Download PDF / Image</Text>
          </TouchableOpacity>
        ) : null}

        {verifyUrl ? (
          <>
            <Text style={styles.verifyHint}>
              Verify this certificate at:
            </Text>
            <Text selectable style={styles.verifyUrl}>{verifyUrl}</Text>
          </>
        ) : null}

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
  headerTitle:    { fontSize: 17, fontWeight: '700', color: palette.dark },
  headerSubtitle: { fontSize: 12, color: palette.textLight, marginTop: 1 },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: palette.purple.vivid,
    borderRadius: 999,
  },
  shareText: { color: '#fff', fontWeight: '800', fontSize: 12 },

  scrollContent: { padding: spacing.xl, alignItems: 'center' },

  verifyBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    alignSelf: 'stretch',
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  verifyOk:  { backgroundColor: '#DCFCE7' },
  verifyBad: { backgroundColor: '#FEE2E2' },
  verifyText: { fontSize: 13, fontWeight: '800' },

  // ── Template canvas card ──────────────────────────────────────
  templateCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1, borderColor: palette.borderSoft,
    ...shadows.card,
  },
  imgLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
  },
  imgFail: {
    alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FAFAFA',
  },
  imgFailText: {
    fontSize: 12, color: palette.textLight, textAlign: 'center',
    paddingHorizontal: 24,
  },

  // ── Metadata-only fallback ────────────────────────────────────
  fallbackCard: {
    alignSelf: 'stretch',
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.xxl,
    alignItems: 'center',
    ...shadows.card,
    gap: 8,
  },
  fallbackTitle: { ...type.h2, color: palette.text, textAlign: 'center' },
  fallbackMeta:  { ...type.caption, color: palette.textMuted, textAlign: 'center' },
  fallbackHint:  {
    ...type.micro, color: palette.textLight, marginTop: 8,
    textAlign: 'center',
  },

  // ── Meta strip below the artwork ─────────────────────────────
  metaCard: {
    alignSelf: 'stretch',
    marginTop: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    ...shadows.card,
  },
  metaRow: {
    flexDirection: 'row', gap: spacing.md,
  },
  metaCol: { flex: 1, minWidth: 0 },
  metaLabel: {
    fontSize: 10, color: palette.textLight, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  metaValue: { fontSize: 13, color: palette.dark, fontWeight: '700', marginTop: 2 },
  mono: { fontFamily: 'monospace', letterSpacing: 0.8 },

  downloadBtn: {
    alignSelf: 'stretch',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6,
    marginTop: spacing.lg,
    paddingVertical: 12,
    backgroundColor: palette.blue.vivid,
    borderRadius: radius.md,
  },
  downloadBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  verifyHint: {
    fontSize: 11, color: palette.textLight, marginTop: spacing.md,
    alignSelf: 'stretch',
  },
  verifyUrl: {
    alignSelf: 'stretch',
    fontSize: 11, color: palette.purple.vivid, fontWeight: '700',
    fontFamily: 'monospace', marginTop: 4,
  },
});
