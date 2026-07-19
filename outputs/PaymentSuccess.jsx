// PaymentSuccess.jsx
//
// Drop this into your web frontend and route it at "/payment-success".
// Razorpay redirects payers here after checkout with the query string
// "?institution_id=<id>" (and optionally "&already=1" for institutions
// that were already active when they clicked a stale approval link).
//
// The page:
//   1. Reads the query string.
//   2. Optionally fetches the institution's name from your public API.
//   3. Renders a branded confirmation card with a CTA that deep-links
//      back into the Veerify mobile app.
//
// Zero external dependencies beyond React itself. Copy → adjust the
// brand color / logo path → route.

import React, { useEffect, useState } from 'react';

export default function PaymentSuccess() {
  const params = new URLSearchParams(window.location.search);
  const institutionId = params.get('institution_id');
  const already       = params.get('already') === '1';

  const [institutionName, setInstitutionName] = useState(null);

  useEffect(() => {
    if (!institutionId) return;
    // Optional pretty touch: fetch the institution's name so the card
    // reads "Damakka Academy" instead of a raw id. Fails silently if
    // the endpoint isn't exposed — the card still renders fine.
    fetch(`/api/institutions/${institutionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setInstitutionName(j?.institution?.name || null))
      .catch(() => {});
  }, [institutionId]);

  return (
    <div style={styles.screen}>
      <div style={styles.card}>
        <div style={styles.tick}>
          <svg viewBox="0 0 24 24" width="40" height="40"
               fill="none" stroke="#fff" strokeWidth="3"
               strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <h1 style={styles.title}>
          {already ? 'Subscription already active' : 'Payment received'}
        </h1>

        {institutionName ? (
          <div style={styles.instPill}>{institutionName}</div>
        ) : null}

        <p style={styles.sub}>
          {already
            ? "You're all set — this institution's subscription is already active. Open the Veerify app to sign in."
            : "Thanks! We've received your payment. The webhook usually confirms it within a few seconds — open Veerify and sign in to see your subscription go live."}
        </p>

        <a href="veerify://payment-complete" style={styles.cta}>
          Open Veerify
        </a>

        <div style={styles.foot}>You can safely close this tab.</div>
      </div>
    </div>
  );
}

const styles = {
  screen: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #F5F3FF 0%, #FDF2F8 100%)',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    color: '#111827',
    padding: '24px',
  },
  card: {
    maxWidth: 460,
    width: '100%',
    background: '#fff',
    borderRadius: 20,
    padding: '32px 28px',
    boxShadow:
      '0 20px 60px rgba(15,23,42,0.08), 0 4px 12px rgba(15,23,42,0.04)',
    textAlign: 'center',
    boxSizing: 'border-box',
  },
  tick: {
    width: 72,
    height: 72,
    borderRadius: '50%',
    background: '#10B981',
    margin: '4px auto 20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 10px 30px rgba(16,185,129,0.35)',
  },
  title: {
    margin: '0 0 8px',
    fontSize: 22,
    fontWeight: 800,
  },
  instPill: {
    display: 'inline-block',
    margin: '14px 0 6px',
    padding: '8px 14px',
    borderRadius: 999,
    background: '#F3E8FF',
    color: '#6D28D9',
    fontWeight: 700,
    fontSize: 13,
  },
  sub: {
    margin: '0 0 8px',
    color: '#6B7280',
    lineHeight: 1.55,
    fontSize: 14,
  },
  cta: {
    display: 'inline-block',
    marginTop: 22,
    padding: '12px 22px',
    borderRadius: 12,
    background: '#6D28D9',
    color: '#fff',
    fontWeight: 700,
    textDecoration: 'none',
    fontSize: 14,
  },
  foot: {
    marginTop: 22,
    fontSize: 11,
    color: '#9CA3AF',
  },
};
