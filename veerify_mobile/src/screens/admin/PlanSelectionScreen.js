import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, 
  StyleSheet, ActivityIndicator, Alert
} from 'react-native';
import apiClient from '../../api/client';
import { colors } from '../../utils/styles';

export default function PlanSelectionScreen({ navigation }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState(null);

  useEffect(() => {
    loadPlans();
  }, []);

  const loadPlans = async () => {
    try {
      const res = await apiClient.get('/plans');
      setPlans(res.data.plans);
    } catch (err) {
      Alert.alert('Error', 'Failed to load plans. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPlan = async (plan) => {
    setSelecting(true);
    setSelectedPlanId(plan.id);
    try {
      await apiClient.post('/onboarding/select-plan', { plan_id: plan.id });
      navigation.navigate('SetupInstitution');
    } catch (err) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to select plan');
    } finally {
      setSelecting(false);
      setSelectedPlanId(null);
    }
  };

  const featureList = (plan) => [
    plan.max_branches === 1 
      ? '🏛️ Single Branch' 
      : '🏛️ Unlimited Branches',
    plan.max_students < 999 
      ? `👥 Up to ${plan.max_students} Students` 
      : '👥 Unlimited Students',
    plan.max_trainers < 999 
      ? `👨‍🏫 Up to ${plan.max_trainers} Trainers` 
      : '👨‍🏫 Unlimited Trainers',
    '💰 Fee Tracking & Receipts',
    '🔔 Push Notifications',
    '✅ Basic Attendance',
    '📧 Email Support',
    '🎁 Vendor Discounts',
    ...(plan.features?.attendance_reports ? ['📊 Attendance Reports'] : []),
    ...(plan.features?.whatsapp_integration ? ['💬 WhatsApp Integration'] : []),
    ...(plan.features?.revenue_trends ? ['📈 Revenue Growth & Trends'] : []),
    ...(plan.features?.event_discounts ? ['🎉 Event Discounts'] : []),
  ];

  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Choose Your Plan</Text>
        <Text style={styles.headerSubtitle}>
          Select the plan that fits your academy's needs.{'\n'}
          You can upgrade anytime.
        </Text>
      </View>

      {/* Plan cards */}
      {plans.map((plan) => (
        <View
          key={plan.id}
          style={[
            styles.planCard,
            plan.is_popular && styles.planCardPopular
          ]}
        >
          {/* Popular badge */}
          {plan.is_popular && (
            <View style={styles.popularBadge}>
              <Text style={styles.popularBadgeText}>⭐ MOST POPULAR</Text>
            </View>
          )}

          {/* Plan header */}
          <View style={styles.planHeader}>
            <Text style={styles.planName}>{plan.name}</Text>
            <View style={styles.planPriceRow}>
              <Text style={styles.planPrice}>₹{parseInt(plan.price).toLocaleString()}</Text>
              <Text style={styles.planCycle}>/month</Text>
            </View>
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Features */}
          <View style={styles.featureList}>
            {featureList(plan).map((feature, idx) => (
              <View key={idx} style={styles.featureRow}>
                <Text style={styles.featureText}>{feature}</Text>
              </View>
            ))}
          </View>

          {/* Select button */}
          <TouchableOpacity
            style={[
              styles.selectButton,
              plan.is_popular && styles.selectButtonPopular
            ]}
            onPress={() => handleSelectPlan(plan)}
            disabled={selecting}
            activeOpacity={0.85}
          >
            {selecting && selectedPlanId === plan.id ? (
              <ActivityIndicator color={plan.is_popular ? colors.white : colors.primary} />
            ) : (
              <Text style={[
                styles.selectButtonText,
                plan.is_popular && styles.selectButtonTextPopular
              ]}>
                Get Started with {plan.name}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      ))}

      {/* Footer note */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          🔒 Secure payment powered by Razorpay{'\n'}
          Cancel anytime. No hidden fees.
        </Text>
      </View>

      <View style={{ height: 30 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f4f8' },
  content: { padding: 20 },

  header: { marginBottom: 24, alignItems: 'center' },
  headerTitle: {
    fontSize: 26, fontWeight: '700',
    color: colors.dark, marginBottom: 8, textAlign: 'center'
  },
  headerSubtitle: {
    fontSize: 14, color: colors.textLight,
    textAlign: 'center', lineHeight: 20
  },

  planCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.lightGray,
  },
  planCardPopular: {
    borderColor: colors.primary,
    borderWidth: 2,
  },

  popularBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  popularBadgeText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  planName: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.dark,
  },
  planPriceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  planPrice: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.primary,
  },
  planCycle: {
    fontSize: 13,
    color: colors.textLight,
    marginBottom: 4,
  },

  divider: {
    height: 1,
    backgroundColor: colors.lightGray,
    marginBottom: 14,
  },

  featureList: { gap: 8, marginBottom: 20 },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureText: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },

  selectButton: {
    borderWidth: 2,
    borderColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  selectButtonPopular: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  selectButtonText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  selectButtonTextPopular: {
    color: colors.white,
  },

  footer: {
    alignItems: 'center',
    marginTop: 8,
  },
  footerText: {
    fontSize: 12,
    color: colors.textLight,
    textAlign: 'center',
    lineHeight: 18,
  },
});