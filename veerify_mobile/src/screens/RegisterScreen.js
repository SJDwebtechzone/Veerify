import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
  Image, StatusBar
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { confirm } from '../components/ConfirmDialog';

// Small wrapper so every notice on this screen reuses the polished
// ConfirmDialog (destructive variant = brand-red header) instead of
// the bare native Alert. hideCancel collapses to a single OK button.
const notice = (title, message) => {
  confirm({
    title,
    message,
    variant: 'destructive',
    confirmText: 'OK',
    hideCancel: true,
  });
};

export default function RegisterScreen({ navigation }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('student');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { register } = useAuth();

  const handleRegister = async () => {
    if (!name || !email || !password) {
      notice('Missing fields', 'Name, email, and password are required.');
      return;
    }
    if (password.length < 6) {
      notice('Weak password', 'Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    const result = await register({ name, email, phone, password, role });
    setLoading(false);

    if (!result.success) {
      notice('Registration failed', result.message);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            if (navigation.canGoBack()) navigation.goBack();
            else navigation.navigate('Welcome');
          }}
          activeOpacity={0.6}
        >
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>

        <View style={styles.logoContainer}>
          <View style={styles.logoBox}>
            <Image
              source={require('../assets/veerify-logo.png')}
              style={styles.logoImage}
              resizeMode="cover"
            />
          </View>
          <Text style={styles.logoText}>Veerify</Text>
        </View>

        <Text style={styles.title}>Create your account 🚀</Text>
        <Text style={styles.subtitle}>Start your martial arts journey today</Text>

        <View style={styles.form}>
       <Text style={styles.label}>I am a</Text>
          <View style={styles.roleSelector}>
            <TouchableOpacity
              style={[styles.roleButton, role === 'student' && styles.roleButtonActive]}
              onPress={() => setRole('student')}
              activeOpacity={0.85}
            >
              <Text style={styles.roleEmoji}>🎓</Text>
              <Text style={[styles.roleText, role === 'student' && styles.roleTextActive]}>
                Student
              </Text>
            </TouchableOpacity>

            {/* Parent role tile temporarily hidden from the registration
                picker — the Parent module code is untouched and still
                works for already-registered parents. Reveal this tile
                again when we re-open parent self-signup. */}
            {/*
            <TouchableOpacity
              style={[styles.roleButton, role === 'parent' && styles.roleButtonActive]}
              onPress={() => setRole('parent')}
              activeOpacity={0.85}
            >
              <Text style={styles.roleEmoji}>👨‍👩‍👧</Text>
              <Text style={[styles.roleText, role === 'parent' && styles.roleTextActive]}>
                Parent
              </Text>
            </TouchableOpacity>
            */}

            <TouchableOpacity
              style={[styles.roleButton, role === 'admin' && styles.roleButtonActive]}
              onPress={() => setRole('admin')}
              activeOpacity={0.85}
            >
              <Text style={styles.roleEmoji}>🏫</Text>
              <Text style={[styles.roleText, role === 'admin' && styles.roleTextActive]}>
                Academy
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Full Name</Text>
          <View style={styles.inputWrapper}>
            <Text style={styles.inputIcon}>👤</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor="#888"
            />
          </View>

          <Text style={styles.label}>Email</Text>
          <View style={styles.inputWrapper}>
            <Text style={styles.inputIcon}>✉️</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor="#888"
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <Text style={styles.label}>Phone (optional)</Text>
          <View style={styles.inputWrapper}>
            <Text style={styles.inputIcon}>📱</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="9876543210"
              placeholderTextColor="#888"
              keyboardType="phone-pad"
            />
          </View>

          <Text style={styles.label}>Password</Text>
          <View style={styles.inputWrapper}>
            <Text style={styles.inputIcon}>🔒</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="At least 6 characters"
              placeholderTextColor="#888"
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
              <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleRegister}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Create Account</Text>}
          </TouchableOpacity>

          <Text style={styles.termsText}>
            By creating an account, you agree to our{' '}
            <Text style={styles.termsLink}>Terms</Text> and{' '}
            <Text style={styles.termsLink}>Privacy Policy</Text>
          </Text>

          <TouchableOpacity
            style={styles.loginLink}
            onPress={() => navigation.replace('Login')}
          >
            <Text style={styles.loginText}>
              Already have an account? <Text style={styles.loginBold}>Login</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 50,
    paddingBottom: 30,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f4f4f8',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  backArrow: {
    fontSize: 22,
    color: '#1a1a2e',
    fontWeight: '600',
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 24,
  },
  logoBox: {
    width: 36,
    height: 36,
    backgroundColor: '#0a4d8c',
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  logoText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a2e',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1a1a2e',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 24,
  },
  form: {
    gap: 4,
  },
  label: {
    fontSize: 13,
    color: '#1a1a2e',
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 12,
  },
  roleSelector: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4,
  },
  roleButton: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#e0e0e8',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  roleButtonActive: {
    backgroundColor: '#fff5f5',
    borderColor: '#e63946',
  },
  roleEmoji: {
    fontSize: 28,
    marginBottom: 6,
  },
  roleText: {
    color: '#666',
    fontWeight: '600',
    fontSize: 13,
  },
  roleTextActive: {
    color: '#e63946',
  },
  roleSubtext: {
    color: '#999',
    fontSize: 11,
    marginTop: 2,
  },
  roleSubtextActive: {
    color: '#e63946',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f4f4f8',
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#e0e0e8',
  },
  inputIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 15,
    color: '#1a1a2e',
  },
  eyeIcon: {
    fontSize: 18,
    paddingLeft: 8,
  },
  button: {
    backgroundColor: '#e63946',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  termsText: {
    fontSize: 11,
    color: '#888',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 16,
  },
  termsLink: {
    color: '#e63946',
    fontWeight: '500',
  },
  loginLink: {
    alignItems: 'center',
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e8',
  },
  loginText: {
    color: '#666',
    fontSize: 14,
  },
  loginBold: {
    color: '#e63946',
    fontWeight: '600',
  },
});
