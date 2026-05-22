// src/components/FAB.js
//
// Floating Action Button. Default is a + glyph but pass any lucide icon.
//   icon     lucide-react-native icon (defaults to Plus)
//   onPress  handler
//   bottom   override default bottom inset (useful with bottom-tabs)

import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { Plus } from 'lucide-react-native';
import { palette, shadows } from '../theme';

export default function FAB({ icon: Icon = Plus, onPress, bottom = 24, accent = palette.purple }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.fab, { bottom, backgroundColor: accent.vivid }]}
    >
      <Icon size={26} color="#fff" strokeWidth={2.4} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 20,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.fab,
  },
});
