// src/components/ErrorBoundary.js
//
// Top-level error boundary wrapped around the entire app tree. Purpose:
//
//   1. First-launch crash containment. If a native module (Keychain,
//      AsyncStorage, SafeArea) fails synchronously on a cold Android
//      boot — the "app crashes only on the first launch after tapping
//      the icon" symptom — this boundary catches the render exception
//      and shows a Retry screen instead of the RN red-box / white
//      crash card, so the user isn't dumped back to the launcher.
//
//   2. Any other render-time throw. Crash telemetry can hang off the
//      `componentDidCatch` hook later; for now we log to console.
//
// The boundary itself uses ONLY primitive react-native pieces (View,
// Text, TouchableOpacity, StyleSheet) so it doesn't drag in any of the
// providers or native modules that could have caused the original
// crash. If those primitives themselves fail the app is dead anyway.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error: error || new Error('Unknown startup error') };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.log('[App] ErrorBoundary caught', {
      message: error?.message,
      stack:   info?.componentStack,
    });
  }

  handleRetry = () => {
    // Reset state so the tree re-mounts. Native modules that were
    // half-initialised on the first launch are typically ready by the
    // time this handler fires, so the second attempt usually succeeds.
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <View style={styles.screen}>
        <View style={styles.card}>
          <Text style={styles.title}>Veerify hit a snag starting up</Text>
          <Text style={styles.body}>
            The app didn't start cleanly. Tap Retry to try again — this
            usually clears itself on the second try.
          </Text>
          {__DEV__ && this.state.error?.message ? (
            <Text style={styles.diag} numberOfLines={4}>
              {String(this.state.error.message)}
            </Text>
          ) : null}
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={this.handleRetry}
            activeOpacity={0.85}
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#F4E4E6',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  diag: {
    fontSize: 11,
    color: '#B91C1C',
    fontFamily: 'monospace',
    marginBottom: 16,
    textAlign: 'center',
  },
  retryBtn: {
    backgroundColor: '#E63946',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 999,
    marginTop: 4,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
});
