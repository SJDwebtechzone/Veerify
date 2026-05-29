// src/screens/parent/ChildProfileScreen.js
//
// Parent Step 10 - Student Profile.
//
// Layout (top to bottom):
//   1. Red hero  back, "Student Profile" title, large avatar, name, gender + age,
//      current belt badge with the actual strap color.
//   2. Personal info card  DOB, age, gender, blood group.
//   3. Contact card  email, phone, emergency contact.
//   4. Academy details  belt level, joining date, institution.
//   5. Batches enrolled in  list of {batch, course, schedule, trainer}.
//
// Data:
//   GET /api/parents/children/:id/summary       - basic user info
//   GET /api/parents/children/:id/enrollments   - batches + trainers
// Placeholders (until students_profile migration ships):
//   DOB, blood group, emergency contact, formal gender (derived from id).

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl, Linking, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Mail, Phone, Award, Calendar, Cake, Droplet, Users,
  GraduationCap, ChevronRight, BookOpen, Clock, User,
  ShieldAlert, Building2,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { useChild } from '../../context/ChildContext';
import { palette, spacing, radius, shadows, type } from '../../theme';

const BELTS = [
  { key: 'white',  label: 'White',  bg: '#FFFFFF', fg: '#111827', border: '#E5E7EB' },
  { key: 'yellow', label: 'Yellow', bg: '#FEF3C7', fg: '#92400E', border: '#F59E0B' },
  { key: 'orange', label: 'Orange', bg: '#FFEDD5', fg: '#9A3412', border: '#F97316' },
  { key: 'green',  label: 'Green',  bg: '#DCFCE7', fg: '#166534', border: '#22C55E' },
  { key: 'blue',   label: 'Blue',   bg: '#DBEAFE', fg: '#1E40AF', border: '#3B82F6' },
  { key: 'brown',  label: 'Brown',  bg: '#FAEDD5', fg: '#7C2D12', border: '#A16207' },
  { key: 'black',  label: 'Black',  bg: '#1F2937', fg: '#FFFFFF', border: '#0F172A' },
];
const beltFor   = (id) => BELTS[Math.abs(Number(id) || 0) % BELTS.length];
const genderFor = (id) => (Math.abs(Number(id) || 0) % 2 === 0 ? 'Male' : 'Female');
const ageFor    = (id) => 12 + (Math.abs(Number(id) || 0) % 24);
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
const bloodFor  = (id) => BLOOD_GROUPS[Math.abs(Number(id) || 0) % BLOOD_GROUPS.length];

// Synthesize a DOB consistent with the synthesized age.
function dobFor(id, age) {
  const now = new Date();
  const year = now.getFullYear() - age;
  const month = Math.abs(Number(id) || 0) % 12;
  const day = (Math.abs(Number(id) || 0) % 28) + 1;
  return new Date(year, month, day);
}

