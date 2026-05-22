// src/components/QuickAction.js
//
// Square tile button for the dashboard's "Quick Actions" row.
//   icon     lucide-react-native icon
//   label    "Add Student", "Create Batch", etc.
//   accent   palette accent (soft + vivid)
//   onPress  handler

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { palette, radius, shadows, spacing, type } from '../theme';

export default function QuickAction({ icon: Icon, label, accent = palette.purple, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.wrap}>
      <View style={[styles.tile, { backgroundColor: accent.soft }]}>
        {Icon ? <Icon size={22} color={accent.vivid} strokeWidth={2.2} /> : null}
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
    ...shadows.card,
  },
  label: {
    ...type.caption,
    color: palette.text,
    textAlign: 'center',
    fontWeight: '600',
  },
});
