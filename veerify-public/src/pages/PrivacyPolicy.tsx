// src/pages/PrivacyPolicy.jsx
//
// Public route: /privacy-policy
//
// Play-Store-compliant privacy policy for Veerify. Written to
// satisfy Google Play's Data Safety declaration + Family Policy
// requirements + India's DPDP Act 2023 disclosures.
//
// Uses only inline styles + the two shared Veerify components
// (VeerifyHeader, VeerifyFooter) so this drops into any Vite / CRA /
// Next.js project with zero external CSS dependencies. Swap the
// `<link>` / `<Helmet>` tags for your project's SEO helper.
//
// Wiring — React Router v6:
//   <Route path="/privacy-policy" element={<PrivacyPolicy />} />
// Next.js Pages Router:
//   pages/privacy-policy.jsx  → default export this file
// Next.js App Router:
//   app/privacy-policy/page.jsx  → default export this file

import React, { useEffect } from 'react';
import VeerifyHeader from './VeerifyHeader';
import VeerifyFooter from './VeerifyFooter';

const LAST_UPDATED = '19 July 2026';

export default function PrivacyPolicy() {
  // Simple SEO — replaces the tab title + meta description without
  // needing react-helmet. If you're on Next.js swap this for the
  // framework's <Head> or metadata export.
  useEffect(() => {
    document.title = 'Privacy Policy — Veerify';
    setMeta(
      'description',
      'How Veerify collects, uses, stores, and protects data across the mobile app and web dashboard. Covers Google Play Data Safety, DPDP Act 2023, and child safety.',
    );
  }, []);

  return (
    <div style={styles.page}>
      <VeerifyHeader
        title="Privacy Policy"
        subtitle="How we collect, use, and protect your data."
      />

      <main style={styles.main}>
        {/* Effective date */}
        <p style={styles.meta}>
          <strong>Last updated:</strong> {LAST_UPDATED}
        </p>

        <p style={styles.lead}>
          Veerify ("we", "our", "us") operates the Veerify mobile
          application and the web dashboard at{' '}
          <a href="https://veerifyapp.com" style={styles.link}>
            veerifyapp.com
          </a>{' '}
          (together, the "Service"). This Privacy Policy explains what
          personal data we collect, how we use it, whom we share it
          with, and the rights you have over your data. It applies to
          every user of Veerify — martial-arts academy owners,
          administrators, trainers, students, parents, and guests
          browsing the app.
        </p>

        <Section title="1. Information We Collect">
          <p>We collect only the information we need to operate the Service. We group it into four categories:</p>

          <h3 style={styles.h3}>1.1 Information you give us directly</h3>
          <ul style={styles.ul}>
            <li><strong>Account details</strong> — name, email address, phone number, password (stored hashed), profile photo, role (admin / student / trainer / parent).</li>
            <li><strong>Institution details</strong> (academy owners only) — academy name, logo, registration number, address, branch locations, operating hours, skills taught.</li>
            <li><strong>Student profile</strong> — date of birth, gender, parent/guardian names, blood group (optional), belt category, height, weight, health notes, emergency contact.</li>
            <li><strong>Payment details</strong> — collected and processed exclusively by our payment gateway (Razorpay). We store the payment reference id, amount, currency, status, and billing cycle. We <strong>never</strong> store card numbers, CVVs, or bank credentials.</li>
            <li><strong>Support content</strong> — messages you send via Feedback or Support, plus attached files.</li>
          </ul>

          <h3 style={styles.h3}>1.2 Information collected automatically</h3>
          <ul style={styles.ul}>
            <li><strong>Device information</strong> — device model, OS version, app version, unique device id (used only to detect duplicate installs), crash logs.</li>
            <li><strong>Approximate location</strong> — used to show nearby academies to guest users. Precise GPS is only used if you tap "Use my location" and grant permission; it is not stored server-side.</li>
            <li><strong>Usage analytics</strong> — screen views, taps on primary CTAs, feature adoption. Aggregated; not linked to your personal identity in reports.</li>
          </ul>

          <h3 style={styles.h3}>1.3 Information from academies you enrol with</h3>
          <ul style={styles.ul}>
            <li>Attendance, belt progression, batch schedules, certificates issued, class videos assigned to your batch.</li>
          </ul>

          <h3 style={styles.h3}>1.4 Information we do <em>not</em> collect</h3>
          <ul style={styles.ul}>
            <li>Contacts, SMS, call logs, calendar events.</li>
            <li>Photos or files outside those you explicitly upload (profile photo, certificate proof, feedback attachments).</li>
            <li>Microphone or continuous location tracking.</li>
          </ul>
        </Section>

        <Section title="2. How We Use Your Information">
          <ul style={styles.ul}>
            <li><strong>Provide the Service</strong> — create your account, deliver enrolments, mark attendance, issue certificates, process payments.</li>
            <li><strong>Send transactional communications</strong> — payment confirmations, invoice PDFs, welcome emails with login credentials, class schedule reminders, certificate issuance.</li>
            <li><strong>Improve the Service</strong> — diagnose crashes, measure feature adoption, prioritise roadmap items.</li>
            <li><strong>Comply with law</strong> — respond to lawful requests, retain tax records, prevent fraud and abuse.</li>
          </ul>
          <p>
            We <strong>do not</strong> use your personal data to serve advertising, and we do not sell or rent your data to third parties.
          </p>
        </Section>

        <Section title="3. Payments &amp; Subscriptions">
          <ul style={styles.ul}>
            <li>Payments are processed by <strong>Razorpay Software Pvt Ltd</strong>. When you pay, you are redirected to Razorpay's hosted checkout; we never see or store your card / UPI credentials.</li>
            <li>We store the payment reference id, amount, currency, billing cycle, and paid_at timestamp on our servers to reconcile subscriptions and issue invoices.</li>
            <li>Subscription renewals are <strong>not automatic</strong>. You will receive a renewal reminder before your subscription expires and must complete a fresh payment to continue.</li>
            <li>See our <a href="/refund-cancellation-policy" style={styles.link}>Refund &amp; Cancellation Policy</a> for details on cancellations and refunds.</li>
          </ul>
        </Section>

        <Section title="4. Data Sharing">
          <p>We share your data only with:</p>
          <ul style={styles.ul}>
            <li><strong>Your academy</strong> — if you are a student, the academy you enrol with sees your name, contact number, enrolment status, attendance, payment history, and certificates. This is inherent to how the platform functions.</li>
            <li><strong>Service providers</strong> — Razorpay (payments), MSG91 (SMS/email delivery), Nodemailer via Gmail SMTP (transactional emails), our cloud hosting provider. Each is bound by contract to process data only on our behalf.</li>
            <li><strong>Law enforcement</strong> — only when compelled by a valid legal order, and only the minimum data required.</li>
          </ul>
          <p>We never share your data with advertisers, data brokers, or unaffiliated third parties.</p>
        </Section>

        <Section title="5. Data Retention">
          <ul style={styles.ul}>
            <li><strong>Active accounts</strong> — retained for as long as your account remains active.</li>
            <li><strong>Deleted accounts</strong> — personal identifiers (name, email, phone, address, photo) are anonymised immediately on deletion. See{' '}
              <a href="/account-deletion" style={styles.link}>Account Deletion</a>.
            </li>
            <li><strong>Financial records</strong> — payment reference ids, amounts, and invoices are retained for <strong>8 years</strong> as required by Indian tax law (Section 44AA of the Income-tax Act, 1961), even after account deletion. All personal identifiers on these records are anonymised.</li>
            <li><strong>Backups</strong> — anonymised data may remain in encrypted backups for up to 90 days before being purged.</li>
          </ul>
        </Section>

        <Section title="6. Data Security">
          <ul style={styles.ul}>
            <li>All data in transit is encrypted with TLS 1.2+.</li>
            <li>Passwords are stored using bcrypt hashing with per-user salts.</li>
            <li>Payment credentials never touch our servers — Razorpay's PCI-DSS-compliant infrastructure handles them end-to-end.</li>
            <li>Access to production data is restricted to a small ops team, logged, and audited.</li>
            <li>We conduct security reviews before every major release.</li>
          </ul>
          <p>
            No system is perfectly secure. If you believe your account has been compromised, email us immediately at{' '}
            <a href="mailto:support@veerifyapp.com" style={styles.link}>support@veerifyapp.com</a>.
          </p>
        </Section>

        <Section title="7. Child Safety">
          <p>
            Veerify is used by martial-arts students of every age, including children. Where a student is under 13, the enrolling academy or parent/guardian is responsible for creating the account and consenting to this Privacy Policy on the child's behalf. See our{' '}
            <a href="/child-safety" style={styles.link}>Child Safety Policy</a> for our full commitments.
          </p>
          <ul style={styles.ul}>
            <li>We do not display advertising to any user.</li>
            <li>We do not collect any data from a child beyond what is required to operate the Service (enrolment, attendance, certificates).</li>
            <li>We do not enable public messaging, chatrooms, or user-generated content directed at children.</li>
          </ul>
        </Section>

        <Section title="8. Your Rights">
          <p>You have the right to:</p>
          <ul style={styles.ul}>
            <li><strong>Access</strong> — request a copy of the personal data we hold about you.</li>
            <li><strong>Correct</strong> — update any inaccurate information via your profile screen or by writing to support.</li>
            <li><strong>Delete</strong> — permanently delete your account via <em>More → Delete Account</em> in the app, or by writing to support. See <a href="/account-deletion" style={styles.link}>Account Deletion</a>.</li>
            <li><strong>Withdraw consent</strong> — for optional data (e.g. profile photo, health notes) by clearing those fields in your profile.</li>
            <li><strong>Complain</strong> — to India's Data Protection Board if you believe your rights have been infringed.</li>
          </ul>
          <p>
            To exercise any right, email{' '}
            <a href="mailto:support@veerifyapp.com" style={styles.link}>support@veerifyapp.com</a>{' '}
            from the email address associated with your account. We respond within 30 days.
          </p>
        </Section>

        <Section title="9. International Users">
          <p>
            Veerify is operated from India. If you access the Service from outside India, you consent to the transfer, storage, and processing of your data in India, which may have different data-protection laws than your country.
          </p>
        </Section>

        <Section title="10. Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. Material changes will be notified in-app and via email to your registered address at least 7 days before they take effect. The "Last updated" date at the top of this page reflects the current version.
          </p>
        </Section>

        <Section title="11. Contact">
          <p>
            For any privacy question, please contact:
          </p>
          <div style={styles.contactBox}>
            <p style={{ margin: 0 }}><strong>Veerify — Data Protection Team</strong></p>
            <p style={{ margin: '4px 0' }}>
              Email:{' '}
              <a href="mailto:support@veerifyapp.com" style={styles.link}>
                support@veerifyapp.com
              </a>
            </p>
            <p style={{ margin: '4px 0' }}>
              Website:{' '}
              <a href="https://veerifyapp.com" style={styles.link}>
                veerifyapp.com
              </a>
            </p>
          </div>
        </Section>
      </main>

      <VeerifyFooter lastUpdated={LAST_UPDATED} />
    </div>
  );
}

