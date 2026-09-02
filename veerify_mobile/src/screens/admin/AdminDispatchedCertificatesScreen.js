// src/screens/admin/AdminDispatchedCertificatesScreen.js
//
// Institution Login → More → Certificates → Dispatched Certificates.
// Shows every certificate the academy has issued (belt promotions +
// course-completion) with a small artwork preview per card. Tapping
// a card opens CertificateDetail, which renders the EXACT layout the
// student received — same template, same placeholder values, same
// QR verification linkage.
//
// Backend:
//   GET /api/certificates/institution
//     → { count, certificates } — LEFT-joined to certificate_templates
//        so the preview can render without a second round-trip.
//
// The certificate object we hand to CertificateDetail already carries
// template_background_url + template_canvas_width/height + signature/
// seal URLs, so the detail screen replays the artwork identically to
// what Student → Certificates shows.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl, Image, Dimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Archive, Award, ShieldCheck, Search, X as XIcon,
  User,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
import resolveAssetUrl from '../../utils/assetUrl';
import { stripBeltSuffix } from '../../utils/beltDisplay';
import InstitutionScreenBackground from '../../components/InstitutionScreenBackground';

const SCREEN_W = Dimensions.get('window').width;
// Preview thumbnail width — half-screen minus horizontal padding + gap
// so two thumbs sit comfortably in the row of a card.
const THUMB_W = Math.round((SCREEN_W - spacing.lg * 2 - spacing.md * 2) * 0.42);

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// Belt certs display "Black" not "Black Belt"; other kinds pass
// through.
function displayCertTitle(cert) {
  if (!cert) return '';
  const raw = cert.title || '';
  if (cert.kind === 'belt') return stripBeltSuffix(raw) || raw;
  return raw;
}

