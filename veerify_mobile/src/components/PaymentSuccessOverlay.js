// src/components/PaymentSuccessOverlay.js
//
// Full-screen celebration overlay shown when a payment is confirmed. Replaces
// the plain ConfirmDialog "Payment confirmed" success popup so the moment
// feels properly rewarding.
//
// Animations (Animated, native driver where possible):
//   1. Backdrop fades in.
//   2. The big check circle springs in (scale 0 → 1.1 → 1) with a soft
//      red→pink halo pulse behind it.
//   3. 22 confetti emojis launch from the centre, drift outward with
//      randomised x/y, rotate, then fade.
//   4. Title + subtitle slide up + fade in.
//   5. "Get started" button slides up from below.
//
// Public API:
//   <PaymentSuccessOverlay
//     visible={boolean}
//     onContinue={() => void}
//     institutionName={string}   // optional, customises the subtitle
//   />

import React, { useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, Animated, Easing, Dimensions,
} from 'react-native';
import { Check, Sparkles } from 'lucide-react-native';

const BRAND       = '#E63946';
const BRAND_DEEP  = '#B11226';
const GREEN       = '#10B981';
const TEXT        = '#111827';
const TEXT_MUTED  = '#6B7280';
const SURFACE     = '#FFFFFF';

const { width: W, height: H } = Dimensions.get('window');

// Confetti palette + glyph set. Plain unicode so no extra fonts/deps.
const CONFETTI_GLYPHS = ['✦', '✧', '★', '•', '◆', '✻', '✺', '✿'];
const CONFETTI_COLORS = [BRAND, '#FFB703', GREEN, '#3B82F6', '#A855F7', '#F472B6'];
const CONFETTI_COUNT  = 22;

// Build one confetti particle's static descriptor. Distances/angles are
// randomised once per mount so each "pop" looks fresh.
function makeConfetti() {
  return Array.from({ length: CONFETTI_COUNT }).map((_, i) => {
    const angle = Math.random() * Math.PI * 2;
    const distance = 110 + Math.random() * 140;
    return {
      key: `c${i}`,
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance - 40,    // bias upward so they look launched
      rot: Math.floor(Math.random() * 540) - 270,
      glyph: CONFETTI_GLYPHS[i % CONFETTI_GLYPHS.length],
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: Math.floor(Math.random() * 120),
      size: 14 + Math.floor(Math.random() * 12),
    };
  });
}

