// src/screens/parent/ParentMoreScreen.js
//
// Step 11 of the Parent module - the "More" tab.
//
// Acts as a hub for things that don't have their own bottom tab:
//   - Linked Children          (manage / switch children)
//   - Student Profile          (view active child's full profile)
//   - Belt & Certificates      (achievements / belt progression)
//   - Inform Leave             (submit a leave request)
//   - Events & Announcements   (academy events feed)
//   - Notifications            (inbox)
//   - Help & Support           (static info card for now)
//   - Sign out
//
// Visually: red hero with parent name + active-child chip, then a
// grouped list of nav rows with leading icon, label, sub-label and
// trailing chevron. Mirrors the staff Profile tab's information density.

import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import {
  Users, UserCircle, Award, Plane, Calendar, Bell, HelpCircle,
  LogOut, ChevronRight, Mail, Phone, Shield, MessageSquare,
} from 'lucide-react-native';

import { useAuth } from '../../context/AuthContext';
import { useChild } from '../../context/ChildContext';
import { palette, spacing, radius, shadows, type } from '../../theme';
import { confirm } from '../../components/ConfirmDialog';

const BELTS = [
  { key: 'white',  label: 'White',  bg: '#FFFFFF', fg: '#111827', border: '#E5E7EB' },
  { key: 'yellow', label: 'Yellow', bg: '#FEF3C7', fg: '#92400E', border: '#F59E0B' },
  { key: 'orange', label: 'Orange', bg: '#FFEDD5', fg: '#9A3412', border: '#F97316' },
  { key: 'green',  label: 'Green',  bg: '#DCFCE7', fg: '#166534', border: '#22C55E' },
  { key: 'blue',   label: 'Blue',   bg: '#DBEAFE', fg: '#1E40AF', border: '#3B82F6' },
  { key: 'brown',  label: 'Brown',  bg: '#FAEDD5', fg: '#7C2D12', border: '#A16207' },
  { key: 'black',  label: 'Black',  bg: '#1F2937', fg: '#FFFFFF', border: '#0F172A' },
];
const beltFor = (id) => BELTS[Math.abs(Number(id) || 0) % BELTS.length];

