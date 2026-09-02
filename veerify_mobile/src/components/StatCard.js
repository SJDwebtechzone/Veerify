// src/components/StatCard.js
//
// KPI tile used on the Institution Dashboard. Pass:
//   icon     A lucide-react-native icon component
//   label    Short label ("Total Students")
//   value    The number / string to display ("248")
//   delta    Optional small subtitle ("+12 this week")
//   accent   One of palette.purple|blue|green|orange|pink|teal|rose
//
// Visual style — subtle frosted glass:
//   • Translucent white surface so the light-blue ambient background
//     bleeds through faintly. No native blur required.
//   • Slightly brighter top border to mimic light catching the top
//     edge of a glass panel — the whole card's "highlight".
//   • Soft outward shadow so the card lifts off the backdrop.
//   • Icon sits in a tonal accent chip (soft fill + hairline outline).
//   • Text stays at full opacity for readability. Numbers are bold
//     and tight; labels stay muted.
//
// No press animation, no glow — matching the "subtle, professional,
// avoid neon / avoid unnecessary animations" direction.

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { palette, radius, spacing, type } from '../theme';

export default function StatCard({ icon: Icon, label, value, delta, accent = palette.purple, onPress }) {
  const body = (
    <>
      <View style={[styles.iconWrap, { backgroundColor: accent.soft, borderColor: accent.vivid + '2E' }]}>
        {Icon ? <Icon size={20} color={accent.vivid} strokeWidth={2.4} /> : null}
      </View>
      <Text style={styles.value} numberOfLines={1}>{value}</Text>
      <Text style={styles.label} numberOfLines={2}>{label}</Text>
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
    // Frosted glass: white at ~62% opacity so the ambient blue
    // paint underneath shows through and the card reads as glass,
    // not a flat white card. A subtly bluish tint keeps it aligned
    // with the navy header's palette.
    backgroundColor: 'rgba(255,255,255,0.62)',
    // Top edge slightly brighter than the other three → reads as
    // a very subtle highlight along the top rim of the panel.
    borderTopWidth: 1.5,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.95)',
    borderRightColor: 'rgba(255,255,255,0.6)',
    borderBottomColor: 'rgba(255,255,255,0.6)',
    borderLeftColor: 'rgba(255,255,255,0.6)',
    borderRadius: radius.xl,
    // Tighter padding so three cards fit comfortably on a
    // portrait phone (~360dp width) without cramping content.
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md + 2,
    minHeight: 132,
    justifyContent: 'space-between',
    // Soft cool-blue drop-shadow — reads as glass caught by the
    // ambient blue light behind it (per the reference).
    shadowColor: '#1E40AF',
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm + 2,
    // Hairline outline in the accent colour keeps the chip from
    // reading as a pastel blob — makes the whole card feel more
    // precise.
    borderWidth: 1,
  },
  value: {
    ...type.h1,
    color: palette.text,
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  label: {
    ...type.caption,
    color: palette.textMuted,
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
  },
  delta: {
    ...type.micro,
    marginTop: 6,
    fontSize: 10,
  },
});
