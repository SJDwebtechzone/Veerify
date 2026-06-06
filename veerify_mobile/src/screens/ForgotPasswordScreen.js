// src/screens/ForgotPasswordScreen.js
//
// Two-step inline flow for "Forgot password?" on the login screen.
//
//   Step 1 - "Enter your email"
//     User types the email registered on their account, taps "Send code".
//     Backend POSTs /api/auth/forgot-password { email }, emails a 6-digit
//     OTP that's valid for 10 minutes.
//
//   Step 2 - "Enter the code + new password"
//     User types the OTP they received and a new password (twice).
//     Backend POSTs /api/auth/reset-password { email, otp, new_password }.
//     On success we navigate back to Login with a success toast.

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Alert,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import {
  ArrowLeft, Mail, Lock, Eye, EyeOff, Shield,
  CheckCircle, ChevronRight,
} from 'lucide-react-native';
// Aliased to icons known to exist in older lucide versions:
//   KeyRound -> Lock, ShieldCheck -> Shield, CheckCircle2 -> CheckCircle
const KeyRound = Lock;
const ShieldCheck = Shield;
const CheckCircle2 = CheckCircle;

import apiClient from '../api/client';

const BRAND = '#E63946';
const BRAND_SOFT = '#FFE4E6';
const TEXT = '#111827';
const TEXT_MUTED = '#6B7280';
const TEXT_LIGHT = '#9CA3AF';
const SURFACE = '#FFFFFF';
const BG = '#F4F4F8';
const BORDER = '#E5E7EB';
const GREEN = '#10B981';