export default function ParentMoreScreen({ navigation }) {
  const { user, logout } = useAuth();
  const { activeChild, list } = useChild();

  const handleSignOut = () => {
    confirm({
      title: 'Sign out?',
      message: 'You will need to sign in again to view your child\'s details.',
      variant: 'destructive',
      confirmText: 'Sign out',
      cancelText: 'Cancel',
      onConfirm: () => logout?.(),
    });
  };

  const childId = activeChild?.child_id ?? null;
  const initials = (user?.name || 'P')
    .split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <View style={styles.screen}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ───── Hero ───── */}
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>SIGNED IN AS</Text>
          <View style={styles.heroRow}>
            <View style={styles.heroAvatar}>
              <Text style={styles.heroAvatarText}>{initials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroName} numberOfLines={1}>{user?.name || 'Parent'}</Text>
              {user?.email ? (
                <View style={styles.heroMetaRow}>
                  <Mail size={12} color="rgba(255,255,255,0.85)" strokeWidth={2.2} />
                  <Text style={styles.heroMetaText} numberOfLines={1}>{user.email}</Text>
                </View>
              ) : null}
              {user?.phone ? (
                <View style={styles.heroMetaRow}>
                  <Phone size={12} color="rgba(255,255,255,0.85)" strokeWidth={2.2} />
                  <Text style={styles.heroMetaText} numberOfLines={1}>{user.phone}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Active child summary, if any */}
          {activeChild ? (
            <TouchableOpacity
              style={styles.childChip}
              onPress={() => navigation.navigate('LinkedChildren')}
              activeOpacity={0.85}
            >
              <View style={[
                styles.childChipAvatar,
                {
                  backgroundColor: beltFor(activeChild.child_id).bg,
                  borderColor: beltFor(activeChild.child_id).border,
                },
              ]}>
                <Text style={[
                  styles.childChipInitials,
                  { color: beltFor(activeChild.child_id).fg === '#FFFFFF'
                      ? '#111827' : beltFor(activeChild.child_id).fg },
                ]}>
                  {(activeChild.child_name || 'C')
                    .split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.childChipLabel}>VIEWING</Text>
                <Text style={styles.childChipName} numberOfLines={1}>
                  {activeChild.child_name}
                </Text>
              </View>
              <View style={styles.childChipPill}>
                <Text style={styles.childChipPillText}>{list.length} linked</Text>
              </View>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* ───── Child management group ───── */}
        <SectionLabel text="MY CHILDREN" />
        <View style={styles.group}>
          <Row
            icon={Users}
            iconBg={palette.purple.soft}
            iconColor={palette.purple.vivid}
            label="Linked Children"
            sub={`${list.length} ${list.length === 1 ? 'student' : 'students'} linked`}
            onPress={() => navigation.navigate('LinkedChildren')}
          />
          <Divider />
          <Row
            icon={UserCircle}
            iconBg={palette.blue.soft}
            iconColor={palette.blue.vivid}
            label="Student Profile"
            sub={activeChild ? activeChild.child_name : 'Link a child to view'}
            disabled={!childId}
            onPress={() => navigation.navigate('ChildProfile', { childId })}
          />
          <Divider />
          <Row
            icon={Award}
            iconBg={palette.orange.soft}
            iconColor={palette.orange.vivid}
            label="Belt & Certificates"
            sub="Achievements and belt progression"
            disabled={!childId}
            onPress={() => navigation.navigate('ChildAchievements', { childId })}
          />
        </View>

        {/* ───── Actions group ───── */}
        <SectionLabel text="ACTIONS" />
        <View style={styles.group}>
          <Row
            icon={Plane}
            iconBg={palette.blue.soft}
            iconColor={palette.blue.vivid}
            label="Inform Leave"
            sub="Notify the academy when your child is away"
            disabled={!childId}
            onPress={() => navigation.navigate('InformLeave', { childId })}
          />
          <Divider />
          <Row
            icon={Calendar}
            iconBg={palette.pink.soft}
            iconColor={palette.pink.vivid}
            label="Events & Announcements"
            sub="Upcoming events from your academy"
            onPress={() => navigation.navigate('ChildEvents')}
          />
          <Divider />
          <Row
            icon={Bell}
            iconBg={palette.green.soft}
            iconColor={palette.green.vivid}
            label="Notifications"
            sub="Inbox of academy and link alerts"
            onPress={() => navigation.navigate('StaffNotifications')}
          />
        </View>

        {/* ───── Support / sign out ───── */}
        <SectionLabel text="ACCOUNT" />
        <View style={styles.group}>
          <Row
            icon={HelpCircle}
            iconBg={palette.blue?.soft || '#DBEAFE'}
            iconColor={palette.blue?.vivid || '#2563EB'}
            label="Support"
            sub="Reach Veerify or your child's academy"
            onPress={() => navigation.navigate('Support')}
          />
          <Divider />
          {/* FAQs — role-scoped dynamic content managed on the
              super-admin web. Parents see the FAQs whose audience
              list includes their role. */}
          <Row
            icon={HelpCircle}
            iconBg={palette.orange?.soft || '#FED7AA'}
            iconColor={palette.orange?.vivid || '#EA580C'}
            label="FAQs"
            sub="Common questions about batches, fees & progress"
            onPress={() => navigation.navigate('Faq')}
          />
          <Divider />
          <Row
            icon={MessageSquare}
            iconBg={palette.pink?.soft || '#FCE7F3'}
            iconColor={palette.pink?.vivid || '#DB2777'}
            label="Send Feedback"
            sub="Tell us what you think about Veerify"
            onPress={() => navigation.navigate('SendFeedback')}
          />
          <Divider />
          <Row
            icon={Shield}
            iconBg={palette.borderSoft}
            iconColor={palette.textMuted}
            label="Privacy & Terms"
            sub="How we protect your family's data"
            onPress={() => Alert.alert(
              'Privacy & Terms',
              'Veerify only shares your child\'s data with their enrolled academy. Tap "OK" to continue.',
            )}
          />
          <Divider />
          <Row
            icon={LogOut}
            iconBg={palette.rose?.soft || '#FEE2E2'}
            iconColor={palette.rose?.vivid || '#DC2626'}
            label="Sign out"
            sub="End this session"
            danger
            onPress={handleSignOut}
          />
        </View>

        <Text style={styles.versionText}>Veerify · Parent</Text>
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────
function SectionLabel({ text }) {
  return <Text style={styles.sectionLabel}>{text}</Text>;
}

function Divider() {
  return <View style={styles.divider} />;
}

function Row({ icon: Icon, iconBg, iconColor, label, sub, danger, disabled, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.row, disabled && { opacity: 0.4 }]}
      onPress={disabled ? undefined : onPress}
      activeOpacity={disabled ? 1 : 0.7}
    >
      <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
        <Icon size={18} color={iconColor} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, danger && { color: palette.rose?.vivid || '#DC2626' }]}>{label}</Text>
        {sub ? <Text style={styles.rowSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {!disabled ? (
        <ChevronRight size={18} color={palette.textLight} strokeWidth={2.2} />
      ) : null}
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },

  // Hero
  hero: {
    backgroundColor: palette.purple.vivid,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl + 6,
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  eyebrow: { ...type.caption, color: 'rgba(255,255,255,0.85)', fontWeight: '700', letterSpacing: 1 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  heroAvatar: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)',
  },
  heroAvatarText: { color: '#fff', fontSize: 22, fontWeight: '800' },
  heroName: { ...type.h1, color: '#fff', fontSize: 20 },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  heroMetaText: { ...type.caption, color: 'rgba(255,255,255,0.9)', fontWeight: '600' },

  // Child chip
  childChip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: radius.lg,
    padding: spacing.sm + 2,
    marginTop: spacing.lg,
  },
  childChipAvatar: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2,
  },
  childChipInitials: { fontSize: 14, fontWeight: '800' },
  childChipLabel: { ...type.micro, color: 'rgba(255,255,255,0.75)', fontWeight: '700', letterSpacing: 1 },
  childChipName: { ...type.bodyBold, color: '#fff', fontSize: 14, marginTop: 1 },
  childChipPill: {
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  childChipPillText: { ...type.micro, color: '#fff', fontWeight: '800' },

  // Section
  sectionLabel: {
    ...type.micro,
    color: palette.textMuted,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginLeft: spacing.xl + spacing.xs,
  },

  // Group
  group: {
    marginHorizontal: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadows.card,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
  },
  rowIcon: {
    width: 36, height: 36, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { ...type.bodyBold, color: palette.text, fontSize: 15 },
  rowSub: { ...type.micro, color: palette.textMuted, marginTop: 2, fontWeight: '600' },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: palette.borderSoft,
    marginLeft: spacing.md + 36 + spacing.md,
  },

  versionText: {
    ...type.micro,
    color: palette.textLight,
    textAlign: 'center',
    marginTop: spacing.xl,
    fontWeight: '600',
  },
});
