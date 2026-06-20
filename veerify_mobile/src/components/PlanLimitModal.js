// src/components/PlanLimitModal.js
//
// Shared "Upgrade Plan" modal shown whenever the institution admin tries
// to add a resource (trainer, student, …) past their subscription cap.
// Replaces the bare Alert.alert prompts that used to fire on a 402
// PLAN_LIMIT_REACHED response.
//
// Props:
//   visible       — boolean
//   kind          — 'trainer' | 'student' | 'branch' (controls copy)
//   limit         — number (max allowed by current plan)
//   current       — number (count already used)
//   planName      — optional plan label ("Starter")
//   onClose       — called when the user dismisses
//   onUpgrade     — called when "View plans" is tapped
//
// Visuals: centered card with a soft red glow, big icon, the
// "your plan limit is X" line, a usage bar, and two stacked actions.

import React from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import {
  X, Crown, Users, GraduationCap, Building2, ArrowRight,
} from 'lucide-react-native';

const BRAND = '#E63946';
const BRAND_SOFT = '#FFE4E6';
const BRAND_GLOW = '#FECDD3';
const TEXT = '#111827';
const TEXT_MUTED = '#6B7280';
const TEXT_LIGHT = '#9CA3AF';
const SURFACE = '#FFFFFF';
const BG = '#F4F4F8';
const BORDER = '#E5E7EB';

const ICON_FOR = {
  trainer:  Users,
  student:  GraduationCap,
  branch:   Building2,
};

const NOUN_FOR = {
  trainer: { sing: 'trainer', plur: 'trainers', actionTitle: 'Add another trainer' },
  student: { sing: 'student', plur: 'students', actionTitle: 'Enrol another student' },
  branch:  { sing: 'branch',  plur: 'branches', actionTitle: 'Add another branch' },
};

export default function PlanLimitModal({
  visible,
  kind = 'trainer',
  limit,
  current,
  planName,
  onClose,
  onUpgrade,
}) {
  const Icon = ICON_FOR[kind] || Users;
  const noun = NOUN_FOR[kind] || NOUN_FOR.trainer;
  const limitN = Number(limit ?? 0);
  const currentN = Number(current ?? 0);
  const pct = limitN > 0 ? Math.min(100, Math.round((currentN / limitN) * 100)) : 100;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.scrim}>
        <View style={styles.card}>
          {/* Close X */}
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeBtn}
            hitSlop={8}
            activeOpacity={0.7}
          >
            <X size={18} color={TEXT_MUTED} strokeWidth={2.2} />
          </TouchableOpacity>

          {/* Crown / icon hero */}
          <View style={styles.heroWrap}>
            <View style={styles.heroGlow} />
            <View style={styles.heroCircle}>
              <Crown size={32} color="#fff" strokeWidth={2.2} />
            </View>
          </View>

          {/* Title */}
          <Text style={styles.title}>Upgrade plan to add more</Text>
          <Text style={styles.subtitle}>{noun.actionTitle}</Text>

          {/* Plan-limit explainer */}
          <View style={styles.limitBox}>
            <View style={styles.limitRow}>
              <View style={styles.limitIconWrap}>
                <Icon size={16} color={BRAND} strokeWidth={2.4} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.limitLine}>
                  Your{' '}
                  <Text style={styles.limitPlan}>{planName || 'current'}</Text>{' '}
                  plan limit is{' '}
                  <Text style={styles.limitBig}>{limitN}</Text>{' '}
                  {limitN === 1 ? noun.sing : noun.plur} only.
                </Text>
                <Text style={styles.limitUsed}>
                  Currently used: {currentN} of {limitN}
                </Text>
              </View>
            </View>

            {/* Usage bar */}
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${pct}%` }]} />
            </View>
          </View>

          {/* Soft pitch */}
          <Text style={styles.pitch}>
            Upgrade to a higher plan to unlock more {noun.plur} and keep
            growing your academy.
          </Text>

          {/* CTAs */}
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => {
              onClose?.();
              onUpgrade?.();
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>View plans</Text>
            <ArrowRight size={16} color="#fff" strokeWidth={2.4} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.ghostBtn}
            onPress={onClose}
            activeOpacity={0.85}
          >
            <Text style={styles.ghostBtnText}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  card: {
    backgroundColor: SURFACE,
    borderRadius: 22,
    padding: 22,
    paddingTop: 18,
  },
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
    zIndex: 2,
  },

  heroWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    marginBottom: 14,
  },
  heroGlow: {
    position: 'absolute',
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: BRAND_GLOW,
    opacity: 0.7,
  },
  heroCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: BRAND,
    alignItems: 'center', justifyContent: 'center',
  },

  title: {
    fontSize: 20, fontWeight: '900', color: TEXT,
    letterSpacing: -0.3, textAlign: 'center',
  },
  subtitle: {
    fontSize: 13, color: TEXT_MUTED,
    textAlign: 'center', marginTop: 4, marginBottom: 16,
  },

  limitBox: {
    backgroundColor: BRAND_SOFT,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  limitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  limitIconWrap: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  limitLine: {
    fontSize: 13, color: TEXT, lineHeight: 19,
  },
  limitPlan: { fontWeight: '900', color: BRAND },
  limitBig: { fontWeight: '900', color: BRAND, fontSize: 14 },
  limitUsed: {
    marginTop: 4,
    fontSize: 11, color: TEXT_MUTED, fontWeight: '700',
    letterSpacing: 0.3,
  },

  barTrack: {
    marginTop: 12,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#FFF',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: BRAND,
    borderRadius: 999,
  },

  pitch: {
    fontSize: 12,
    color: TEXT_MUTED,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
    paddingHorizontal: 6,
  },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: BRAND,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },

  ghostBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  ghostBtnText: { color: TEXT_MUTED, fontSize: 13, fontWeight: '700' },
});
