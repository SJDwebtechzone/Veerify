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

import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import apiClient from '../../../api/client';
import {
  UserCog, BookOpen, Building2, CalendarRange, Bell, Megaphone,
  MessageSquare, BarChart3, Palette, CreditCard, Settings, LifeBuoy,
  LogOut, ChevronRight, Edit3, ShieldCheck, Layers, KeyRound, MapPin,
  Award, FileText,
} from 'lucide-react-native';

import { useAuth } from '../../../context/AuthContext';
import { palette, spacing, radius, shadows, type } from '../../../theme';
import { confirm } from '../../../components/ConfirmDialog';

// ─── Menu definition ─────────────────────────────────────────────────────────
const MENU = [
  { key: 'trainers',      label: 'Trainers',         icon: UserCog,        accent: palette.purple },
  { key: 'courses',       label: 'Courses',          icon: BookOpen,       accent: palette.blue   },
  // "Batches" — full list of every batch the institution admin has
  // created. Reuses the existing BatchesList screen registered in the
  // root navigator.
  { key: 'batches',       label: 'Batches',          icon: Layers,         accent: palette.teal   },
  { key: 'branches',      label: 'Branches',         icon: Building2,      accent: palette.green  },
  { key: 'events',        label: 'Events',           icon: CalendarRange,  accent: palette.orange },
  { key: 'certificates',  label: 'Certificates',     icon: Award,          accent: palette.rose   },
  // Salary — monthly payroll for the institution's trainers. Admin
  // picks a trainer, sees their read-only Basic Salary from the
  // trainer profile, enters Deductions, and saves a per-month slip.
  { key: 'salary',        label: 'Salary',           icon: CreditCard,     accent: palette.teal   },
  // ── Note: About Academy, Academy Rules, Attendance Policy, Belt
  //    Test Policy, and Certificate Templates were previously here
  //    in the main grid. They've all moved into their own "Academy"
  //    section (rendered below the grid + right above the account
  //    shortcuts card) so admins can find every academy-configuration
  //    entry point in one place. Platform Information also moved out
  //    — it's now the "Legal" row in the account shortcuts card.
  // { key: 'notifications', label: 'Notifications',    icon: Bell,           accent: palette.pink   },
  // { key: 'announcements', label: 'Announcements',    icon: Megaphone,      accent: palette.teal   },
  // { key: 'feedback',      label: 'Feedback',         icon: MessageSquare,  accent: palette.rose   },
  // { key: 'reports',       label: 'Reports',          icon: BarChart3,      accent: palette.purple },
  { key: 'branding',      label: 'Branding',         icon: Palette,        accent: palette.blue   },
  { key: 'pricing',       label: 'Pricing & Plans',  icon: CreditCard,     accent: palette.green  },
  { key: 'settings',      label: 'Settings',         icon: Settings,       accent: palette.orange },
  { key: 'support',       label: 'Support',          icon: LifeBuoy,       accent: palette.pink   },
];

// ── Academy section — every institution-managed policy in one place.
// Rendered as a labeled list card above the account shortcuts so admins
// can find their 5 academy-configuration screens without hunting through
// the main tile grid. Certificate Templates lives here too because it's
// an academy-owned deliverable configuration.
const ACADEMY_ITEMS = [
  { key: 'about_academy',         label: 'About Academy',       accent: palette.blue   },
  { key: 'academy_rules',         label: 'Academy Rules',       accent: palette.orange },
  { key: 'attendance_policy',     label: 'Attendance Policy',   accent: palette.green  },
  { key: 'belt_test_policy',      label: 'Belt Test Policy',    accent: palette.rose   },
  { key: 'certificate_templates', label: 'Certificate Templates', accent: palette.purple },
];

