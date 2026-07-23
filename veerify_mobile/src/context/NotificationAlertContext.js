// src/context/NotificationAlertContext.js
//
// Global "WhatsApp-style" alerter for inbound notifications.
//
// Strategy:
//   • Poll GET /api/notifications?limit=1 every POLL_MS while authenticated.
//   • Track the latest notification id we've seen in a ref.
//   • When a poll returns a row whose id is greater than the tracked id
//     (i.e. a brand-new notification arrived):
//       - vibrate the device with a short, WhatsApp-like double-buzz
//         pattern (Vibration is built-in to React Native, no extra deps),
//       - try to play a tone via react-native-sound IF that library is
//         installed (we require it dynamically so the app still bundles
//         when it isn't there yet — see the install note at the bottom),
//       - show an in-app toast banner at the top of the screen with the
//         title + a 1-line preview. Tapping it routes to the user's
//         notifications screen.
//
// Mounted just inside AuthProvider so we have access to the auth token.
// The poller pauses automatically when the user signs out.

import React, {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react';
import {
  Vibration, View, Text, TouchableOpacity, StyleSheet, Animated, Easing,
  Platform,
} from 'react-native';
import { Bell } from 'lucide-react-native';

import apiClient from '../api/client';
import { useAuth } from './AuthContext';
// Imperative navigate() — works even when our Banner is rendered outside
// the React Navigation tree, because the helper goes through the global
// navigationRef wired in AppNavigator.
import { navigate } from '../navigation/navigationRef';

const POLL_MS         = 20_000;
const VIBRATE_PATTERN = [0, 250, 100, 250];  // mimic WhatsApp's double buzz
const BANNER_MS       = 4_000;

// ── Optional system-default tone via @notifee/react-native ───────────────
//
// React Native itself has no audio API. To make a new notification ring
// like a WhatsApp ping using the user's *system default* tone, the cleanest
// way is to post a tiny local OS notification — the OS then plays whichever
// sound the user has configured on the notification channel.
//
// To enable real audio (zero asset bundling needed; uses the phone's
// default notification tone):
//   1. `npm install @notifee/react-native`
//   2. Rebuild the app (`npx react-native run-android` / `pod install`
//      + `run-ios`). Autolinking does the native wiring.
//   3. That's it — the dynamic require() below resolves and every new
//      notification triggers a system-tone ping.
//
// We require it in a try/catch so the JS bundle still builds today, before
// the library is installed. Until then we fall back to Vibration only.
// Audio is intentionally OFF until @notifee/react-native is installed.
// Metro statically resolves every require() it sees — even ones wrapped
// in try/catch and even ones built from string concatenation — so the
// only safe way to keep the bundle building today is to leave the
// require commented out. To enable the system default notification tone:
//
//   1. npm install @notifee/react-native
//   2. Rebuild the app (autolinking does the native wiring).
//   3. Replace the `null` assignments below with the real require:
//        const mod = require('@notifee/react-native');
//        notifee = mod.default || mod;
//        AndroidImportance = mod.AndroidImportance;
//
// Until then, new notifications still vibrate and show the in-app
// banner — they just don't ring.
const notifee = null;
const AndroidImportance = null;

let channelReady = false;
async function ensureChannel() {
  if (!notifee || channelReady) return;
  try {
    await notifee.createChannel({
      id:         'veerify-alerts',
      name:       'Veerify alerts',
      // HIGH so the OS plays the channel's default sound on every post.
      importance: AndroidImportance?.HIGH ?? 4,
      sound:      'default',
    });
    channelReady = true;
  } catch (_e) { /* harmless — we just lose the tone */ }
}

async function playSystemAlert({ title, body }) {
  if (!notifee) return;
  try {
    await ensureChannel();
    await notifee.requestPermission();
    await notifee.displayNotification({
      title: title || 'New notification',
      body:  body  || '',
      android: {
        channelId: 'veerify-alerts',
        sound:     'default',           // ← system default tone
        smallIcon: 'ic_launcher',       // built-in app icon
        pressAction: { id: 'default' },
      },
      ios: { sound: 'default' },
    });
  } catch (_e) { /* swallow — vibration covers us */ }
}

const NotificationAlertContext = createContext({});

export function NotificationAlertProvider({ children }) {
  // We only need to know whether someone is signed in — apiClient already
  // attaches the bearer token via its request interceptor.
  const { user } = useAuth();
  const [banner, setBanner] = useState(null);   // { title, message, screen }
  const slide = useRef(new Animated.Value(-120)).current;

  // Tracks the highest notification.id we've already alerted on, per
  // session. Seeded on first poll so we don't blast the user with toasts
  // for every existing unread notification right after sign-in.
  const lastSeenIdRef = useRef(null);
  const bannerTimer   = useRef(null);

  const showBanner = useCallback((payload) => {
    setBanner(payload);
    Animated.timing(slide, {
      toValue: 0, duration: 220, easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => {
      Animated.timing(slide, {
        toValue: -120, duration: 220, easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }).start(() => setBanner(null));
    }, BANNER_MS);
  }, [slide]);

  const hideBanner = useCallback(() => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    Animated.timing(slide, {
      toValue: -120, duration: 200, useNativeDriver: true,
    }).start(() => setBanner(null));
  }, [slide]);

  // The poller. Re-installed whenever the user changes (sign in / out)
  // so we run only while signed in.
  //
  // First tick is DELAYED by a short beat on cold start. The concern:
  // on a first-launch cold boot the Android network stack, keychain,
  // and axios interceptor init can race with this effect's mount. If
  // the notification poll fires before all three are stable we've seen
  // the app crash on that first launch (works on the second because
  // the native modules are already warm). The 1200 ms delay is
  // imperceptible to the user but reliably outlasts the boot race.
  useEffect(() => {
    if (!user) {
      lastSeenIdRef.current = null;
      return undefined;
    }
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await apiClient.get('/notifications?limit=1');
        const latest = res.data?.notifications?.[0];
        if (!latest) return;
        const id = Number(latest.id);
        if (lastSeenIdRef.current === null) {
          // First poll after sign-in — seed without alerting. Existing
          // unread items stay unread; only NEW ones beyond this point
          // trigger sound + toast.
          lastSeenIdRef.current = id;
          return;
        }
        if (id > lastSeenIdRef.current && !latest.read_at) {
          lastSeenIdRef.current = id;
          Vibration.vibrate(VIBRATE_PATTERN);
          // System default tone via the local-notification trick —
          // silent no-op until @notifee/react-native is installed.
          playSystemAlert({ title: latest.title, body: latest.message });
          if (!cancelled) {
            showBanner({
              id,
              title:   latest.title   || 'New notification',
              message: latest.message || '',
              screen:  resolveScreen(user.role),
            });
          }
        } else if (id > lastSeenIdRef.current) {
          // Already-read row sneaked through (e.g. user marked it on
          // another device). Bump the ref so we don't re-alert later.
          lastSeenIdRef.current = id;
        }
      } catch (_e) { /* silent — next tick will retry */ }
    };

    // Fire the first tick AFTER a short cold-start delay so native
    // modules (Keychain, network stack, axios interceptor) have
    // stabilised. Subsequent ticks run on the normal interval.
    const firstTickTimer = setTimeout(() => {
      if (!cancelled) tick();
    }, 1200);
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(firstTickTimer);
      clearInterval(id);
    };
  }, [user, showBanner]);

  return (
    <NotificationAlertContext.Provider value={{ showBanner, hideBanner }}>
      {children}
      {banner ? <Banner banner={banner} slide={slide} onClose={hideBanner} /> : null}
    </NotificationAlertContext.Provider>
  );
}

