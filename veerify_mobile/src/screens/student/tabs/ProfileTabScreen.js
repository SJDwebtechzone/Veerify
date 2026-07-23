// src/screens/student/tabs/ProfileTabScreen.js
//
// Student-facing Profile tab — two completely different views:
//
//   1. Guest view  → welcome card with Login / Sign up / View Plans CTAs
//                    + a small "explore as guest" hint
//   2. Logged-in   → profile card (avatar + name + email + plan pill),
//                    subscription card (current plan / upgrade CTA),
//                    grid of menu items (Enrolled / Attendance / Certificates
//                    / Payments / Referrals / Settings / Help / Sign Out)
//
// Subscription state is hard-coded to "free" for now — Phase 2 wires the real
// /api/subscriptions/me endpoint.

import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Share, Image,
} from 'react-native';
import {
  LogIn, UserPlus, Sparkles, ChevronRight, GraduationCap, ClipboardCheck,
  Award, Wallet, Gift, Settings, LifeBuoy, LogOut, ShieldCheck, Edit3,
  Crown, Lock, Star, KeyRound, MessageSquare, FileText, HelpCircle,
} from 'lucide-react-native';

import { useAuth } from '../../../context/AuthContext';
import { useInstitution } from '../../../context/InstitutionContext';
import { palette, spacing, radius, shadows, type } from '../../../theme';
import { useBellScrollHandler } from '../../../components/bellScrollBus';
import { confirm } from '../../../components/ConfirmDialog';

export default function ProfileTabScreen({ navigation }) {
  const { user, logout } = useAuth();
  const { selectedInstitution } = useInstitution();

  const isGuest = !user;
  // Phase 2 will hydrate this from /api/subscriptions/me
  const subscription = null; // null = no active sub

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: 60 }}
      showsVerticalScrollIndicator={false}
      onScroll={useBellScrollHandler()}
      scrollEventThrottle={16}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{isGuest ? 'You' : 'My Profile'}</Text>
        <Text style={styles.subtitle}>
          {isGuest
            ? 'Sign in to enroll, save progress, and access live classes.'
            : 'Manage your subscription, enrollments, and settings.'}
        </Text>
      </View>

      {isGuest ? (
        <GuestView navigation={navigation} />
      ) : (
        <LoggedInView
          user={user}
          subscription={subscription}
          selectedInstitution={selectedInstitution}
          onLogout={logout}
          navigation={navigation}
        />
      )}
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Guest view
// ─────────────────────────────────────────────────────────────────────────────
function GuestView({ navigation }) {
  const goToLogin = () => navigation.getParent()?.navigate('Login');
  const goToRegister = () => navigation.getParent()?.navigate('Register');
  const placeholder = (n) => Alert.alert(n, "We'll wire this up next.");

  return (
    <View style={{ paddingHorizontal: spacing.xl, gap: spacing.lg }}>
      {/* Hero card */}
      <View style={styles.guestHero}>
        {/* Brand mark — circular tile holding the Veerify logo. Replaces
            the wave-hand emoji we had as a placeholder so the guest hero
            opens with the actual brand identity. */}
        <View style={styles.guestLogo}>
          <Image
            source={require('../../../assets/veerify-logo.png')}
            style={styles.guestLogoImage}
            resizeMode="cover"
          />
        </View>
        <Text style={styles.guestTitle}>Welcome to Veerify</Text>
        <Text style={styles.guestBody}>
          Browse academies, programs, and live classes as a guest. Sign in to
          enroll, track progress, and unlock premium content.
        </Text>

        <TouchableOpacity
          onPress={goToLogin}
          activeOpacity={0.85}
          style={styles.primaryBtn}
        >
          <LogIn size={16} color="#fff" strokeWidth={2.4} />
          <Text style={styles.primaryBtnText}>Login</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={goToRegister}
          activeOpacity={0.85}
          style={styles.secondaryBtn}
        >
          <UserPlus size={16} color={palette.purple.on} strokeWidth={2.4} />
          <Text style={styles.secondaryBtnText}>Sign up — it's free</Text>
        </TouchableOpacity>
      </View>

      {/* "See subscription plans" CTA intentionally removed from the
          guest Profile view — the paywall flow only makes sense once
          the user has signed in, so we don't promote it to anonymous
          visitors. Login / Sign up remain the primary actions. */}

      {/* Why sign up */}
      <View style={styles.benefitsCard}>
        <Text style={styles.benefitsTitle}>Why create an account?</Text>
        <Benefit
          icon={GraduationCap}
          accent={palette.purple}
          title="Enroll in programs"
          body="Join programs and live classes at any academy."
        />
        <Benefit
          icon={ClipboardCheck}
          accent={palette.green}
          title="Track your progress"
          body="Attendance, completed lessons, and certificates in one place."
        />
        {/* "Refer friends, earn perks" benefit removed alongside the
            More-tab Refer & Earn tile — students no longer see any
            referral messaging on the Profile tab. */}
      </View>
    </View>
  );
}

