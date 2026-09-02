// src/services/fcm.service.js
//
// Firebase Cloud Messaging bootstrap for the mobile app.
//
// Public surface:
//   requestPermissionAndRegister({ auth }) — call after login. Handles
//     Android 13+ POST_NOTIFICATIONS runtime prompt, iOS APNS
//     authorisation, retrieves the FCM token, and POSTs it to
//     /api/notifications/fcm-token so the user starts getting pushes.
//
//   attachHandlers({ navigationRef }) — set up foreground /
//     background / notification-tap listeners. Idempotent — safe to
//     call every mount because the internal `attached` latch skips
//     duplicate subscriptions.
//
//   revokeOnLogout() — hits DELETE /api/notifications/fcm-token so
//     the just-logged-out user stops receiving pushes on this device.
//
// Everything is fail-open: any Firebase / native error is caught and
// logged, and the rest of the app keeps working. In-app notification
// bell is unaffected regardless.

import { Alert, PermissionsAndroid, Platform } from 'react-native';
import apiClient from '../api/client';
import { navigationRef } from '../navigation/navigationRef';

// Lazy, guarded import of @react-native-firebase/messaging. When the
// native module hasn't been linked yet (fresh `npm install` without
// an Android/iOS rebuild), requiring the package throws
// "Native module RNFBAppModule not found" at eval time and takes the
// whole app down. Wrapping the require() in a helper lets the rest
// of the app boot; every public API in this file bails cleanly with
// a { ok: false, skipped: 'firebase-native-module-missing' } shape.
let messaging = null;
let messagingLoaded = false;
function getMessaging() {
  if (messagingLoaded) return messaging;
  messagingLoaded = true;
  try {
    // eslint-disable-next-line global-require
    messaging = require('@react-native-firebase/messaging').default;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[fcm] native module missing — FCM disabled. Rebuild the app after '
      + 'installing @react-native-firebase/messaging. Detail:',
      err && err.message,
    );
    messaging = null;
  }
  return messaging;
}

// Map a notification's `data.screen` (set by the backend when it
// creates the row) to a mobile route. If the target screen doesn't
// exist in the current navigator (roles differ per user), we fall
// back to the notifications bell.
const DEFAULT_TAP_ROUTE = 'Notifications';

let handlersAttached = false;
let unsubscribeTokenRefresh = null;

function safeParseParams(raw) {
  if (!raw) return undefined;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); }
  catch { return undefined; }
}

async function ensurePermission() {
  const m = getMessaging();
  if (!m) return false;
  try {
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      // Android 13+ needs a runtime permission — silently returning
      // 'denied' just means the user can enable pushes later from
      // system settings.
      const res = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      if (res !== PermissionsAndroid.RESULTS.GRANTED) {
        console.log('[fcm] POST_NOTIFICATIONS not granted:', res);
        return false;
      }
    }
    // iOS + older Android — @react-native-firebase/messaging handles
    // APNS authorisation. Returns an enum: NOT_DETERMINED (0),
    // DENIED (1), AUTHORIZED (2), PROVISIONAL (3).
    const status = await m().requestPermission();
    const ok = status === m.AuthorizationStatus.AUTHORIZED
            || status === m.AuthorizationStatus.PROVISIONAL;
    if (!ok) console.log('[fcm] messaging().requestPermission not granted:', status);
    return ok;
  } catch (err) {
    console.warn('[fcm] permission request failed:', err?.message);
    return false;
  }
}

async function registerTokenWithBackend(token, meta = {}) {
  if (!token) return;
  try {
    await apiClient.post('/notifications/fcm-token', {
      token,
      platform:    Platform.OS,
      app_version: meta.appVersion || null,
      device_id:   meta.deviceId || null,
    });
    console.log('[fcm] token registered with backend');
  } catch (err) {
    console.warn(
      '[fcm] failed to register token:',
      err?.response?.status,
      err?.response?.data?.message || err?.message,
    );
  }
}

