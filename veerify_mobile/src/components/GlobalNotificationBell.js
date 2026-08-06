// src/components/GlobalNotificationBell.js
//
// Legacy floating notification bell. Used to sit in the top-right
// corner of the Home screens for every role — now those screens use
// <AppHeader/> which owns the bell inside a fixed header. This global
// overlay is kept ONLY for the routes that don't render an AppHeader
// yet (currently none of the dashboards, but leaving the plumbing in
// place lets us re-enable the floater on any future non-tab surface
// without touching the component tree).
//
// Auto-hide-on-scroll is preserved so that if any allowed route uses
// useBellScrollHandler(), the floater tucks away on scroll down.

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, StyleSheet, Platform, StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../context/AuthContext';
import { navigationRef } from '../navigation/navigationRef';
import { subscribe as subscribeToScroll, reset as resetScrollBus } from './bellScrollBus';
import NotificationBellButton from './NotificationBellButton';

// Routes that render their OWN AppHeader — the floater must stay
// hidden on these so we don't get two bells on the same screen. This
// is the inverse of the old SHOW_ON_ROUTES set.
//
//   • Student → 'Home'          (StudentTabNavigator)
//   • Trainer / Staff → 'StaffDashboard' (StaffTabNavigator)
//   • Admin (Institution / Branch) → 'Dashboard' (AdminTabNavigator)
const HAS_APP_HEADER = new Set([
  'Home',
  'StaffDashboard',
  'Dashboard',
]);

// Parent role sees no notification bell anywhere per the spec.
const PARENT_ROLE = 'parent';

export default function GlobalNotificationBell() {
  const { user }   = useAuth();
  const insets     = useSafeAreaInsets();

  // Track the current route so we can suppress the floater on routes
  // that render their own AppHeader.
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
              // New screen → floater defaults to visible until the
              // screen's own scroll handler reports otherwise.
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

  // Auto-hide on scroll down / show on scroll up.
  const insetTop = insets.top || (Platform.OS === 'ios' ? 44 : StatusBar.currentHeight || 24);
  const HIDDEN_Y = -(insetTop + 60);
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

  // Parent accounts never see the bell.
  if (user?.role === PARENT_ROLE) return null;
  // AppHeader owns the bell on every role's home dashboard, and no
  // other route ever showed the floater in the first place. So the
  // floater is currently a no-op — we short-circuit unconditionally.
  // Kept the file around (rather than removing the mount at App root)
  // so the navigation-ref plumbing and scroll-bus wiring stay in place
  // — any future non-tab surface that wants the floater back can
  // simply add itself to the SHOW_ON_ROUTES set and return the render
  // block below.
  return null;

  // eslint-disable-next-line no-unreachable
  // Kept as reference for how the floater would render if we ever
  // opt a route back in via the check above.
  // const top = insetTop + 8;
  // return (
  //   <Animated.View
  //     pointerEvents="box-none"
  //     style={[styles.wrap, { top, transform: [{ translateY }] }]}
  //   >
  //     <NotificationBellButton />
  //   </Animated.View>
  // );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 16,
    zIndex: 9999,
    elevation: 20,
  },
});
