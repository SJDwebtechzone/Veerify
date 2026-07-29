// backend/src/config/firebase.js
//
// Firebase Admin SDK bootstrap. Loaded once, memoised, and safe to
// import from anywhere. If credentials aren't configured we log a
// clear warning and every send helper degrades to a no-op — the
// in-app notification bell keeps working regardless.
//
// Credential resolution order:
//   1. FIREBASE_SERVICE_ACCOUNT_JSON — the whole service-account JSON
//      pasted into a single env var (handy for hosted deploys where
//      you can't drop a file next to the process).
//   2. GOOGLE_APPLICATION_CREDENTIALS — path to the .json file
//      (standard for local dev + Cloud Run).
//   3. `backend/serviceAccount.json` at repo root — the developer
//      convention we already document.
//
// Never crashes. Callers just check `getMessaging()` — a null return
// means "FCM is disabled, skip the send".

const path = require('path');
const fs = require('fs');

let admin = null;
let messaging = null;
let bootstrapped = false;

function tryLoadCredential() {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inline) {
    try { return JSON.parse(inline); }
    catch (err) {
      console.warn('[firebase] FIREBASE_SERVICE_ACCOUNT_JSON parse failed:', err?.message);
    }
  }
  const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (gac && fs.existsSync(gac)) {
    try { return JSON.parse(fs.readFileSync(gac, 'utf8')); }
    catch (err) {
      console.warn('[firebase] GOOGLE_APPLICATION_CREDENTIALS read failed:', err?.message);
    }
  }
  // Convention: serviceAccount.json alongside the backend package.
  const convention = path.resolve(__dirname, '..', '..', 'serviceAccount.json');
  if (fs.existsSync(convention)) {
    try { return JSON.parse(fs.readFileSync(convention, 'utf8')); }
    catch (err) {
      console.warn('[firebase] serviceAccount.json read failed:', err?.message);
    }
  }
  return null;
}

function bootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;
  try {
    admin = require('firebase-admin');
  } catch (err) {
    console.warn(
      '[firebase] firebase-admin is not installed. Run '
      + '`npm install --prefix backend firebase-admin` to enable FCM push. '
      + 'The in-app notification bell is unaffected.',
    );
    admin = null;
    return;
  }
  if (admin.apps && admin.apps.length) {
    messaging = admin.messaging();
    return;
  }
  const cred = tryLoadCredential();
  if (!cred) {
    console.warn(
      '[firebase] No service-account credential found. Set '
      + 'FIREBASE_SERVICE_ACCOUNT_JSON, GOOGLE_APPLICATION_CREDENTIALS, or drop '
      + 'backend/serviceAccount.json in place. FCM push is disabled until then.',
    );
    return;
  }
  try {
    admin.initializeApp({ credential: admin.credential.cert(cred) });
    messaging = admin.messaging();
    console.log(
      `[firebase] initialised for project=${cred.project_id || 'unknown'}`,
    );
  } catch (err) {
    console.warn('[firebase] initializeApp failed:', err?.message);
  }
}

function getMessaging() {
  if (!bootstrapped) bootstrap();
  return messaging;
}

function getAdmin() {
  if (!bootstrapped) bootstrap();
  return admin;
}

module.exports = { getMessaging, getAdmin };