function Benefit({ icon: Icon, accent, title, body }) {
  return (
    <View style={styles.benefitRow}>
      <View style={[styles.benefitIcon, { backgroundColor: accent.soft }]}>
        <Icon size={18} color={accent.vivid} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.benefitTitle}>{title}</Text>
        <Text style={styles.benefitBody}>{body}</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Logged-in view
// ─────────────────────────────────────────────────────────────────────────────
function LoggedInView({ user, subscription, selectedInstitution, onLogout, navigation }) {
  const initials = (user?.name || 'You')
    .split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const placeholder = (n) => Alert.alert(n, "We'll wire this up next.");

  const handleSignOut = () => {
    confirm({
      title: 'Sign out?',
      message: "You'll return to the welcome screen.",
      variant: 'destructive',
      confirmText: 'Sign out',
      cancelText: 'Cancel',
      onConfirm: () => onLogout(),
    });
  };

  const handleReferral = async () => {
    const code = `VEER${(user?.id || 0).toString().padStart(4, '0')}`;
    const link = `https://veerify.app/register?ref=${code}`;
    try {
      await Share.share({
        message: `Join me on Veerify — India's #1 martial arts platform! Use my link to sign up: ${link}`,
      });
    } catch (e) {
      Alert.alert('Could not share', e?.message || 'Try again.');
    }
  };

  return (
    <View style={{ paddingHorizontal: spacing.xl, gap: spacing.lg }}>
      {/* Profile card */}
      <View style={styles.profileCard}>
        <View style={styles.avatarWrap}>
          {user?.profile_image ? (
            <Image source={{ uri: user.profile_image }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: palette.purple.vivid }]}>
              <Text style={styles.avatarInitial}>{initials}</Text>
            </View>
          )}
          {/* Small pencil overlay on the avatar — one-tap shortcut into
              the Edit Profile screen. Both this and the "Edit Profile"
              button below route to the same StudentEditProfile screen. */}
          <TouchableOpacity
            onPress={() => navigation.navigate('StudentEditProfile')}
            style={styles.editPencil}
          >
            <Edit3 size={11} color="#fff" strokeWidth={2.6} />
          </TouchableOpacity>
        </View>
        <Text style={styles.profileName}>{user?.name || '—'}</Text>
        <Text style={styles.profileEmail}>{user?.email}</Text>
        {selectedInstitution?.name ? (
          <View style={styles.atPill}>
            <Text style={styles.atPillText}>at {selectedInstitution.name}</Text>
          </View>
        ) : null}

        {/* Prominent Edit Profile CTA — larger and more discoverable
            than the small pencil overlay alone. */}
        <TouchableOpacity
          onPress={() => navigation.navigate('StudentEditProfile')}
          style={styles.editProfileBtn}
          activeOpacity={0.85}
        >
          <Edit3 size={13} color={palette.purple.vivid} strokeWidth={2.6} />
          <Text style={styles.editProfileBtnText}>Edit Profile</Text>
        </TouchableOpacity>
      </View>

      {/* Subscription card — only renders when the student already has an
          active subscription. The "Upgrade to Premium" CTA that used to
          appear for non-subscribers has been removed; we don't promote
          paid plans to students from the Profile tab anymore. */}
      {subscription ? (
        <View style={[styles.subCard, { backgroundColor: palette.purple.vivid }]}>
          <Crown size={22} color="#fff" strokeWidth={2.2} />
          <View style={{ flex: 1 }}>
            <Text style={styles.subCardTitle}>{subscription.name}</Text>
            <Text style={styles.subCardBody}>
              Active until {subscription.expires_at || '—'}
            </Text>
          </View>
          <TouchableOpacity onPress={() => placeholder('Manage Plan')}>
            <ChevronRight size={20} color="#fff" strokeWidth={2.4} />
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Grid menu */}
      <View style={styles.grid}>
        <Tile icon={GraduationCap}  label="Enrolled Programs" accent={palette.purple} onPress={() => navigation.navigate('StudentEnrolledPrograms')} />
        <Tile icon={ClipboardCheck} label="Attendance"        accent={palette.green}  onPress={() => navigation.navigate('StudentAttendance')} />
        <Tile icon={Star}           label="My Performance"    accent={palette.orange} onPress={() => navigation.navigate('StudentPerformanceReports')} />
        <Tile icon={Award}          label="Belts & Certs"     accent={palette.teal}   onPress={() => navigation.navigate('StudentBeltJourney')} />
        <Tile icon={Wallet}         label="Payments"          accent={palette.blue}   onPress={() => navigation.navigate('StudentPayments')} />
        {/* Refer & Earn removed from the student More tab per product
            request. The tile lives elsewhere for roles where the
            referral program actually pays out (admin), and re-enabling
            it here later is a one-line uncomment. */}
        {/* <Tile icon={Gift}           label="Refer & Earn"      accent={palette.pink}   onPress={handleReferral} /> */}
        {/* <Tile icon={Settings}       label="Settings"          accent={palette.teal}   onPress={() => placeholder('Settings')} /> */}
      </View>

      {/* List shortcuts */}
      <View style={styles.listCard}>
        {/* Legal — replaces the old "Privacy & Security" placeholder
            row. Opens the read-only viewer for T&C, Privacy, Refund,
            Child Safety (platform) and Academy Rules (institution).
            Backend gates visibility by role so the screen just renders
            what it's given. */}
        <ListRow
          icon={FileText}
          label="Legal"
          accent={palette.green}
          onPress={() => navigation.navigate('Legal')}
        />
        <View style={styles.divider} />
        {/* Change Password — same screen the first-login dialog routes
            into. Lets students who picked "I'll do it later" rotate
            their temp password whenever they want. */}
        <ListRow
          icon={KeyRound}
          label="Change Password"
          accent={palette.purple}
          onPress={() => navigation.navigate('ChangePassword')}
        />
        <View style={styles.divider} />
        <ListRow icon={LifeBuoy}    label="Support"             accent={palette.blue}  onPress={() => navigation.navigate('Support')} />
        <View style={styles.divider} />
        {/* FAQs — dynamic content published from the super-admin web
            panel. Filtered on the student role so the answers apply
            to enrolments, payments, attendance, certificates, etc. */}
        <ListRow icon={HelpCircle}  label="FAQs"                accent={palette.orange} onPress={() => navigation.navigate('Faq')} />
        <View style={styles.divider} />
        <ListRow
          icon={MessageSquare}
          label="Send Feedback"
          accent={palette.pink}
          onPress={() => navigation.navigate('SendFeedback')}
        />
      </View>

      {/* Sign out */}
      <TouchableOpacity
        onPress={handleSignOut}
        activeOpacity={0.85}
        style={styles.signOutBtn}
      >
        <LogOut size={18} color={palette.rose.on} strokeWidth={2.2} />
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>

      <Text style={styles.version}>Veerify · v1.0.0</Text>
    </View>
  );
}

