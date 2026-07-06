// src/components/ConfirmDialog.js
//
// Polished replacement for React Native's native Alert.alert popup.
// Renders a centered card with an optional accent icon, bold title,
// muted body, and a row of buttons (Cancel + primary, optional 3rd).
//
// Two ways to use it:
//
//   1. Declarative (recommended for a screen with a single dialog):
//      <ConfirmDialog
//        visible={open}
//        title="Sign out?"
//        message="You'll need to log back in to continue."
//        variant="destructive"
//        confirmText="Sign out"
//        cancelText="Stay"
//        onConfirm={() => { setOpen(false); logout(); }}
//        onCancel={() => setOpen(false)}
//      />
//
//   2. Imperative (drop-in for Alert.alert anywhere):
//      import { confirm } from '../../components/ConfirmDialog';
//      confirm({
//        title: 'Plan limit reached',
//        message: 'Upgrade to Unlimited to add more students.',
//        variant: 'warning',
//        confirmText: 'Upgrade plan',
//        cancelText: 'Edit number',
//        onConfirm: () => navigation.navigate('PlanSelection'),
//      });
//
// The imperative API requires <ConfirmDialogHost /> to be mounted once at
// the root of the app (typically in App.tsx, next to SafeAreaProvider).

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet, Animated, Easing, Platform,
} from 'react-native';
import {
  X, AlertTriangle, Info, CheckCircle2, ShieldAlert,
} from 'lucide-react-native';

const VARIANT_THEMES = {
  // Pink hero — used for destructive actions (Sign out, Delete).
  destructive: {
    accent: '#E63946',
    accentSoft: '#FFE4E6',
    icon: ShieldAlert,
    confirmBg: '#E63946',
    confirmText: '#FFFFFF',
  },
  // Amber — used for "are you sure" + upgrade prompts.
  warning: {
    accent: '#D97706',
    accentSoft: '#FEF3C7',
    icon: AlertTriangle,
    confirmBg: '#E63946',
    confirmText: '#FFFFFF',
  },
  // Sky — used for purely informational confirmations.
  info: {
    accent: '#2563EB',
    accentSoft: '#DBEAFE',
    icon: Info,
    confirmBg: '#2563EB',
    confirmText: '#FFFFFF',
  },
  // Brand red — used for "Saved!" / "Updated!" / "All set" prompts.
  // Was green before; flipped to brand red so the success card visually
  // matches the rest of the app's primary CTAs and confirmation flows
  // (Payment, Enrollment, Course Save, etc.).
  success: {
    accent: '#E63946',
    accentSoft: '#FFE4E6',
    icon: CheckCircle2,
    confirmBg: '#E63946',
    confirmText: '#FFFFFF',
  },
};

export default function ConfirmDialog({
  visible,
  title,
  message,
  variant = 'info',
  confirmText = 'OK',
  cancelText = 'Cancel',
  destructiveText,            // optional third button — usually for "discard"
  onConfirm,
  onCancel,
  onDestructive,
  hideCancel = false,
}) {
  const theme = VARIANT_THEMES[variant] || VARIANT_THEMES.info;
  const Icon = theme.icon;

  // Subtle scale-in animation when the dialog appears.
  const scale = useRef(new Animated.Value(0.92)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1, duration: 180, useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1, friction: 7, tension: 90, useNativeDriver: true,
        }),
      ]).start();
    } else {
      scale.setValue(0.92);
      opacity.setValue(0);
    }
  }, [visible, scale, opacity]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <Animated.View style={[styles.backdrop, { opacity }]}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onCancel}
        />
        <Animated.View
          style={[
            styles.card,
            { transform: [{ scale }] },
          ]}
        >
          {/* Accent stripe at the top of the card — picks up the theme
              color so the dialog feels intentional, not stock. */}
          <View style={[styles.accentStripe, { backgroundColor: theme.accent }]} />

          {/* Icon with concentric glow rings — the soft outer rings give
              the icon depth so it reads as a polished focal point rather
              than a flat coloured circle. */}
          <View style={styles.iconStage}>
            <View
              style={[
                styles.iconHaloOuter,
                { backgroundColor: theme.accentSoft, opacity: 0.55 },
              ]}
            />
            <View
              style={[
                styles.iconHaloInner,
                { backgroundColor: theme.accentSoft },
              ]}
            />
            <View style={[styles.iconWrap, { backgroundColor: theme.accent }]}>
              <Icon size={30} color="#FFFFFF" strokeWidth={2.4} />
            </View>
          </View>

          {/* Close (×) — gives the user a third way out besides Cancel/backdrop. */}
          {!hideCancel ? (
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onCancel}
              hitSlop={6}
              activeOpacity={0.7}
            >
              <X size={16} color="#64748B" strokeWidth={2.4} />
            </TouchableOpacity>
          ) : null}

          {/* Copy */}
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {message ? <Text style={styles.message}>{message}</Text> : null}

          {/* Buttons */}
          <View style={styles.btnRow}>
            {!hideCancel ? (
              <TouchableOpacity
                style={[styles.btn, styles.btnGhost]}
                onPress={onCancel}
                activeOpacity={0.85}
              >
                <Text style={styles.btnGhostText}>{cancelText}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[
                styles.btn,
                styles.btnPrimary,
                {
                  backgroundColor: theme.confirmBg,
                  shadowColor: theme.confirmBg,
                },
              ]}
              onPress={onConfirm}
              activeOpacity={0.88}
            >
              <Text style={[styles.btnPrimaryText, { color: theme.confirmText }]}>
                {confirmText}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Optional secondary destructive action below the row */}
          {destructiveText ? (
            <TouchableOpacity
              style={styles.destructiveLink}
              onPress={onDestructive}
              activeOpacity={0.7}
            >
              <Text style={styles.destructiveLinkText}>{destructiveText}</Text>
            </TouchableOpacity>
          ) : null}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

