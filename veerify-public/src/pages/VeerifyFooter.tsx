// src/pages/VeerifyFooter.jsx
//
// Shared footer for every public Veerify web page. Contains:
//   • Quick links to all six Play-Store-mandated pages.
//   • Contact email.
//   • Last-updated date (passed in by the calling page).
//   • Copyright line.
//
// Responsive: single column on mobile, three columns on desktop.
// Inline styles — no external CSS dependency.

import React from 'react';

const BRAND = '#E63946';
const TEXT  = '#111827';
const MUTED = '#6B7280';
const FOOT  = '#0F172A';

export default function VeerifyFooter({ lastUpdated }) {
  const year = new Date().getFullYear();
  return (
    <footer style={styles.wrap}>
      <div style={styles.inner}>
        {/* Column 1 — brand */}
        <div style={styles.col}>
          <div style={styles.brandRow}>
            <div style={styles.logoCircle}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
                   stroke="#fff" strokeWidth="2.4"
                   strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L4 5v6c0 5 3.5 9.4 8 11 4.5-1.6 8-6 8-11V5l-8-3z"/>
                <polyline points="9 12 11 14 15 10"/>
              </svg>
            </div>
            <span style={styles.brandName}>Veerify</span>
          </div>
          <p style={styles.tag}>
            Martial-arts academy management, made simple.
          </p>
        </div>

        {/* Column 2 — quick links */}
        <div style={styles.col}>
          <h4 style={styles.colHead}>Legal</h4>
          <a href="/privacy-policy" style={styles.link}>Privacy Policy</a>
          <a href="/terms-and-conditions" style={styles.link}>Terms &amp; Conditions</a>
          <a href="/refund-cancellation-policy" style={styles.link}>Refund &amp; Cancellation</a>
          <a href="/child-safety" style={styles.link}>Child Safety</a>
          <a href="/account-deletion" style={styles.link}>Account Deletion</a>
        </div>

        {/* Column 3 — contact */}
        <div style={styles.col}>
          <h4 style={styles.colHead}>Contact</h4>
          <a href="/contact" style={styles.link}>Contact Us</a>
          <a href="mailto:support@veerifyapp.com" style={styles.link}>
            support@veerifyapp.com
          </a>
          <a href="https://veerifyapp.com" style={styles.link}>
            veerifyapp.com
          </a>
        </div>
      </div>

      {/* Bottom strip — copyright + last-updated */}
      <div style={styles.stripWrap}>
        <div style={styles.strip}>
          <span>© {year} DevSpectra. All rights reserved.</span>
          {lastUpdated ? (
            <span style={styles.stripMeta}>Last updated: {lastUpdated}</span>
          ) : null}
        </div>
      </div>
    </footer>
  );
}

const styles = {
  wrap: { background: FOOT, color: '#E5E7EB', marginTop: 60 },
  inner: {
    maxWidth: 1120,
    margin: '0 auto',
    padding: '40px 20px',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 32,
  },
  col: { display: 'flex', flexDirection: 'column', gap: 8 },
  brandRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  logoCircle: {
    width: 34, height: 34, borderRadius: '50%',
    background: BRAND,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  brandName: { fontSize: 18, fontWeight: 900, color: '#fff' },
  tag: {
    color: '#94A3B8',
    fontSize: 13,
    margin: '4px 0 0',
    lineHeight: 1.5,
  },
  colHead: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    margin: '0 0 8px',
  },
  link: {
    color: '#94A3B8',
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 600,
    padding: '2px 0',
  },
  stripWrap: {
    borderTop: '1px solid #1E293B',
    background: '#020617',
  },
  strip: {
    maxWidth: 1120,
    margin: '0 auto',
    padding: '16px 20px',
    display: 'flex',
    justifyContent:'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    color: '#64748B',
    fontSize: 12,
  },
  stripMeta: { color: '#475569' },
};