export default function ForgotPasswordScreen({ navigation }) {
  // 'email' = step 1, 'otp' = step 2, 'done' = success
  const [stage, setStage] = useState('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  // ── Step 1: request OTP ───────────────────────────────────────────────
  const requestOtp = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!/\S+@\S+\.\S+/.test(trimmed)) {
      Alert.alert('Enter a valid email', 'Please type the email registered on your account.');
      return;
    }
    setLoading(true);
    try {
      await apiClient.post('/auth/forgot-password', { email: trimmed });
      setEmail(trimmed);
      setStage('otp');
    } catch (err) {
      Alert.alert('Try again', err.response?.data?.message || 'Could not send the reset code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: verify OTP + set new password ────────────────────────────
  const verifyAndReset = async () => {
    if (!/^\d{6}$/.test(otp)) {
      Alert.alert('Check the code', 'The reset code is a 6-digit number from your email.');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Password too short', 'Use at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Passwords do not match', 'Please re-enter the same password in both fields.');
      return;
    }
    setLoading(true);
    try {
      await apiClient.post('/auth/reset-password', {
        email,
        otp,
        new_password: newPassword,
      });
      setStage('done');
    } catch (err) {
      Alert.alert(
        'Could not reset',
        err.response?.data?.message || 'The code may be incorrect or expired. Try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  const resendOtp = async () => {
    setLoading(true);
    try {
      await apiClient.post('/auth/forgot-password', { email });
      Alert.alert('Sent', 'A fresh code is on its way to your email.');
    } catch (err) {
      Alert.alert('Try again', err.response?.data?.message || 'Could not resend the code.');
    } finally {
      setLoading(false);
    }
  };

  // ── Success ───────────────────────────────────────────────────────────
  if (stage === 'done') {
    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.successBody}>
          <View style={styles.successCircle}>
            <CheckCircle2 size={56} color="#fff" strokeWidth={2.4} />
          </View>
          <Text style={styles.successTitle}>Password updated</Text>
          <Text style={styles.successSub}>
            Your password has been reset. Sign in with your new password to continue.
          </Text>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, { marginTop: 24 }]}
            onPress={() => navigation.replace('Login')}
            activeOpacity={0.85}
          >
            <Text style={styles.btnPrimaryText}>Go to Login</Text>
            <ChevronRight size={18} color="#fff" strokeWidth={2.6} />
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ── Email or OTP step ────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => stage === 'otp' ? setStage('email') : navigation.goBack()}
          style={styles.iconBtn}
          activeOpacity={0.7}
        >
          <ArrowLeft size={20} color={TEXT} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Forgot password</Text>
          <Text style={styles.headerSub}>
            Step {stage === 'email' ? 1 : 2} of 2
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Big icon hero */}
        <View style={styles.heroIconWrap}>
          {stage === 'email' ? (
            <Mail size={36} color={BRAND} strokeWidth={2} />
          ) : (
            <KeyRound size={36} color={BRAND} strokeWidth={2} />
          )}
        </View>

        {stage === 'email' ? (
          <>
            <Text style={styles.title}>Recover your account</Text>
            <Text style={styles.subtitle}>
              Enter the email you used to sign up. We'll send you a 6-digit code
              you can use to set a new password.
            </Text>

            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={TEXT_LIGHT}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />

            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, loading && { opacity: 0.6 }, { marginTop: 18 }]}
              onPress={requestOtp}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Text style={styles.btnPrimaryText}>Send code</Text>
                  <ChevronRight size={18} color="#fff" strokeWidth={2.6} />
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={{ marginTop: 18 }}
              onPress={() => navigation.replace('Login')}
              activeOpacity={0.7}
            >
              <Text style={styles.linkText}>Remembered? Back to sign in</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.title}>Enter the code</Text>
            <Text style={styles.subtitle}>
              We sent a 6-digit code to{'\n'}
              <Text style={{ fontWeight: '800', color: TEXT }}>{email}</Text>
            </Text>

            <Text style={styles.label}>Verification code</Text>
            <TextInput
              style={[styles.input, styles.otpInput]}
              placeholder="000000"
              placeholderTextColor={TEXT_LIGHT}
              value={otp}
              onChangeText={(v) => setOtp(v.replace(/[^0-9]/g, '').slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />

            <Text style={styles.label}>New password</Text>
            <View style={styles.pwRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="At least 6 characters"
                placeholderTextColor={TEXT_LIGHT}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry={!showPw}
                autoCapitalize="none"
              />
              <TouchableOpacity
                onPress={() => setShowPw((s) => !s)}
                style={styles.pwEye}
                activeOpacity={0.7}
              >
                {showPw ? (
                  <EyeOff size={18} color={TEXT_MUTED} strokeWidth={2.2} />
                ) : (
                  <Eye size={18} color={TEXT_MUTED} strokeWidth={2.2} />
                )}
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Confirm new password</Text>
            <TextInput
              style={styles.input}
              placeholder="Type the new password again"
              placeholderTextColor={TEXT_LIGHT}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry={!showPw}
              autoCapitalize="none"
            />

            <View style={styles.tipRow}>
              <ShieldCheck size={12} color={GREEN} strokeWidth={2.4} />
              <Text style={styles.tipText}>
                The code expires in 10 minutes. After 5 wrong tries you'll need
                to request a fresh one.
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, loading && { opacity: 0.6 }, { marginTop: 18 }]}
              onPress={verifyAndReset}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Text style={styles.btnPrimaryText}>Reset password</Text>
                  <ChevronRight size={18} color="#fff" strokeWidth={2.6} />
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={{ marginTop: 14, alignSelf: 'center' }}
              onPress={resendOtp}
              activeOpacity={0.7}
              disabled={loading}
            >
              <Text style={styles.linkText}>Didn't get the code? Resend</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 44, paddingBottom: 12,
    backgroundColor: SURFACE,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: TEXT },
  headerSub: { fontSize: 11, color: TEXT_MUTED, marginTop: 2, fontWeight: '600' },

  body: { padding: 20, paddingTop: 24 },

  heroIconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },

  title: {
    fontSize: 22, fontWeight: '900', color: TEXT,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13, color: TEXT_MUTED, fontWeight: '600',
    textAlign: 'center', lineHeight: 19,
    marginTop: 6, marginBottom: 24,
  },

  label: {
    fontSize: 12, fontWeight: '700', color: TEXT,
    marginBottom: 6, marginTop: 10, letterSpacing: 0.3,
  },
  input: {
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 12,
    fontSize: 14, color: TEXT,
  },
  otpInput: {
    fontSize: 22, letterSpacing: 8, textAlign: 'center',
    fontWeight: '800', color: BRAND,
  },

  pwRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pwEye: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: SURFACE,
    borderWidth: 1, borderColor: BORDER,
  },

  tipRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 12,
    paddingHorizontal: 4,
  },
  tipText: { fontSize: 11, color: TEXT_MUTED, fontWeight: '600', flex: 1, lineHeight: 16 },

  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, borderRadius: 12,
  },
  btnPrimary: { backgroundColor: BRAND },
  btnPrimaryText: { fontSize: 14, fontWeight: '800', color: '#fff' },

  linkText: {
    fontSize: 13, color: BRAND, fontWeight: '700',
    textAlign: 'center',
  },

  // Success
  successBody: { padding: 24, paddingTop: 80, alignItems: 'center' },
  successCircle: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: GREEN,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  successTitle: { fontSize: 22, fontWeight: '900', color: TEXT, marginTop: 8 },
  successSub: {
    fontSize: 13, color: TEXT_MUTED, fontWeight: '600',
    textAlign: 'center', marginTop: 8, lineHeight: 19,
    paddingHorizontal: 20,
  },
});