// ─── Small helpers ────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <section style={styles.section}>
      <h2 style={styles.h2}>{title}</h2>
      {children}
    </section>
  );
}

function setMeta(name, content) {
  if (typeof document === 'undefined') return;
  let tag = document.querySelector(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('name', name);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

// ─── Styles (inline — no external CSS needed) ─────────────────────
const BRAND = '#E63946';
const TEXT  = '#111827';
const MUTED = '#4B5563';
const BG    = '#FFFFFF';

const styles = {
  page: {
    minHeight: '100vh',
    background: BG,
    color: TEXT,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    lineHeight: 1.6,
  },
  main: {
    maxWidth: 820,
    margin: '0 auto',
    padding: '32px 20px 64px',
  },
  meta: {
    color: MUTED,
    fontSize: 13,
    margin: '0 0 20px',
  },
  lead: {
    fontSize: 16,
    color: TEXT,
    marginBottom: 28,
  },
  section: { marginTop: 36 },
  h2: {
    fontSize: 22,
    fontWeight: 800,
    color: TEXT,
    borderBottom: `2px solid ${BRAND}`,
    display: 'inline-block',
    paddingBottom: 4,
    marginTop: 0,
    marginBottom: 14,
  },
  h3: {
    fontSize: 15,
    fontWeight: 800,
    color: TEXT,
    marginTop: 18,
    marginBottom: 8,
  },
  ul: {
    paddingLeft: 22,
    margin: '0 0 12px',
    color: MUTED,
    fontSize: 15,
  },
  link: {
    color: BRAND,
    textDecoration: 'none',
    fontWeight: 700,
  },
  contactBox: {
    marginTop: 8,
    padding: 16,
    background: '#FFF5F6',
    borderLeft: `4px solid ${BRAND}`,
    borderRadius: 8,
    fontSize: 14,
  },
};