// Called from AuthContext right after login. Requests permission,
// pulls the FCM token, ships it to the backend, and subscribes to
// onTokenRefresh so Firebase-driven rotations land automatically.
//
// Fail-open at every step: a missing native module, a denied
// permission, or a backend hiccup returns cleanly without ever
// throwing back to the caller — the auth flow keeps working and
// the in-app notification bell (which doesn't need FCM) is
// unaffected.
export async function requestPermissionAndRegister() {
  try {
    const m = getMessaging();
    if (!m) return { ok: false, skipped: 'firebase-native-module-missing' };

    const granted = await ensurePermission();
    if (!granted) return { ok: false, skipped: 'permission-denied' };

    let token = null;
    try { token = await m().getToken(); }
    catch (err) {
      console.warn('[fcm] getToken failed:', err?.message);
      return { ok: false, skipped: 'get-token-failed' };
    }
    if (!token) return { ok: false, skipped: 'no-token' };

    await registerTokenWithBackend(token);

    // Subscribe to Firebase-driven token rotations so a refreshed
    // token lands on the backend automatically. Guarded against
    // duplicate subscriptions across hot-reload / re-login.
    try {
      if (typeof unsubscribeTokenRefresh === 'function') {
        try { unsubscribeTokenRefresh(); } catch {}
      }
      unsubscribeTokenRefresh = m().onTokenRefresh((next) => {
        registerTokenWithBackend(next).catch(() => {});
      });
    } catch (err) {
      console.warn('[fcm] onTokenRefresh subscribe failed:', err?.message);
    }

    return { ok: true };
  } catch (err) {
    console.warn('[fcm] requestPermissionAndRegister threw:', err?.message);
    return { ok: false, skipped: 'threw' };
  }
}

// Reset the token registration + logout ex-user's push subscription
// so the next login owner starts fresh.
export async function revokeOnLogout() {
  try {
    // Best-effort backend revocation FIRST while the JWT is still
    // valid — the deleteToken step in AuthContext runs after this.
    await apiClient.delete('/notifications/fcm-token').catch(() => {});
    // Then wipe the FCM registration locally so a fresh login gets a
    // new token via getToken() (Firebase re-mints on first read).
    const m = getMessaging();
    if (m) { try { await m().deleteToken(); } catch {} }
    if (typeof unsubscribeTokenRefresh === 'function') {
      try { unsubscribeTokenRefresh(); } catch {}
      unsubscribeTokenRefresh = null;
    }
  } catch (err) {
    console.warn('[fcm] revokeOnLogout threw:', err?.message);
  }
}

// Foreground / background / tap listeners.
//
// Foreground: Firebase gives us the message payload but does NOT
// display a system tray notification (Android convention). We fall
// back to a lightweight Alert with the title so the user sees
// something — the in-app bell will pick it up on the next fetch.
//
// Background / terminated: the OS renders the tray notification for
// us. When the user taps it, either onNotificationOpenedApp
// (background) or getInitialNotification (terminated) fires with the
// same payload; we route via data.screen / data.params.
export function attachHandlers() {
  if (handlersAttached) return;
  const m = getMessaging();
  if (!m) {
    // Fresh install without a native rebuild — nothing to attach.
    // Leaves handlersAttached=false so a later reload after the
    // rebuild wires things up on that mount.
    return;
  }
  handlersAttached = true;

  // Foreground.
  m().onMessage(async (msg) => {
    console.log('[fcm] foreground message', msg?.notification, msg?.data);
    const title = msg?.notification?.title || msg?.data?.title || 'Veerify';
    const body  = msg?.notification?.body  || msg?.data?.body  || '';
    // Minimal in-app surface; the bell is the canonical inbox.
    try { Alert.alert(title, body); } catch {}
  });

  const routeFromData = (data) => {
    if (!data) return null;
    const screen = data.screen || DEFAULT_TAP_ROUTE;
    const params = safeParseParams(data.params);
    return { screen, params };
  };

  const navigate = (target) => {
    if (!target) return;
    if (!navigationRef.isReady()) return;
    try {
      navigationRef.navigate(target.screen, target.params);
    } catch (err) {
      console.warn(
        `[fcm] navigate to ${target.screen} failed:`,
        err?.message,
      );
      // Fallback so a tap never lands on nothing.
      try { navigationRef.navigate(DEFAULT_TAP_ROUTE); } catch {}
    }
  };

  // Background → tap.
  m().onNotificationOpenedApp((msg) => {
    console.log('[fcm] onNotificationOpenedApp', msg?.data);
    navigate(routeFromData(msg?.data));
  });

  // Terminated → tap. getInitialNotification only returns the payload
  // once per process — safe to await on every mount.
  m()
    .getInitialNotification()
    .then((msg) => {
      if (!msg) return;
      console.log('[fcm] getInitialNotification', msg?.data);
      // Give the navigator a beat to finish mounting before we push
      // a target onto it.
      setTimeout(() => navigate(routeFromData(msg?.data)), 500);
    })
    .catch((err) => console.warn('[fcm] getInitialNotification threw:', err?.message));

  // Optional: background message handler. Firebase requires this to
  // be registered at the module TOP LEVEL for the terminated app case;
  // see index.js in the app root.
}
