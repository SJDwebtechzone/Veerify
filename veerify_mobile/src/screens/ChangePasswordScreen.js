// src/screens/ChangePasswordScreen.js
//
// Self-contained password change form. Used:
//   • By branch admins on first login, when the must-change-password
//     dialog routes them here (also accessible later from More → Account).
//   • By anyone tapping "Change password" from a profile screen.
//
// POST /api/auth/change-password { current_password, new_password }
// clears users.must_change_password on success.

import React, { createContext, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { ArrowLeft, Lock, Eye, EyeOff, ShieldCheck } from 'lucide-react-native';

import apiClient from '../api/client';
import { confirm } from '../components/ConfirmDialog';
// Institution Home visual system — ambient blue wash + glass
// cards + navy accents. Reused verbatim so this screen belongs to
// the same design language as the rest of the institution UI.
import InstitutionScreenBackground, {
  INSTITUTION_BG_BASE,
} from '../components/InstitutionScreenBackground';
import { useTheme } from '../theme/ThemeContext';

// ── Institution-Home glass tokens ─────────────────────────────
const GLASS_FILL         = 'rgba(255,255,255,0.72)';
const GLASS_FILL_STRONG  = 'rgba(255,255,255,0.88)';
const GLASS_BORDER_LIGHT = 'rgba(255,255,255,0.55)';
const GLASS_HIGHLIGHT    = 'rgba(255,255,255,0.9)';
const GLASS_SHADOW       = '#1E40AF';
const BRAND_DARK_BLUE    = '#1E3A8A';
const BRAND_ACCENT_SOFT  = 'rgba(30,58,138,0.10)';
const HEADER_NAVY        = '#0F172A';

// Local tokens — names kept unchanged so every card / border /
// text style inherits the Institution Home look automatically.
const BRAND       = '#E63946';
const BG          = INSTITUTION_BG_BASE;
const SURFACE     = GLASS_FILL_STRONG;
const TEXT        = HEADER_NAVY;
const TEXT_MUTED  = '#64748B';
const TEXT_LIGHT  = '#94A3B8';
const BORDER      = GLASS_BORDER_LIGHT;

// Local context so nested sub-components pick up dark-mode
// overrides without prop-drilling.
const ChangePwdCtx = createContext({ isDark: false, dark: {} });

function buildDarkOverrides(pal) {
  return StyleSheet.create({
    screen:      { backgroundColor: pal.bg },
    header:      { backgroundColor: pal.surface, borderBottomColor: pal.border },
    headerTitle: { color: pal.text },
    headerBack:  { backgroundColor: pal.border },
    card:        { backgroundColor: pal.surface, borderColor: pal.border },
    label:       { color: pal.textMuted },
    input:       { backgroundColor: pal.surface, borderColor: pal.border, color: pal.text },
  });
}

export default function ChangePasswordScreen({ navigation }) {
  const [current, setCurrent]   = useState('');
  const [next, setNext]         = useState('');
  const [confirmPw, setConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext]       = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!current) {
      return confirm({
        title: 'Check this detail', message: 'Please enter your current password.',
        variant: 'warning', confirmText: 'OK', hideCancel: true,
      });
    }
    if (next.length < 6) {
      return confirm({
        title: 'Password too short',
        message: 'New password must be at least 6 characters.',
        variant: 'warning', confirmText: 'OK', hideCancel: true,
      });
    }
    if (next !== confirmPw) {
      return confirm({
        title: 'Passwords don\'t match',
        message: 'Re-enter the new password in both fields and try again.',
        variant: 'warning', confirmText: 'OK', hideCancel: true,
      });
    }
    if (next === current) {
      return confirm({
        title: 'Pick a different password',
        message: 'Your new password must be different from your current one.',
        variant: 'warning', confirmText: 'OK', hideCancel: true,
      });
    }

    setBusy(true);
    try {
      await apiClient.post('/auth/change-password', {
        current_password: current,
        new_password:     next,
      });
      confirm({
        title: 'Password updated',
        message: 'Your new password is in effect. Sign in with it next time.',
        variant: 'success',
        confirmText: 'Done',
        hideCancel: true,
        onConfirm: () => {
          if (navigation.canGoBack()) navigation.goBack();
        },
      });
    } catch (err) {
      const msg = err?.response?.data?.message
        || err?.message
        || 'Could not change your password. Try again.';
      confirm({
        title: 'Could not change password',
        message: msg,
        variant: 'warning',
        confirmText: 'OK',
        hideCancel: true,
      });
    } finally {
      setBusy(false);
    }
  };

  // Dark-mode overrides pulled from the shared ThemeContext.
  // Institution Home's ambient background is skipped in dark mode.
  const { mode, palette: themePalette } = useTheme();
  const isDark = mode === 'dark';
  const dark   = useMemo(() => (isDark ? buildDarkOverrides(themePalette) : {}), [isDark, themePalette]);

  return (
    <ChangePwdCtx.Provider value={{ isDark, dark }}>
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, isDark && dark.screen]}
    >
      {/* Institution Home ambient wash — sits behind all content. */}
      {!isDark ? <InstitutionScreenBackground layer /> : null}
      <View style={[styles.header, isDark && dark.header]}>
        <TouchableOpacity
          onPress={() => navigation.canGoBack() && navigation.goBack()}
          style={[styles.headerBack, isDark && dark.headerBack]}
          hitSlop={8}
        >
          <ArrowLeft size={20} color={isDark ? themePalette.text : TEXT} strokeWidth={2.4} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, isDark && dark.headerTitle]}>Change password</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <ShieldCheck size={26} color="#fff" strokeWidth={2.2} />
          </View>
          <Text style={styles.heroTitle}>Pick something only you know</Text>
          <Text style={styles.heroBody}>
            At least 6 characters. Use a mix you'll remember without writing it down.
          </Text>
        </View>

        <PasswordField
          label="Current password"
          value={current}
          onChange={setCurrent}
          show={showCurrent}
          toggle={() => setShowCurrent((s) => !s)}
          placeholder="Enter your existing password"
        />
        <PasswordField
          label="New password"
          value={next}
          onChange={setNext}
          show={showNext}
          toggle={() => setShowNext((s) => !s)}
          placeholder="At least 6 characters"
        />
        <PasswordField
          label="Confirm new password"
          value={confirmPw}
          onChange={setConfirm}
          show={showConfirm}
          toggle={() => setShowConfirm((s) => !s)}
          placeholder="Type the new password again"
        />

        <TouchableOpacity
          style={[styles.cta, busy && { opacity: 0.7 }]}
          onPress={submit}
          disabled={busy}
          activeOpacity={0.9}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaText}>Update password</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
    </ChangePwdCtx.Provider>
  );
}

