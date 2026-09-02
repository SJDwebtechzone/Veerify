// src/screens/SendFeedbackScreen.js
//
// Shared "Send Feedback" screen used by every role (institution admin,
// branch admin, student, trainer, parent). Reached from the More /
// Profile tab's "Send feedback" row.
//
// Backend: POST /api/feedback with { rating: 1..5, message? }. The
// server resolves the caller's role_snapshot + institution + branch
// from the JWT — no need to send them here.

import React, { createContext, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { ArrowLeft, Send, Star, MessageSquare } from 'lucide-react-native';

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
const BRAND_SOFT  = '#FFE4E6';
const TEXT        = HEADER_NAVY;
const TEXT_MUTED  = '#64748B';
const TEXT_LIGHT  = '#94A3B8';
const SURFACE     = GLASS_FILL_STRONG;
const BG          = INSTITUTION_BG_BASE;
const BORDER      = GLASS_BORDER_LIGHT;
const AMBER       = '#F59E0B';

const RATING_LABELS = {
  1: 'Very bad',
  2: 'Not great',
  3: 'It\'s okay',
  4: 'Pretty good',
  5: 'Excellent!',
};

// Local context so nested sub-components pick up dark-mode
// overrides without prop-drilling.
const FeedbackCtx = createContext({ isDark: false, dark: {} });

function buildDarkOverrides(pal) {
  return StyleSheet.create({
    screen:      { backgroundColor: pal.bg },
    header:      { backgroundColor: pal.surface, borderBottomColor: pal.border },
    headerTitle: { color: pal.text },
    headerSub:   { color: pal.textMuted },
    iconBtn:     { backgroundColor: pal.border },
    card:        { backgroundColor: pal.surface, borderColor: pal.border },
    cardTitle:   { color: pal.text },
    cardHint:    { color: pal.textMuted },
    textarea:    { backgroundColor: pal.surface, borderColor: pal.border, color: pal.text },
    footer:      { backgroundColor: pal.surface, borderTopColor: pal.border },
  });
}

export default function SendFeedbackScreen({ navigation }) {
  const [rating, setRating]     = useState(0);
  const [message, setMessage]   = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Dark-mode overrides pulled from the shared ThemeContext.
  // Institution Home's ambient background is skipped in dark mode.
  const { mode, palette: themePalette } = useTheme();
  const isDark = mode === 'dark';
  const dark   = useMemo(() => (isDark ? buildDarkOverrides(themePalette) : {}), [isDark, themePalette]);

  const submit = async () => {
    if (rating < 1 || rating > 5) {
      confirm({
        title:       'Rating required',
        message:     'Please tap a star to rate your experience.',
        variant:     'destructive',
        confirmText: 'OK',
        hideCancel:  true,
      });
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.post('/feedback', {
        rating,
        message: message.trim() || null,
      });
      confirm({
        title:       'Thank you!',
        message:     'Your feedback has been sent to our team. We appreciate you taking the time.',
        variant:     'success',
        confirmText: 'Done',
        hideCancel:  true,
        onConfirm:   () => navigation.goBack(),
      });
    } catch (err) {
      const msg = err?.response?.data?.message || err.message || 'Could not send feedback.';
      confirm({
        title:       'Failed to send',
        message:     msg,
        variant:     'destructive',
        confirmText: 'OK',
        hideCancel:  true,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FeedbackCtx.Provider value={{ isDark, dark }}>
    <KeyboardAvoidingView
      style={[styles.screen, isDark && dark.screen]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Institution Home ambient wash — sits behind all content. */}
      {!isDark ? <InstitutionScreenBackground layer /> : null}

      {/* Header */}
      <View style={[styles.header, isDark && dark.header]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.iconBtn, isDark && dark.iconBtn]} hitSlop={8}>
          <ArrowLeft size={20} color={isDark ? themePalette.text : HEADER_NAVY} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, isDark && dark.headerTitle]}>Send Feedback</Text>
          <Text style={[styles.headerSub, isDark && dark.headerSub]}>Tell us what you think about Veerify</Text>
        </View>
        <View style={styles.headerIcon}>
          <MessageSquare size={18} color={BRAND_DARK_BLUE} strokeWidth={2.2} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Rating card */}
        <View style={[styles.card, isDark && dark.card]}>
          <Text style={[styles.cardTitle, isDark && dark.cardTitle]}>How would you rate your experience?</Text>
          <Text style={[styles.cardHint, isDark && dark.cardHint]}>Tap a star — 1 is very bad, 5 is excellent.</Text>

          <View style={styles.starRow}>
            {[1, 2, 3, 4, 5].map((n) => {
              const active = n <= rating;
              return (
                <TouchableOpacity
                  key={n}
                  onPress={() => setRating(n)}
                  activeOpacity={0.7}
                  hitSlop={4}
                  style={styles.starBtn}
                >
                  <Star
                    size={38}
                    strokeWidth={1.8}
                    color={active ? AMBER : TEXT_LIGHT}
                    fill={active ? AMBER : 'transparent'}
                  />
                </TouchableOpacity>
              );
            })}
          </View>

          {rating > 0 ? (
            <Text style={styles.ratingLabel}>{RATING_LABELS[rating]}</Text>
          ) : (
            <Text style={[styles.ratingLabel, { color: TEXT_LIGHT }]}>Tap a star to rate</Text>
          )}
        </View>

        {/* Message card */}
        <View style={[styles.card, isDark && dark.card]}>
          <Text style={[styles.cardTitle, isDark && dark.cardTitle]}>Anything else? <Text style={styles.optional}>(optional)</Text></Text>
          <Text style={[styles.cardHint, isDark && dark.cardHint]}>
            Bugs, ideas, workflow suggestions — anything you'd like the team to know.
          </Text>
          <TextInput
            style={[styles.textarea, isDark && dark.textarea]}
            value={message}
            onChangeText={setMessage}
            placeholder="Type your message…"
            placeholderTextColor={TEXT_LIGHT}
            multiline
            textAlignVertical="top"
            maxLength={1000}
          />
          <Text style={styles.counter}>{message.length}/1000</Text>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Footer submit */}
      <View style={[styles.footer, isDark && dark.footer]}>
        <TouchableOpacity
          style={[styles.submitBtn, (submitting || rating < 1) && { opacity: 0.6 }]}
          onPress={submit}
          disabled={submitting || rating < 1}
          activeOpacity={0.88}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Send size={16} color="#fff" strokeWidth={2.4} />
              <Text style={styles.submitBtnText}>Send Feedback</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
    </FeedbackCtx.Provider>
  );
}