export default function ChildProfileScreen({ navigation, route }) {
  const { activeChild } = useChild();
  const childId = route?.params?.childId ?? activeChild?.child_id ?? null;
  const childName = route?.params?.childName ?? activeChild?.child_name ?? 'Student';

  const [summary, setSummary] = useState(null);
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!childId) { setLoading(false); setRefreshing(false); return; }
    try {
      const [sumRes, enrollRes] = await Promise.all([
        apiClient.get(`/parents/children/${childId}/summary`).catch(() => ({ data: { child: null } })),
        apiClient.get(`/parents/children/${childId}/enrollments`).catch(() => ({ data: { enrollments: [] } })),
      ]);
      setSummary(sumRes.data?.child || sumRes.data?.summary || sumRes.data || null);
      setEnrollments(enrollRes.data?.enrollments || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [childId]);
  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  // ── Derived values ──
  const belt    = beltFor(childId);
  const gender  = genderFor(childId);
  const age     = ageFor(childId);
  const dob     = useMemo(() => dobFor(childId, age), [childId, age]);
  const blood   = bloodFor(childId);

  // Joining date = earliest enrollment.
  const joiningDate = useMemo(() => {
    if (enrollments.length === 0) return null;
    const sorted = [...enrollments].sort((a, b) => new Date(a.enrolled_at) - new Date(b.enrolled_at));
    return new Date(sorted[0].enrolled_at);
  }, [enrollments]);

  const email = summary?.email || activeChild?.child_email || null;
  const phone = summary?.phone || activeChild?.child_phone || null;

  const initials = (childName || 'S').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  // ── Actions ──
  const openMail = () => email && Linking.openURL(`mailto:${email}`).catch(() => {});
  const openTel = () => phone && Linking.openURL(`tel:${phone}`).catch(() => {});
  const openEmergency = () => {
    Alert.alert(
      'Emergency contact',
      'Emergency-contact details will appear here once the student profile fields ship. For now use the regular phone above.',
      [phone ? { text: 'Call regular number', onPress: openTel } : null, { text: 'Cancel', style: 'cancel' }].filter(Boolean),
    );
  };

  return (
    <View style={styles.screen}>
      {/* Red hero */}
      <View style={styles.hero}>
        <View style={styles.heroTopRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.heroIconBtn}>
            <ArrowLeft size={20} color="#fff" strokeWidth={2.4} />
          </TouchableOpacity>
          <Text style={styles.heroTitle}>Student Profile</Text>
          <View style={{ width: 36 }} />
        </View>

        <View style={styles.heroBody}>
          <View style={[styles.heroAvatar, { borderColor: belt.border }]}>
            <Text style={styles.heroAvatarText}>{initials}</Text>
          </View>
          <Text style={styles.heroName} numberOfLines={1}>{childName}</Text>
          <View style={styles.heroMetaRow}>
            <Users size={11} color="rgba(255,255,255,0.85)" strokeWidth={2.4} />
            <Text style={styles.heroMetaText}>{gender} · {age} yrs</Text>
            {summary?.institution_name ? (
              <>
                <View style={styles.heroDot} />
                <Building2 size={11} color="rgba(255,255,255,0.85)" strokeWidth={2.4} />
                <Text style={styles.heroMetaText} numberOfLines={1}>{summary.institution_name}</Text>
              </>
            ) : null}
          </View>
          <View style={[styles.heroBelt, { backgroundColor: belt.bg, borderColor: belt.border }]}>
            <Award size={11} color={belt.fg} strokeWidth={2.4} />
            <Text style={[styles.heroBeltText, { color: belt.fg }]}>{belt.label} Belt</Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.purple.vivid}
          />
        }
      >
        {/* Personal info */}
        <Card title="Personal info" icon={User}>
          <InfoRow icon={Cake}   label="Date of birth" value={dob.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })} placeholder />
          <Divider />
          <InfoRow icon={Calendar} label="Age" value={`${age} years`} placeholder />
          <Divider />
          <InfoRow icon={Users} label="Gender" value={gender} placeholder />
          <Divider />
          <InfoRow icon={Droplet} label="Blood group" value={blood} placeholder accent={palette.rose} />
          <Text style={styles.placeholderNote}>
            Personal fields above are placeholders. Real values appear once the
            student profile migration adds DOB, gender and blood group columns.
          </Text>
        </Card>

        {/* Contact */}
        <Card title="Contact" icon={Phone}>
          <ContactRow
            icon={Mail}
            label="Email"
            value={email || 'Not provided'}
            onPress={email ? openMail : null}
            ctaLabel={email ? 'Email' : null}
            muted={!email}
          />
          <Divider />
          <ContactRow
            icon={Phone}
            label="Phone"
            value={phone || 'Not provided'}
            onPress={phone ? openTel : null}
            ctaLabel={phone ? 'Call' : null}
            muted={!phone}
          />
          <Divider />
          <ContactRow
            icon={ShieldAlert}
            label="Emergency contact"
            value="Tap to view"
            onPress={openEmergency}
            ctaLabel="Open"
            accent={palette.rose}
          />
        </Card>

        {/* Academy details */}
        <Card title="Academy details" icon={GraduationCap}>
          <InfoRow icon={Award} label="Belt level" value={`${belt.label} Belt`} placeholder />
          <Divider />
          <InfoRow
            icon={Calendar}
            label="Joining date"
            value={joiningDate
              ? joiningDate.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
              : 'Not enrolled yet'}
          />
          {summary?.institution_name ? (
            <>
              <Divider />
              <InfoRow icon={Building2} label="Institution" value={summary.institution_name} />
            </>
          ) : null}
        </Card>

        {/* Batches & trainers */}
        <Card
          title="Batches & trainers"
          icon={BookOpen}
          subtitle={`${enrollments.length} ${enrollments.length === 1 ? 'batch' : 'batches'}`}
        >
          {loading ? (
            <ActivityIndicator color={palette.purple.vivid} />
          ) : enrollments.length === 0 ? (
            <Text style={styles.placeholderText}>Not enrolled in any batches yet.</Text>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {enrollments.map((e) => (
                <BatchRow key={e.id || e.batch_id} enroll={e} />
              ))}
            </View>
          )}
        </Card>
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

function Card({ title, icon: Icon, subtitle, children }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {Icon ? (
            <View style={styles.cardHeaderIcon}>
              <Icon size={12} color={palette.purple.vivid} strokeWidth={2.4} />
            </View>
          ) : null}
          <Text style={styles.cardTitle}>{title}</Text>
        </View>
        {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
      </View>
      <View style={styles.cardBody}>{children}</View>
    </View>
  );
}

