// src/components/ThemeToggle.js
//
// Premium sun/moon theme toggle for the More / Profile screens.
// Renders as a full row (label on the left, animated switch on the
// right) so it slots naturally into existing settings cards.
//
// The switch itself is a rounded track with a knob that slides + a
// sun icon on the light side, a moon icon on the dark side. Spring
// animation runs on the native driver so it stays smooth even when
// the JS thread is busy re-rendering the app after the theme flips.
//
// The toggle reads + writes from the shared ThemeContext, so
// dropping it anywhere in the tree Just Works — no callback plumbing
// needed on the caller side.

import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, Animated, StyleSheet } from 'react-native';
import { Sun, Moon } from 'lucide-react-native';

import { useTheme } from '../theme/ThemeContext';

const TRACK_WIDTH  = 56;
const TRACK_HEIGHT = 30;
const KNOB_SIZE    = 24;
const KNOB_TRAVEL  = TRACK_WIDTH - KNOB_SIZE - 6; // 3dp padding on each side

export default function ThemeToggle({ label = 'Dark Mode', hint }) {
  const { mode, palette, toggleMode } = useTheme();
  const isDark = mode === 'dark';

  // Position 0 → sun (light), 1 → moon (dark). Drives knob x-slide,
  // knob color, and the icon opacities on either side.
  const anim = useRef(new Animated.Value(isDark ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(anim, {
      toValue: isDark ? 1 : 0,
      useNativeDriver: false, // driving both transform + backgroundColor
      speed: 20,
      bounciness: 6,
    }).start();
  }, [isDark, anim]);

  const knobLeft = anim.interpolate({
    inputRange:  [0, 1],
    outputRange: [3, 3 + KNOB_TRAVEL],
  });
  const trackBg = anim.interpolate({
    inputRange:  [0, 1],
    outputRange: ['#FBBF24', '#0B0F17'],   // amber → near-black
  });
  const sunOpacity = anim.interpolate({
    inputRange:  [0, 1],
    outputRange: [1, 0.35],
  });
  const moonOpacity = anim.interpolate({
    inputRange:  [0, 1],
    outputRange: [0.35, 1],
  });

  return (
    <Pressable
      onPress={toggleMode}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: palette.surface,
          borderColor:     palette.borderSoft,
        },
        pressed && { opacity: 0.85 },
      ]}
      accessibilityRole="switch"
      accessibilityState={{ checked: isDark }}
      accessibilityLabel={label}
    >
      <View style={styles.textCol}>
        <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
        {hint ? (
          <Text style={[styles.hint, { color: palette.textMuted }]} numberOfLines={2}>
            {hint}
          </Text>
        ) : (
          <Text style={[styles.hint, { color: palette.textMuted }]}>
            {isDark ? 'On — using Dark theme' : 'Off — using Light theme'}
          </Text>
        )}
      </View>

      <Animated.View style={[styles.track, { backgroundColor: trackBg }]}>
        {/* Sun icon fixed to the left inside the track. */}
        <Animated.View style={[styles.iconWrap, { left: 6, opacity: sunOpacity }]}>
          <Sun size={12} color="#FFFFFF" strokeWidth={2.6} />
        </Animated.View>
        {/* Moon icon fixed to the right inside the track. */}
        <Animated.View style={[styles.iconWrap, { right: 6, opacity: moonOpacity }]}>
          <Moon size={12} color="#FFFFFF" strokeWidth={2.6} />
        </Animated.View>
        {/* Sliding knob. */}
        <Animated.View style={[styles.knob, { left: knobLeft }]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  textCol: {
    flex: 1,
    paddingRight: 12,
  },
  label: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  hint: {
    fontSize: 12,
    marginTop: 2,
  },
  track: {
    width:  TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    justifyContent: 'center',
    position: 'relative',
  },
  iconWrap: {
    position: 'absolute',
    top: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  knob: {
    position: 'absolute',
    top: 3,
    width:  KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    backgroundColor: '#FFFFFF',
    // Soft drop shadow to lift the knob off the track. Kept subtle
    // so the switch doesn't scream in a settings list.
    shadowColor: '#000',
    shadowOpacity: 0.20,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});