const styles = StyleSheet.create({
  // Base uses the Institution Home ambient wash so the glass
  // cards below read as translucent panels floating on it.
  screen: { flex: 1, backgroundColor: BG },

  // Header — glass slab with navy title and soft blue lift shadow.
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingTop: 48, paddingBottom: 14,
    backgroundColor: GLASS_FILL_STRONG,
    borderBottomWidth: 1, borderBottomColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.10,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: BRAND_ACCENT_SOFT,
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: HEADER_NAVY, letterSpacing: 0.2 },
  headerSub:   { fontSize: 11, color: TEXT_MUTED, fontWeight: '600', marginTop: 2 },
  headerIcon: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: BRAND_ACCENT_SOFT,
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
  },

  body: { padding: 16, paddingBottom: 20 },

  // Glass card — translucent fill + light glass border + soft
  // blue lift shadow so the card reads as a glass panel on the
  // Institution Home ambient wash.
  card: {
    backgroundColor: GLASS_FILL_STRONG,
    borderRadius: 14,
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
    padding: 16,
    marginBottom: 12,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardTitle: { fontSize: 14, fontWeight: '800', color: HEADER_NAVY },
  cardHint:  { fontSize: 12, color: TEXT_MUTED, marginTop: 4, fontWeight: '500', lineHeight: 17 },
  optional:  { fontSize: 12, color: TEXT_LIGHT, fontWeight: '600' },

  starRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, marginTop: 16,
  },
  starBtn: { padding: 4 },
  ratingLabel: {
    textAlign: 'center', marginTop: 12,
    fontSize: 13, fontWeight: '800', color: AMBER, letterSpacing: 0.3,
  },

  textarea: {
    minHeight: 120,
    backgroundColor: GLASS_HIGHLIGHT,
    borderRadius: 10,
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
    paddingHorizontal: 12, paddingTop: 11, paddingBottom: 11,
    fontSize: 14, color: HEADER_NAVY,
    marginTop: 12,
  },
  counter: {
    marginTop: 6, fontSize: 11, color: TEXT_LIGHT, textAlign: 'right', fontWeight: '600',
  },

  // Footer — glass slab that matches the header, so the submit
  // button lifts off the same translucent surface.
  footer: {
    paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 22,
    backgroundColor: GLASS_FILL_STRONG,
    borderTopWidth: 1, borderTopColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -3 },
    elevation: 3,
  },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, borderRadius: 12,
    backgroundColor: BRAND,
  },
  submitBtnText: { color: '#fff', fontWeight: '800', fontSize: 14, letterSpacing: 0.2 },
});
