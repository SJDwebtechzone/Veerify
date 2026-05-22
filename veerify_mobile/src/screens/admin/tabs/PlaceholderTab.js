// Temporary stand-in for tabs we'll design next. Wraps a friendly "coming next"
// state with the same shell so the tab bar can render without errors.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { palette, type, spacing, radius } from '../../../theme';

export default function PlaceholderTab({ route }) {
  const name = route?.params?.title || route?.name || 'Coming soon';
  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.emoji}>🛠️</Text>
        <Text style={styles.title}>{name}</Text>
        <Text style={styles.body}>
          We're designing this next. Stay on the Dashboard tab for now.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: palette.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    padding: spacing.xxxl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.border,
    maxWidth: 340,
  },
  emoji: { fontSize: 44, marginBottom: spacing.md },
  title: { ...type.h1, color: palette.text, marginBottom: spacing.xs },
  body: { ...type.body, color: palette.textMuted, textAlign: 'center' },
});
