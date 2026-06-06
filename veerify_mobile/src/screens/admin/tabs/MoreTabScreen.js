// src/screens/admin/tabs/MoreTabScreen.js
//
// "More" tab — the catch-all menu for everything that doesn't earn a primary
// tab spot. Institution info on top, 12-item grid below, sign-out at the
// bottom.
//
// Layout:
//   1. Profile card — academy avatar/initial + name + plan + edit/chevron
//   2. Grid menu — 12 entries, 3 columns: Trainers, Courses, Branches,
//      Events, Notifications, Announcements, Feedback, Reports, Branding,
//      Pricing & Plans, Settings, Support
//   3. Sign Out button + version label
//
// Every item is tap-routable; for now each shows an alert until the dedicated
// screens are built.

import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import {
  UserCog, BookOpen, Building2, CalendarRange, Bell, Megaphone,
  MessageSquare, BarChart3, Palette, CreditCard, Settings, LifeBuoy,
  LogOut, ChevronRight, Edit3, ShieldCheck,
} from 'lucide-react-native';

import { useAuth } from '../../../context/AuthContext';
import { palette, spacing, radius, shadows, type } from '../../../theme';

// ─── Menu definition ─────────────────────────────────────────────────────────
const MENU = [
  { key: 'trainers',      label: 'Trainers',         icon: UserCog,        accent: palette.purple },
  { key: 'courses',       label: 'Courses',          icon: BookOpen,       accent: palette.blue   },
  { key: 'branches',      label: 'Branches',         icon: Building2,      accent: palette.green  },
  { key: 'events',        label: 'Events',           icon: CalendarRange,  accent: palette.orange },
  { key: 'notifications', label: 'Notifications',    icon: Bell,           accent: palette.pink   },
  { key: 'announcements', label: 'Announcements',    icon: Megaphone,      accent: palette.teal   },
  { key: 'feedback',      label: 'Feedback',         icon: MessageSquare,  accent: palette.rose   },
  { key: 'reports',       label: 'Reports',          icon: BarChart3,      accent: palette.purple },
  { key: 'branding',      label: 'Branding',         icon: Palette,        accent: palette.blue   },
  { key: 'pricing',       label: 'Pricing & Plans',  icon: CreditCard,     accent: palette.green  },
  { key: 'settings',      label: 'Settings',         icon: Settings,       accent: palette.orange },
  { key: 'support',       label: 'Support',          icon: LifeBuoy,       accent: palette.pink   },
];

export default function MoreTabScreen({ navigation }) {
  const { user, logout } = useAuth();
  const placeholder = (m) => Alert.alert(m, "We'll wire this up next.");

  // Real navigation targets for tiles that already have screens built.
  const TILE_ROUTES = {
    courses:  'CoursesList',
    trainers: 'TrainersList',
    settings: 'Settings',
    branches: null, // not built yet — keep placeholder
  };
  const handleTile = (key, label) => {
    const route = TILE_ROUTES[key];
    if (route) navigation.navigate(route);
    else placeholder(label);
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign out?',
      'You\'ll be returned to the welcome screen.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => logout() },
      ],
    );
  };

  const initials = (user?.name || 'Academy')
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* ───── Header ───── */}
      <View style={styles.header}>
        <Text style={styles.title}>More</Text>
        <Text style={styles.subtitle}>Settings, tools, and everything else</Text>
      </View>

      {/* ───── Profile card ───── */}
      <TouchableOpacity
        style={styles.profileCard}
        onPress={() => placeholder('Academy Profile')}
        activeOpacity={0.9}
      >
        <View style={styles.profileAvatar}>
          <Text style={styles.profileInitials}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.profileName} numberOfLines={1}>
            {user?.name || 'Veerify Academy'}
          </Text>
          <Text style={styles.profileEmail} numberOfLines={1}>
            {user?.email || 'academy@veerify.com'}
          </Text>
          <View style={styles.planBadge}>
            <ShieldCheck size={11} color={palette.purple.on} strokeWidth={2.4} />
            <Text style={styles.planBadgeText}>Pro Plan • Active</Text>
          </View>
        </View>
        <View style={styles.profileEditButton}>
          <Edit3 size={16} color={palette.text} strokeWidth={2.2} />
        </View>
      </TouchableOpacity>

      {/* ───── Grid menu ───── */}
      <View style={styles.grid}>
        {MENU.map((item) => (
          <MenuTile
            key={item.key}
            label={item.label}
            icon={item.icon}
            accent={item.accent}
            onPress={() => handleTile(item.key, item.label)}
          />
        ))}
      </View>

      {/* ───── Quick links list ───── */}
      <View style={styles.listCard}>
        <ListRow
          icon={ShieldCheck}
          label="Privacy & Security"
          accent={palette.green}
          onPress={() => placeholder('Privacy & Security')}
        />
        <View style={styles.divider} />
        <ListRow
          icon={LifeBuoy}
          label="Help Center"
          accent={palette.blue}
          onPress={() => placeholder('Help Center')}
        />
        <View style={styles.divider} />
        <ListRow
          icon={MessageSquare}
          label="Send feedback"
          accent={palette.pink}
          onPress={() => placeholder('Send feedback')}
        />
      </View>

      {/* ───── Sign out ───── */}
      <TouchableOpacity
        style={styles.signOutButton}
        onPress={handleSignOut}
        activeOpacity={0.85}
      >
        <LogOut size={18} color={palette.rose.on} strokeWidth={2.2} />
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>

      {/* ───── Version ───── */}
      <Text style={styles.version}>Veerify · v1.0.0</Text>

      <View style={{ height: 100 }} />
    </ScrollView>
  );
}

