// src/screens/admin/SettingsScreen.js
//
// Read-only settings page showing Commission Settings, Settlement explanation,
// and a live calculator preview. Hits GET /api/marketplace-settings.

import React, { createContext, useState, useEffect, useMemo } from 'react';
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
// Institution Home visual system — ambient blue wash + glass
// cards + navy accents. Reused verbatim so this screen belongs to
// the same design language as the rest of the institution UI.
import InstitutionScreenBackground, {
  INSTITUTION_BG_BASE,
} from '../../components/InstitutionScreenBackground';
import { useTheme } from '../../theme/ThemeContext';

// ── Institution-Home glass tokens ─────────────────────────────
const GLASS_FILL         = 'rgba(255,255,255,0.72)';
const GLASS_FILL_STRONG  = 'rgba(255,255,255,0.88)';
const GLASS_BORDER_LIGHT = 'rgba(255,255,255,0.55)';
const GLASS_HIGHLIGHT    = 'rgba(255,255,255,0.9)';
const GLASS_SHADOW       = '#1E40AF';
const BRAND_DARK_BLUE    = '#1E3A8A';
const BRAND_ACCENT_SOFT  = 'rgba(30,58,138,0.10)';
const HEADER_NAVY        = '#0F172A';

// Local context so nested sub-components pick up dark-mode
// overrides without prop-drilling.
const SettingsCtx = createContext({ isDark: false, dark: {} });

function buildDarkOverrides(pal) {
  return StyleSheet.create({
    screen:      { backgroundColor: pal.bg },
    card:        { backgroundColor: pal.surface, borderColor: pal.border },
    cardTitle:   { color: pal.text },
    fieldLabel:  { color: pal.textMuted },
    fieldValue:  { color: pal.text },
    errorText:   { color: pal.textMuted },
  });
}

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
    // Gateway charges are absorbed by the platform — never shown to the
    // institution so the breakdown matches what they see on the admin web.
    const earnings = amount - commissionFee;
    return { amount, commissionFee, earnings };
  }, [calcAmount, settings]);

  // Dark-mode overrides pulled from the shared ThemeContext.
  // Institution Home's ambient background is skipped in dark mode.
  const { mode, palette: themePalette } = useTheme();
  const isDark = mode === 'dark';
  const dark   = useMemo(() => (isDark ? buildDarkOverrides(themePalette) : {}), [isDark, themePalette]);

  if (loading) {
    return (
      <SettingsCtx.Provider value={{ isDark, dark }}>
      <View style={[styles.center, isDark && dark.screen]}>
        {!isDark ? <InstitutionScreenBackground layer /> : null}
        <ActivityIndicator size="large" color={BRAND_DARK_BLUE} />
        <Text style={styles.loadingText}>Loading settings...</Text>
      </View>
      </SettingsCtx.Provider>
    );
  }

  if (error || !settings) {
    return (
      <SettingsCtx.Provider value={{ isDark, dark }}>
      <View style={[styles.center, isDark && dark.screen]}>
        {!isDark ? <InstitutionScreenBackground layer /> : null}
        <Text style={[styles.errorText, isDark && dark.errorText]}>{error || 'Settings not available.'}</Text>
      </View>
      </SettingsCtx.Provider>
    );
  }

  return (
    <SettingsCtx.Provider value={{ isDark, dark }}>
    <View style={[styles.screen, isDark && dark.screen]}>
      {/* Institution Home ambient wash — sits behind all content. */}
      {!isDark ? <InstitutionScreenBackground layer /> : null}
    <ScrollView
      style={{ flex: 1 }}
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
          <Step num="4" text="Remaining earnings are added to your academy wallet." />
          <Step
            num="5"
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
    </View>
    </SettingsCtx.Provider>
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
  // Institution Home ambient page base — the wash SVG paints on top.
  screen: {
    flex: 1,
    backgroundColor: INSTITUTION_BG_BASE,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: INSTITUTION_BG_BASE,
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

  // Cards — translucent glass fill + light glass border + soft blue
  // lift shadow so each card reads as a glass panel on the
  // Institution Home ambient wash.
  card: {
    backgroundColor: GLASS_FILL_STRONG,
    borderRadius: 16,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
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

