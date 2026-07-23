// src/components/GlobalNotificationBell.js
//
// Floating notification bell mounted once at the App root. Renders as
// an absolute-positioned round button in the top-right corner and
// stays visible across every screen. Behaviour:
//
//   • Guest (no user)       → branded "Sign in for notifications" dialog.
//   • Signed-in (any role)  → navigate to StaffNotifications.
//
// Extras (this file):
//   • Unread badge — polls /notifications/unread-count every 60s (and
//     immediately after the screen transitions to the notifications
//     list so the count clears without waiting for the next tick).
//     Renders a small red pill with "N" (or "99+") in the top-right
//     of the bell whenever the count is > 0.
//   • Auto-hide on scroll — the bellScrollBus reports 'down' / 'up'
//     from any screen that plugs in useBellScrollHandler(). Down →
//     slide off the top edge; up → slide back in. Uses Animated so
//     the motion is smooth and doesn't run on the JS thread.
//   • Route allow-list — hides on Welcome / Login / Register /
//     ForgotPassword / ChangePassword and on StaffNotifications
//     itself (tapping there would re-navigate to the same screen).

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, TouchableOpacity, StyleSheet, Platform, StatusBar, Text,
} from 'react-native';
import { Bell } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../context/AuthContext';
import { navigationRef } from '../navigation/navigationRef';
import { confirm } from './ConfirmDialog';
import apiClient from '../api/client';
import { subscribe as subscribeToScroll, reset as resetScrollBus } from './bellScrollBus';

const SURFACE = '#FFFFFF';
const TEXT    = '#111827';
const BADGE   = '#EF4444';

// Home-tab route names by role — the bell is visible ONLY on these
// routes. Everywhere else (all inner tabs, detail screens, auth
// screens, splash) the bell is hidden. Kept as an allow-list rather
// than a hide-list so a new inner screen added later is silently
// covered without needing to remember to update this file.
//
//   • Guest + Student → 'Home'          (StudentTabNavigator)
//   • Trainer / Staff → 'StaffDashboard' (StaffTabNavigator)
//   • Admin (Institution / Branch) → 'Dashboard' (AdminTabNavigator)
//
// Parent is excluded entirely — see PARENT_ROLE check below.
const SHOW_ON_ROUTES = new Set([
  'Home',
  'StaffDashboard',
  'Dashboard',
]);

// Parent role sees no notification bell anywhere per the spec.
const PARENT_ROLE = 'parent';

// How often we re-poll unread count for signed-in users. 60s is a
// good balance — the drop-shadow badge doesn't need to be second-by-
// second accurate, and a shorter interval would light up radios.
const UNREAD_POLL_MS = 60_000;