export default function MoreTabScreen({ navigation }) {
  const { user, logout } = useAuth();
  const placeholder = (m) => Alert.alert(m, "We'll wire this up next.");

  // Read the institution's actual plan name + status from /plans/usage
  // (same endpoint the FAB gate uses). Falls back to a generic label
  // while it's loading or if the request fails, so we never block the
  // rest of the More screen on a slow network.
  const [planLabel, setPlanLabel] = useState('Loading plan…');
  // isSubBranch drives whether we render the "Update Location" ListRow.
  // We derive it from /institutions/me/details.parent_institution_id.
  // Main-branch admins have parent_institution_id = null, so the row
  // stays hidden for them (they edit head-office location via Settings).
  const [isSubBranch, setIsSubBranch] = useState(false);
  useEffect(() => {
    let cancelled = false;
    apiClient.get('/plans/usage')
      .then((r) => {
        if (cancelled) return;
        const name = r.data?.students?.plan_name || r.data?.trainers?.plan_name;
        // Show "<Plan> Plan • Active" — matches the layout the screen
        // had hard-coded before but now reflects the real DB value.
        setPlanLabel(name ? `${name} Plan • Active` : 'Free Plan • Active');
      })
      .catch(() => {
        if (!cancelled) setPlanLabel('Free Plan • Active');
      });
    // Separate probe — /me/details tells us if this admin is a sub-branch.
    apiClient.get('/institutions/me/details')
      .then((r) => {
        if (cancelled) return;
        const inst = r.data?.institution || r.data || {};
        setIsSubBranch(!!inst.parent_institution_id);
      })
      .catch(() => { /* not fatal — row just stays hidden */ });
    return () => { cancelled = true; };
  }, []);

  // Real navigation targets for tiles that already have screens built.
  const TILE_ROUTES = {
    courses:  'CoursesList',
    trainers: 'TrainersList',
    batches:  'BatchesList',
    settings: 'Settings',
    // Branches tile opens the institution's read-only branch roster.
    // Scoped server-side to the caller's root (parent) institution so a
    // sub-branch admin sees the same list a main-branch admin sees.
    branches: 'BranchesList',
    // Events tile opens the list of every event this institution has
    // published (upcoming + past), with a FAB to add a new one. The
    // create flow lives inside that screen.
    events:   'EventsList',
    // Certificates queue — students awaiting certificate dispatch after
    // a trainer submits their belt-test remarks.
    certificates: 'AdminCertificates',
    certificate_templates: 'CertificateTemplates',
    // Salary — per-month payroll workflow. Opens the trainer list;
    // tapping a trainer expands the monthly slip editor inline.
    salary:   'AdminSalary',
    // Pricing & Plans — shows current subscription + renewal + the
    // catalog of other plans (super admin defined). "Renew" on current
    // and "Upgrade/Downgrade/Switch" on alternates all route through to
    // the existing PlanSelection payment flow.
    pricing:  'PricingPlans',
    // Branding → promotional banners shown on student / trainer
    // dashboards. Each banner picks its own audience: student-only,
    // trainer-only, or both.
    branding: 'InstitutionBranding',
  };
  // Institution-scoped policy slugs are handled inline — they all
  // route to the same InstitutionLegal editor with different slugs.
  const LEGAL_SLUGS = new Set([
    'about_academy', 'academy_rules', 'attendance_policy', 'belt_test_policy',
  ]);
  const handleTile = (key, label) => {
    if (LEGAL_SLUGS.has(key)) {
      navigation.navigate('InstitutionLegal', { slug: key });
      return;
    }
    // Legal → the shared LegalScreen in platform-only mode. Header
    // matches the tap target so the user lands on a screen titled
    // "Legal", not the internal "Platform Information" name.
    if (key === 'platform_information') {
      navigation.navigate('Legal', {
        platformOnly: true,
        pageTitle:    'Legal',
        pageSubtitle: 'Veerify\'s platform policies. Updates by admin appear here automatically.',
      });
      return;
    }
    const route = TILE_ROUTES[key];
    if (route) navigation.navigate(route);
    else placeholder(label);
  };

  const handleSignOut = () => {
    confirm({
      title: 'Sign out?',
      message: 'You\'ll be returned to the welcome screen.',
      variant: 'destructive',
      confirmText: 'Sign out',
      cancelText: 'Cancel',
      onConfirm: () => logout(),
    });
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

      {/* ───── Profile card ─────
          Tapping opens the full Academy Profile screen (view mode by
          default; pencil in the top-right toggles edit mode). */}
      <TouchableOpacity
        style={styles.profileCard}
        onPress={() => navigation.navigate('AcademyProfile')}
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
            <Text style={styles.planBadgeText}>{planLabel}</Text>
          </View>
        </View>
        {/* Edit pencil removed per user request — the profile card
            itself is still tappable, but the small right-side icon was
            redundant with that and not yet wired to an edit screen. */}
      </TouchableOpacity>

      {/* ───── Grid menu ─────
          Sub-branch admins get a trimmed menu — tiles that belong to
          the main institution (Trainers roster, Branches list,
          Branding banners, Pricing & Plans) are hidden. Their branch
          only manages day-to-day (Courses handled, Batches, Events,
          Settings, Support). Main admins still see the full grid. */}
      <View style={styles.grid}>
        {MENU
          .filter((item) => !(
            isSubBranch && ['trainers', 'branches', 'branding', 'pricing'].includes(item.key)
          ))
          .map((item) => (
            <MenuTile
              key={item.key}
              label={item.label}
              icon={item.icon}
              accent={item.accent}
              onPress={() => handleTile(item.key, item.label)}
            />
          ))}
      </View>

      {/* ───── Academy section ─────
          Every institution-configuration screen in one labeled group,
          placed above the account shortcuts so admins know exactly
          where their academy policies live. Certificate Templates
          rounds out the group since it's also an academy-owned
          deliverable configuration. */}
      <Text style={styles.sectionLabel}>ACADEMY</Text>
      <View style={styles.listCard}>
        {ACADEMY_ITEMS.map((item, i) => (
          <React.Fragment key={item.key}>
            {i > 0 ? <View style={styles.divider} /> : null}
            <ListRow
              icon={FileText}
              label={item.label}
              accent={item.accent}
              onPress={() => handleTile(item.key, item.label)}
            />
          </React.Fragment>
        ))}
      </View>

      {/* ───── Account shortcuts ─────
          Replaces the old "Privacy & Security" placeholder row with a
          real "Legal" entry that opens the read-only Platform
          Information viewer (T&C, Privacy, Refund, Child Safety,
          Contact & Support). Rest of the account shortcuts stay put. */}
      <View style={styles.listCard}>
        <ListRow
          icon={ShieldCheck}
          label="Legal"
          accent={palette.green}
          onPress={() => handleTile('platform_information', 'Legal')}
        />
        {/* Update Location — sub-branch admins only. Lets them pin
            their branch's GPS + address so it lands correctly in the
            student-side Academies Nearby search. Sits above Change
            Password per product spec. */}
        {isSubBranch ? (
          <>
            <View style={styles.divider} />
            <ListRow
              icon={MapPin}
              label="Update Location"
              accent={palette.orange}
              onPress={() => navigation.navigate('UpdateLocation')}
            />
          </>
        ) : null}
        <View style={styles.divider} />
        {/* Change Password — wired to the shared ChangePasswordScreen
            so users (especially sub-branch admins who picked "I'll do
            it later" on the first-login dialog) can rotate their temp
            password whenever they want. */}
        <ListRow
          icon={KeyRound}
          label="Change Password"
          accent={palette.purple}
          onPress={() => navigation.navigate('ChangePassword')}
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
          onPress={() => navigation.navigate('SendFeedback')}
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

  // Small uppercase section label — used above the Academy list card
  // so the group has a visible heading matching the rest of the app.
  sectionLabel: {
    ...type.micro,
    color: palette.textMuted,
    fontWeight: '800',
    letterSpacing: 0.6,
    paddingHorizontal: 4,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
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
    marginTop: spacing.md,
  },
});

