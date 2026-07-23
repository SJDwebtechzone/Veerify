// src/pages/Contact.jsx — Public route: /contact

import React, { useEffect, useState } from 'react';
import VeerifyHeader from './VeerifyHeader';
import VeerifyFooter from './VeerifyFooter';

const LAST_UPDATED = '22 July 2026';

export default function Contact() {
  useEffect(() => {
    document.title = 'Contact Veerify';
    setMeta('description',
      'Get in touch with Veerify — support, sales, partnerships, media, child safety. Response within 2 business days.');
  }, []);

  return (
    <div style={styles.page}>
      <VeerifyHeader title="Contact" subtitle="We reply within 2 business days." />

      <main style={styles.main}>
        <div style={styles.grid}>
          {/* Left — contact channels */}
          <div>
            <ContactCard
              title="General support"
              body="Bugs, questions, feedback about the app."
              email="support@veerifyapp.com"
              sla="2 business days"
            />
            <ContactCard
              title="Sales &amp; onboarding"
              body="Interested in bringing your academy onto Veerify? We'll walk you through setup."
              email="support@veerifyapp.com"
              sla="1 business day"
            />
            <ContactCard
              title="Child safety"
              body="Reports of any content or conduct that raises a child-safety concern."
              email="support@veerifyapp.com"
              sla="24 hours"
              tone="urgent"
              subject="CHILD SAFETY"
            />
            <ContactCard
              title="Data protection"
              body="Data access, correction, or deletion requests under the DPDP Act 2023."
              email="support@veerifyapp.com"
              sla="30 days"
            />
            <ContactCard
              title="Press &amp; partnerships"
              body="Media enquiries, partnership proposals, tournament sponsorships."
              email="support@veerifyapp.com"
              sla="5 business days"
            />
          </div>

          {/* Right — office block + form */}
          <aside>
            <div style={styles.officeCard}>
              <h3 style={styles.officeTitle}>Veerify</h3>
              <p style={styles.officeBody}>
                <strong>Website:</strong>{' '}
                <a href="https://veerifyapp.com" style={styles.link}>veerifyapp.com</a><br/>
                <strong>Email:</strong>{' '}
                <a href="mailto:support@veerifyapp.com" style={styles.link}>support@veerifyapp.com</a><br/>
                <strong>Hours:</strong> Mon–Fri, 10:00 – 18:00 IST
              </p>
            </div>

            <QuickForm />
          </aside>
        </div>
      </main>

      <VeerifyFooter lastUpdated={LAST_UPDATED} />
    </div>
  );
}

// ─── Contact channel card ─────────────────────────────────────────
function ContactCard({ title, body, email, sla, tone, subject }) {
  const isUrgent = tone === 'urgent';
  const mail = subject
    ? `mailto:${email}?subject=${encodeURIComponent(subject)}`
    : `mailto:${email}`;
  return (
    <div style={{
      ...styles.chanCard,
      ...(isUrgent ? { borderColor: '#E63946', background: '#FFF5F6' } : null),
    }}>
      <h3 style={{
        ...styles.chanTitle,
        ...(isUrgent ? { color: '#B02736' } : null),
      }} dangerouslySetInnerHTML={{ __html: title }} />
      <p style={styles.chanBody}>{body}</p>
      <div style={styles.chanFoot}>
        <a href={mail} style={styles.chanEmail}>{email}</a>
        <span style={styles.chanSla}>Reply within {sla}</span>
      </div>
    </div>
  );
}