function InfoRow({ icon: Icon, label, value, placeholder, accent }) {
  const iconAccent = accent || palette.purple;
  return (
    <View style={styles.infoRow}>
      <View style={[styles.infoIcon, { backgroundColor: iconAccent.soft }]}>
        <Icon size={14} color={iconAccent.vivid} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.infoLabelRow}>
          <Text style={styles.infoLabel}>{label}</Text>
          {placeholder ? <Text style={styles.placeholderTag}>placeholder</Text> : null}
        </View>
        <Text style={styles.infoValue} numberOfLines={2}>{value}</Text>
      </View>
    </View>
  );
}

function ContactRow({ icon: Icon, label, value, onPress, ctaLabel, muted, accent }) {
  const iconAccent = accent || palette.purple;
  const Body = (
    <View style={styles.infoRow}>
      <View style={[styles.infoIcon, { backgroundColor: iconAccent.soft }]}>
        <Icon size={14} color={iconAccent.vivid} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={[styles.infoValue, muted && { color: palette.textMuted }]} numberOfLines={1}>{value}</Text>
      </View>
      {onPress && ctaLabel ? (
        <View style={[styles.contactCta, { backgroundColor: iconAccent.soft }]}>
          <Text style={[styles.contactCtaText, { color: iconAccent.on }]}>{ctaLabel}</Text>
        </View>
      ) : null}
    </View>
  );
  if (!onPress) return Body;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      {Body}
    </TouchableOpacity>
  );
}

function Divider() { return <View style={styles.divider} />; }

function BatchRow({ enroll }) {
  return (
    <View style={styles.batchRow}>
      <View style={styles.batchIcon}>
        <BookOpen size={16} color={palette.purple.vivid} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.batchName} numberOfLines={1}>{enroll.batch_name || 'Batch'}</Text>
        {enroll.course_name ? (
          <Text style={styles.batchCourse} numberOfLines={1}>{enroll.course_name}</Text>
        ) : null}
        <View style={styles.batchMetaRow}>
          {enroll.days_of_week ? (
            <View style={styles.batchMetaItem}>
              <Calendar size={10} color={palette.textMuted} strokeWidth={2.4} />
              <Text style={styles.batchMetaText}>{enroll.days_of_week}</Text>
            </View>
          ) : null}
          {enroll.start_time ? (
            <View style={styles.batchMetaItem}>
              <Clock size={10} color={palette.textMuted} strokeWidth={2.4} />
              <Text style={styles.batchMetaText}>
                {enroll.start_time.slice(0, 5)}
                {enroll.end_time ? ` – ${enroll.end_time.slice(0, 5)}` : ''}
              </Text>
            </View>
          ) : null}
          {enroll.trainer_name ? (
            <View style={styles.batchMetaItem}>
              <User size={10} color={palette.textMuted} strokeWidth={2.4} />
              <Text style={styles.batchMetaText}>{enroll.trainer_name}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },

  // Hero
  hero: {
    backgroundColor: palette.purple.vivid,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl + 4,
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  heroTopRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  heroIconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  heroTitle: { ...type.h2, color: '#fff', fontWeight: '700' },
  heroBody: { alignItems: 'center', marginTop: spacing.lg },
  heroAvatar: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3,
    marginBottom: spacing.md,
  },
  heroAvatarText: { color: palette.purple.vivid, fontSize: 28, fontWeight: '800' },
  heroName: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  heroMetaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  heroMetaText: { ...type.caption, color: 'rgba(255,255,255,0.85)', fontWeight: '700' },
  heroDot: {
    width: 3, height: 3, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.5)',
    marginHorizontal: 4,
  },
  heroBelt: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginTop: spacing.md,
  },
  heroBeltText: { ...type.caption, fontWeight: '800' },

  // Card
  card: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    ...shadows.card,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  cardHeaderIcon: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { ...type.bodyBold, color: palette.text, fontSize: 13 },
  cardSubtitle: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  cardBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },

  // Info row
  infoRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  infoIcon: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  infoLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  infoLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  infoValue: { ...type.bodyBold, color: palette.text, marginTop: 1 },
  placeholderTag: {
    ...type.micro,
    color: palette.textLight,
    fontWeight: '700',
    paddingHorizontal: 6, paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: palette.borderSoft,
    overflow: 'hidden',
    fontStyle: 'italic',
  },
  placeholderNote: {
    ...type.micro, color: palette.textMuted, fontStyle: 'italic',
    marginTop: spacing.sm,
  },
  placeholderText: { ...type.caption, color: palette.textMuted, fontStyle: 'italic' },

  contactCta: {
    paddingHorizontal: spacing.sm, paddingVertical: 6,
    borderRadius: radius.pill,
  },
  contactCtaText: { ...type.micro, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },

  divider: { height: 1, backgroundColor: palette.borderSoft, marginVertical: spacing.xs },

  // Batch row
  batchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: palette.bg,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  batchIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  batchName: { ...type.bodyBold, color: palette.text, fontSize: 13 },
  batchCourse: { ...type.micro, color: palette.purple.vivid, fontWeight: '700', marginTop: 1 },
  batchMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  batchMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  batchMetaText: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
});
