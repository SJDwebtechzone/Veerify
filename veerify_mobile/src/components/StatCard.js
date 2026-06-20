// src/components/StatCard.js
//
// Pastel KPI tile used on the dashboard. Pass:
//   icon     A lucide-react-native icon component
//   label    Short label ("Total Students")
//   value    The number / string to display ("248")
//   delta    Optional small subtitle ("+12 this week")
//   accent   One of palette.purple|blue|green|orange|pink|teal|rose

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { palette, radius, shadows, spacing, type } from '../theme';

export default function StatCard({ icon: Icon, label, value, delta, accent = palette.purple, onPress }) {
  const body = (
    <>
      <View style={[styles.iconWrap, { backgroundColor: accent.soft }]}>
        {Icon ? <Icon size={20} color={accent.vivid} strokeWidth={2.2} /> : null}
      </View>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
      {delta ? <Text style={[styles.delta, { color: accent.on }]}>{delta}</Text> : null}
    </>
  );

  if (typeof onPress === 'function') {
    return (
      <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
        {body}
      </TouchableOpacity>
    );
  }
  return <View style={styles.card}>{body}</View>;
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    minHeight: 120,
    justifyContent: 'space-between',
    ...shadows.card,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  value: { ...type.h1, color: palette.text },
  label: { ...type.caption, color: palette.textMuted, marginTop: 2 },
  delta: { ...type.micro, marginTop: spacing.sm },
});
