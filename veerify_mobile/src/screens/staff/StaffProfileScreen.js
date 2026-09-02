// src/screens/staff/StaffProfileScreen.js
//
// Step 8 of the Staff module - trainer profile.
//
// Layout (top to bottom):
//   1. Red hero - back button, "Profile" title, large white avatar with red
//      initials, name, designation (specialization), institution.
//   2. Quick-stat strip - Experience years / Batches assigned / Students.
//   3. About card - email + phone + belt level + bio.
//   4. Assigned batches - tappable rows that jump to StaffAttendance for
//      that batch.
//   5. Account settings list - Salary details, Change password, Notifications.
//   6. Logout button (rose accent).
//
// Data:
//   GET /api/trainers/me            - profile + aggregates
//   POST /api/auth/change-password  - secure password change

import React, { useEffect, useState, useCallback, useContext, useMemo, createContext } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet,
  Alert, Modal, TextInput, RefreshControl,
} from 'react-native';
import {
  ArrowLeft, Mail, Phone, Award, BookOpen, Briefcase, Lock,
  Wallet, LogOut, ChevronRight, X as XIcon, Eye, EyeOff,
  GraduationCap, Users, Calendar, MessageSquare, FileText, LifeBuoy,
  HelpCircle,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { palette, spacing, radius, shadows, type } from '../../theme';
import { confirm } from '../../components/ConfirmDialog';
import { formatBatchTime } from '../../utils/formatTime';
import ThemeToggle from '../../components/ThemeToggle';
// Match the Institution Home visual system exactly — ambient
// light-blue wash + glow blobs + translucent glass cards with a
// glossy top-edge highlight and cool cobalt drop-shadow. The design
// tokens below (GLASS_FILL, dark-blue accent, etc.) mirror the
// values used in AdminDashboardScreen so this screen belongs to
// the same design system without approximation.
import InstitutionScreenBackground, {
  INSTITUTION_BG_BASE,
} from '../../components/InstitutionScreenBackground';
import { useTheme } from '../../theme/ThemeContext';

// ── Institution-Home glass tokens ────────────────────────────────
// Verbatim copies from AdminDashboardScreen.js so the two screens
// render identical surfaces without a shared theme module. If those
// values shift on the source, mirror the same values here.
const GLASS_FILL         = 'rgba(255,255,255,0.72)';
const GLASS_FILL_STRONG  = 'rgba(255,255,255,0.88)';
const GLASS_BORDER_LIGHT = 'rgba(255,255,255,0.55)';
const GLASS_HIGHLIGHT    = 'rgba(255,255,255,0.9)';
const GLASS_SHADOW       = '#1E40AF';   // cool cobalt shadow
// Dark-blue primary + soft-accent (icon halo) that the Institution
// dashboard uses everywhere for its ctas and header bar.
const BRAND_DARK_BLUE    = '#1E3A8A';
const BRAND_ACCENT_SOFT  = 'rgba(30,58,138,0.10)';
const HEADER_NAVY        = '#0F172A';   // navy header used on admin

// Local context — sub-components (StatPill, Card, InfoRow, SettingRow)
// consume `{ isDark, dark }` so they can layer dark-mode overrides on
// their `style` arrays without prop-drilling through every render.
// Only surfaces (bg / text / borders) shift for dark mode; the glass
// concept and layout stay identical.
const StaffCtx = createContext({ isDark: false, dark: {} });

function buildDarkOverrides(pal) {
  return StyleSheet.create({
    statPill:       { backgroundColor: pal.surface, borderTopColor: pal.border, borderRightColor: pal.border, borderBottomColor: pal.border, borderLeftColor: pal.border },
    statPillValue:  { color: pal.text },
    statPillLabel:  { color: pal.textMuted },
    card:           { backgroundColor: pal.surface, borderTopColor: pal.border, borderRightColor: pal.border, borderBottomColor: pal.border, borderLeftColor: pal.border },
    cardTitle:      { color: pal.text },
    cardSubtitle:   { color: pal.textMuted },
    infoLabel:      { color: pal.textMuted },
    infoValue:      { color: pal.text },
    divider:        { backgroundColor: pal.border },
    bioLabel:       { color: pal.textMuted },
    bioText:        { color: pal.text },
    joinedText:     { color: pal.textLight },
    placeholderText:{ color: pal.textMuted },
    batchRow:       { backgroundColor: pal.border, borderColor: pal.border },
    batchName:      { color: pal.text },
    batchMetaText:  { color: pal.textMuted },
    settingLabel:   { color: pal.text },
    settingDesc:    { color: pal.textMuted },
  });
}

export default function StaffProfileScreen({ navigation }) {
  const { user, logout } = useAuth();
  // Dark-mode adaptation: light mode paints the Institution ambient
  // (fixed light-blue SVG blobs) behind everything. Dark mode swaps
  // to the theme's dark surface + text colours via inline overrides
  // on each card so the same layout stays readable without recolouring
  // the ambient SVG (which is intentionally fixed for brand identity).
  const { mode, palette: themePalette } = useTheme();
  const isDark = mode === 'dark';
  const p = themePalette; // shorthand for inline overrides
  const dark = useMemo(() => buildDarkOverrides(p), [p]);
  const ctxValue = useMemo(() => ({ isDark, dark }), [isDark, dark]);
  const [profile, setProfile] = useState(null);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [profRes, batchRes] = await Promise.all([
        apiClient.get('/trainers/me').catch(() => ({ data: { trainer: null } })),
        apiClient.get('/batches/trainer/my').catch(() => ({ data: { batches: [] } })),
      ]);
      setProfile(profRes.data?.trainer || null);
      setBatches(batchRes.data?.batches || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const confirmLogout = () => {
    // eslint-disable-next-line no-console
    console.log('[Staff] SIGN OUT TAPPED @', new Date().toISOString(),
      'logout typeof =', typeof logout);
    // Sledgehammer: skip any dialog and log out immediately. If this
    // doesn't fire, the bundle didn't reload. If this fires but the
    // app stays on the trainer stack, the issue is inside logout() /
    // AuthContext.
    if (typeof logout === 'function') {
      // eslint-disable-next-line no-console
      console.log('[Staff] invoking logout() directly');
      logout();
    } else {
      // eslint-disable-next-line no-console
      console.log('[Staff] logout is not a function — AuthContext broken?');
    }
  };

  // ── Render ──
  const fallbackName = user?.name || 'Trainer';
  const displayName = profile?.name || fallbackName;
  const designation = profile?.specialization || 'Martial Arts Trainer';
  const initials = displayName.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <StaffCtx.Provider value={ctxValue}>
    <View style={[
      styles.screen,
      isDark && { backgroundColor: p.bg },
    ]}>
      {/* Ambient Institution wash — light-blue vertical gradient +
          two low-opacity glow blobs. Painted absolutely behind
          everything with pointerEvents="none" so taps still pass
          through. Skipped in dark mode where the ambient light
          palette would clash with the dark surfaces. */}
      {!isDark ? <InstitutionScreenBackground layer /> : null}
      <ScrollView
        style={{ flex: 1 }}
        // Floating bottom tab bar (~64px tall + ~14-24px gap) hides the
        // Sign out button if we only pad by spacing.xxxl. Use 120 so the
        // CTA sits comfortably above the tab bar.
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={BRAND_DARK_BLUE}
          />
        }
      >
        {/* Red hero — kept INSIDE the ScrollView so it scrolls with the
            content. When the hero was outside, the Experience stat strip
            and Email row got hidden behind it as the user scrolled. */}
        <View style={styles.hero}>
          <View style={styles.heroTopRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.heroIconBtn}>
              <ArrowLeft size={20} color="#fff" strokeWidth={2.4} />
            </TouchableOpacity>
            <Text style={styles.heroTitle}>Profile</Text>
            <View style={{ width: 36 }} />
          </View>

          <View style={styles.heroBody}>
            <View style={styles.heroAvatar}>
              <Text style={styles.heroAvatarText}>{initials}</Text>
            </View>
            <Text style={styles.heroName} numberOfLines={1}>{displayName}</Text>
            <Text style={styles.heroDesignation} numberOfLines={1}>{designation}</Text>
            {profile?.institution_name ? (
              <View style={styles.heroInstitution}>
                <GraduationCap size={11} color="rgba(255,255,255,0.85)" strokeWidth={2.4} />
                <Text style={styles.heroInstitutionText} numberOfLines={1}>{profile.institution_name}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Stat strip */}
        <View style={styles.statStrip}>
          <StatPill
            icon={Briefcase}
            label="Experience"
            value={profile?.experience_years ? `${profile.experience_years}y` : '-'}
            accent={palette.orange}
          />
          <StatPill
            icon={BookOpen}
            label="Batches"
            value={profile?.assigned_batches ?? batches.length ?? 0}
            accent={palette.blue}
          />
          <StatPill
            icon={Users}
            label="Students"
            value={profile?.total_students ?? 0}
            accent={palette.green}
          />
        </View>

        {/* About */}
        <Card title="About" icon={Award}>
          {loading ? (
            <ActivityIndicator color={BRAND_DARK_BLUE} />
          ) : (
            <>
              <InfoRow icon={Mail}  label="Email" value={profile?.email || user?.email || '-'} />
              <Divider />
              <InfoRow icon={Phone} label="Phone" value={profile?.phone || user?.phone || '-'} />
              {profile?.belt_level ? (
                <>
                  <Divider />
                  <InfoRow icon={Award} label="Belt level" value={profile.belt_level} />
                </>
              ) : null}
              {profile?.bio ? (
                <>
                  <Divider />
                  <View style={styles.bioWrap}>
                    <Text style={[styles.bioLabel, isDark && dark.bioLabel]}>BIO</Text>
                    <Text style={[styles.bioText, isDark && dark.bioText]}>{profile.bio}</Text>
                  </View>
                </>
              ) : null}
              {profile?.joined_at ? (
                <Text style={[styles.joinedText, isDark && dark.joinedText]}>
                  Joined {new Date(profile.joined_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
                </Text>
              ) : null}
            </>
          )}
        </Card>

        {/* Assigned batches */}
        <Card title="Assigned batches" icon={BookOpen} subtitle={`${batches.length} ${batches.length === 1 ? 'batch' : 'batches'}`}>
          {batches.length === 0 ? (
            <Text style={[styles.placeholderText, isDark && dark.placeholderText]}>
              No batches assigned yet. Your admin can assign you to a batch.
            </Text>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {batches.map((b) => (
                <TouchableOpacity
                  key={b.id}
                  style={[styles.batchRow, isDark && dark.batchRow]}
                  onPress={() => navigation.navigate('StaffAttendance', { batchId: b.id })}
                  activeOpacity={0.85}
                >
                  <View style={styles.batchIcon}>
                    <BookOpen size={16} color={BRAND_DARK_BLUE} strokeWidth={2.4} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.batchName, isDark && dark.batchName]} numberOfLines={1}>{b.name}</Text>
                    <View style={styles.batchMeta}>
                      {b.days_of_week ? <Text style={[styles.batchMetaText, isDark && dark.batchMetaText]}>{b.days_of_week}</Text> : null}
                      {b.start_time ? <Text style={[styles.batchMetaText, isDark && dark.batchMetaText]}>· {formatBatchTime(b.start_time)}</Text> : null}
                      <Text style={[styles.batchMetaText, isDark && dark.batchMetaText]}>· {b.enrolled_count || 0} students</Text>
                    </View>
                  </View>
                  <ChevronRight size={16} color={palette.textLight} strokeWidth={2.2} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </Card>

        {/* Account settings — Payments (salary) is now restored so the
            trainer can see the current month's slip + full history the
            moment their institution admin saves the monthly payroll. */}
        <Card title="Account settings" icon={Lock}>
          <SettingRow
            icon={Wallet}
            accent={palette.green}
            label="Payments"
            description="Current month's slip + salary history"
            onPress={() => navigation.navigate('StaffSalary')}
          />
          <Divider />
          {/* Legal — trainer's read-only view. Backend returns T&C /
              Privacy (platform) + Academy Rules / Belt Test Policy
              (institution) per the role-scoped visibility matrix. */}
          <SettingRow
            icon={FileText}
            accent={palette.teal}
            label="Legal"
            description="Terms, privacy, and academy policies"
            onPress={() => navigation.navigate('Legal')}
          />
          <Divider />
          <SettingRow
            icon={Lock}
            accent={palette.blue}
            label="Change password"
            description="Update your account password"
            onPress={() => setPwOpen(true)}
          />
          <Divider />
          <SettingRow
            icon={MessageSquare}
            accent={palette.pink}
            label="Send Feedback"
            description="Tell us what you think about Veerify"
            onPress={() => navigation.navigate('SendFeedback')}
          />
          <Divider />
          {/* Support — App Support (Veerify platform) and Institution
              Support (the trainer's academy contact email, resolved
              dynamically from the institution's registration data). */}
          <SettingRow
            icon={LifeBuoy}
            accent={palette.purple}
            label="Support"
            description="Contact Veerify or your academy"
            onPress={() => navigation.navigate('Support')}
          />
          <Divider />
          {/* FAQs — role-scoped dynamic content managed on the
              super-admin web. Trainers see their own bucket
              (batches, payroll, attendance, etc.). */}
          <SettingRow
            icon={HelpCircle}
            accent={palette.orange}
            label="FAQs"
            description="Answers to common trainer questions"
            onPress={() => navigation.navigate('Faq')}
          />
        </Card>

        {/* Preferences — theme switch, persisted via ThemeContext. */}
        <View style={{ marginTop: spacing.lg }}>
          <ThemeToggle
            label="Dark Mode"
            hint="Switch between light and dark theme."
          />
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={confirmLogout} activeOpacity={0.85}>
          <LogOut size={18} color={'#B91C1C'} strokeWidth={2.4} />
          <Text style={styles.logoutBtnText}>Sign out NOW</Text>
        </TouchableOpacity>

        <Text style={styles.version}>Veerify · v1.0.0</Text>
      </ScrollView>

      {/* Change password modal */}
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </View>
    </StaffCtx.Provider>
  );
}

// ─── Change password modal ───────────────────────────────────────────────
function ChangePasswordModal({ open, onClose }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCurrent(''); setNext(''); setConfirm('');
      setShowCurrent(false); setShowNext(false);
    }
  }, [open]);

  const submit = async () => {
    if (!current || !next) { Alert.alert('Both fields are required'); return; }
    if (next.length < 6)   { Alert.alert('New password must be at least 6 characters'); return; }
    if (next !== confirm)  { Alert.alert('New passwords do not match'); return; }
    setSaving(true);
    try {
      await apiClient.post('/auth/change-password', { current_password: current, new_password: next });
      Alert.alert('Password updated', 'Use your new password the next time you log in.');
      onClose();
    } catch (err) {
      Alert.alert('Could not change password', err.response?.data?.message || err.message || 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Change password</Text>
            <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn}>
              <XIcon size={16} color={palette.text} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>

          <PasswordField
            label="Current password"
            value={current}
            onChange={setCurrent}
            show={showCurrent}
            toggleShow={() => setShowCurrent((s) => !s)}
          />
          <PasswordField
            label="New password"
            value={next}
            onChange={setNext}
            show={showNext}
            toggleShow={() => setShowNext((s) => !s)}
            hint="At least 6 characters."
          />
          <PasswordField
            label="Confirm new password"
            value={confirm}
            onChange={setConfirm}
            show={showNext}
            toggleShow={() => setShowNext((s) => !s)}
          />

          <View style={styles.modalActions}>
            <TouchableOpacity onPress={onClose} disabled={saving} style={[styles.modalBtn, styles.modalBtnSecondary]}>
              <Text style={styles.modalBtnSecondaryText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={submit} disabled={saving} style={[styles.modalBtn, styles.modalBtnPrimary]}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalBtnPrimaryText}>Update password</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function PasswordField({ label, value, onChange, show, toggleShow, hint }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.pwLabel}>{label}</Text>
      <View style={styles.pwField}>
        <TextInput
          value={value}
          onChangeText={onChange}
          secureTextEntry={!show}
          placeholder="••••••"
          placeholderTextColor={palette.textLight}
          style={styles.pwInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity onPress={toggleShow} style={styles.pwToggle}>
          {show
            ? <EyeOff size={16} color={palette.textMuted} strokeWidth={2.4} />
            : <Eye    size={16} color={palette.textMuted} strokeWidth={2.4} />}
        </TouchableOpacity>
      </View>
      {hint ? <Text style={styles.pwHint}>{hint}</Text> : null}
    </View>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────
function StatPill({ icon: Icon, label, value, accent }) {
  const { isDark, dark } = useContext(StaffCtx);
  return (
    <View style={[styles.statPill, isDark && dark.statPill]}>
      <View style={[styles.statPillIcon, { backgroundColor: accent.soft }]}>
        <Icon size={14} color={accent.vivid} strokeWidth={2.4} />
      </View>
      <Text style={[styles.statPillValue, isDark && dark.statPillValue]} numberOfLines={1}>{value}</Text>
      <Text style={[styles.statPillLabel, isDark && dark.statPillLabel]}>{label}</Text>
    </View>
  );
}

function Card({ title, icon: Icon, subtitle, children }) {
  const { isDark, dark } = useContext(StaffCtx);
  return (
    <View style={[styles.card, isDark && dark.card]}>
      <View style={styles.cardHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {Icon ? (
            <View style={styles.cardHeaderIcon}>
              <Icon size={12} color={BRAND_DARK_BLUE} strokeWidth={2.4} />
            </View>
          ) : null}
          <Text style={[styles.cardTitle, isDark && dark.cardTitle]}>{title}</Text>
        </View>
        {subtitle ? <Text style={[styles.cardSubtitle, isDark && dark.cardSubtitle]}>{subtitle}</Text> : null}
      </View>
      <View style={styles.cardBody}>{children}</View>
    </View>
  );
}

function InfoRow({ icon: Icon, label, value }) {
  const { isDark, dark } = useContext(StaffCtx);
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <Icon size={14} color={BRAND_DARK_BLUE} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.infoLabel, isDark && dark.infoLabel]}>{label}</Text>
        <Text style={[styles.infoValue, isDark && dark.infoValue]} numberOfLines={1}>{value}</Text>
      </View>
    </View>
  );
}

function Divider() {
  const { isDark, dark } = useContext(StaffCtx);
  return <View style={[styles.divider, isDark && dark.divider]} />;
}

function SettingRow({ icon: Icon, accent, label, description, onPress, muted }) {
  const { isDark, dark } = useContext(StaffCtx);
  return (
    <TouchableOpacity onPress={onPress} style={styles.settingRow} activeOpacity={0.85}>
      <View style={[styles.settingIcon, { backgroundColor: accent.soft }]}>
        <Icon size={14} color={accent.vivid} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[
          styles.settingLabel,
          isDark && dark.settingLabel,
          muted && { color: palette.textMuted },
        ]}>{label}</Text>
        {description ? (
          <Text style={[styles.settingDesc, isDark && dark.settingDesc]}>{description}</Text>
        ) : null}
      </View>
      <ChevronRight size={14} color={palette.textLight} strokeWidth={2.2} />
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────
// Rebuilt to mirror the Institution Home (AdminDashboardScreen)
// design system: light-blue ambient base, translucent white glass
// cards with a glossy top-edge highlight + cool cobalt drop-shadow,
// dark-blue primary accent. Preserves every existing sub-component
// signature — only the visual surface changes.
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: INSTITUTION_BG_BASE },

  // Hero — dark navy header matching the Institution Home top bar,
  // with rounded bottom corners so it reads as an elevated slab
  // rather than a system status bar.
  hero: {
    backgroundColor: HEADER_NAVY,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl + 4,
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroIconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
  },
  heroTitle: { ...type.h2, color: '#fff', fontWeight: '800', letterSpacing: 0.2 },
  heroBody: { alignItems: 'center', marginTop: spacing.lg },
  // Frosted glass avatar so it reads as caught in the header's light.
  heroAvatar: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.5)',
    marginBottom: spacing.md,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  heroAvatarText: { color: BRAND_DARK_BLUE, fontSize: 28, fontWeight: '800' },
  heroName: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center', letterSpacing: 0.2 },
  heroDesignation: { ...type.caption, color: 'rgba(255,255,255,0.9)', fontWeight: '700', marginTop: 4 },
  heroInstitution: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: radius.pill,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
  },
  heroInstitutionText: { ...type.micro, color: 'rgba(255,255,255,0.95)', fontWeight: '700' },

  // Stat strip — three glass tiles that float over the boundary
  // between the navy hero and the ambient wash below (marginTop
  // negative pulls them upward to overlap the hero bottom edge).
  statStrip: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    marginTop: -spacing.md,
  },
  statPill: {
    flex: 1,
    backgroundColor: GLASS_FILL,
    borderRadius: radius.xl,
    padding: spacing.md,
    borderTopWidth: 1.5,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderTopColor: GLASS_HIGHLIGHT,
    borderRightColor: GLASS_BORDER_LIGHT,
    borderBottomColor: GLASS_BORDER_LIGHT,
    borderLeftColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  statPillIcon: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  statPillValue: { ...type.h1, color: HEADER_NAVY, fontSize: 18, fontWeight: '800' },
  statPillLabel: { ...type.micro, color: '#475569', fontWeight: '700', letterSpacing: 0.3 },

  // Card — premium glass surface. Same recipe as the Institution
  // Home quickActions / chart / activity cards.
  card: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    backgroundColor: GLASS_FILL_STRONG,
    borderRadius: radius.xl,
    borderTopWidth: 1.5,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderTopColor: GLASS_HIGHLIGHT,
    borderRightColor: GLASS_BORDER_LIGHT,
    borderBottomColor: GLASS_BORDER_LIGHT,
    borderLeftColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.11,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
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
    backgroundColor: BRAND_ACCENT_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { ...type.bodyBold, color: HEADER_NAVY, fontSize: 13, letterSpacing: 0.2 },
  cardSubtitle: { ...type.micro, color: '#64748B', fontWeight: '700' },
  cardBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },

  // Info row
  infoRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  infoIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: BRAND_ACCENT_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  infoLabel: { ...type.micro, color: '#64748B', fontWeight: '700', letterSpacing: 0.3 },
  infoValue: { ...type.bodyBold, color: HEADER_NAVY, marginTop: 1 },
  divider: {
    height: 1,
    backgroundColor: 'rgba(148,163,184,0.22)',
    marginVertical: spacing.xs,
  },

  bioWrap: { paddingVertical: spacing.sm },
  bioLabel: { ...type.micro, color: '#64748B', fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 },
  bioText: { ...type.body, color: HEADER_NAVY, lineHeight: 20 },

  joinedText: { ...type.micro, color: '#94A3B8', fontWeight: '700', marginTop: spacing.sm, fontStyle: 'italic' },
  placeholderText: { ...type.caption, color: '#64748B', fontStyle: 'italic' },

  // Batch row — nested inside the glass card, subtly tinted so it
  // reads as a distinct row without breaking the frosted surface.
  batchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: 'rgba(241,246,251,0.9)',
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1, borderColor: 'rgba(148,163,184,0.22)',
  },
  batchIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: BRAND_ACCENT_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  batchName: { ...type.bodyBold, color: HEADER_NAVY, fontSize: 13 },
  batchMeta: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 1 },
  batchMetaText: { ...type.micro, color: '#64748B', fontWeight: '700' },

  // Setting row
  settingRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  settingIcon: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  settingLabel: { ...type.bodyBold, color: HEADER_NAVY, fontSize: 13 },
  settingDesc: { ...type.micro, color: '#64748B', marginTop: 1 },

  // Logout — glass surface with rose accent. Kept as the sign-out
  // affordance the trainer already knows.
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    backgroundColor: 'rgba(254,226,226,0.85)',
    borderRadius: radius.xl,
    paddingVertical: spacing.md,
    borderTopWidth: 1.5,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.9)',
    borderRightColor: 'rgba(252,165,165,0.5)',
    borderBottomColor: 'rgba(252,165,165,0.5)',
    borderLeftColor: 'rgba(252,165,165,0.5)',
    shadowColor: '#EF4444',
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  logoutBtnText: { ...type.bodyBold, color: '#B91C1C', fontWeight: '800', letterSpacing: 0.3 },

  version: {
    ...type.micro,
    color: palette.textLight,
    textAlign: 'center',
    marginTop: spacing.md,
    fontWeight: '700',
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  modalSheet: {
    width: '100%',
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadows.modal,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  modalTitle: { ...type.h2, color: palette.text },
  modalCloseBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.borderSoft,
  },

  pwLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700', marginBottom: 6 },
  pwField: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: palette.borderSoft,
    borderRadius: radius.md,
    backgroundColor: palette.bg,
  },
  pwInput: { flex: 1, ...type.body, color: palette.text, paddingHorizontal: spacing.md, paddingVertical: 10 },
  pwToggle: { paddingHorizontal: spacing.md, paddingVertical: 10 },
  pwHint: { ...type.micro, color: palette.textMuted, marginTop: 4 },

  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnSecondary: { backgroundColor: palette.borderSoft },
  modalBtnSecondaryText: { ...type.bodyBold, color: palette.text },
  modalBtnPrimary: { backgroundColor: palette.purple.vivid },
  modalBtnPrimaryText: { ...type.bodyBold, color: '#fff' },
});
