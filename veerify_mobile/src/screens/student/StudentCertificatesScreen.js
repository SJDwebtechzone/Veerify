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
  StyleSheet, RefreshControl, Modal, Image, Dimensions, Share, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Award, Clock, Eye, Download, Share2,
  ShieldCheck, X as XIcon,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
import resolveAssetUrl from '../../utils/assetUrl';

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
  const [viewer, setViewer]   = useState(null);

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
      await Share.share({
        title: cert.title,
        message: `My certificate: ${cert.title} (No. ${cert.certificate_no || ''})`,
      });
    } catch (err) {
      Alert.alert('Could not share', err?.message || 'Try again.');
    }
  };

  const download = (cert) => {
    // Real download requires the render_url. Fallback: tell the
    // student where to look. If a real render_url is later populated,
    // this becomes a Linking.openURL(render_url).
    if (cert.render_url) {
      const url = resolveAssetUrl(cert.render_url);
      Alert.alert('Download', `Open ${url}`);
    } else {
      Alert.alert('Not yet available', 'Your academy is still preparing the file. Try again in a moment.');
    }
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
                    <Text style={styles.courseName} numberOfLines={1}>{c.title}</Text>
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
                  <ActionBtn icon={Eye}      label="View"     onPress={() => setViewer(c)}         accent={palette.purple} />
                  <ActionBtn icon={Download} label="Download" onPress={() => download(c)}         accent={palette.blue} />
                  <ActionBtn icon={Share2}   label="Share"    onPress={() => shareCert(c)}        accent={palette.green} />
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* Full-screen viewer */}
      <Modal visible={!!viewer} animationType="fade" onRequestClose={() => setViewer(null)} transparent>
        <View style={styles.viewer}>
          <TouchableOpacity onPress={() => setViewer(null)} style={styles.viewerClose} hitSlop={8}>
            <XIcon size={22} color="#fff" strokeWidth={2.4} />
          </TouchableOpacity>
          {viewer ? <CertViewer cert={viewer} /> : null}
        </View>
      </Modal>
    </View>
  );
}

// Full-fidelity renderer for a dispatched certificate. Reads the same
// data the admin PreviewModal uses:
//   • template_background_url — the artwork the admin uploaded
//   • template_canvas_width/height — sets the canvas ratio so pin (x,y)
//     positions align across devices
//   • placeholder_data — snapshot of the pins WITH resolved values +
//     image_url for the digital_signature / seal pins
// so what the student sees matches what the admin dispatched.
function CertViewer({ cert }) {
  const SCREEN_W = Dimensions.get('window').width;
  const CANVAS_W = SCREEN_W - spacing.lg * 2;
  const pins = Array.isArray(cert.placeholder_data) ? cert.placeholder_data : [];

  // Prefer the finalised render_url (a real PNG/PDF) when the backend
  // has one; otherwise fall back to rendering placeholders onto the
  // raw template background. Both paths use the same canvas ratio so
  // the student's view is stable regardless of which one wins.
  const canvasW = Number(cert.template_canvas_width)  || 1000;
  const canvasH = Number(cert.template_canvas_height) || 700;
  const ratio   = canvasH / (canvasW || 1);
  const CANVAS_H = Math.min(CANVAS_W * ratio, SCREEN_W * 1.2);

  const bg = cert.render_url
    ? resolveAssetUrl(cert.render_url)
    : cert.template_background_url
      ? resolveAssetUrl(cert.template_background_url)
      : null;

  return (
    <View style={{
      width: CANVAS_W, height: CANVAS_H,
      borderRadius: radius.lg, overflow: 'hidden',
      backgroundColor: '#fff',
      alignSelf: 'center',
    }}>
      {bg ? (
        <Image
          source={{ uri: bg }}
          style={StyleSheet.absoluteFill}
          resizeMode={cert.render_url ? 'contain' : 'cover'}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#FFF8E7' }]} />
      )}

      {/* Placeholder-layer render — only when we're painting on top of
          the raw background (not the finalised render_url which is an
          already-baked image). Same layout math the admin preview modal
          uses so what the student sees matches the dispatch preview. */}
      {!cert.render_url ? pins.map((pin, i) => {
        if (pin.active === false) return null;
        const isImage = pin.key === 'digital_signature' || pin.key === 'seal';
        if (isImage) {
          const url = pin.image_url
            || (pin.key === 'digital_signature' ? cert.template_signature_url : cert.template_seal_url);
          if (!url) return null;
          const w = Math.max(40, (pin.width  || 0.20) * CANVAS_W);
          const h = Math.max(24, (pin.height || 0.10) * CANVAS_H);
          return (
            <Image
              key={i}
              source={{ uri: resolveAssetUrl(url) }}
              style={{
                position: 'absolute',
                left: pin.x * CANVAS_W - w / 2,
                top:  pin.y * CANVAS_H - h / 2,
                width: w, height: h,
              }}
              resizeMode="contain"
            />
          );
        }
        const est = Math.max(60, String(pin.value || pin.label || '').length * (pin.font_size || 16) * 0.55);
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: pin.x * CANVAS_W - est / 2,
              top:  pin.y * CANVAS_H - (pin.font_size || 16),
              width: est,
            }}
          >
            <Text style={{
              fontSize: Math.max(9, (pin.font_size || 16) * 0.6),
              color: pin.color || '#111827',
              fontWeight: pin.bold ? '800' : '600',
              fontStyle: pin.italic ? 'italic' : 'normal',
              textAlign: pin.align || 'center',
            }}>
              {String(pin.value ?? '')}
            </Text>
          </View>
        );
      }) : null}

      {/* Legacy fallback — no template artwork AND no render_url (the
          admin dispatched from a very old certificate row). Show a
          text-only summary so the student still sees something useful. */}
      {!bg ? (
        <View style={[StyleSheet.absoluteFill, { padding: spacing.lg }]}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Award size={40} color="#B45309" strokeWidth={2} />
            <Text style={{ ...type.h1, color: '#111827', marginTop: 10, textAlign: 'center' }}>
              {cert.title}
            </Text>
            <Text style={{ marginTop: 6, color: '#78350F', fontWeight: '700' }}>
              Awarded on {new Date(cert.issue_date).toLocaleDateString('en-IN', {
                day: '2-digit', month: 'long', year: 'numeric',
              })}
            </Text>
            {cert.certificate_no ? (
              <Text style={{ marginTop: 4, color: '#78350F' }}>No. {cert.certificate_no}</Text>
            ) : null}
            {pins.filter((p) => p.value).slice(0, 4).map((p, i) => (
              <Text key={i} style={{ marginTop: 4, color: '#111827', fontWeight: '700' }}>
                {p.label}: <Text style={{ fontWeight: '900' }}>{String(p.value)}</Text>
              </Text>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ActionBtn({ icon: Icon, label, onPress, accent }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.actionBtn, { backgroundColor: accent.soft }]}
    >
      <Icon size={13} color={accent.on} strokeWidth={2.4} />
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
