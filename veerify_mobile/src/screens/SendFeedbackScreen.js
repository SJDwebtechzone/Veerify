// src/screens/SendFeedbackScreen.js
//
// Shared "Send Feedback" screen used by every role (institution admin,
// branch admin, student, trainer, parent). Reached from the More /
// Profile tab's "Send feedback" row.
//
// Backend: POST /api/feedback with { rating: 1..5, message? }. The
// server resolves the caller's role_snapshot + institution + branch
// from the JWT — no need to send them here.

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { ArrowLeft, Send, Star } from 'lucide-react-native';

import apiClient from '../api/client';
import { confirm } from '../components/ConfirmDialog';

const BRAND       = '#E63946';
const BRAND_SOFT  = '#FFE4E6';
const TEXT        = '#111827';
const TEXT_MUTED  = '#6B7280';
const TEXT_LIGHT  = '#9CA3AF';
const SURFACE     = '#FFFFFF';
const BG          = '#F4F4F8';
const BORDER      = '#E5E7EB';
const AMBER       = '#F59E0B';

const RATING_LABELS = {
  1: 'Very bad',
  2: 'Not great',
  3: 'It\'s okay',
  4: 'Pretty good',
  5: 'Excellent!',
};

export default function SendFeedbackScreen({ navigation }) {
  const [rating, setRating]     = useState(0);
  const [message, setMessage]   = useState('');
  const [submitting, setSubmitting] = useState(false);

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
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8}>
          <ArrowLeft size={20} color={TEXT} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Send Feedback</Text>
          <Text style={styles.headerSub}>Tell us what you think about Veerify</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Rating card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>How would you rate your experience?</Text>
          <Text style={styles.cardHint}>Tap a star — 1 is very bad, 5 is excellent.</Text>

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
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Anything else? <Text style={styles.optional}>(optional)</Text></Text>
          <Text style={styles.cardHint}>
            Bugs, ideas, workflow suggestions — anything you'd like the team to know.
          </Text>
          <TextInput
            style={styles.textarea}
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
      <View style={styles.footer}>
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
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingTop: 48, paddingBottom: 14,
    backgroundColor: SURFACE,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: TEXT },
  headerSub:   { fontSize: 11, color: TEXT_MUTED, fontWeight: '600', marginTop: 2 },

  body: { padding: 16, paddingBottom: 20 },

  card: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: { fontSize: 14, fontWeight: '800', color: TEXT },
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
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 12, paddingTop: 11, paddingBottom: 11,
    fontSize: 14, color: TEXT,
    marginTop: 12,
  },
  counter: {
    marginTop: 6, fontSize: 11, color: TEXT_LIGHT, textAlign: 'right', fontWeight: '600',
  },

  footer: {
    paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 22,
    backgroundColor: SURFACE,
    borderTopWidth: 1, borderTopColor: BORDER,
  },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, borderRadius: 12,
    backgroundColor: BRAND,
  },
  submitBtnText: { color: '#fff', fontWeight: '800', fontSize: 14, letterSpacing: 0.2 },
});
