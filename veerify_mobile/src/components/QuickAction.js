// src/components/QuickAction.js
//
// Square tile button for the Institution Dashboard's "Quick Actions"
// row.
//   icon     lucide-react-native icon
//   label    "Add Student", "Create Batch", etc.
//   accent   palette accent (soft + vivid)
//   onPress  handler
//
// Visual style — subtle:
//   • Tonal accent chip with a thin outline in the accent colour.
//   • Small natural drop-shadow so the chip lifts off the glass
//     Quick Actions panel behind it.
//   • Label at full opacity in the primary text colour.
//   • Native TouchableOpacity press feedback only — no scale/glow.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { palette, radius, spacing, type } from '../theme';

export default function QuickAction({ icon: Icon, label, accent = palette.purple, onPress }) {
  // Clean white tile with a vivid accent glyph — reads well against
  // any background, keeps the label the visual anchor, and lets the
  // accent do just enough hue lifting to differentiate each action
  // at a glance. A thin same-hue outline sits at ~40% opacity so
  // the tile edge feels defined without dominating.
  const glyph = accent?.vivid || palette.text;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={styles.wrap}>
      <View
        style={[
          styles.tile,
          {
            backgroundColor: palette.surface,
            borderColor: glyph + '66',
          },
        ]}
      >
        {Icon ? <Icon size={24} color={glyph} strokeWidth={2.6} /> : null}
      </View>
      <Text style={styles.label} numberOfLines={2}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
  },
  tile: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    // Natural, modest drop-shadow — enough for the chip to feel
    // raised without any bloom / neon effect.
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  label: {
    ...type.caption,
    color: palette.text,
    textAlign: 'center',
    fontWeight: '600',
  },
});
