import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, ScrollView, RefreshControl,
} from 'react-native';
import apiClient from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../utils/styles';

// Payment for new academies happens via the link Razorpay-emails the owner
// after the super-admin approves the academy. The mobile app does NOT initiate
// payment in-app — this screen is purely informational while we wait for the
// webhook (or a manual admin override) to flip the institution to `active`.
//
// Flow:
//   1. Owner is approved → backend creates a Razorpay Payment Link and emails it.
//   2. Owner opens email on any device, completes payment in browser.
//   3. Razorpay webhook hits the backend → status flips to `active`.
//   4. Owner taps "I've paid — refresh status" here. We re-call /my-status.
//      If status == 'active', we route to the dashboard. Otherwise we tell them
//      to give it a minute and try again, or to check the spam folder.
export default function PaymentScreen({ navigation }) {
  const { user, logout, refreshOnboardingStatus } = useAuth();

  const [institution, setInstitution] = useState(null);
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/onboarding/my-status');
      setInstitution(res.data.institution);
      if (res.data.institution?.plan_name) {
        setPlan({
          name: res.data.institution.plan_name,
          price: res.data.institution.plan_price,
        });
      }
      // If we land here but backend already says active, just push to dashboard.
      if (res.data.status === 'active') {
        navigation.replace('AdminDashboard');
      }
    } catch (err) {
      console.log('PaymentScreen load:', err?.message);
    } finally {
      setLoading(false);
    }
  }, [navigation]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCheckStatus = async () => {
    setChecking(true);
    try {
      const status = await refreshOnboardingStatus();
      if (status === 'active') {
        Alert.alert(
          '🎉 Payment confirmed!',
          'Your academy is now live. Welcome to Veerify!',
          [{ text: 'Get Started', onPress: () => navigation.replace('AdminDashboard') }],
        );
      } else {
        Alert.alert(
          'Still waiting',
          "We haven't received confirmation yet. Razorpay can take up to a minute after you complete payment. Try again shortly, or check your email for the payment link.",
        );
      }
    } catch (err) {
      Alert.alert('Error', err?.message || 'Could not refresh status');
    } finally {
      setChecking(false);
    }
  };

  const handlePullToRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign out?',
      'You can come back and sign in any time once you complete payment.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => logout() },
      ],
    );
  };

  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const ownerEmail = institution?.owner_email || user?.email || 'your email';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handlePullToRefresh} />}
    >
      {/* Approved banner */}
      <View style={styles.approvedBanner}>
        <Text style={styles.approvedEmoji}>🎉</Text>
        <Text style={styles.approvedTitle}>Academy Approved!</Text>
        <Text style={styles.approvedSubtitle}>
          Complete your subscription payment to go live.
        </Text>
      </View>

      {/* Email instruction card — the only payment instruction we surface */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>📧 Check your email</Text>
        <Text style={styles.cardBody}>
          We've sent a secure Razorpay payment link to{' '}
          <Text style={styles.emailHighlight}>{ownerEmail}</Text>.
          Open the email and tap the "Pay" button to complete payment.
        </Text>
        <Text style={[styles.cardBody, { marginTop: 10 }]}>
          Once payment is confirmed, your academy is activated instantly. Sign in
          here with the same email and password to enter your dashboard.
        </Text>
        <View style={styles.tipsBox}>
          <Text style={styles.tipsTitle}>Didn't get the email?</Text>
          <Text style={styles.tipsItem}>• Check your spam / promotions folder.</Text>
          <Text style={styles.tipsItem}>• Ask support to resend from the admin dashboard.</Text>
        </View>
      </View>

      {/* Academy + plan summary */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Order summary</Text>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Academy</Text>
          <Text style={styles.detailValue}>{institution?.name}</Text>
        </View>
        {institution?.city ? (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>City</Text>
            <Text style={styles.detailValue}>{institution.city}</Text>
          </View>
        ) : null}
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Plan</Text>
          <Text style={styles.detailValue}>{plan?.name || '—'}</Text>
        </View>
        <View style={[styles.detailRow, styles.totalRow]}>
          <Text style={styles.totalLabel}>Amount</Text>
          <Text style={styles.totalAmount}>
            ₹{parseInt(plan?.price || 0).toLocaleString()}/month
          </Text>
        </View>
      </View>

      {/* Re-check status */}
      <TouchableOpacity
        style={[styles.primaryButton, checking && { opacity: 0.6 }]}
        onPress={handleCheckStatus}
        disabled={checking}
        activeOpacity={0.85}
      >
        {checking ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.primaryButtonText}>I've paid — refresh status</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.secureText}>
        🔒 Payment is handled entirely on Razorpay's secure page.
      </Text>

      {/* Sign out — escape hatch */}
      <TouchableOpacity onPress={handleSignOut} style={styles.signOutLink}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f4f8' },
  content: { padding: 20 },

  approvedBanner: {
    backgroundColor: '#e1f5ee',
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#0f6e56',
  },
  approvedEmoji: { fontSize: 40, marginBottom: 8 },
  approvedTitle: {
    fontSize: 20, fontWeight: '700',
    color: '#085041', marginBottom: 4,
  },
  approvedSubtitle: {
    fontSize: 13, color: '#0f6e56', textAlign: 'center',
  },

  card: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.lightGray,
  },
  cardTitle: {
    fontSize: 15, fontWeight: '700',
    color: colors.dark, marginBottom: 8,
  },
  cardBody: { fontSize: 13, color: colors.text, lineHeight: 19 },
  emailHighlight: { fontWeight: '700', color: colors.primary },

  tipsBox: {
    marginTop: 14,
    padding: 12,
    backgroundColor: '#fafafa',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  tipsTitle: { fontSize: 12, fontWeight: '700', color: colors.dark, marginBottom: 4 },
  tipsItem: { fontSize: 12, color: colors.text, lineHeight: 18 },

  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  detailLabel: { fontSize: 13, color: colors.textLight },
  detailValue: { fontSize: 13, fontWeight: '600', color: colors.text },

  totalRow: {
    borderTopWidth: 1,
    borderTopColor: colors.lightGray,
    marginTop: 8,
    paddingTop: 12,
  },
  totalLabel: { fontSize: 14, fontWeight: '700', color: colors.dark },
  totalAmount: { fontSize: 18, fontWeight: '700', color: colors.primary },

  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 10,
  },
  primaryButtonText: {
    fontSize: 15, fontWeight: '700', color: colors.white,
  },

  secureText: {
    fontSize: 12, color: colors.textLight, textAlign: 'center',
    marginBottom: 18,
  },

  signOutLink: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  signOutText: {
    fontSize: 13, fontWeight: '600',
    color: colors.textLight,
    textDecorationLine: 'underline',
  },
});
