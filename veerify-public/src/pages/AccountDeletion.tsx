// src/pages/AccountDeletion.jsx — Public route: /account-deletion
//
// Play Store now requires a direct URL where users can read how to
// delete their account. This page describes both the in-app path
// (More → Delete Account) and the email path for users who can't
// access the app.

import React, { useEffect } from 'react';
import VeerifyHeader from './VeerifyHeader';
import VeerifyFooter from './VeerifyFooter';

const LAST_UPDATED = '22 July 2026';

export default function AccountDeletion() {
  useEffect(() => {
    document.title = 'Account Deletion — Veerify';
    setMeta('description',
      'How to permanently delete your Veerify account via the mobile app, or by writing to support. Explains what data is deleted, what is retained for tax/legal records, and the timeline.');
  }, []);

  return (
    <div style={styles.page}>
      <VeerifyHeader title="Account Deletion"
        subtitle="Delete your Veerify account permanently — any time, any reason." />
      <main style={styles.main}>
        <p style={styles.meta}><strong>Last updated:</strong> {LAST_UPDATED}</p>

        <p style={styles.lead}>
          You can permanently delete your Veerify account at any time. This
          page describes the two ways to do it, exactly what happens when
          you do, and what is retained (with all personal identifiers
          removed) for legal and tax records.
        </p>

        <div style={styles.callout}>
          <p style={{ margin: 0, fontWeight: 800, fontSize: 15 }}>
            The fastest way: open Veerify → <em>More</em> → <em>Delete Account</em>.
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#6B7280' }}>
            Deletion is immediate. Re-enter your password to confirm.
          </p>
        </div>

        <Section title="1. Method A — Inside the App (Recommended)">
          <ol style={styles.ol}>
            <li>Open the Veerify mobile app on Android.</li>
            <li>Sign in with your registered email and password.</li>
            <li>Tap <strong>More</strong> in the bottom tab bar.</li>
            <li>Scroll down and tap <strong>Delete Account</strong>.</li>
            <li>Read the warning card. Enter your current password.</li>
            <li>Optionally add a reason (helps us improve; not shown to other users).</li>
            <li>Tap <strong>Delete Account</strong> and confirm the dialog.</li>
          </ol>
          <p>Deletion is immediate. You will be signed out of all devices and returned to the Welcome screen.</p>
        </Section>

        <Section title="2. Method B — By Email">
          <p>If you cannot access the app (forgot password, uninstalled, etc.), email us:</p>
          <div style={styles.contactBox}>
            <p style={{ margin: 0 }}><strong>To:</strong> <a href="mailto:support@veerifyapp.com" style={styles.link}>support@veerifyapp.com</a></p>
            <p style={{ margin: '4px 0' }}><strong>Subject:</strong> Account deletion request</p>
            <p style={{ margin: '4px 0' }}><strong>Body:</strong> Include the email address registered on your account and your reason (optional).</p>
          </div>
          <p style={{ marginTop: 12 }}>
            We verify the request by sending a confirmation email to the same address. Once confirmed, we complete the deletion within <strong>3 business days</strong>.
          </p>
        </Section>

        <Section title="3. What is Deleted">
          <p>Immediately anonymised — irrecoverable:</p>
          <ul style={styles.ul}>
            <li>Your name, replaced with "Deleted User".</li>
            <li>Your email address, replaced with an internal tombstone value.</li>
            <li>Your phone number, replaced with an internal tombstone value.</li>
            <li>Your password (cleared — no future login possible).</li>
            <li>Your profile photo.</li>
            <li>Your address, gender, date of birth, health notes, blood group, belt category, occupation, physical measurements, parent/guardian names, emergency contact number.</li>
            <li>Your session tokens on every device.</li>
            <li>Your notification preferences and settings.</li>
          </ul>
        </Section>

        <Section title="4. What is Retained (with Personal Identifiers Removed)">
          <p>The following are kept because Indian tax law (Section 44AA of the Income-tax Act, 1961) requires financial records for <strong>8 years</strong>. All personal identifiers on them are anonymised:</p>
          <ul style={styles.ul}>
            <li><strong>Enrolment history</strong> — course, batch, dates. Attached to the tombstoned "Deleted User" row, no personal identity.</li>
            <li><strong>Payment records</strong> — transaction reference id, amount, currency, status, timestamps. Required for GST and income-tax audit trails.</li>
            <li><strong>Invoices</strong> — the PDFs already emailed to you remain in our archive with the tombstoned identity.</li>
            <li><strong>Institution wallet ledger</strong> — payouts by the platform to academies are recorded against the tombstoned enrolment id.</li>
            <li><strong>Certificates issued</strong> — the QR-verifiable certificate record is retained so a verifier scanning an existing certificate still resolves. The name on the certificate PDF stays as it was on the day of issue.</li>
            <li><strong>Audit trail of your deletion event</strong> — a permanent row in an internal audit table so we can respond to lawful inquiries. Does not contain your personal data beyond the timestamp, your role, and the internal user id.</li>
          </ul>
          <p>
            After 8 years, financial records are purged from our systems. Backups are rotated on a 90-day cycle, so any backup containing your pre-deletion data is superseded within 90 days.
          </p>
        </Section>

        <Section title="5. What Happens to Data the Academy Holds">
          <p>
            If you enrolled with an academy through Veerify, that academy has its own copy of the operational data required to run its classes — attendance you attended, belts you earned, certificates you were issued. This copy is governed by the academy's own privacy practices and is not deleted by our anonymisation of your Veerify account.
          </p>
          <p>
            To request deletion of academy-held records, contact the academy directly. Veerify will assist in facilitating the request.
          </p>
        </Section>

        <Section title="6. Sessions &amp; Devices">
          <p>Immediately on deletion:</p>
          <ul style={styles.ul}>
            <li>All active login sessions are invalidated.</li>
            <li>Any device with a stored authentication token returns to the login screen on the next request.</li>
            <li>You cannot sign in again with the old credentials. There is no "undo".</li>
          </ul>
          <p>If you want to use Veerify again after deletion, you must register a new account.</p>
        </Section>

        <Section title="7. Institution Admins">
          <p>
            If you are the owner of an active institution on Veerify, you cannot self-delete while the institution is still active — deleting the owner would orphan every student and trainer under it. Please:
          </p>
          <ol style={styles.ol}>
            <li>Contact <a href="mailto:support@veerifyapp.com" style={styles.link}>support@veerifyapp.com</a> to close the institution first.</li>
            <li>Or transfer ownership to another admin.</li>
            <li>Once the institution is closed or transferred, follow Method A or B above to delete your own account.</li>
          </ol>
        </Section>

        <Section title="8. Timeline Summary">
          <ul style={styles.ul}>
            <li><strong>In-app delete</strong>: immediate.</li>
            <li><strong>Email delete</strong>: within 3 business days after confirmation.</li>
            <li><strong>Backup purge</strong>: within 90 days.</li>
            <li><strong>Financial records purge</strong>: 8 years from the date of the last financial transaction, per Indian tax law.</li>
          </ul>
        </Section>

        <Section title="9. Questions">
          <div style={styles.contactBox}>
            <p style={{ margin: 0 }}><strong>Veerify — Data Protection Team</strong></p>
            <p style={{ margin: '4px 0' }}>
              Email: <a href="mailto:support@veerifyapp.com" style={styles.link}>support@veerifyapp.com</a>
            </p>
            <p style={{ margin: '4px 0' }}>Response time: within 2 business days.</p>
          </div>
        </Section>
      </main>
      <VeerifyFooter lastUpdated={LAST_UPDATED} />
    </div>
  );
}

