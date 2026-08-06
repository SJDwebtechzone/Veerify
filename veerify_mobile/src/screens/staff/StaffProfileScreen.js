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

import React, { useEffect, useState, useCallback } from 'react';
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

export default function StaffProfileScreen({ navigation }) {
  const { user, logout } = useAuth();
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
    <View style={styles.screen}>
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
            tintColor={palette.purple.vivid}
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
            <ActivityIndicator color={palette.purple.vivid} />
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
                    <Text style={styles.bioLabel}>BIO</Text>
                    <Text style={styles.bioText}>{profile.bio}</Text>
                  </View>
                </>
              ) : null}
              {profile?.joined_at ? (
                <Text style={styles.joinedText}>
                  Joined {new Date(profile.joined_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
                </Text>
              ) : null}
            </>
          )}
        </Card>

        {/* Assigned batches */}
        <Card title="Assigned batches" icon={BookOpen} subtitle={`${batches.length} ${batches.length === 1 ? 'batch' : 'batches'}`}>
          {batches.length === 0 ? (
            <Text style={styles.placeholderText}>
              No batches assigned yet. Your admin can assign you to a batch.
            </Text>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {batches.map((b) => (
                <TouchableOpacity
                  key={b.id}
                  style={styles.batchRow}
                  onPress={() => navigation.navigate('StaffAttendance', { batchId: b.id })}
                  activeOpacity={0.85}
                >
                  <View style={styles.batchIcon}>
                    <BookOpen size={16} color={palette.purple.vivid} strokeWidth={2.4} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.batchName} numberOfLines={1}>{b.name}</Text>
                    <View style={styles.batchMeta}>
                      {b.days_of_week ? <Text style={styles.batchMetaText}>{b.days_of_week}</Text> : null}
                      {b.start_time ? <Text style={styles.batchMetaText}>· {formatBatchTime(b.start_time)}</Text> : null}
                      <Text style={styles.batchMetaText}>· {b.enrolled_count || 0} students</Text>
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

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={confirmLogout} activeOpacity={0.85}>
          <LogOut size={18} color={palette.rose.on} strokeWidth={2.4} />
          <Text style={styles.logoutBtnText}>Sign out NOW</Text>
        </TouchableOpacity>

        <Text style={styles.version}>Veerify · v1.0.0</Text>
      </ScrollView>

      {/* Change password modal */}
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </View>
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
  return (
    <View style={styles.statPill}>
      <View style={[styles.statPillIcon, { backgroundColor: accent.soft }]}>
        <Icon size={14} color={accent.vivid} strokeWidth={2.4} />
      </View>
      <Text style={styles.statPillValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.statPillLabel}>{label}</Text>
    </View>
  );
}

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

function InfoRow({ icon: Icon, label, value }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <Icon size={14} color={palette.purple.vivid} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue} numberOfLines={1}>{value}</Text>
      </View>
    </View>
  );
}

function Divider() { return <View style={styles.divider} />; }

function SettingRow({ icon: Icon, accent, label, description, onPress, muted }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.settingRow} activeOpacity={0.85}>
      <View style={[styles.settingIcon, { backgroundColor: accent.soft }]}>
        <Icon size={14} color={accent.vivid} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.settingLabel, muted && { color: palette.textMuted }]}>{label}</Text>
        {description ? <Text style={styles.settingDesc}>{description}</Text> : null}
      </View>
      <ChevronRight size={14} color={palette.textLight} strokeWidth={2.2} />
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────
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
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.4)',
    marginBottom: spacing.md,
  },
  heroAvatarText: { color: palette.purple.vivid, fontSize: 28, fontWeight: '800' },
  heroName: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  heroDesignation: { ...type.caption, color: 'rgba(255,255,255,0.95)', fontWeight: '700', marginTop: 4 },
  heroInstitution: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: radius.pill,
  },
  heroInstitutionText: { ...type.micro, color: 'rgba(255,255,255,0.9)', fontWeight: '700' },

  // Stat strip
  statStrip: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    marginTop: -spacing.md,
  },
  statPill: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  statPillIcon: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  statPillValue: { ...type.h1, color: palette.text, fontSize: 18 },
  statPillLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700' },

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
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  infoLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  infoValue: { ...type.bodyBold, color: palette.text, marginTop: 1 },
  divider: { height: 1, backgroundColor: palette.borderSoft, marginVertical: spacing.xs },

  bioWrap: { paddingVertical: spacing.sm },
  bioLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 },
  bioText: { ...type.body, color: palette.text, lineHeight: 20 },

  joinedText: { ...type.micro, color: palette.textLight, fontWeight: '700', marginTop: spacing.sm, fontStyle: 'italic' },
  placeholderText: { ...type.caption, color: palette.textMuted, fontStyle: 'italic' },

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
  batchMeta: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 1 },
  batchMetaText: { ...type.micro, color: palette.textMuted, fontWeight: '700' },

  // Setting row
  settingRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  settingIcon: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  settingLabel: { ...type.bodyBold, color: palette.text, fontSize: 13 },
  settingDesc: { ...type.micro, color: palette.textMuted, marginTop: 1 },

  // Logout
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    backgroundColor: palette.rose.soft,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
  },
  logoutBtnText: { ...type.bodyBold, color: palette.rose.on, fontWeight: '800' },

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
