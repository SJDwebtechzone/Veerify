import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
  Image, ScrollView, StatusBar, Dimensions,
} from 'react-native';
import Svg, { Path, Circle, G } from 'react-native-svg';
import { useAuth } from '../context/AuthContext';
import { confirm } from '../components/ConfirmDialog';
import { navigate } from '../navigation/navigationRef';

// Single OK-only branded notice — replaces native Alert.alert so the
// login screen's error popups match the rest of the app's red dialogs.
const notice = (title, message) => {
  confirm({
    title,
    message,
    variant: 'destructive',
    confirmText: 'OK',
    hideCancel: true,
  });
};

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Brand palette derived from the Veerify logo (deep navy + brand blue).
// Kept in one place so we can tune the entire screen by editing here.
const COLORS = {
  bg: '#FFFFFF',
  ink: '#0A1628',
  inkSoft: '#475569',
  inkFaint: '#94A3B8',
  // Variable names kept for backwards-compat; treat as semantic
  // accent / accentSoft / accentWash tokens, not literal "blue".
  blue: '#E63946',       // brand red — primary action
  blueDeep: '#B91C1C',   // deep red for pressed / secondary
  blueSoft: '#FFE4E6',   // soft pink for halos + borders
  blueWash: '#FEF2F2',   // pale pink for wave decoration
  divider: '#E2E8F0',
  inputBorder: '#F1D6D9',
  logoNavy: '#0F2A3F',
};

/* ──────────────────────────────────────────────────────────────────
   Decorative backdrop — pale brand-red waves at top and bottom plus a
   soft dotted halo behind the logo. Pure decoration: pointerEvents
   off so it never intercepts taps from the form below.
   ────────────────────────────────────────────────────────────── */
function BackdropDecor() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* Top waves + dotted halo behind logo */}
      <Svg
        width={SCREEN_W}
        height={SCREEN_H * 0.5}
        viewBox="0 0 400 360"
        preserveAspectRatio="xMidYMin slice"
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        <Path
          d="M 0 70 Q 100 30 200 95 T 400 75 L 400 0 L 0 0 Z"
          fill={COLORS.blueWash}
          opacity={0.55}
        />
        <Path
          d="M 0 165 Q 110 125 215 195 T 400 170"
          stroke={COLORS.blueSoft}
          strokeWidth={2}
          fill="none"
          opacity={0.65}
        />
        <Path
          d="M 0 230 Q 120 195 220 260 T 400 235"
          stroke={COLORS.blueWash}
          strokeWidth={2}
          fill="none"
        />
        {/* dotted halo */}
        <G opacity={0.45}>
          {Array.from({ length: 5 }).map((_, r) =>
            Array.from({ length: 5 }).map((_, c) => (
              <Circle
                key={`d-${r}-${c}`}
                cx={250 + c * 9}
                cy={28 + r * 9}
                r={1.4}
                fill="#9EC0F1"
              />
            )),
          )}
        </G>
      </Svg>

      {/* Kicker silhouette removed — the screen now relies on the wave
          decoration alone for visual rhythm, which keeps focus on the
          brand block and form. */}

      {/* Bottom waves */}
      <Svg
        width={SCREEN_W}
        height={160}
        viewBox="0 0 400 160"
        preserveAspectRatio="xMidYMax slice"
        style={{ position: 'absolute', bottom: 0, left: 0 }}
      >
        <Path
          d="M 0 70 Q 100 25 200 70 T 400 55 L 400 160 L 0 160 Z"
          fill={COLORS.blueWash}
          opacity={0.7}
        />
        <Path
          d="M 0 100 Q 120 60 220 105 T 400 95"
          stroke={COLORS.blueSoft}
          strokeWidth={2}
          fill="none"
        />
      </Svg>
    </View>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Inline SVG icons — keeps us off icon-font dependencies and lets
   each glyph share the brand blue exactly.
   ────────────────────────────────────────────────────────────── */
const EnvelopeIcon = () => (
  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
    <Path
      d="M3 6.5 A 1.5 1.5 0 0 1 4.5 5 H 19.5 A 1.5 1.5 0 0 1 21 6.5 V 17.5 A 1.5 1.5 0 0 1 19.5 19 H 4.5 A 1.5 1.5 0 0 1 3 17.5 Z"
      stroke={COLORS.blue}
      strokeWidth={1.7}
    />
    <Path
      d="M3.5 7 L 12 13 L 20.5 7"
      stroke={COLORS.blue}
      strokeWidth={1.7}
      fill="none"
    />
  </Svg>
);