// ─── Quick form — mailto-based (no backend needed) ────────────────
function QuickForm() {
  const [name, setName]     = useState('');
  const [email, setEmail]   = useState('');
  const [topic, setTopic]   = useState('General');
  const [msg, setMsg]       = useState('');

  const submit = (e) => {
    e.preventDefault();
    const subject = `Veerify — ${topic} — ${name || 'new enquiry'}`;
    const body =
      `From: ${name || '(name)'} <${email || '(email)'}>\n` +
      `Topic: ${topic}\n\n` +
      `${msg}`;
    window.location.href =
      `mailto:support@veerifyapp.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <form onSubmit={submit} style={styles.form}>
      <h3 style={styles.formTitle}>Send a quick message</h3>
      <label style={styles.label}>Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)}
        placeholder="Your full name" style={styles.input} required />
      <label style={styles.label}>Email</label>
      <input value={email} onChange={(e) => setEmail(e.target.value)}
        type="email" placeholder="you@example.com" style={styles.input} required />
      <label style={styles.label}>Topic</label>
      <select value={topic} onChange={(e) => setTopic(e.target.value)}
        style={styles.input}>
        <option>General</option>
        <option>Sales</option>
        <option>Support</option>
        <option>Child Safety</option>
        <option>Data Protection</option>
        <option>Press</option>
      </select>
      <label style={styles.label}>Message</label>
      <textarea value={msg} onChange={(e) => setMsg(e.target.value)}
        rows={5} placeholder="How can we help?" style={{ ...styles.input, resize: 'vertical' }} required />
      <button type="submit" style={styles.submitBtn}>Open in email client</button>
      <p style={styles.formHint}>
        Opens a pre-filled email in your default email client. You send it from there.
      </p>
    </form>
  );
}

function setMeta(name, content) {
  if (typeof document === 'undefined') return;
  let tag = document.querySelector(`meta[name="${name}"]`);
  if (!tag) { tag = document.createElement('meta'); tag.setAttribute('name', name); document.head.appendChild(tag); }
  tag.setAttribute('content', content);
}

const BRAND='#E63946', TEXT='#111827', MUTED='#4B5563', BG='#FFFFFF', BORDER='#E5E7EB';
const styles = {
  page: { minHeight:'100vh', background: BG, color: TEXT, fontFamily:"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", lineHeight:1.6 },
  main: { maxWidth: 1100, margin:'0 auto', padding:'32px 20px 64px' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
    gap: 32,
  },
  chanCard: {
    background: '#fff',
    border: `1px solid ${BORDER}`,
    borderRadius: 12,
    padding: 20,
    marginBottom: 14,
  },
  chanTitle: { fontSize: 16, fontWeight: 800, margin: '0 0 6px', color: TEXT },
  chanBody:  { fontSize: 14, color: MUTED, margin: '0 0 12px', lineHeight: 1.55 },
  chanFoot: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, flexWrap: 'wrap',
  },
  chanEmail: { color: BRAND, fontWeight: 700, textDecoration: 'none', fontSize: 14 },
  chanSla:   { fontSize: 12, color: MUTED, fontWeight: 600 },

  officeCard: {
    background: BRAND,
    color: '#fff',
    borderRadius: 14,
    padding: 24,
    marginBottom: 16,
  },
  officeTitle: { fontSize: 22, fontWeight: 900, margin: '0 0 10px' },
  officeBody:  { fontSize: 14, lineHeight: 1.8, margin: 0, color: '#FFF5F6' },
  link: { color: '#fff', fontWeight: 800, textDecoration: 'underline' },

  form: {
    background: '#fff',
    border: `1px solid ${BORDER}`,
    borderRadius: 14,
    padding: 20,
  },
  formTitle: { fontSize: 16, fontWeight: 800, margin: '0 0 12px', color: TEXT },
  label: { display: 'block', fontSize: 12, fontWeight: 700, color: MUTED, marginTop: 8, marginBottom: 4 },
  input: {
    width: '100%',
    padding: '10px 12px',
    fontSize: 14,
    border: `1px solid ${BORDER}`,
    borderRadius: 8,
    color: TEXT,
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  submitBtn: {
    width: '100%',
    marginTop: 14,
    padding: '12px 20px',
    borderRadius: 10,
    background: BRAND,
    color: '#fff',
    fontWeight: 800,
    fontSize: 14,
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  formHint: { fontSize: 11, color: MUTED, textAlign: 'center', margin: '8px 0 0' },
};
