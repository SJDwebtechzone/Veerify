// src/components/NotificationBellButton.js
//
// Reusable notification-bell button. Encapsulates:
//   • Unread count polling (every 60s) via GET /notifications/unread-count
//   • Immediate refetch when the notifications screen becomes active
//     so the badge clears on return without waiting for the next tick
//   • Red badge pill with "N" (or "99+") when unread > 0
//   • Tap behaviour:
//       - Signed-in → navigate to StaffNotifications
//       - Guest    → branded "Sign in for notifications" dialog
//
// Used by both:
//   • <AppHeader/> — the fixed top bar on every role's dashboard
//   • <GlobalNotificationBell/> — the legacy floating overlay (kept
//     around for a few auth/pre-tab routes but hidden on dashboards
//     where AppHeader owns the bell)
//
// Kept variant-less on purpose so the bell looks identical in both
// contexts. Callers can pass `size` to tweak the icon in tight rows.

import React, { useEffect, useState } from 'react';
import { TouchableOpacity, StyleSheet, Text, View } from 'react-native';
import { Bell } from 'lucide-react-native';

import { useAuth } from '../context/AuthContext';
import { navigationRef } from '../navigation/navigationRef';
import { confirm } from './ConfirmDialog';
import apiClient from '../api/client';

const SURFACE = '#FFFFFF';
const TEXT    = '#111827';
const BADGE   = '#EF4444';

// Poll interval — 60s is a nice balance. The badge doesn't need to be
// second-perfect and a tighter loop would light up radios on quiet
// screens.
const UNREAD_POLL_MS = 60_000;

export default function NotificationBellButton({
  size = 20,
  color = TEXT,
  showBackground = true,
}) {
  const { user } = useAuth();
  const isGuest = !user;

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
        // Endpoint may not exist on older builds — swallow silently.
      }
    };

    // Small delay so native modules (Keychain, axios interceptor)
    // have time to warm up on a cold boot. Subsequent launches are
    // unaffected because the modules are already loaded.
    const firstFetch = setTimeout(() => { if (!cancelled) fetchUnread(); }, 1200);
    timerId = setInterval(fetchUnread, UNREAD_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(firstFetch);
      if (timerId) clearInterval(timerId);
    };
  }, [isGuest]);

  // Refetch immediately after visiting the notifications screen so the
  // badge clears without waiting for the next 60s tick.
  useEffect(() => {
    if (isGuest) return;
    let unsub = null;
    const attach = () => {
      if (navigationRef.isReady && navigationRef.isReady()) {
        try {
          unsub = navigationRef.addListener('state', () => {
            const name = navigationRef.getCurrentRoute()?.name || null;
            if (name === 'StaffNotifications') {
              // Backend marks rows read on GET, so wait long enough
              // for the list request to complete before refetching.
              setTimeout(async () => {
                try {
                  const r = await apiClient.get('/notifications/unread-count');
                  const n = Number(
                    r.data?.count ?? r.data?.unread ?? r.data?.unread_count ?? 0,
                  );
                  setUnread(Number.isFinite(n) ? n : 0);
                } catch (_) { /* noop */ }
              }, 1500);
            }
          });
        } catch (_) { /* retry below */ }
      } else {
        setTimeout(attach, 200);
      }
    };
    attach();
    return () => { if (unsub) { try { unsub(); } catch (_) { /* noop */ } } };
  }, [isGuest]);

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

  return (
    <TouchableOpacity
      style={showBackground ? styles.btn : styles.btnFlat}
      onPress={handlePress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={
        unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'
      }
    >
      <Bell size={size} color={color} strokeWidth={2.2} />
      {unread > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {unread > 99 ? '99+' : String(unread)}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // With background — matches the old floating bell look.
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
  // Flat — for use inside the AppHeader where the header already
  // provides the surface + shadow.
  btnFlat: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 2, right: 2,
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