const LockIcon = () => (
  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
    <Path
      d="M6 10 V 8 a 6 6 0 1 1 12 0 v 2"
      stroke={COLORS.blue}
      strokeWidth={1.7}
      fill="none"
    />
    <Path
      d="M5 10 h 14 a 1 1 0 0 1 1 1 v 8 a 1 1 0 0 1 -1 1 H 5 a 1 1 0 0 1 -1 -1 v -8 a 1 1 0 0 1 1 -1 Z"
      stroke={COLORS.blue}
      strokeWidth={1.7}
    />
  </Svg>
);

const EyeIcon = ({ closed }) => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path
      d="M2 12 S 5.5 5.5 12 5.5 S 22 12 22 12 S 18.5 18.5 12 18.5 S 2 12 2 12 Z"
      stroke={COLORS.blue}
      strokeWidth={1.7}
      fill="none"
    />
    <Circle cx={12} cy={12} r={2.8} stroke={COLORS.blue} strokeWidth={1.7} fill="none" />
    {closed && <Path d="M4 4 L 20 20" stroke={COLORS.blue} strokeWidth={1.7} />}
  </Svg>
);

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { login } = useAuth();

  const handleLogin = async () => {
    if (!email || !password) {
      notice('Missing fields', 'Please enter email and password.');
      return;
    }
    setLoading(true);
    const result = await login(email, password);
    setLoading(false);
    if (!result.success) {
      notice('Login failed', result.message);
      return;
    }

    // First-login password change prompt. The backend returns
    // user.must_change_password=true for accounts created on the user's
    // behalf with a temp password (currently sub-branch admins). We
    // surface the styled dialog here so it overlays whatever screen the
    // navigator switched to (AdminDashboard etc.). The user can either
    // jump to the Change Password screen, or defer with "I'll do it
    // later" and continue using the temp password — the flag stays set
    // server-side so the dialog re-appears on the next login.
    if (result.user?.must_change_password) {
      // Defer slightly so the navigator finishes mounting the new stack
      // before we try to navigate into ChangePassword.
      setTimeout(() => {
        confirm({
          title:           'Set a new password',
          message:         "Your account was created with a temporary password. We recommend changing it now — you can do it later if you prefer.",
          variant:         'info',
          confirmText:     'Change password',
          cancelText:      "I'll do it later",
          onConfirm:       () => {
            try { navigate('ChangePassword'); } catch (_) { /* ignore */ }
          },
          // onCancel: nothing — user keeps using the temp password.
        });
      }, 250);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />
      <BackdropDecor />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Back arrow — returns to Welcome so the user can pick another
            entry point (Browse as guest, Register, etc.). Falls back to
            an explicit Welcome navigate when the stack is empty (e.g.
            after a reset). Sits above the brand block but inside the
            scroll view so it scrolls with content rather than floating. */}
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            if (navigation.canGoBack()) navigation.goBack();
            else navigation.navigate('Welcome');
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.7}
        >
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>

        {/* Brand block: logo circle + wordmark + tagline */}
        <View style={styles.brandBlock}>
          <View style={styles.logoCircle}>
            <Image
              source={require('../assets/veerify-logo.png')}
              style={styles.logoImage}
              resizeMode="cover"
            />
          </View>
          <Text style={styles.brandName}>Veerify</Text>
          <Text style={styles.brandTag}>#1 MARTIAL ARTS APP</Text>
        </View>

        {/* Welcome */}
        <Text style={styles.title}>Welcome back!</Text>
        <Text style={styles.subtitle}>Sign in to continue your journey</Text>

        {/* Email / Phone */}
        <View style={styles.inputCard}>
          <View style={styles.iconLeading}>
            <EnvelopeIcon />
          </View>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={COLORS.inkFaint}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* Password */}
        <View style={styles.inputCard}>
          <View style={styles.iconLeading}>
            <LockIcon />
          </View>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={COLORS.inkFaint}
            secureTextEntry={!showPassword}
          />
          <TouchableOpacity
            onPress={() => setShowPassword(!showPassword)}
            style={styles.iconTrailing}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
          >
            <EyeIcon closed={!showPassword} />
          </TouchableOpacity>
        </View>

        {/* Forgot password */}
        <TouchableOpacity
          style={styles.forgotLink}
          onPress={() => navigation.navigate('ForgotPassword')}
          activeOpacity={0.7}
        >
          <Text style={styles.forgotText}>Forgot Password?</Text>
        </TouchableOpacity>

        {/* Login button */}
        <TouchableOpacity
          style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
          onPress={handleLogin}
          disabled={loading}
          activeOpacity={0.9}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <View style={styles.loginBtnInner}>
              <Text style={styles.loginText}>Login</Text>
              <Text style={styles.loginArrow}>→</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Sign up */}
        <TouchableOpacity
          style={styles.signupRow}
          onPress={() => navigation.replace('Register')}
          activeOpacity={0.7}
        >
          <Text style={styles.signupText}>
            Don't have an account? <Text style={styles.signupBold}>Sign up</Text>
          </Text>
        </TouchableOpacity>

        {/* Browse as guest — gives no-account visitors a direct way into
            the Home tab without making them go back to Welcome first. */}
        <TouchableOpacity
          style={styles.guestRow}
          onPress={() => navigation.replace('GuestHome')}
          activeOpacity={0.7}
        >
          <Text style={styles.guestText}>Browse as guest →</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: Platform.OS === 'ios' ? 70 : 56,
    paddingBottom: 48,
  },

  // ── Brand block ────────────────────────────────────────────────
  brandBlock: { alignItems: 'center', marginBottom: 40 },
  logoCircle: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: COLORS.logoNavy,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: COLORS.logoNavy,
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  logoImage: { width: 78, height: 78, borderRadius: 39 },
  brandName: {
    fontSize: 30,
    fontWeight: '800',
    color: COLORS.ink,
    marginTop: 14,
    letterSpacing: 0.2,
  },
  brandTag: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.blue,
    marginTop: 8,
    letterSpacing: 2.6,
  },

  // ── Headings ───────────────────────────────────────────────────
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.ink,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.inkSoft,
    marginBottom: 24,
  },

  // ── Inputs ─────────────────────────────────────────────────────
  // Inputs use a coloured "glow" — a brand-blue border with a centred
  // blue shadow (offset 0,0 keeps the halo even on all four sides). On
  // Android the shadowColor is honoured alongside elevation from API 28+
  // (Pie), giving the same blue-tinted glow as iOS.
  inputCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 16 : 4,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: COLORS.blueSoft,
    shadowColor: COLORS.blue,
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  iconLeading: { marginRight: 12 },
  iconTrailing: { paddingLeft: 10 },
  input: {
    flex: 1,
    paddingVertical: Platform.OS === 'ios' ? 0 : 12,
    fontSize: 15,
    color: COLORS.ink,
  },

  // ── Forgot link ────────────────────────────────────────────────
  forgotLink: { alignSelf: 'flex-end', marginTop: 6, marginBottom: 20 },
  forgotText: {
    fontSize: 14,
    color: COLORS.blue,
    fontWeight: '700',
  },

  // ── Login button ───────────────────────────────────────────────
  loginBtn: {
    backgroundColor: COLORS.blue,
    borderRadius: 16,
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.blue,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  loginBtnDisabled: { opacity: 0.7 },
  loginBtnInner: { flexDirection: 'row', alignItems: 'center' },
  loginText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginRight: 10,
  },
  loginArrow: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },

  // ── Back arrow ─────────────────────────────────────────────────
  // Small, low-key — doesn't fight the brand block for attention but
  // gives the user a clear path back to Welcome.
  backBtn: {
    alignSelf: 'flex-start',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.blueWash,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  backArrow: { fontSize: 20, color: COLORS.ink, fontWeight: '700' },

  // ── Sign up row ────────────────────────────────────────────────
  signupRow: { alignItems: 'center', marginTop: 36 },
  signupText: { fontSize: 14, color: COLORS.inkSoft },
  signupBold: { color: COLORS.blue, fontWeight: '800' },

  // ── Guest browse row ───────────────────────────────────────────
  guestRow: { alignItems: 'center', marginTop: 12 },
  guestText: {
    fontSize: 13,
    color: COLORS.inkSoft,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
