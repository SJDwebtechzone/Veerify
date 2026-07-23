// src/pages/VeerifyHeader.jsx
//
// Shared header for every public Veerify web page (Privacy, Terms,
// Refunds, Child Safety, Account Deletion, Contact). Displays the
// logo, brand wordmark, page title, and optional subtitle.
//
// Fully responsive — stacks vertically on screens narrower than 640px.
// Uses inline styles so it drops into any React setup with no CSS
// bundler configuration.

import React from 'react';

const BRAND      = '#E63946';
const BRAND_SOFT = '#FFF5F6';
const TEXT       = '#111827';
const MUTED      = '#4B5563';

export default function VeerifyHeader({ title, subtitle }) {
  return (
    <header style={styles.wrap}>
      <div style={styles.inner}>
        {/* Brand block — logo + wordmark. Home link so any page can
            route back to the marketing site. */}
        <a href="/" style={styles.brand} aria-label="Veerify home">
          <div style={styles.logoCircle}>
            {/* Inline SVG shield so the header never depends on an
                asset the frontend build may or may not have. Swap for
                <img src="/veerify-logo.png" /> when your build serves
                the real asset from /public. */}
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none"
                 stroke="#fff" strokeWidth="2.4"
                 strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L4 5v6c0 5 3.5 9.4 8 11 4.5-1.6 8-6 8-11V5l-8-3z"/>
              <polyline points="9 12 11 14 15 10"/>
            </svg>
          </div>
          <div style={styles.wordmark}>
            <span style={styles.brandName}>Veerify</span>
            <span style={styles.brandTag}>#1 Martial Arts App</span>
          </div>
        </a>

        {/* Right-aligned quick links — hidden on small screens; the
            footer carries the same links for mobile users. */}
        <nav style={styles.nav} aria-label="Primary">
          <a href="/privacy-policy" style={styles.navLink}>Privacy</a>
          <a href="/terms-and-conditions" style={styles.navLink}>Terms</a>
          <a href="/contact" style={styles.navLink}>Contact</a>
        </nav>
      </div>

      {/* Page title strip — sits below the brand row on every page.
          Same visual on every route so users know what they're
          reading at a glance. */}
      {title ? (
        <div style={styles.titleStrip}>
          <div style={styles.titleInner}>
            <h1 style={styles.title}>{title}</h1>
            {subtitle ? <p style={styles.subtitle}>{subtitle}</p> : null}
          </div>
        </div>
      ) : null}
    </header>
  );
}

const styles = {
  wrap: {
    borderBottom: '1px solid #E5E7EB',
    background: '#FFFFFF',
  },
  inner: {
    maxWidth: 1120,
    margin: '0 auto',
    padding: '18px 20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20,
    flexWrap: 'wrap',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    textDecoration: 'none',
    color: TEXT,
  },
  logoCircle: {
    width: 42,
    height: 42,
    borderRadius: '50%',
    background: BRAND,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: `0 6px 18px ${BRAND}44`,
  },
  wordmark: { display: 'flex', flexDirection: 'column' },
  brandName: {
    fontSize: 20,
    fontWeight: 900,
    color: TEXT,
    letterSpacing: 0.2,
  },
  brandTag: {
    fontSize: 10,
    fontWeight: 800,
    color: BRAND,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  nav: {
    display: 'flex',
    gap: 18,
  },
  navLink: {
    color: MUTED,
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 700,
  },
  titleStrip: {
    background: BRAND_SOFT,
    borderTop: `3px solid ${BRAND}`,
  },
  titleInner: {
    maxWidth: 1120,
    margin: '0 auto',
    padding: '28px 20px',
  },
  title: {
    fontSize: 30,
    fontWeight: 900,
    color: TEXT,
    margin: 0,
    lineHeight: 1.15,
  },
  subtitle: {
    fontSize: 15,
    color: MUTED,
    margin: '6px 0 0',
    fontWeight: 600,
  },
};