export default function GlobalNotificationBell() {
  const { user }   = useAuth();
  const insets     = useSafeAreaInsets();
  const isGuest    = !user;

  // Track the current route so we can hide on the exclusion list.
  // Also reset the scroll bus on every route change so a new screen
  // never inherits a "hidden" bell state from the previous screen's
  // last scroll direction.
  const [routeName, setRouteName] = useState(null);
  useEffect(() => {
    let unsub = null;
    let cancelled = false;
    const attach = () => {
      if (cancelled) return;
      if (navigationRef.isReady && navigationRef.isReady()) {
        try {
          setRouteName(navigationRef.getCurrentRoute()?.name || null);
          unsub = navigationRef.addListener('state', () => {
            try {
              setRouteName(navigationRef.getCurrentRoute()?.name || null);
              // New screen → bell should default to visible until the
              // new screen's own scroll handler reports otherwise.
              resetScrollBus();
            } catch (_) { /* noop */ }
          });
        } catch (_) { /* retry */ }
      } else {
        setTimeout(attach, 200);
      }
    };
    attach();
    return () => {
      cancelled = true;
      if (unsub) { try { unsub(); } catch (_) { /* noop */ } }
    };
  }, []);

  // ── Unread badge ─────────────────────────────────────────────────
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (isGuest) { setUnread(0); return; }
    let cancelled = false;
    let timerId = null;

    const fetchUnread = async () => {
      try {
        const r = await apiClient.get('/notifications/unread-count');
        const n = Number(
          r.data?.count ?? r.data?.unread ?? r.data?.unread_count ?? 0,
        );
        if (!cancelled) setUnread(Number.isFinite(n) ? n : 0);
      } catch (_) {
        // Endpoint may not exist on older builds — swallow silently
        // rather than lighting up console.error on every tick.
      }
    };

    // Delay the very first fetch so native modules (Keychain, axios
    // interceptor) can finish initialising on a cold boot. Second
    // launches are unaffected because the modules are already warm.
    const firstFetch = setTimeout(() => {
      if (!cancelled) fetchUnread();
    }, 1200);
    timerId = setInterval(fetchUnread, UNREAD_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(firstFetch);
      if (timerId) clearInterval(timerId);
    };
  }, [isGuest]);

  // Re-fetch immediately when we land on the notifications screen so
  // returning from it clears the badge without a stale 60s wait.
  useEffect(() => {
    if (isGuest) return;
    if (routeName !== 'StaffNotifications') return;
    // Fire the refetch after a short delay — the backend marks rows
    // read on GET, so we want to fetch AFTER the list request has
    // returned to reflect the new zero.
    const t = setTimeout(async () => {
      try {
        const r = await apiClient.get('/notifications/unread-count');
        const n = Number(
          r.data?.count ?? r.data?.unread ?? r.data?.unread_count ?? 0,
        );
        setUnread(Number.isFinite(n) ? n : 0);
      } catch (_) { /* ignore */ }
    }, 1500);
    return () => clearTimeout(t);
  }, [routeName, isGuest]);

  // ── Auto-hide on scroll down / show on scroll up ────────────────
  // translateY is animated between 0 (visible) and -offscreen when
  // we're scrolling down. Native driver so the animation runs on the
  // UI thread and never stutters on a busy JS queue.
  const insetTop = insets.top || (Platform.OS === 'ios' ? 44 : StatusBar.currentHeight || 24);
  const HIDDEN_Y = -(insetTop + 60); // enough to clear the status bar + bell height
  const translateY = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const unsub = subscribeToScroll((direction) => {
      Animated.spring(translateY, {
        toValue: direction === 'down' ? HIDDEN_Y : 0,
        useNativeDriver: true,
        speed: 18,
        bounciness: 6,
      }).start();
    });
    return () => { try { unsub(); } catch (_) { /* noop */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [HIDDEN_Y]);

  // Parent accounts never see the bell — the spec excludes them
  // entirely. This runs before the route allow-list so a parent who
  // happens to land on a route named "Home" still gets nothing.
  if (user?.role === PARENT_ROLE) return null;
  // Allow-list gate: bell renders only on each role's Home tab.
  // Anything else (inner tabs like Programs / Batches / Profile,
  // detail screens like Course Detail / Enrolment, auth screens,
  // splash) short-circuits here.
  if (!routeName || !SHOW_ON_ROUTES.has(routeName)) return null;

  const handlePress = () => {
    if (isGuest) {
      confirm({
        title:       'Sign in for notifications',
        message:
          'Login to receive notifications about courses, batches, ' +
          'events, offers, announcements, and more.',
        variant:     'destructive',
        confirmText: 'Login',
        cancelText:  'Sign up',
        onConfirm: () => {
          if (navigationRef.isReady()) {
            try { navigationRef.navigate('Login'); } catch (_) { /* noop */ }
          }
        },
        onCancel: () => {
          if (navigationRef.isReady()) {
            try { navigationRef.navigate('Register'); } catch (_) { /* noop */ }
          }
        },
      });
      return;
    }
    if (navigationRef.isReady()) {
      try { navigationRef.navigate('StaffNotifications'); } catch (_) { /* noop */ }
    }
  };

  const top = insetTop + 8;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { top, transform: [{ translateY }] }]}
    >
      <TouchableOpacity
        style={styles.btn}
        onPress={handlePress}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={
          unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'
        }
      >
        <Bell size={20} color={TEXT} strokeWidth={2.2} />
        {unread > 0 ? (
          <Animated.View style={styles.badge}>
            <Text style={styles.badgeText}>
              {unread > 99 ? '99+' : String(unread)}
            </Text>
          </Animated.View>
        ) : null}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 16,
    zIndex: 9999,
    elevation: 20,
  },
  btn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: SURFACE,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  badge: {
    position: 'absolute',
    top: -3, right: -3,
    minWidth: 18, height: 18, borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: BADGE,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: SURFACE,
  },
  badgeText: {
    color: '#fff', fontSize: 10, fontWeight: '900',
    lineHeight: 12,
  },
});
