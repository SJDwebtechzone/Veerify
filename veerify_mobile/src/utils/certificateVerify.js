// veerify_mobile/src/utils/certificateVerify.js
//
// Builds the PUBLIC certificate-verification URL — the one that
// opens a browser page anyone can visit without logging in. This is
// the URL exposed to end users; the raw JSON API (/api/certificates/
// verify/:token) must never leak into share sheets or on-screen
// labels per the Digital Certificate Verification spec.
//
// Path shape is deliberately mirror-image to the API route so the
// two flows share one token system:
//
//   API   :   {origin}/api/certificates/verify/:token   (JSON, private)
//   Public:   {origin}/certificates/verify/:token       (HTML, public)
//
// The origin is derived from the app's own baseURL by stripping the
// trailing '/api' — that automatically resolves to
//   http://10.0.2.2:5000       (Android emulator, __DEV__)
//   https://veerifyapp.com     (release / production)
// without a second config knob.

import apiClient from '../api/client';

// Strip the trailing '/api' from apiClient.defaults.baseURL to get
// the public web origin. Extracted so tests can pass a fake base in.
export function apiOriginFrom(base) {
  const raw = String(base || '');
  return raw.replace(/\/api\/?$/, '').replace(/\/+$/, '');
}

// Public verification URL for a certificate. Returns null when the
// cert has no qr_token (older rows may) so callers can guard the UI.
export function buildPublicVerifyUrl(cert) {
  if (!cert?.qr_token) return null;
  const base = apiOriginFrom(apiClient?.defaults?.baseURL);
  if (!base) return null;
  return `${base}/certificates/verify/${cert.qr_token}`;
}

export default buildPublicVerifyUrl;
