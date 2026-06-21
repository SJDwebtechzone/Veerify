// src/utils/assetUrl.js
//
// One canonical place to turn a server-stored upload reference into a
// URL the current device can actually fetch.
//
// Why this is non-trivial:
//   1. The mobile sometimes saved an ABSOLUTE URL containing the
//      emulator host (e.g. "http://10.0.2.2:5000/uploads/abc.jpg").
//      That URL is unreachable from a browser, an iOS device, the
//      production host, or even the same emulator if its API base
//      changes. We strip the embedded host and reattach the current
//      api base at render time.
//   2. Newer writes store the RELATIVE path ("/uploads/abc.jpg") — we
//      prepend the current api base.
//   3. Legitimate external URLs (https://i.pravatar.cc/...) pass
//      through untouched.
//
// Use this everywhere instead of redefining resolveAssetUrl per file.

import apiClient from '../api/client';

const HOSTS_TO_STRIP = [
  'http://localhost:5000',
  'https://localhost:5000',
  'http://10.0.2.2:5000',
  'https://10.0.2.2:5000',
  'http://127.0.0.1:5000',
  'https://127.0.0.1:5000',
];

// Cached api host (everything before /api).
const ASSET_HOST = (apiClient.defaults.baseURL || '').replace(/\/api\/?$/, '');

export function resolveAssetUrl(src) {
  if (!src || typeof src !== 'string') return null;

  // Data URI — return as-is.
  if (src.startsWith('data:')) return src;

  // Strip any embedded dev hosts (localhost / 10.0.2.2 / 127.0.0.1).
  // We compare against the start so query-strings + path slashes survive.
  let cleaned = src;
  for (const h of HOSTS_TO_STRIP) {
    if (cleaned.startsWith(h)) {
      cleaned = cleaned.slice(h.length);
      break;
    }
  }

  // After stripping, anything that still starts with http(s) is an
  // external URL the user genuinely wants — return it.
  if (/^https?:\/\//i.test(cleaned)) return cleaned;

  // At this point we expect a relative path like "/uploads/abc.jpg" or
  // just "uploads/abc.jpg". Normalise the leading slash and prepend the
  // current api host.
  if (!cleaned.startsWith('/')) cleaned = '/' + cleaned;
  const finalUrl = ASSET_HOST + cleaned;
  // Dev-only log to confirm exactly what URL the device is trying to
  // fetch when images don't show. Remove once images are verified.
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[resolveAssetUrl]', src, '→', finalUrl);
  }
  return finalUrl;
}

export default resolveAssetUrl;
