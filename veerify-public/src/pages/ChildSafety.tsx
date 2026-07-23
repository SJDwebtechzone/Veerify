// src/pages/ChildSafety.jsx — Public route: /child-safety
//
// Play Store Family Policy + POCSO-aligned child-safety statement.

import React, { useEffect } from 'react';
import VeerifyHeader from './VeerifyHeader';
import VeerifyFooter from './VeerifyFooter';

const LAST_UPDATED = '22 July 2026';

export default function ChildSafety() {
  useEffect(() => {
    document.title = 'Child Safety Policy — Veerify';
    setMeta('description',
      'Veerify\'s commitments to protecting children: no ads, no public messaging, parent-controlled accounts, and rapid response to reports of child-safety concerns.');
  }, []);

  return (
    <div style={styles.page}>
      <VeerifyHeader title="Child Safety Policy"
        subtitle="Our commitments to keeping children safe on Veerify." />
      <main style={styles.main}>
        <p style={styles.meta}><strong>Last updated:</strong> {LAST_UPDATED}</p>

        <p style={styles.lead}>
          A large share of Veerify's users are children learning martial arts.
          We take that responsibility seriously. This policy explains what we
          do — and equally important, what we <em>do not</em> do — to keep
          them safe. It complements our{' '}
          <a href="/privacy-policy" style={styles.link}>Privacy Policy</a>{' '}
          and our{' '}
          <a href="/terms-and-conditions" style={styles.link}>Terms &amp; Conditions</a>.
        </p>

        <Section title="1. Our Core Commitments">
          <ul style={styles.ul}>
            <li><strong>No advertising to any user, ever.</strong> Zero ads, zero targeted content, zero third-party trackers used to build advertising profiles.</li>
            <li><strong>No public messaging, chatrooms, or user-generated posts.</strong> Children on Veerify do not have any surface where strangers can contact them.</li>
            <li><strong>Parent- or academy-controlled accounts for minors.</strong> A child under 13 does not create their own Veerify account — the parent or the enrolling academy does, and gives consent on the child's behalf.</li>
            <li><strong>Minimal data collection.</strong> We collect only what is needed to operate the Service: enrolment, attendance, belt progression, certificates. We do not ask children for their location beyond what an adult voluntarily shares to find nearby academies.</li>
            <li><strong>Rapid response to reports.</strong> Any credible report of a child-safety concern is escalated within 24 hours.</li>
          </ul>
        </Section>

        <Section title="2. What Children Can Do on Veerify">
          <ul style={styles.ul}>
            <li>See their own enrolment schedule, batch, and trainer.</li>
            <li>See their own attendance history and belt progression.</li>
            <li>Watch academy-approved course videos assigned to their batch.</li>
            <li>Download their own certificates.</li>
          </ul>
        </Section>

        <Section title="3. What Children Cannot Do on Veerify">
          <ul style={styles.ul}>
            <li>Send or receive messages to other users.</li>
            <li>Post publicly visible content, comments, or photos.</li>
            <li>Discover other children's profiles, contact information, or attendance.</li>
            <li>Follow, add, or "friend" any other user.</li>
            <li>Make in-app purchases beyond course fees paid to their enrolled academy — no cosmetic items, subscriptions, or upsells directed at children.</li>
          </ul>
        </Section>

        <Section title="4. Parental Controls">
          <ul style={styles.ul}>
            <li>A parent can link to their child's account via the app and see everything the child sees — attendance, schedule, certificates, fee dues.</li>
            <li>A parent can pay fees on the child's behalf directly through the app.</li>
            <li>A parent can request account deletion for the child at any time by writing to <a href="mailto:support@veerifyapp.com" style={styles.link}>support@veerifyapp.com</a>. See <a href="/account-deletion" style={styles.link}>Account Deletion</a>.</li>
            <li>A parent can revoke consent to their child's use of the Service in writing. The account is anonymised within 7 business days of the request.</li>
          </ul>
        </Section>

        <Section title="5. Content Standards">
          <p>All content published through Veerify by trainers and academies (course videos, certificates, event announcements) must:</p>
          <ul style={styles.ul}>
            <li>Be strictly related to martial-arts instruction, safety, or academy administration.</li>
            <li>Not depict violence outside the pedagogical context of the discipline.</li>
            <li>Not include contact requests, invitations to private communication, or references to any platform outside Veerify.</li>
            <li>Not solicit personal information from children beyond what the academy already holds on file.</li>
          </ul>
          <p>Content violating these standards is removed and the publishing account is investigated.</p>
        </Section>

        <Section title="6. Trainer Vetting">
          <p>Trainer accounts are created by institution admins, not self-registered. Every academy admin agrees under our Terms to:</p>
          <ul style={styles.ul}>
            <li>Vet trainers before adding them to Veerify.</li>
            <li>Follow all applicable child-safeguarding regulations, including India's POCSO Act 2012.</li>
            <li>Maintain physical child-safety policies in their academy that meet or exceed local statutory standards.</li>
          </ul>
        </Section>

        <Section title="7. Reporting a Concern">
          <p>If you believe a child is at risk through their use of Veerify, or you have observed content, communication, or behaviour that raises a safeguarding concern:</p>
          <ol style={styles.ol}>
            <li>Email <a href="mailto:support@veerifyapp.com" style={styles.link}>support@veerifyapp.com</a> with the subject line <strong>CHILD SAFETY</strong>.</li>
            <li>Include as much context as you can — the account name, the content or behaviour you observed, and any screenshots.</li>
            <li>Our team acknowledges within <strong>24 hours</strong> and escalates internally.</li>
            <li>Where required by law, we cooperate with police, National Commission for Protection of Child Rights (NCPCR) proceedings, and any competent authority.</li>
          </ol>
        </Section>

        <Section title="8. Zero Tolerance">
          <p>The following are zero-tolerance offences on Veerify:</p>
          <ul style={styles.ul}>
            <li>Any content that sexualises, exploits, or endangers a child.</li>
            <li>Any attempt by an adult user to contact a child outside academy-administrative interactions.</li>
            <li>Any content that grooms, entices, or otherwise attempts to build inappropriate trust with a child.</li>
          </ul>
          <p>Accounts implicated in any of the above are suspended immediately pending investigation, evidence is preserved, and appropriate authorities are notified.</p>
        </Section>

        <Section title="9. Our Team">
          <p>
            Child-safety reports are handled by our senior operations team. Contact:
          </p>
          <div style={styles.contactBox}>
            <p style={{ margin: 0 }}><strong>Veerify — Child Safety Team</strong></p>
            <p style={{ margin: '4px 0' }}>
              Email: <a href="mailto:support@veerifyapp.com" style={styles.link}>support@veerifyapp.com</a>
            </p>
            <p style={{ margin: '4px 0' }}>Response time: within 24 hours for CHILD SAFETY reports.</p>
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
  section: { marginTop: 36 },
  h2: { fontSize: 22, fontWeight: 800, color: TEXT, borderBottom: `2px solid ${BRAND}`, display:'inline-block', paddingBottom: 4, marginTop:0, marginBottom: 14 },
  ul: { paddingLeft: 22, margin:'0 0 12px', color: MUTED, fontSize: 15 },
  ol: { paddingLeft: 22, margin:'0 0 12px', color: MUTED, fontSize: 15 },
  link: { color: BRAND, textDecoration:'none', fontWeight: 700 },
  contactBox: { marginTop: 8, padding: 16, background:'#FFF5F6', borderLeft:`4px solid ${BRAND}`, borderRadius: 8, fontSize: 14 },
};