// ─── Thumbnail preview ─────────────────────────────────────────────
// Mini-canvas — draws the template background at THUMB_W and paints
// each active placeholder pin at its normalised (x,y). Fonts are
// downscaled proportionally so the layout reads as the exact same
// composition the student sees, just smaller. Deliberately non-
// interactive; the whole card is the touch target.
function CertThumbnail({ cert }) {
  const bg = cert?.template_background_url
    ? resolveAssetUrl(cert.template_background_url)
    : null;
  const canvasW = cert?.template_canvas_width  || 1000;
  const canvasH = cert?.template_canvas_height || 700;
  const ratio   = canvasH / canvasW;
  const w = THUMB_W;
  const h = Math.max(70, Math.round(w * ratio));
  const scale = w / canvasW;

  const pins = useMemo(() => {
    if (!Array.isArray(cert?.placeholder_data)) return [];
    return cert.placeholder_data.filter((p) => p && p.active !== false);
  }, [cert?.placeholder_data]);

  return (
    <View
      style={[
        styles.thumb,
        { width: w, height: h, backgroundColor: bg ? '#0B1220' : '#F1F5F9' },
      ]}
    >
      {bg ? (
        <Image
          source={{ uri: bg }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.thumbEmpty}>
          <Award size={20} color={palette.textLight} strokeWidth={1.6} />
        </View>
      )}
      {pins.map((pin, i) => {
        // Image-backed pins (signature / seal).
        const isImage = pin.key === 'digital_signature' || pin.key === 'seal';
        if (isImage) {
          if (!pin.image_url) return null;
          const iw = Math.max(12, (pin.width  || 0.20) * w);
          const ih = Math.max(10, (pin.height || 0.10) * h);
          return (
            <Image
              key={`${pin.key}-${i}`}
              source={{ uri: resolveAssetUrl(pin.image_url) }}
              style={{
                position: 'absolute',
                left: pin.x * w - iw / 2,
                top:  pin.y * h - ih / 2,
                width: iw, height: ih,
              }}
              resizeMode="contain"
            />
          );
        }
        // Text pins. Belt-typed pins render short-form so the preview
        // matches the dispatched cert.
        const raw = pin.value != null && pin.value !== ''
          ? String(pin.value)
          : '';
        const text = (pin.key === 'belt_name' || pin.key === 'belt_from' || pin.key === 'belt_to')
          ? stripBeltSuffix(raw)
          : raw;
        if (!text) return null;
        const fontSize = Math.max(5, Math.round((Number(pin.font_size) || 16) * scale));
        // Loose width heuristic — same math the editor uses at full
        // scale, then downscaled.
        const est = Math.max(24, text.length * fontSize * 0.55);
        return (
          <Text
            key={`${pin.key}-${i}`}
            numberOfLines={1}
            style={{
              position: 'absolute',
              left: pin.x * w - est / 2,
              top:  pin.y * h - fontSize,
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
      })}
    </View>
  );
}

// ─── Card ──────────────────────────────────────────────────────────
function DispatchedCard({ cert, onOpen }) {
  const title = displayCertTitle(cert) || 'Certificate';
  const kindLabel = cert.kind === 'belt'
    ? 'Belt Promotion'
    : cert.kind === 'tournament'
      ? 'Tournament'
      : cert.kind === 'completion'
        ? 'Course Completion'
        : 'Achievement';
  return (
    <TouchableOpacity
      onPress={onOpen}
      activeOpacity={0.88}
      style={styles.card}
    >
      <View style={styles.cardRow}>
        <CertThumbnail cert={cert} />
        <View style={{ flex: 1, minWidth: 0, marginLeft: spacing.md }}>
          <View style={styles.kindPill}>
            <ShieldCheck size={10} color="#1E3A8A" strokeWidth={2.6} />
            <Text style={styles.kindPillText}>{kindLabel}</Text>
          </View>
          <Text style={styles.cardTitle} numberOfLines={2}>{title}</Text>
          <View style={styles.metaRow}>
            <User size={11} color={palette.textMuted} strokeWidth={2.4} />
            <Text style={styles.metaText} numberOfLines={1}>
              {cert.student_name || 'Student'}
            </Text>
          </View>
          <Text style={styles.metaLine} numberOfLines={1}>
            Issued {fmtDate(cert.issue_date)}
          </Text>
          {cert.certificate_no ? (
            <Text style={styles.certNo} numberOfLines={1}>
              No. {cert.certificate_no}
            </Text>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Screen ────────────────────────────────────────────────────────
export default function AdminDispatchedCertificatesScreen({ navigation }) {
  const [certs, setCerts]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefresh]  = useState(false);
  const [query, setQuery]         = useState('');

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get('/certificates/institution');
      setCerts(Array.isArray(r.data?.certificates) ? r.data.certificates : []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log('[DispatchedCerts] load error:', err?.response?.data);
      setCerts([]);
    } finally {
      setLoading(false);
      setRefresh(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Client-side filter — case-insensitive substring across student
  // name, certificate title (short-form for belt certs), and cert no.
  // Keeps things snappy for the common "who did I promote last?"
  // question without a backend round-trip.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return certs;
    return certs.filter((c) => {
      const t = (displayCertTitle(c) || '').toLowerCase();
      const s = (c.student_name || '').toLowerCase();
      const n = (c.certificate_no || '').toLowerCase();
      return t.includes(q) || s.includes(q) || n.includes(q);
    });
  }, [certs, query]);

  const openDetail = (cert) => {
    // Hand the full cert row to the same viewer the student uses.
    // CertificateDetail renders template_background_url + placeholder
    // pins so this is a 1:1 replay of what was dispatched.
    navigation.navigate('CertificateDetail', { certificate: cert });
  };

  return (
    <View style={styles.screen}>
      <InstitutionScreenBackground layer />
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.iconBtn}
            hitSlop={8}
            activeOpacity={0.85}
          >
            <ArrowLeft size={20} color="#0F172A" strokeWidth={2.4} />
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title}>Dispatched Certificates</Text>
            <Text style={styles.subtitle}>
              {loading ? 'Loading…' : `${certs.length} issued`}
            </Text>
          </View>
        </View>

        {/* Search — only render when there's something to search */}
        {certs.length > 0 ? (
          <View style={styles.searchWrap}>
            <Search size={14} color={palette.textMuted} strokeWidth={2.4} />
            <View style={{ flex: 1 }}>
              <TextInputShim
                value={query}
                onChange={setQuery}
                placeholder="Search by student, belt, or cert no."
              />
            </View>
            {query.length > 0 ? (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
                <XIcon size={14} color={palette.textMuted} strokeWidth={2.4} />
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#1E3A8A" />
        </View>
      ) : certs.length === 0 ? (
        <View style={styles.emptyCard}>
          <Archive size={30} color={palette.textLight} strokeWidth={1.6} />
          <Text style={styles.emptyTitle}>No dispatched certificates yet</Text>
          <Text style={styles.emptySub}>
            Once your academy issues a belt promotion or course-completion
            certificate, it will appear here.
          </Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.emptyCard}>
          <Search size={26} color={palette.textLight} strokeWidth={1.6} />
          <Text style={styles.emptyTitle}>No matches</Text>
          <Text style={styles.emptySub}>
            Nothing matches "{query}". Try a different name or number.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefresh(true); load(); }}
              tintColor="#1E3A8A"
            />
          }
        >
          {filtered.map((c) => (
            <DispatchedCard key={c.id} cert={c} onOpen={() => openDetail(c)} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// Small TextInput wrapper so we can dodge importing TextInput at the
// top just for the search box — keeps the import block tidy and lets
// the search bar be dropped in / out based on the certs.length check.
function TextInputShim({ value, onChange, placeholder }) {
  const { TextInput } = require('react-native');
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={palette.textLight}
      style={styles.searchInput}
      returnKeyType="search"
      autoCorrect={false}
      autoCapitalize="none"
    />
  );
}

const styles = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: '#F1F6FB' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148,163,184,0.22)',
  },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#EEF2F7',
  },
  title:    { ...type.h1, color: '#0F172A', fontSize: 18 },
  subtitle: { ...type.caption, color: palette.textMuted, marginTop: 2 },

  searchWrap: {
    marginTop: spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(241,246,251,0.9)',
    borderRadius: radius.md,
    borderWidth: 1, borderColor: 'rgba(148,163,184,0.22)',
    paddingHorizontal: 10, paddingVertical: 6,
  },
  searchInput: {
    fontSize: 13, color: palette.text, paddingVertical: 4,
  },

  emptyCard: {
    marginHorizontal: spacing.lg, marginTop: spacing.xl,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: 'rgba(148,163,184,0.18)',
  },
  emptyTitle: {
    ...type.h2, color: palette.text, fontSize: 15, marginTop: 6,
  },
  emptySub: {
    ...type.caption, color: palette.textMuted, textAlign: 'center',
  },

  // Card — glass surface matching the Certificates screen.
  card: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1, borderColor: 'rgba(148,163,184,0.18)',
    shadowColor: '#1E40AF',
    shadowOpacity: 0.10,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start' },

  // Thumbnail — dark backdrop when the template hasn't been uploaded
  // so the placeholder icon reads clearly.
  thumb: {
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(148,163,184,0.28)',
  },
  thumbEmpty: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
  },

  kindPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(30,58,138,0.10)',
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
    marginBottom: 6,
  },
  kindPillText: {
    fontSize: 10, fontWeight: '800', color: '#1E3A8A',
    letterSpacing: 0.3, textTransform: 'uppercase',
  },
  cardTitle: {
    fontSize: 15, fontWeight: '800', color: '#0F172A',
    letterSpacing: 0.2,
  },
  metaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 6,
  },
  metaText: {
    fontSize: 12, color: palette.text, fontWeight: '600',
  },
  metaLine: {
    fontSize: 11, color: palette.textMuted, marginTop: 3,
  },
  certNo: {
    fontSize: 10, color: palette.textLight, marginTop: 3,
    letterSpacing: 0.3,
  },
});
