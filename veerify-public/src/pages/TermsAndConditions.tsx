// src/pages/TermsAndConditions.jsx
//
// Public route: /terms-and-conditions
//
// Google-Play-review-ready Terms of Service for Veerify. Written to
// satisfy Play's Developer Program Policy references to "clear
// terms", the Indian IT Rules 2021 (intermediary due diligence), and
// standard SaaS user-agreement conventions.
//
// Same layout + branding as PrivacyPolicy.jsx — shared header /
// footer / section helpers so the six legal pages read as one
// consistent document set.

import React, { useEffect } from 'react';
import VeerifyHeader from './VeerifyHeader';
import VeerifyFooter from './VeerifyFooter';

const LAST_UPDATED = '19 July 2026';

export default function TermsAndConditions() {
  useEffect(() => {
    document.title = 'Terms & Conditions — Veerify';
    setMeta(
      'description',
      'The terms that govern your use of Veerify — the martial arts academy management platform. Covers accounts, payments, subscriptions, user conduct, intellectual property, and dispute resolution.',
    );
  }, []);

  return (
    <div style={styles.page}>
      <VeerifyHeader
        title="Terms & Conditions"
        subtitle="The rules that govern your use of Veerify."
      />

      <main style={styles.main}>
        <p style={styles.meta}>
          <strong>Last updated:</strong> {LAST_UPDATED}
        </p>

        <p style={styles.lead}>
          These Terms &amp; Conditions ("Terms") form a binding agreement
          between you and <strong>Veerify</strong> ("we", "our", "us")
          governing your use of the Veerify mobile application and the
          web dashboard at{' '}
          <a href="https://veerifyapp.com" style={styles.link}>
            veerifyapp.com
          </a>{' '}
          (together, the "Service"). By creating an account or using the
          Service in any capacity — as an academy owner, administrator,
          trainer, student, parent, or guest — you agree to these Terms.
          If you do not agree, do not use the Service.
        </p>

        <Section title="1. Eligibility">
          <ul style={styles.ul}>
            <li>You must be at least 18 years old to create an account on your own behalf.</li>
            <li>Users under 18 may only use the Service through an account created for them by their parent, legal guardian, or the martial-arts academy where they are enrolled.</li>
            <li>By using the Service you represent that you have the legal capacity to enter into this agreement in your jurisdiction.</li>
          </ul>
        </Section>

        <Section title="2. Accounts">
          <h3 style={styles.h3}>2.1 Registration</h3>
          <ul style={styles.ul}>
            <li>You must provide accurate, current, and complete information when you register or when an academy creates an account for you.</li>
            <li>You are responsible for keeping your account information up to date via your profile screen.</li>
            <li>One person may hold multiple role-based accounts (e.g. as a trainer at one academy and a student at another), but each account must be individually authorised.</li>
          </ul>

          <h3 style={styles.h3}>2.2 Account security</h3>
          <ul style={styles.ul}>
            <li>You are solely responsible for the security of your login credentials and for all activity that occurs under your account.</li>
            <li>If your account was created by an academy admin with a temporary password, you must change it on first login (or use "Remind me later" and change it at your next session).</li>
            <li>Notify us immediately at <a href="mailto:support@veerifyapp.com" style={styles.link}>support@veerifyapp.com</a> if you suspect unauthorised access.</li>
          </ul>

          <h3 style={styles.h3}>2.3 One account per role</h3>
          <p>You may not sell, transfer, or share your account with any other person. Doing so may lead to immediate suspension.</p>
        </Section>

        <Section title="3. Roles &amp; Responsibilities">
          <p>The Service supports several role types. Each role has its own responsibilities.</p>
          <ul style={styles.ul}>
            <li><strong>Institution / Branch Admin</strong> — an academy that has completed onboarding and paid its subscription. Responsible for the accuracy of student records, attendance, batch schedules, and any content it publishes.</li>
            <li><strong>Trainer</strong> — an account created by an academy admin to record attendance, evaluate belts, and post class videos. Responsible for the professional conduct of every class taught through the app.</li>
            <li><strong>Student</strong> — an account either self-registered or created by an academy at enrolment. Responsible for the accuracy of profile information and for payment obligations to the academy.</li>
            {/* <li><strong>Parent</strong> — a linked account that can view a child student's progress, attendance, and certificates. Consent given by the parent extends to the child's use of the Service.</li> */}
            <li><strong>Guest</strong> — an unauthenticated visitor browsing academies. Limited to public content (course previews capped at 60 seconds, academy discovery, categories).</li>
          </ul>
        </Section>

        <Section title="4. The Service">
          <p>Veerify provides tools to run a martial-arts academy, including:</p>
          <ul style={styles.ul}>
            <li>Student &amp; trainer management, batch scheduling, and attendance marking.</li>
            <li>Course catalogues, curriculum, and belt progression tracking.</li>
            <li>Payment collection via Razorpay Payment Links and hosted checkout.</li>
            <li>Automated invoice generation and email delivery.</li>
            <li>Certificate issuance and QR-code verification.</li>
            <li>Institution-owned promotional content (banners, videos, events) for prospective students browsing as guests.</li>
          </ul>
          <p>
            We continually improve the Service. Features may be added, changed, or removed. Material changes that meaningfully reduce functionality on a paid plan will be notified at least 7 days in advance.
          </p>
        </Section>

        <Section title="5. Payments &amp; Subscriptions">
          <h3 style={styles.h3}>5.1 How payments work</h3>
          <ul style={styles.ul}>
            <li>All payments are processed by <strong>Razorpay Software Pvt Ltd</strong> on their PCI-DSS-compliant hosted checkout. We never see or store your card / UPI / bank credentials.</li>
            <li>Subscription plans are offered on <strong>Monthly, Quarterly, Half-Yearly, or Annual</strong> billing terms (as configured by the plan). Prices are shown in Indian Rupees (INR) and are inclusive of applicable taxes unless stated otherwise.</li>
            <li>Institution subscriptions are activated only after successful payment. Trial periods, where offered, are non-transferable and expire on the stated date.</li>
            <li>Student course fees are paid to the academy through the app. The academy sets the course price and billing cycle (One-Time, Monthly, Quarterly, Half-Yearly, or Annual).</li>
          </ul>

          <h3 style={styles.h3}>5.2 Renewals</h3>
          <ul style={styles.ul}>
            <li>Subscriptions do <strong>not auto-renew</strong>. You will receive a renewal reminder before your term expires and must complete a fresh payment to continue.</li>
            <li>If a subscription is not renewed by its expiry date, the account enters a grace period defined by the plan. After grace, feature access is locked until payment is made.</li>
          </ul>

          <h3 style={styles.h3}>5.3 Refunds</h3>
          <p>
            Refund and cancellation rules are described in our{' '}
            <a href="/refund-cancellation-policy" style={styles.link}>
              Refund &amp; Cancellation Policy
            </a>. That policy is incorporated into these Terms by reference.
          </p>

          <h3 style={styles.h3}>5.4 Invoices</h3>
          <p>
            Every successful payment generates a system-generated PDF invoice bearing a unique invoice number in the format <code style={styles.code}>VRF-INV-YYYY-######</code>. Invoices are emailed to your registered address and downloadable in-app.
          </p>
        </Section>

        <Section title="6. Acceptable Use">
          <p>You agree not to:</p>
          <ul style={styles.ul}>
            <li>Use the Service to break any law, or to help anyone else break the law.</li>
            <li>Impersonate any person or academy, or misrepresent your affiliation with any organisation.</li>
            <li>Upload malicious code, attempt to probe or breach security, or interfere with the Service's operation.</li>
            <li>Scrape, mirror, or resell any part of the Service without our written consent.</li>
            <li>Harass, threaten, or abuse other users. Trainers and students who behave inappropriately during a class may be reported via the in-app Feedback flow and their accounts investigated.</li>
            <li>Post, upload, or share content that is unlawful, obscene, hateful, or infringes any third party's rights.</li>
            <li>Use the Service to promote violence, extremism, or any activity that could endanger a child.</li>
          </ul>
          <p>
            We may suspend or terminate any account that violates these rules, with or without notice, at our sole discretion.
          </p>
        </Section>

        <Section title="7. Intellectual Property">
          <ul style={styles.ul}>
            <li>The Veerify name, logo, wordmark, brand colours, product designs, and code are owned by Veerify. You may not use them without our written permission except as reasonably necessary to reference the Service.</li>
            <li>Course content, curriculum, videos, and imagery published by an academy remain the property of that academy. By publishing them through the Service, the academy grants Veerify a worldwide, non-exclusive, royalty-free licence to host, transmit, and display that content to authorised users of the Service.</li>
            <li>User-generated content (feedback, profile photo, health notes, certificate proofs) is licensed to us solely for the purpose of providing the Service to you and your academy. You retain ownership.</li>
          </ul>
        </Section>

        <Section title="8. Third-Party Services">
          <p>The Service integrates the following third parties. Your use of them is subject to their own terms, which we encourage you to review:</p>
          <ul style={styles.ul}>
            <li><strong>Razorpay</strong> — payment processing.</li>
            <li><strong>WhatsApp Cloud API (Meta)</strong> — Sending transactional WhatsApp notifications, login credentials, enrollment confirmations, payment updates, and other service-related communications (where enabled).</li>
            <li><strong>Firebase Cloud Messaging (Google Firebase)</strong> — Delivery of push notifications for announcements, attendance, certificates, payments, reminders, and other app-related events.</li>
          
            <li><strong>Google Play</strong> — app distribution, in-app purchases (where applicable), and platform-level policies.</li>
          </ul>
          <p>
            We are not responsible for the availability, content, or practices of third-party services, and inclusion of a third party does not imply endorsement.
          </p>
        </Section>

        <Section title="9. Content Moderation &amp; Reporting">
          <p>
            If you encounter content that violates these Terms, please report it via <em>More → Send Feedback</em> in the app or email us at{' '}
            <a href="mailto:support@veerifyapp.com" style={styles.link}>
              support@veerifyapp.com
            </a>. We review every report and may remove content, suspend accounts, or take other action as appropriate.
          </p>
        </Section>

        <Section title="10. Termination">
          <ul style={styles.ul}>
            <li><strong>By you</strong> — you can delete your account at any time via <em>More → Delete Account</em>. See our <a href="/account-deletion" style={styles.link}>Account Deletion Policy</a>.</li>
            <li><strong>By us</strong> — we may suspend or terminate your access if you violate these Terms, if we suspect fraudulent use, if required by law, or if the Service is discontinued.</li>
            <li>On termination, your right to use the Service ends immediately. Provisions that by their nature should survive termination (payment obligations, intellectual property, limitation of liability, dispute resolution) survive.</li>
          </ul>
        </Section>

        <Section title="11. Disclaimers">
          <p>
            The Service is provided "AS IS" and "AS AVAILABLE" without warranties of any kind, whether express or implied, including any implied warranties of merchantability, fitness for a particular purpose, or non-infringement. We do not warrant that the Service will be uninterrupted, error-free, or that any information provided through the Service is accurate or complete.
          </p>
          <p>
            Veerify is a management tool. We do not provide martial-arts instruction. Any advice, curriculum, belt evaluation, or health guidance shown in the Service is provided by the enrolling academy and is that academy's sole responsibility.
          </p>
        </Section>

        <Section title="12. Limitation of Liability">
          <p>
            To the maximum extent permitted by law, Veerify, its officers, directors, employees, and agents shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits, revenue, data, or use, arising out of or in connection with your use of the Service, whether based on warranty, contract, tort, or any other legal theory.
          </p>
          <p>
            Our total aggregate liability arising out of or relating to the Service shall not exceed the greater of (a) the amount you paid to us in the 12 months immediately preceding the event giving rise to liability, or (b) ₹1,000.
          </p>
          <p>
            Nothing in these Terms excludes or limits liability that cannot lawfully be excluded — including liability for fraud, gross negligence, or death or personal injury caused by our negligence.
          </p>
        </Section>

        <Section title="13. Indemnification">
          <p>
            You agree to indemnify and hold Veerify harmless from any claim, loss, or expense (including reasonable attorney's fees) arising out of your breach of these Terms, your misuse of the Service, or your violation of any law or third-party right.
          </p>
        </Section>

        <Section title="14. Privacy">
          <p>
            Our collection and use of personal information is described in our{' '}
            <a href="/privacy-policy" style={styles.link}>Privacy Policy</a>, which is incorporated into these Terms by reference.
          </p>
        </Section>

        <Section title="15. Governing Law &amp; Dispute Resolution">
          <ul style={styles.ul}>
            <li>These Terms are governed by the laws of <strong>India</strong>, without regard to conflict-of-law rules.</li>
            <li>Any dispute arising out of or in connection with these Terms shall be subject to the exclusive jurisdiction of the courts of Chennai, Tamil Nadu, India.</li>
            <li>Before bringing formal proceedings, both parties agree to attempt in good faith to resolve any dispute by writing to <a href="mailto:support@veerifyapp.com" style={styles.link}>support@veerifyapp.com</a>.</li>
          </ul>
        </Section>

        <Section title="16. Changes to These Terms">
          <p>
            We may amend these Terms from time to time. If we make a material change, we will notify you in-app and by email to your registered address at least 7 days before the change takes effect. Your continued use of the Service after the effective date constitutes acceptance of the amended Terms.
          </p>
        </Section>

        <Section title="17. Miscellaneous">
          <ul style={styles.ul}>
            <li><strong>Entire agreement</strong> — these Terms, together with the Privacy Policy and the Refund &amp; Cancellation Policy, constitute the entire agreement between you and Veerify regarding the Service.</li>
            <li><strong>Severability</strong> — if any provision is held unenforceable, the remaining provisions remain in effect.</li>
            <li><strong>No waiver</strong> — our failure to enforce any provision is not a waiver of that provision.</li>
            <li><strong>Assignment</strong> — you may not assign these Terms without our written consent. We may assign these Terms in connection with a merger, acquisition, or sale of assets.</li>
            <li><strong>No agency</strong> — nothing in these Terms creates any agency, partnership, joint-venture, or employment relationship.</li>
          </ul>
        </Section>

        <Section title="18. Contact">
          <p>Questions about these Terms? Get in touch:</p>
          <div style={styles.contactBox}>
            <p style={{ margin: 0 }}><strong>Veerify — Legal Team</strong></p>
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

// ─── Helpers (identical to PrivacyPolicy.jsx) ─────────────────────
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

// ─── Styles — identical to PrivacyPolicy.jsx ──────────────────────
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
  main: { maxWidth: 820, margin: '0 auto', padding: '32px 20px 64px' },
  meta:  { color: MUTED, fontSize: 13, margin: '0 0 20px' },
  lead:  { fontSize: 16, color: TEXT, marginBottom: 28 },
  section: { marginTop: 36 },
  h2: {
    fontSize: 22, fontWeight: 800, color: TEXT,
    borderBottom: `2px solid ${BRAND}`,
    display: 'inline-block', paddingBottom: 4,
    marginTop: 0, marginBottom: 14,
  },
  h3: {
    fontSize: 15, fontWeight: 800, color: TEXT,
    marginTop: 18, marginBottom: 8,
  },
  ul: {
    paddingLeft: 22, margin: '0 0 12px',
    color: MUTED, fontSize: 15,
  },
  link: {
    color: BRAND, textDecoration: 'none', fontWeight: 700,
  },
  code: {
    background: '#F3F4F6',
    padding: '2px 6px',
    borderRadius: 4,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 13,
    color: TEXT,
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
