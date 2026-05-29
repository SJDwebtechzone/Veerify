import axios from 'axios';
import { Platform, NativeModules } from 'react-native';
import { getToken } from '../utils/storage';

// ─────────────────────────────────────────────────────────────────────────────
// API base URL
// ─────────────────────────────────────────────────────────────────────────────
// Two runtime contexts, one config each:
//
//   PRODUCTION (release APK, distributed builds)
//     Always talks to the VPS.  Set PRODUCTION_API_BASE below.  This URL is
//     baked into the APK at build time so phones can reach it from anywhere.
//
//   DEV (debug build, Metro running)
//     We auto-detect: iOS sim/web → localhost, Android emulator → 10.0.2.2,
//     real device on Wi-Fi → the laptop's LAN IP (from the Metro packager URL
//     RN already knows, or DEV_LAN_IP as a fallback).
//
// React Native exposes the global `__DEV__` that's true for debug builds and
// false for release builds — that's how we pick between the two branches.
//
// 👉  EDIT THE TWO CONSTANTS BELOW:
//     PRODUCTION_API_BASE → your deployed backend (https preferred).
//     DEV_LAN_IP          → your dev laptop's LAN IP for testing on phone.

const PRODUCTION_API_BASE = 'http://72.61.245.163:5002/api';
const DEV_LAN_IP = '192.168.1.5';
const DEV_PORT = 5000;

function detectDevHost() {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return DEV_LAN_IP;

  // Reuse Metro's host so the API base follows whichever machine is serving
  // the JS bundle. Keeps device-vs-emulator switching painless.
  const scriptURL = NativeModules.SourceCode?.scriptURL || '';
  const m = scriptURL.match(/^https?:\/\/([^:/]+)(?::\d+)?\//);
  const metroHost = m?.[1];
  if (metroHost && metroHost !== 'localhost') return metroHost;
  if (metroHost === 'localhost' && Platform.OS === 'android') return '10.0.2.2';
  return DEV_LAN_IP;
}

// ⚠ TEMPORARY: hard-coded to the Android emulator's host-loopback alias so
// every dev run hits the local laptop's backend on port 5000.
// Switch back to the __DEV__ / detectDevHost ternary once we're past the
// "what URL is the bundle actually using" debugging phase.
// eslint-disable-next-line no-undef, no-unused-vars
const _detectUnused = detectDevHost;
const API_BASE_URL = __DEV__
  ? 'http://10.0.2.2:5000/api'
  : PRODUCTION_API_BASE;

// eslint-disable-next-line no-console
console.log('[API] base URL =', API_BASE_URL);

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

// Auto-attach token to every request
apiClient.interceptors.request.use(async (config) => {
  try {
    const token = await getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch (err) {
    console.error('Token retrieval error:', err);
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      console.log('API Error:', error.response.status, error.response.data);
    } else if (error.request) {
      console.log('Network Error: cannot reach backend');
    }
    return Promise.reject(error);
  }
);

export default apiClient;