// ─── Components ──────────────────────────────────────────────────────────────
function MenuTile({ icon: Icon, label, accent, onPress }) {
  return (
    <TouchableOpacity
      style={styles.tile}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={[styles.tileIcon, { backgroundColor: accent.soft }]}>
        <Icon size={22} color={accent.vivid} strokeWidth={2.2} />
      </View>
      <Text style={styles.tileLabel} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

function ListRow({ icon: Icon, label, accent, onPress }) {
  return (
    <TouchableOpacity
      style={styles.listRow}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={[styles.listIcon, { backgroundColor: accent.soft }]}>
        <Icon size={16} color={accent.vivid} strokeWidth={2.2} />
      </View>
      <Text style={styles.listLabel}>{label}</Text>
      <ChevronRight size={16} color={palette.textLight} strokeWidth={2} />
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  scrollContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.xxl },

  // Header
  header: { marginBottom: spacing.lg },
  title: { ...type.display, color: palette.text },
  subtitle: { ...type.caption, color: palette.textMuted, marginTop: 2 },

  // Profile card
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.xxl,
    ...shadows.card,
  },
  profileAvatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: palette.purple.vivid,
    alignItems: 'center', justifyContent: 'center',
  },
  profileInitials: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
  },
  profileName: { ...type.h2, color: palette.text },
  profileEmail: { ...type.caption, color: palette.textMuted, marginTop: 2 },
  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: palette.purple.soft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  planBadgeText: { ...type.micro, color: palette.purple.on, fontWeight: '700' },
  profileEditButton: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: palette.borderSoft,
    alignItems: 'center', justifyContent: 'center',
  },

  // Grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.xxl,
    ...shadows.card,
  },
  tile: {
    width: '33.33%',
    alignItems: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xs,
    gap: 8,
  },
  tileIcon: {
    width: 52, height: 52, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center',
  },
  tileLabel: {
    ...type.caption,
    color: palette.text,
    fontWeight: '600',
    textAlign: 'center',
  },

  // List card
  listCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    marginBottom: spacing.xxl,
    ...shadows.card,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  listIcon: {
    width: 34, height: 34, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  listLabel: { ...type.bodyBold, color: palette.text, flex: 1 },
  divider: {
    height: 1,
    backgroundColor: palette.borderSoft,
    marginHorizontal: spacing.lg,
  },

  // Sign out
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: palette.rose.soft,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    marginBottom: spacing.lg,
  },
  signOutText: { ...type.bodyBold, color: palette.rose.on, fontWeight: '700' },

  // Version
  version: {
    ...type.caption,
    color: palette.textLight,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
});