function Section({ title, children }) {
  return <section style={styles.section}><h2 style={styles.h2}>{title}</h2>{children}</section>;
}
function setMeta(name, content) {
  if (typeof document === 'undefined') return;
  let tag = document.querySelector(`meta[name="${name}"]`);
  if (!tag) { tag = document.createElement('meta'); tag.setAttribute('name', name); document.head.appendChild(tag); }
  tag.setAttribute('content', content);
}

const BRAND='#E63946', TEXT='#111827', MUTED='#4B5563', BG='#FFFFFF';
const styles = {
  page: { minHeight:'100vh', background: BG, color: TEXT, fontFamily:"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", lineHeight:1.6 },
  main: { maxWidth: 820, margin:'0 auto', padding:'32px 20px 64px' },
  meta: { color: MUTED, fontSize: 13, margin:'0 0 20px' },
  lead: { fontSize: 16, color: TEXT, marginBottom: 28 },
  callout: {
    background: '#FFF5F6',
    borderLeft: `4px solid ${BRAND}`,
    borderRadius: 8,
    padding: '16px 20px',
    marginBottom: 32,
  },
  section: { marginTop: 36 },
  h2: { fontSize: 22, fontWeight: 800, color: TEXT, borderBottom: `2px solid ${BRAND}`, display:'inline-block', paddingBottom: 4, marginTop:0, marginBottom: 14 },
  ul: { paddingLeft: 22, margin:'0 0 12px', color: MUTED, fontSize: 15 },
  ol: { paddingLeft: 22, margin:'0 0 12px', color: MUTED, fontSize: 15 },
  link: { color: BRAND, textDecoration:'none', fontWeight: 700 },
  contactBox: { marginTop: 8, padding: 16, background:'#FFF5F6', borderLeft:`4px solid ${BRAND}`, borderRadius: 8, fontSize: 14 },
};