function PasswordField({ label, value, onChange, show, toggle, placeholder }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputWrap}>
        <Lock size={14} color={TEXT_MUTED} strokeWidth={2.4} />
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={TEXT_LIGHT}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity onPress={toggle} hitSlop={6}>
          {show ? (
            <EyeOff size={16} color={TEXT_MUTED} strokeWidth={2.2} />
          ) : (
            <Eye size={16} color={TEXT_MUTED} strokeWidth={2.2} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  // Header — glass slab with navy title and soft blue lift shadow.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: GLASS_FILL_STRONG,
    borderBottomWidth: 1,
    borderBottomColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.10,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  headerBack: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: BRAND_ACCENT_SOFT,
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '800',
    color: HEADER_NAVY,
    letterSpacing: 0.2,
  },
  body: {
    padding: 20,
    paddingBottom: 40,
  },
  // Hero card — translucent glass fill + light glass border + soft
  // blue lift shadow so the card reads as a glass panel on the
  // Institution Home ambient wash.
  hero: {
    backgroundColor: GLASS_FILL_STRONG,
    borderRadius: 18,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: GLASS_BORDER_LIGHT,
    marginBottom: 20,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  heroIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: BRAND,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  heroTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: TEXT,
    textAlign: 'center',
    marginBottom: 4,
  },
  heroBody: {
    fontSize: 13,
    color: TEXT_MUTED,
    textAlign: 'center',
    lineHeight: 18,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: TEXT_MUTED,
    marginBottom: 6,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    height: 48,
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: TEXT,
    padding: 0,
  },
  cta: {
    marginTop: 14,
    backgroundColor: BRAND,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.3,
  },
});