// ─── Imperative API ────────────────────────────────────────────────────
//
// Lets call sites use `confirm({ title, message, ... })` from anywhere
// without wiring local state. Mount <ConfirmDialogHost /> once at the
// app root and you can fire confirm() like you would Alert.alert.

let dispatchSet = null;
export function confirm(options) {
  if (typeof dispatchSet === 'function') {
    dispatchSet({ visible: true, ...options });
  } else if (__DEV__) {
    // eslint-disable-next-line no-console
    console.warn(
      '[ConfirmDialog] confirm() called but <ConfirmDialogHost /> is not mounted. ' +
      'Add <ConfirmDialogHost /> near the root of your app.',
    );
  }
}

export function ConfirmDialogHost() {
  const [state, setState] = useState({ visible: false });
  useEffect(() => {
    dispatchSet = setState;
    return () => { dispatchSet = null; };
  }, []);
  const close = () => setState((s) => ({ ...s, visible: false }));
  return (
    <ConfirmDialog
      {...state}
      onConfirm={() => {
        const cb = state.onConfirm;
        close();
        // Defer the user callback so the close animation can start first.
        setTimeout(() => { if (typeof cb === 'function') cb(); }, 0);
      }}
      onCancel={() => {
        const cb = state.onCancel;
        close();
        setTimeout(() => { if (typeof cb === 'function') cb(); }, 0);
      }}
      onDestructive={() => {
        const cb = state.onDestructive;
        close();
        setTimeout(() => { if (typeof cb === 'function') cb(); }, 0);
      }}
    />
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    // Slightly deeper backdrop for premium focus — lifts the white card
    // off the page and centres the user's attention on the decision.
    backgroundColor: 'rgba(8, 15, 30, 0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingTop: 34,
    paddingBottom: 22,
    paddingHorizontal: 24,
    alignItems: 'center',
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOpacity: 0.22,
        shadowRadius: 28,
        shadowOffset: { width: 0, height: 18 },
      },
      android: { elevation: 14 },
    }),
  },

  // Thin coloured accent stripe at the very top of the card.
  accentStripe: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 4,
  },

  // Icon stage with concentric soft rings for depth.
  iconStage: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    height: 80,
    width: 80,
  },
  iconHaloOuter: {
    position: 'absolute',
    width: 80, height: 80, borderRadius: 40,
  },
  iconHaloInner: {
    position: 'absolute',
    width: 64, height: 64, borderRadius: 32,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },

  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },

  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.2,
  },
  message: {
    fontSize: 14.5,
    fontWeight: '500',
    color: '#475569',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 22,
    paddingHorizontal: 4,
  },

  btnRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  btnGhostText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
    letterSpacing: 0.1,
  },
  btnPrimary: {
    backgroundColor: '#E63946',
    // Coloured glow under the primary button so the eye lands here first.
    ...Platform.select({
      ios: {
        shadowOpacity: 0.32,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 6 },
    }),
  },
  btnPrimaryText: {
    fontSize: 14.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  destructiveLink: {
    marginTop: 14,
    paddingVertical: 4,
  },
  destructiveLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94A3B8',
  },
});
