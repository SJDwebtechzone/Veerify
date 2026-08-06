// src/components/AppHeader.js
//
// [DEPRECATED — kept for future non-tab surfaces]
//
// This component used to render a fixed top bar with the notification
// bell across every role's dashboard. The design brief moved the bell
// INTO the "Welcome Back" greeting card (top-right of that card), and
// removed the top bar entirely to save vertical space. As a result no
// dashboard imports this component today.
//
// The file is intentionally kept (rather than deleted) so it can be
// re-introduced trivially on any future non-tab surface that needs a
// fixed header + bell — for example a modal-heavy detail flow. For
// dashboards, the bell now lives inline in the welcome card via
// <NotificationBellButton showBackground={false} />.

import React from 'react';
import { View, Text, StyleSheet, Platform, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import NotificationBellButton from './NotificationBellButton';

const SURFACE   = '#FFFFFF';
const TEXT      = '#111827';
const TEXT_MUTED = '#6B7280';
const BORDER    = '#F1F5F9';

export default function AppHeader({
  title,
  subtitle,
  left,
  right,
}) {
  const insets = useSafeAreaInsets();
  const topPad = insets.top || (Platform.OS === 'ios' ? 44 : StatusBar.currentHeight || 24);

  return (
    <View style={[styles.wrap, { paddingTop: topPad }]}>
      <View style={styles.row}>
        <View style={styles.left}>
          {left ? (
            left
          ) : (
            <View>
              {title ? (
                <Text style={styles.title} numberOfLines={1}>{title}</Text>
              ) : null}
              {subtitle ? (
                <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
              ) : null}
            </View>
          )}
        </View>
        <View style={styles.right}>
          {right}
          <NotificationBellButton showBackground={false} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: SURFACE,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
    zIndex: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 52,
  },
  left: {
    flex: 1,
    paddingRight: 12,
    minWidth: 0,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: TEXT,
    letterSpacing: 0.2,
  },
  subtitle: {
    fontSize: 11,
    color: TEXT_MUTED,
    marginTop: 2,
  },
});
