// src/screens/student/PublicTrainerProfileScreen.js
//
// Public trainer profile reached from CourseDetail → Trainer card.
// Shows every safe field the backend surfaces via /trainers/:id/public:
//
//   • Photo (falls back to initials tile)
//   • Name + primary skill / specialization headline
//   • Skills (chips) — from the structured `skills` JSONB or the
//     legacy `specialization` VARCHAR
//   • Experience (years)
//   • Certificate — tap to open the uploaded PDF externally
//   • Bio
//   • Achievements — active-course count + batches-taught, derived
//     server-side so the values match what students actually see
//   • Academy details — name, city, logo
//
// Contact fields (email, phone, govt ID) are intentionally omitted
// per the /public endpoint's contract — those are private.

import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  ActivityIndicator, StyleSheet, Linking,
} from 'react-native';
import {
  ArrowLeft, Award, Briefcase, FileText, GraduationCap,
  Building2, MapPin, ChevronRight, Sparkles,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import resolveAssetUrl from '../../utils/assetUrl';
import { palette, spacing, radius, shadows, type } from '../../theme';

// Turn the trainer.skills JSONB (or legacy specialization) into a
// clean, deduplicated array of skill names for the chip row.
function extractSkills(t) {
  const out = [];
  const seen = new Set();
  const push = (s) => {
    const clean = String(s || '').trim();
    if (!clean) return;
    const k = clean.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(clean);
  };
  if (Array.isArray(t?.skills)) {
    for (const s of t.skills) {
      if (typeof s === 'string') push(s);
      else if (s && s.name) push(s.name);
    }
  }
  if (t?.specialization) push(t.specialization);
  return out;
}

// Belt-level display map — matches how the Belt column reads on other
// staff-facing screens so a student sees the same wording.
function fmtBelt(level) {
  if (!level) return null;
  const s = String(level).trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function PublicTrainerProfileScreen({ route, navigation }) {
  const trainerId = route?.params?.trainerId;
  const initialName = route?.params?.trainerName || 'Trainer';

  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [trainer, setTrainer] = useState(null);

  useEffect(() => {
    if (!trainerId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await apiClient.get(`/trainers/${trainerId}/public`);
        if (!cancelled) setTrainer(r.data?.trainer || null);
      } catch (err) {
        if (!cancelled) {
          setError(err?.response?.data?.message
            || 'Could not load this trainer\'s profile.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [trainerId]);

  const photo = trainer?.photo_url ? resolveAssetUrl(trainer.photo_url) : null;
  const logo  = trainer?.institution_logo_url ? resolveAssetUrl(trainer.institution_logo_url) : null;
  const certUrl = trainer?.certificate_url ? resolveAssetUrl(trainer.certificate_url) : null;
  const skills = extractSkills(trainer);
  const headline = skills[0] || 'Master Instructor';
  const belt = fmtBelt(trainer?.belt_level);
  const yearsExp = Number(trainer?.experience_years) || 0;
  const activeCourses = Number(trainer?.active_courses) || 0;
  const batchesTaught = Number(trainer?.batches_taught) || 0;

  const openCertificate = async () => {
    if (!certUrl) return;
    try { await Linking.openURL(certUrl); } catch { /* noop */ }
  };

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.iconBtn}
          hitSlop={8}
        >
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.4} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {trainer?.name || initialName}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={palette.purple.vivid} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.errorBtn}
            activeOpacity={0.85}
          >
            <Text style={styles.errorBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      ) : !trainer ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Trainer not found.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero — photo + name + headline */}
          <View style={styles.hero}>
            {photo ? (
              <Image source={{ uri: photo }} style={styles.heroPhoto} />
            ) : (
              <View style={[styles.heroPhoto, styles.heroPhotoFallback]}>
                <Text style={styles.heroInitials}>
                  {(trainer.name || 'T').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <Text style={styles.heroName}>{trainer.name}</Text>
            <Text style={styles.heroHeadline}>{headline}</Text>
            {belt ? (
              <View style={styles.beltPill}>
                <Award size={11} color={palette.purple.on} strokeWidth={2.4} />
                <Text style={styles.beltPillText}>{belt} Belt</Text>
              </View>
            ) : null}
          </View>

          {/* Achievement stats — trims to just the values the endpoint
              gives us so the row never lies about counts. */}
          <View style={styles.statsRow}>
            <StatTile
              icon={Briefcase}
              value={`${yearsExp} yr${yearsExp === 1 ? '' : 's'}`}
              label="Experience"
              accent={palette.blue}
            />
            <StatTile
              icon={GraduationCap}
              value={String(activeCourses)}
              label={activeCourses === 1 ? 'Course' : 'Courses'}
              accent={palette.green}
            />
            <StatTile
              icon={Sparkles}
              value={String(batchesTaught)}
              label={batchesTaught === 1 ? 'Batch' : 'Batches'}
              accent={palette.orange}
            />
          </View>

          {/* Skills */}
          {skills.length > 0 ? (
            <SectionCard title="Skills">
              <View style={styles.chipRow}>
                {skills.map((s) => (
                  <View key={s} style={styles.chip}>
                    <Text style={styles.chipText}>{s}</Text>
                  </View>
                ))}
              </View>
            </SectionCard>
          ) : null}

          {/* Bio */}
          {trainer.bio ? (
            <SectionCard title="About">
              <Text style={styles.bio}>{trainer.bio}</Text>
            </SectionCard>
          ) : null}

          {/* Certifications */}
          {certUrl ? (
            <SectionCard title="Certifications">
              <TouchableOpacity
                style={styles.certRow}
                onPress={openCertificate}
                activeOpacity={0.85}
              >
                <View style={styles.certIcon}>
                  <FileText size={14} color={palette.purple.vivid} strokeWidth={2.4} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.certTitle}>Certificate</Text>
                  <Text style={styles.certSub}>Tap to view the uploaded document</Text>
                </View>
                <ChevronRight size={16} color={palette.textMuted} strokeWidth={2.4} />
              </TouchableOpacity>
            </SectionCard>
          ) : null}

          {/* Academy details */}
          <SectionCard title="Academy">
            <View style={styles.academyRow}>
              {logo ? (
                <Image source={{ uri: logo }} style={styles.academyLogo} />
              ) : (
                <View style={[styles.academyLogo, styles.academyLogoFallback]}>
                  <Building2 size={16} color={palette.purple.vivid} strokeWidth={2.4} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.academyName} numberOfLines={1}>
                  {trainer.institution_name || 'Veerify Academy'}
                </Text>
                {trainer.institution_city ? (
                  <View style={styles.academyCityRow}>
                    <MapPin size={11} color={palette.textMuted} strokeWidth={2.4} />
                    <Text style={styles.academyCity} numberOfLines={1}>
                      {trainer.institution_city}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          </SectionCard>
        </ScrollView>
      )}
    </View>
  );
}

// ── Bits ────────────────────────────────────────────────────────────
function StatTile({ icon: Icon, value, label, accent }) {
  return (
    <View style={styles.statTile}>
      <View style={[styles.statIcon, { backgroundColor: accent.soft }]}>
        <Icon size={14} color={accent.vivid} strokeWidth={2.4} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SectionCard({ title, children }) {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
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
  headerTitle: { ...type.h1, color: palette.text, fontSize: 18, flex: 1 },

  errorText: {
    ...type.body, color: palette.textMuted,
    textAlign: 'center',
  },
  errorBtn: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.xl, paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: palette.purple.vivid,
  },
  errorBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  // Hero
  hero: {
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  heroPhoto: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: palette.borderSoft,
  },
  heroPhotoFallback: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.purple.vivid,
  },
  heroInitials: { color: '#fff', fontSize: 34, fontWeight: '800' },
  heroName: {
    ...type.h1, color: palette.text, marginTop: spacing.md, fontSize: 20,
  },
  heroHeadline: {
    ...type.caption, color: palette.textMuted, marginTop: 4,
    fontWeight: '700',
  },
  beltPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: palette.purple.soft,
    marginTop: spacing.sm,
  },
  beltPillText: { ...type.micro, color: palette.purple.on, fontWeight: '800' },

  // Stats row
  statsRow: {
    flexDirection: 'row', gap: spacing.sm,
    marginBottom: spacing.md,
  },
  statTile: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    ...shadows.card,
  },
  statIcon: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  statValue: { ...type.h2, color: palette.text, fontSize: 15, fontWeight: '800' },
  statLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700', marginTop: 1 },

  // Section cards
  sectionCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  sectionTitle: {
    ...type.micro, color: palette.textMuted,
    fontWeight: '800', letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: palette.purple.soft,
  },
  chipText: { ...type.micro, color: palette.purple.on, fontWeight: '800' },

  bio: { ...type.body, color: palette.text, lineHeight: 22 },

  certRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 4,
  },
  certIcon: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  certTitle: { ...type.bodyBold, color: palette.text, fontSize: 14 },
  certSub:   { ...type.caption, color: palette.textMuted, marginTop: 2 },

  academyRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: spacing.md,
  },
  academyLogo: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: palette.borderSoft,
  },
  academyLogoFallback: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.purple.soft,
  },
  academyName: { ...type.bodyBold, color: palette.text, fontSize: 14 },
  academyCityRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 3, marginTop: 3,
  },
  academyCity: { ...type.caption, color: palette.textMuted },
});