// Map a role to the notifications screen each app surfaces. Defaults
// to the staff screen (which is the broadest) so we never throw on a
// missing route.
function resolveScreen(role) {
  if (role === 'admin')   return 'AdminDashboard';
  if (role === 'trainer') return 'StaffNotifications';
  if (role === 'student') return 'StudentNotifications';
  if (role === 'parent')  return 'ParentNotifications';
  return 'StaffNotifications';
}

function Banner({ banner, slide, onClose }) {
  const goToScreen = () => {
    onClose();
    try { navigate(banner.screen); } catch (_e) { /* ignore */ }
  };
  return (
    <Animated.View
      style={[styles.bannerWrap, { transform: [{ translateY: slide }] }]}
    >
      <TouchableOpacity
        style={styles.banner}
        onPress={goToScreen}
        activeOpacity={0.9}
      >
        <View style={styles.bannerIcon}>
          <Bell size={16} color="#fff" strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle} numberOfLines={1}>
            {banner.title}
          </Text>
          {banner.message ? (
            <Text style={styles.bannerMessage} numberOfLines={2}>
              {banner.message}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export function useNotificationAlert() {
  return useContext(NotificationAlertContext);
}

const styles = StyleSheet.create({
  bannerWrap: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 24,
    left: 12, right: 12,
    zIndex: 9999,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#0F172A',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 8 },
    }),
  },
  bannerIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#E63946',
    alignItems: 'center', justifyContent: 'center',
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.2,
  },
  bannerMessage: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '500',
    marginTop: 2,
    lineHeight: 16,
  },
});
