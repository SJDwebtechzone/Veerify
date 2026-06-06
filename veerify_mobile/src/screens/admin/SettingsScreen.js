// src/screens/admin/SettingsScreen.js
//
// Read-only settings page showing Commission Settings, Settlement explanation,
// and a live calculator preview. Hits GET /api/marketplace-settings.

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import {
  Percent,
  Info,
  Calculator,
  Wallet,
  Clock,
  ArrowRight,
} from 'lucide-react-native';
import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';

const GATEWAY_PERCENT = 2; // Fixed for calculator preview

export default function SettingsScreen() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [calcAmount, setCalcAmount] = useState('3000');

  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await apiClient.get('/marketplace-settings');
        setSettings(res.data?.settings || null);
      } catch (err) {
        console.log('[SettingsScreen] fetch error:', err.message);
        setError('Could not load marketplace settings.');
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const calc = useMemo(() => {
    if (!settings) return null;
    const amount = parseFloat(calcAmount) || 0;
    const commissionFee = Math.round((amount * settings.commission_percent) / 100);
    const gatewayFee = Math.round((amount * GATEWAY_PERCENT) / 100);
    const institutionBears = settings.gateway_bearer === 'Institution';
    const totalDeduction = commissionFee + (institutionBears ? gatewayFee : 0);
    const earnings = amount - totalDeduction;
    return { amount, commissionFee, gatewayFee, institutionBears, totalDeduction, earnings };
  }, [calcAmount, settings]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={palette.purple.vivid} />
        <Text style={styles.loadingText}>Loading settings...</Text>
      </View>
    );
  }

  if (error || !settings) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error || 'Settings not available.'}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* 1. Commission Settings Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={[styles.iconContainer, { backgroundColor: palette.purple.soft }]}>
            <Percent size={20} color={palette.purple.vivid} strokeWidth={2.4} />
          </View>
          <Text style={styles.cardTitle}>Commission Settings</Text>
        </View>

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Marketplace Commission</Text>
          <Text style={styles.fieldValue}>{settings.commission_percent}%</Text>
          <Text style={styles.fieldDescription}>Deducted from institution course sales.</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Gateway Charges Bearer</Text>
          <Text style={styles.fieldValue}>{settings.gateway_bearer}</Text>
          <Text style={styles.fieldDescription}>Who pays the payment gateway processing fees.</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Minimum Payout Amount</Text>
          <Text style={styles.fieldValue}>₹{settings.min_payout.toLocaleString()}</Text>
          <Text style={styles.fieldDescription}>Minimum wallet balance required before settlement.</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Settlement Cycle</Text>
          <View style={styles.badge}>
            <Clock size={12} color={palette.blue.on} />
            <Text style={styles.badgeText}>{settings.settlement_cycle}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Automatic Settlements</Text>
          <View style={[styles.statusBadge, { backgroundColor: settings.auto_settlement ? palette.green.soft : palette.border }]}>
            <Text style={[styles.statusBadgeText, { color: settings.auto_settlement ? palette.green.on : palette.textMuted }]}>
              {settings.auto_settlement ? 'ENABLED' : 'DISABLED'}
            </Text>
          </View>
        </View>
      </View>

      {/* 2. Explanation Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={[styles.iconContainer, { backgroundColor: palette.blue.soft }]}>
            <Info size={20} color={palette.blue.vivid} strokeWidth={2.4} />
          </View>
          <Text style={styles.cardTitle}>How Settlement Works</Text>
        </View>

        <View style={styles.steps}>
          <Step num="1" text="Student purchases your course online." />
          <Step num="2" text="Payment goes to platform Razorpay account." />
          <Step num="3" text={`Marketplace commission (${settings.commission_percent}%) is deducted.`} />
          {settings.gateway_bearer === 'Institution' && (
            <Step num="4" text="Gateway processing fee (2%) is deducted." />
          )}
          <Step
            num={settings.gateway_bearer === 'Institution' ? '5' : '4'}
            text="Remaining earnings are added to your academy wallet."
          />
          <Step
            num={settings.gateway_bearer === 'Institution' ? '6' : '5'}
            text={`Settlements occur ${settings.settlement_cycle.toLowerCase()} once wallet exceeds ₹${settings.min_payout}.`}
          />
        </View>
      </View>

      {/* 3. Settlement Preview Calculator Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={[styles.iconContainer, { backgroundColor: palette.green.soft }]}>
            <Calculator size={20} color={palette.green.vivid} strokeWidth={2.4} />
          </View>
          <Text style={styles.cardTitle}>Settlement Preview</Text>
        </View>
        <Text style={styles.calculatorIntro}>Enter a test course price to see the earnings breakdown:</Text>

        <View style={styles.inputContainer}>
          <Text style={styles.currencyPrefix}>₹</Text>
          <TextInput
            style={styles.textInput}
            keyboardType="numeric"
            value={calcAmount}
            onChangeText={setCalcAmount}
            placeholder="3000"
            maxLength={6}
          />
        </View>

        {calc && calc.amount > 0 && (
          <View style={styles.breakdown}>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Course Amount</Text>
              <Text style={styles.breakdownValue}>₹{calc.amount.toLocaleString()}</Text>
            </View>

            <View style={styles.breakdownDivider} />

            <View style={styles.breakdownRow}>
              <Text style={[styles.breakdownLabel, styles.deductionText]}>
                Marketplace Fee ({settings.commission_percent}%)
              </Text>
              <Text style={[styles.breakdownValue, styles.deductionText]}>
                -₹{calc.commissionFee.toLocaleString()}
              </Text>
            </View>

            <View style={styles.breakdownRow}>
              <Text style={[styles.breakdownLabel, styles.deductionText]}>
                Gateway Charges ({GATEWAY_PERCENT}%)
              </Text>
              <Text style={[styles.breakdownValue, styles.deductionText]}>
                {calc.institutionBears ? `-₹${calc.gatewayFee.toLocaleString()}` : '₹0 (Paid by Platform)'}
              </Text>
            </View>

            <View style={styles.breakdownDivider} />

            <View style={styles.breakdownRow}>
              <Text style={[styles.breakdownLabel, styles.earningsText]}>Your Earnings</Text>
              <Text style={[styles.breakdownValue, styles.earningsText]}>
                ₹{calc.earnings.toLocaleString()}
              </Text>
            </View>
          </View>
        )}
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function Step({ num, text }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepCircle}>
        <Text style={styles.stepNum}>{num}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.bg,
    padding: spacing.xxl,
  },
  loadingText: {
    ...type.caption,
    color: palette.textMuted,
    marginTop: spacing.md,
  },
  errorText: {
    ...type.bodyBold,
    color: palette.purple.vivid,
    textAlign: 'center',
  },

  // Cards
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.card,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    ...type.h2,
    color: palette.text,
  },

  // Details fields
  fieldRow: {
    marginVertical: spacing.xs,
  },
  fieldLabel: {
    ...type.bodyBold,
    color: palette.text,
    marginBottom: 2,
  },
  fieldValue: {
    ...type.h2,
    color: palette.text,
  },
  fieldDescription: {
    ...type.caption,
    color: palette.textMuted,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: palette.borderSoft,
    marginVertical: spacing.md,
  },

  // Badges
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: palette.blue.soft,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  badgeText: {
    ...type.micro,
    color: palette.blue.on,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  statusBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  statusBadgeText: {
    ...type.micro,
    fontWeight: '700',
  },

  // Steps
  steps: {
    gap: spacing.md,
  },
  stepRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  stepCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  stepNum: {
    ...type.caption,
    fontWeight: '700',
    color: palette.textMuted,
  },
  stepText: {
    ...type.body,
    color: palette.textMuted,
    flex: 1,
  },

  // Calculator
  calculatorIntro: {
    ...type.caption,
    color: palette.textMuted,
    marginBottom: spacing.lg,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    backgroundColor: palette.bg,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xl,
  },
  currencyPrefix: {
    ...type.h2,
    color: palette.textLight,
    marginRight: spacing.xs,
  },
  textInput: {
    flex: 1,
    height: 48,
    ...type.h2,
    color: palette.text,
  },
  breakdown: {
    backgroundColor: palette.bg,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 4,
  },
  breakdownLabel: {
    ...type.caption,
    color: palette.textMuted,
  },
  breakdownValue: {
    ...type.caption,
    color: palette.text,
    fontWeight: '600',
  },
  breakdownDivider: {
    height: 1,
    backgroundColor: palette.border,
    marginVertical: spacing.sm,
  },
  deductionText: {
    color: palette.purple.vivid,
  },
  earningsText: {
    ...type.bodyBold,
    color: palette.green.vivid,
  },
});