export default function PaymentSuccessOverlay({ visible, onContinue, institutionName }) {
  // Static for the lifetime of the mount so the confetti pattern doesn't
  // re-randomise on every re-render.
  const confetti = useRef(makeConfetti()).current;

  const backdrop = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0)).current;
  const haloScale = useRef(new Animated.Value(0.6)).current;
  const haloOpacity = useRef(new Animated.Value(0)).current;
  const textTranslateY = useRef(new Animated.Value(20)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const btnTranslateY = useRef(new Animated.Value(30)).current;
  const btnOpacity = useRef(new Animated.Value(0)).current;
  const confettiProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      // Reset for the next time the parent flips visible.
      backdrop.setValue(0);
      checkScale.setValue(0);
      haloScale.setValue(0.6);
      haloOpacity.setValue(0);
      textTranslateY.setValue(20);
      textOpacity.setValue(0);
      btnTranslateY.setValue(30);
      btnOpacity.setValue(0);
      confettiProgress.setValue(0);
      return;
    }

    Animated.sequence([
      // 1. Backdrop fade
      Animated.timing(backdrop, {
        toValue: 1, duration: 220, useNativeDriver: true,
      }),
      // 2. Check + halo + confetti burst, in parallel
      Animated.parallel([
        Animated.spring(checkScale, {
          toValue: 1, friction: 5, tension: 60, useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(haloOpacity, { toValue: 1, duration: 150, useNativeDriver: true }),
          Animated.timing(haloOpacity, { toValue: 0, duration: 700, useNativeDriver: true }),
        ]),
        Animated.spring(haloScale, {
          toValue: 1.4, friction: 4, tension: 40, useNativeDriver: true,
        }),
        Animated.timing(confettiProgress, {
          toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
      ]),
      // 3. Title + subtitle slide up & fade
      Animated.parallel([
        Animated.timing(textTranslateY, {
          toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
        Animated.timing(textOpacity, {
          toValue: 1, duration: 300, useNativeDriver: true,
        }),
      ]),
      // 4. Button slides up
      Animated.parallel([
        Animated.timing(btnTranslateY, {
          toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
        Animated.timing(btnOpacity, {
          toValue: 1, duration: 260, useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [visible]);

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} statusBarTranslucent animationType="none">
      <Animated.View style={[styles.backdrop, { opacity: backdrop }]}>
        {/* Centred celebration content */}
        <View style={styles.center}>
          {/* Confetti burst — absolute over the check */}
          <View pointerEvents="none" style={styles.confettiLayer}>
            {confetti.map((c) => {
              const translateX = confettiProgress.interpolate({
                inputRange: [0, 1], outputRange: [0, c.dx],
              });
              const translateY = confettiProgress.interpolate({
                inputRange: [0, 1], outputRange: [0, c.dy],
              });
              const rotate = confettiProgress.interpolate({
                inputRange: [0, 1], outputRange: ['0deg', `${c.rot}deg`],
              });
              const opacity = confettiProgress.interpolate({
                inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 1, 1, 0],
              });
              return (
                <Animated.Text
                  key={c.key}
                  style={[
                    styles.confetti,
                    {
                      color: c.color,
                      fontSize: c.size,
                      opacity,
                      transform: [{ translateX }, { translateY }, { rotate }],
                    },
                  ]}
                >
                  {c.glyph}
                </Animated.Text>
              );
            })}
          </View>

          {/* Halo behind the check — fades in/out as the check arrives */}
          <Animated.View
            style={[
              styles.halo,
              {
                opacity: haloOpacity,
                transform: [{ scale: haloScale }],
              },
            ]}
          />

          {/* The check circle — spring scale */}
          <Animated.View
            style={[
              styles.checkCircle,
              { transform: [{ scale: checkScale }] },
            ]}
          >
            <Check size={56} color="#fff" strokeWidth={3.2} />
          </Animated.View>

          {/* Title / subtitle */}
          <Animated.View
            style={{
              opacity: textOpacity,
              transform: [{ translateY: textTranslateY }],
              alignItems: 'center',
              marginTop: 28,
            }}
          >
            <View style={styles.titleRow}>
              <Sparkles size={18} color={BRAND} strokeWidth={2.4} />
              <Text style={styles.title}>Payment confirmed</Text>
              <Sparkles size={18} color={BRAND} strokeWidth={2.4} />
            </View>
            <Text style={styles.subtitle}>
              {institutionName
                ? `${institutionName} is now live on Veerify. Welcome aboard!`
                : 'Your academy is now live on Veerify. Welcome aboard!'}
            </Text>
          </Animated.View>

          {/* Primary CTA */}
          <Animated.View
            style={{
              opacity: btnOpacity,
              transform: [{ translateY: btnTranslateY }],
              alignSelf: 'stretch',
              marginTop: 32,
            }}
          >
            <TouchableOpacity
              style={styles.btn}
              onPress={onContinue}
              activeOpacity={0.9}
            >
              <Text style={styles.btnText}>Get started</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
  },
  center: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: SURFACE,
    borderRadius: 24,
    paddingTop: 64,
    paddingHorizontal: 24,
    paddingBottom: 24,
    alignItems: 'center',
    overflow: 'hidden',
    // Subtle glow shadow
    shadowColor: BRAND,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.18,
    shadowRadius: 32,
    elevation: 16,
  },
  confettiLayer: {
    position: 'absolute',
    top: 64 + 56,  // align with check centre
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    height: 1,
  },
  confetti: {
    position: 'absolute',
    fontWeight: '900',
  },
  halo: {
    position: 'absolute',
    top: 64,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#FCE7E9',
  },
  checkCircle: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: GREEN,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 22,
    elevation: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: TEXT,
    letterSpacing: 0.2,
  },
  subtitle: {
    marginTop: 10,
    fontSize: 14,
    color: TEXT_MUTED,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 4,
  },
  btn: {
    backgroundColor: BRAND,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: BRAND_DEEP,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
  },
  btnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
});