function Tile({ icon: Icon, label, accent, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.tile}>
      <View style={[styles.tileIcon, { backgroundColor: accent.soft }]}>
        <Icon size={22} color={accent.vivid} strokeWidth={2.2} />
      </View>
      <Text style={styles.tileLabel} numberOfLines={2}>{label}</Text>
    </TouchableOpacity>
  );
}

function ListRow({ icon: Icon, label, accent, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={styles.listRow}>
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

  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  title: { ...type.display, color: palette.text },
  subtitle: { ...type.caption, color: palette.textMuted, marginTop: 4 },

  // Guest hero
  guestHero: {
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    ...shadows.card,
  },
  guestEmoji: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  // Brand-logo tile — mirrors the LoginScreen.brandBlock treatment so the
  // navy/V logo PNG is rendered correctly. The image fills the entire
  // circle (same size, same borderRadius applied to the image itself) and
  // resizeMode="cover" lets the PNG's built-in navy background BE the
  // tile's background, instead of leaving an awkward square inside a
  // pink circle. overflow:'hidden' clips any edge bleed.
  guestLogo: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: '#0E1A2E',          // logo navy — matches PNG bg
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  guestLogoImage: {
    width: 84, height: 84, borderRadius: 42,
  },
  guestTitle: { ...type.h1, color: palette.text, marginBottom: 6, textAlign: 'center' },
  guestBody: {
    ...type.body, color: palette.textMuted,
    textAlign: 'center', maxWidth: 320,
    marginBottom: spacing.xl,
  },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: palette.purple.vivid,
    width: '100%',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    ...shadows.raised,
  },
  primaryBtnText: { ...type.bodyBold, color: '#fff' },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: palette.purple.soft,
    width: '100%',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  secondaryBtnText: { ...type.bodyBold, color: palette.purple.on },

  // Plan CTA
  planCta: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: palette.purple.vivid,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadows.raised,
  },
  planCtaIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  planCtaTitle: { ...type.h3, color: '#fff', fontSize: 15 },
  planCtaBody: { ...type.caption, color: 'rgba(255,255,255,0.85)', marginTop: 2 },

  // Benefits
  benefitsCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.lg,
    ...shadows.card,
  },
  benefitsTitle: { ...type.h2, color: palette.text },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  benefitIcon: {
    width: 36, height: 36, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  benefitTitle: { ...type.bodyBold, color: palette.text },
  benefitBody: { ...type.caption, color: palette.textMuted, marginTop: 2 },

  // Profile card
  profileCard: {
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    ...shadows.card,
  },
  avatarWrap: { position: 'relative', marginBottom: spacing.md },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { color: '#fff', fontSize: 28, fontWeight: '800' },
  editPencil: {
    position: 'absolute',
    bottom: -2, right: -2,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: palette.purple.vivid,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: palette.surface,
  },
  profileName: { ...type.h1, color: palette.text },
  profileEmail: { ...type.caption, color: palette.textMuted, marginTop: 2 },
  atPill: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: 4,
    backgroundColor: palette.purple.soft,
    borderRadius: radius.pill,
  },
  atPillText: { ...type.micro, color: palette.purple.on, fontWeight: '700' },

  // Prominent Edit Profile CTA on the profile card. Soft-purple
  // outline pill sits below the "at <institution>" line.
  editProfileBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginTop: spacing.md,
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: palette.purple.soft,
    borderWidth: 1, borderColor: palette.purple.vivid,
  },
  editProfileBtnText: {
    fontSize: 12, fontWeight: '800', color: palette.purple.vivid,
    letterSpacing: 0.3,
  },

  // Subscription card (active)
  subCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadows.raised,
  },
  subCardTitle: { ...type.h3, color: '#fff' },
  subCardBody: { ...type.caption, color: 'rgba(255,255,255,0.85)', marginTop: 2 },

  // Upgrade card (no sub)
  upgradeCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: palette.purple.vivid,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadows.raised,
  },
  upgradeIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  upgradeTitle: { ...type.h3, color: '#fff', fontSize: 15 },
  upgradeBody: { ...type.caption, color: 'rgba(255,255,255,0.85)', marginTop: 2 },

  // Grid
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
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
  tileLabel: { ...type.caption, color: palette.text, fontWeight: '600', textAlign: 'center' },

  // List card
  listCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    ...shadows.card,
  },
  listRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
  },
  listIcon: {
    width: 34, height: 34, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  listLabel: { ...type.bodyBold, color: palette.text, flex: 1 },
  divider: { height: 1, backgroundColor: palette.borderSoft, marginHorizontal: spacing.lg },

  // Sign out
  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: palette.rose.soft,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
  },
  signOutText: { ...type.bodyBold, color: palette.rose.on, fontWeight: '700' },

  version: {
    ...type.caption,
    color: palette.textLight,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
