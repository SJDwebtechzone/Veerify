// src/pages/LandingPage.jsx
//
// Public route: /
//
// Veerify marketing landing page — every section the brief lists,
// in one self-contained React component with inline styles so it
// drops into any Vite / CRA / Next.js project with zero external
// CSS dependencies. Fully responsive via clamp() / minmax() / grid
// auto-fit patterns — no media queries needed for the common cases.
//
// SEO: sets document.title + meta description on mount. Swap to
// your framework's Head component (Next.js) when you're ready.

import React, { useEffect, useState } from 'react';
import VeerifyFooter from './VeerifyFooter';

// ── Brand tokens ──────────────────────────────────────────────────
const BRAND       = '#E63946';
const BRAND_SOFT  = '#FFF5F6';
const BRAND_DARK  = '#B02736';
const TEXT        = '#111827';
const MUTED       = '#4B5563';
const SURFACE     = '#FFFFFF';
const BG_SOFT     = '#FAFAFC';
const BORDER      = '#E5E7EB';

const LAST_UPDATED = '22 July 2026';

export default function LandingPage() {
  useEffect(() => {
    document.title = 'Veerify — #1 Martial Arts App';
    setMeta(
      'description',
      'Veerify is the all-in-one platform for martial-arts academies — attendance, batches, belt progression, payments, certificates. Trusted by 100+ academies across India.',
    );
  }, []);

  return (
    <div style={styles.page}>
      <TopNav />
      <Hero />
      <TrustStrip />
      <Features />
      <Benefits />
      <HowItWorks />
      <CoursesAndCerts />
      <EventsSection />
      <Testimonials />
      <FAQSection />
      <ContactCTA />
      <VeerifyFooter lastUpdated={LAST_UPDATED} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Top navigation
// ═══════════════════════════════════════════════════════════════════
function TopNav() {
  return (
    <header style={styles.nav}>
      <div style={styles.navInner}>
        <a href="/" style={styles.brand} aria-label="Veerify home">
          <div style={styles.brandLogo}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none"
                 stroke="#fff" strokeWidth="2.4"
                 strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L4 5v6c0 5 3.5 9.4 8 11 4.5-1.6 8-6 8-11V5l-8-3z"/>
              <polyline points="9 12 11 14 15 10"/>
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={styles.brandName}>Veerify</span>
            <span style={styles.brandTag}>#1 Martial Arts App</span>
          </div>
        </a>
        <nav style={styles.navLinks} aria-label="Primary">
          <a href="#features"     style={styles.navLink}>Features</a>
          <a href="#how-it-works" style={styles.navLink}>How it works</a>
          <a href="#courses"      style={styles.navLink}>Courses</a>
          <a href="#faq"          style={styles.navLink}>FAQ</a>
          <a href="/contact"      style={styles.navLink}>Contact</a>
        </nav>
        <div style={styles.navCtas}>
          <a href="/admin" style={styles.navGhost}>Sign in</a>
          <a href="#download" style={styles.navPrimary}>Get the app</a>
        </div>
      </div>
    </header>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Hero
// ═══════════════════════════════════════════════════════════════════
function Hero() {
  return (
    <section id="download" style={styles.hero}>
      <div style={styles.heroInner}>
        <div style={styles.heroLeft}>
          <span style={styles.heroPill}>★ #1 MARTIAL ARTS APP IN INDIA</span>
          <h1 style={styles.heroTitle}>
            The complete <span style={{ color: BRAND }}>martial arts</span> platform.
          </h1>
          <p style={styles.heroSub}>
            Attendance, batches, belt progression, payments, certificates —
            everything your academy needs, in one app. Students and parents
            get a beautiful mobile experience. Trainers get their day back.
          </p>
          <div style={styles.heroCtas}>
            <a href="https://play.google.com/store" style={styles.ctaPrimary}>
              <PlayIcon /> Download for Android
            </a>
            <a href="#courses" style={styles.ctaGhost}>
              Browse academies →
            </a>
          </div>
          <div style={styles.heroStats}>
            <Stat n="100+" label="Academies" />
            <Stat n="10K+" label="Students" />
            <Stat n="4.9★" label="App rating" />
          </div>
        </div>
        <div style={styles.heroRight}>
          <HeroPhoneMockup />
        </div>
      </div>
    </section>
  );
}

function HeroPhoneMockup() {
  return (
    <div style={styles.phoneWrap}>
      <div style={styles.phoneShadow} />
      <div style={styles.phone}>
        <div style={styles.phoneNotch} />
        <div style={styles.phoneScreen}>
          <div style={styles.mockHeader}>
            <div style={styles.mockAvatar}>M</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: TEXT }}>Maruthi Academy</div>
              <div style={{ fontSize: 10, color: MUTED }}>Silambam · Karate</div>
            </div>
          </div>
          <div style={styles.mockCard}>
            <div style={{ fontSize: 10, color: MUTED, fontWeight: 700 }}>ATTENDANCE THIS MONTH</div>
            <div style={{ fontSize: 32, fontWeight: 900, color: BRAND, marginTop: 4 }}>
              92<span style={{ fontSize: 16, color: MUTED }}>%</span>
            </div>
            <div style={styles.mockBar}>
              <div style={{ ...styles.mockBarFill, width: '92%' }} />
            </div>
          </div>
          <div style={styles.mockGrid}>
            <div style={styles.mockTile}>
              <div style={{ fontSize: 20, fontWeight: 900, color: TEXT }}>3</div>
              <div style={{ fontSize: 10, color: MUTED }}>Classes today</div>
            </div>
            <div style={styles.mockTile}>
              <div style={{ fontSize: 20, fontWeight: 900, color: TEXT }}>Blue I</div>
              <div style={{ fontSize: 10, color: MUTED }}>Current belt</div>
            </div>
          </div>
          <div style={styles.mockList}>
            <div style={styles.mockRow}>
              <span style={{ ...styles.mockDot, background: '#10B981' }} />
              <span style={{ fontSize: 11, color: TEXT }}>Karate — Batch 1</span>
              <span style={{ fontSize: 10, color: MUTED, marginLeft: 'auto' }}>6:00 PM</span>
            </div>
            <div style={styles.mockRow}>
              <span style={{ ...styles.mockDot, background: '#F59E0B' }} />
              <span style={{ fontSize: 11, color: TEXT }}>Silambam — Batch 2</span>
              <span style={{ fontSize: 10, color: MUTED, marginLeft: 'auto' }}>7:00 PM</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ n, label }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 900, color: BRAND }}>{n}</div>
      <div style={{ fontSize: 12, color: MUTED, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Trust strip
// ═══════════════════════════════════════════════════════════════════
function TrustStrip() {
  return (
    <div style={styles.trustStrip}>
      <div style={styles.trustInner}>
        <span style={styles.trustLabel}>Powering academies teaching</span>
        <div style={styles.trustSkills}>
          {['Karate', 'Silambam', 'Taekwondo', 'BJJ', 'Muay Thai', 'Kalari', 'Judo', 'MMA'].map((s) => (
            <span key={s} style={styles.trustSkill}>{s}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Features
// ═══════════════════════════════════════════════════════════════════
function Features() {
  const feats = [
    { icon: '📅', title: 'Smart attendance',
      body: 'Mark attendance in seconds. Auto-locked to scheduled class days. Auto-computed % per student.' },
    { icon: '🥋', title: 'Belt progression',
      body: 'Track belts across every rank. Trigger promotions when milestones are hit. Print certificates.' },
    { icon: '💳', title: 'Payments in-app',
      body: 'Razorpay-backed course fees, subscriptions, and event fees. Instant invoices by email.' },
    { icon: '📄', title: 'Automatic invoices',
      body: 'Every payment generates a signed PDF invoice with a unique reference for tax records.' },
    { icon: '🎓', title: 'QR certificates',
      body: 'Issue tamper-evident certificates. Verifiable by anyone scanning the QR — no login needed.' },
    { icon: '👨‍👩‍👧', title: 'Parent view',
      body: 'Parents link to their child\'s account to view attendance, belts, and certificates in real time.' },
    { icon: '📍', title: 'Multi-branch',
      body: 'Main institution + unlimited sub-branches. Each branch admin only sees their own students.' },
    { icon: '📊', title: 'Real-time dashboards',
      body: 'Revenue, pending fees, attendance %, subscription health — one home screen tells you everything.' },
  ];
  return (
    <section id="features" style={styles.section}>
      <div style={styles.sectionInner}>
        <SectionHead eyebrow="Features" title="Everything an academy needs." />
        <div style={styles.featureGrid}>
          {feats.map((f) => (
            <div key={f.title} style={styles.featureCard}>
              <div style={styles.featureIcon}>{f.icon}</div>
              <h3 style={styles.featureTitle}>{f.title}</h3>
              <p style={styles.featureBody}>{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Benefits (per role)
// ═══════════════════════════════════════════════════════════════════
function Benefits() {
  const roles = [
    {
      accent: '#E63946', title: 'Institutions',
      items: [
        'Full student roster + branch scoping',
        'Trainer + salary management',
        'Course, batch, and pricing controls',
        'Automatic invoices + revenue dashboards',
        'Promotional banners for guest users',
      ],
    },
    {
      accent: '#6D28D9', title: 'Trainers',
      items: [
        'Attendance in taps, not clicks',
        'Assigned batches auto-populate',
        'Belt evaluations and promotions',
        'Salary slips + leave tracking',
        'Share course videos with students',
      ],
    },
    {
      accent: '#0891B2', title: 'Students',
      items: [
        'See your schedule + belt progress',
        'Pay course fees securely in-app',
        'Download invoices and certificates',
        'Watch enrolled course videos',
        'Track your attendance %',
      ],
    },
    {
      accent: '#059669', title: 'Parents',
      items: [
        'Link to your child\'s account',
        'Attendance + belt updates in real time',
        'View certificates and reports',
        'See fee dues and pay directly',
        'Receive event announcements',
      ],
    },
  ];
  return (
    <section style={{ ...styles.section, background: BG_SOFT }}>
      <div style={styles.sectionInner}>
        <SectionHead eyebrow="Benefits" title="Built for every role." />
        <div style={styles.benefitGrid}>
          {roles.map((r) => (
            <div key={r.title} style={styles.benefitCard}>
              <div style={{ ...styles.benefitAccent, background: r.accent }} />
              <h3 style={{ ...styles.benefitTitle, color: r.accent }}>{r.title}</h3>
              <ul style={styles.benefitList}>
                {r.items.map((i) => (
                  <li key={i} style={styles.benefitLi}>
                    <span style={{ ...styles.benefitCheck, color: r.accent }}>✓</span>
                    <span>{i}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// How it works
// ═══════════════════════════════════════════════════════════════════
function HowItWorks() {
  const steps = [
    { n: 1, title: 'Register your academy',
      body: 'Sign up in 5 minutes. Add your logo, address, branches, and courses. Pick a plan and pay via Razorpay.' },
    { n: 2, title: 'Add trainers + students',
      body: 'Bulk-add or invite one at a time. Students receive login credentials by email automatically after payment.' },
    { n: 3, title: 'Run classes',
      body: 'Mark attendance on scheduled class days. Track belts, share videos, issue certificates from your dashboard.' },
    { n: 4, title: 'Grow',
      body: 'Analytics show revenue, attendance %, and student growth. Add branches as you scale.' },
  ];
  return (
    <section id="how-it-works" style={styles.section}>
      <div style={styles.sectionInner}>
        <SectionHead eyebrow="How it works" title="From setup to first class in a day." />
        <div style={styles.stepGrid}>
          {steps.map((s) => (
            <div key={s.n} style={styles.stepCard}>
              <div style={styles.stepBubble}>{s.n}</div>
              <h3 style={styles.stepTitle}>{s.title}</h3>
              <p style={styles.stepBody}>{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Courses & Certifications
// ═══════════════════════════════════════════════════════════════════
function CoursesAndCerts() {
  const cats = [
    { emoji: '🥋', name: 'Karate',      count: '40+ academies' },
    { emoji: '🥍', name: 'Silambam',    count: '18+ academies' },
    { emoji: '🦵', name: 'Taekwondo',   count: '25+ academies' },
    { emoji: '🥊', name: 'Muay Thai',   count: '12+ academies' },
    { emoji: '🤼', name: 'BJJ',         count: '8+ academies'  },
    { emoji: '⚔️', name: 'Kalari',      count: '10+ academies' },
    { emoji: '🥋', name: 'Judo',        count: '14+ academies' },
    { emoji: '🥊', name: 'MMA',         count: '9+ academies'  },
  ];
  return (
    <section id="courses" style={{ ...styles.section, background: BG_SOFT }}>
      <div style={styles.sectionInner}>
        <SectionHead
          eyebrow="Courses & certifications"
          title="Every discipline. Every belt. QR-verified."
        />
        <p style={styles.sectionLead}>
          Certificates issued through Veerify carry a unique QR code. Anyone can scan
          to instantly verify authenticity — students, employers, competition
          organisers, no login required.
        </p>
        <div style={styles.courseGrid}>
          {cats.map((c) => (
            <a key={c.name} href="#download" style={styles.courseCard}>
              <div style={styles.courseEmoji}>{c.emoji}</div>
              <div style={styles.courseName}>{c.name}</div>
              <div style={styles.courseCount}>{c.count}</div>
            </a>
          ))}
        </div>
        <div style={styles.certRow}>
          <div style={styles.certCard}>
            <h3 style={styles.certTitle}>Belt progression that maps to the real world</h3>
            <p style={styles.certBody}>
              Every belt from White to Black, plus Gray / Blue I / Blue II / Brown I–III,
              plus custom ranks for academies that use their own system. Trainers
              nominate; admins approve; students get notified.
            </p>
          </div>
          <div style={styles.certCard}>
            <h3 style={styles.certTitle}>Signed, tamper-evident certificates</h3>
            <p style={styles.certBody}>
              PDF certificates carry a unique invoice-style reference and a QR that
              resolves to a public verify page on veerifyapp.com. Great for
              tournaments, college applications, and employer verification.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Events
// ═══════════════════════════════════════════════════════════════════
function EventsSection() {
  return (
    <section style={styles.section}>
      <div style={styles.sectionInner}>
        <SectionHead
          eyebrow="Events"
          title="Tournaments, gradings, workshops — all in the app."
        />
        <div style={styles.eventGrid}>
          <div style={styles.eventFeature}>
            <h3 style={styles.eventFeatureTitle}>Publish, collect, remember.</h3>
            <p style={styles.eventFeatureBody}>
              Academy admins publish events with a fee, capacity, and location. Students
              register + pay through the app. Attendance at the event is tracked with the
              same tool trainers use daily. Post-event certificates roll out automatically.
            </p>
            <ul style={styles.eventFeatureList}>
              <li>✓ Registration fee via Razorpay</li>
              <li>✓ Automatic reminders 24 hours before</li>
              <li>✓ Attendance tracked in the app</li>
              <li>✓ Certificates issued on completion</li>
            </ul>
          </div>
          <div style={styles.eventCardCol}>
            <MiniEventCard tag="TOURNAMENT" title="State Karate Championship 2026" date="Aug 14" location="Chennai" />
            <MiniEventCard tag="GRADING" title="Blue Belt to Brown I" date="Sep 05" location="Bangalore" />
            <MiniEventCard tag="WORKSHOP" title="Self-defense fundamentals" date="Oct 12" location="Coimbatore" />
          </div>
        </div>
      </div>
    </section>
  );
}

function MiniEventCard({ tag, title, date, location }) {
  return (
    <div style={styles.miniEvent}>
      <span style={styles.miniEventTag}>{tag}</span>
      <div style={styles.miniEventTitle}>{title}</div>
      <div style={styles.miniEventMeta}>
        <span>📅 {date}</span>
        <span>📍 {location}</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Testimonials
// ═══════════════════════════════════════════════════════════════════
function Testimonials() {
  const quotes = [
    { text: "Veerify replaced three separate tools. Attendance, fees, and belts all live in one place now. Our trainers save 5 hours a week.",
      name: "Priya R.", role: "Founder, Silambam Academy" },
    { text: "The QR certificates are a game changer for my students. Tournament organisers verify in seconds instead of asking for paperwork.",
      name: "Sensei Karthik",  role: "Karate instructor · 15 years" },
    { text: "As a parent, I finally know when my daughter attends class and when she doesn't. Payments through the app are also so much easier than cash.",
      name: "Meena V.", role: "Parent" },
  ];
  return (
    <section style={{ ...styles.section, background: BG_SOFT }}>
      <div style={styles.sectionInner}>
        <SectionHead eyebrow="Testimonials" title="Loved by academies across India." />
        <div style={styles.testimonialGrid}>
          {quotes.map((q, i) => (
            <div key={i} style={styles.testimonialCard}>
              <div style={styles.stars}>★★★★★</div>
              <p style={styles.testimonialText}>"{q.text}"</p>
              <div style={styles.testimonialFoot}>
                <div style={styles.testimonialAvatar}>{q.name[0]}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{q.name}</div>
                  <div style={{ fontSize: 11, color: MUTED }}>{q.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// FAQ
// ═══════════════════════════════════════════════════════════════════
function FAQSection() {
  const faqs = [
    { q: 'Is Veerify free for students?',
      a: 'Yes. Students only pay their academy for course fees. There is no separate cost to use the app.' },
    { q: 'How do academies pay for Veerify?',
      a: 'Academies pick a monthly, quarterly, half-yearly, or annual plan. Prices are shown on the plan selection screen after signup and range from a free trial to premium tiers.' },
    { q: 'Do subscriptions auto-renew?',
      a: 'No. You will receive a reminder before renewal and must complete a fresh payment to continue. See our Refund & Cancellation Policy for details.' },
    { q: 'What payment methods are supported?',
      a: 'All UPI apps, all major credit and debit cards, and net banking — through Razorpay\'s hosted checkout. We never see or store your card details.' },
    { q: 'How is student data protected?',
      a: 'All data is encrypted in transit with TLS 1.2+. Passwords are bcrypt-hashed. Payment credentials never touch our servers. See our Privacy Policy.' },
    { q: 'Can I delete my account?',
      a: 'Yes, any time. More → Delete Account inside the app. Personal information is immediately anonymised. See Account Deletion for details.' },
    { q: 'Does Veerify work for one-person coaching?',
      a: 'Yes. A single trainer running one batch of five students uses the same app as a 500-student multi-branch academy — just at a lower plan tier.' },
    { q: 'Which languages are supported?',
      a: 'English at launch. Tamil, Hindi, and Kannada are on the roadmap.' },
  ];
  return (
    <section id="faq" style={styles.section}>
      <div style={styles.sectionInner}>
        <SectionHead eyebrow="FAQ" title="Answers, before you ask." />
        <div style={styles.faqList}>
          {faqs.map((f, i) => <FAQItem key={i} q={f.q} a={f.a} />)}
        </div>
      </div>
    </section>
  );
}

function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={styles.faq}>
      <button
        style={styles.faqBtn}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span style={{ flex: 1, textAlign: 'left' }}>{q}</span>
        <span style={{ fontSize: 20, color: BRAND, transform: open ? 'rotate(45deg)' : 'none', transition: 'transform 200ms' }}>+</span>
      </button>
      {open ? <div style={styles.faqBody}>{a}</div> : null}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Contact CTA
// ═══════════════════════════════════════════════════════════════════
function ContactCTA() {
  return (
    <section style={{ ...styles.section, background: BRAND }}>
      <div style={{ ...styles.sectionInner, textAlign: 'center' }}>
        <h2 style={styles.ctaBigTitle}>Ready to run a better academy?</h2>
        <p style={styles.ctaBigSub}>
          Join 100+ martial-arts academies already using Veerify.
        </p>
        <div style={styles.ctaBigRow}>
          <a href="https://play.google.com/store" style={styles.ctaWhite}>
            <PlayIcon /> Download for Android
          </a>
          <a href="/contact" style={styles.ctaOutlineWhite}>Talk to us</a>
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════
function SectionHead({ eyebrow, title }) {
  return (
    <div style={{ textAlign: 'center', maxWidth: 720, margin: '0 auto 40px' }}>
      <div style={styles.eyebrow}>{eyebrow}</div>
      <h2 style={styles.sectionTitle}>{title}</h2>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 8 }}>
      <polygon points="5,3 19,12 5,21" />
    </svg>
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

// ═══════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════
const styles = {
  page: {
    background: SURFACE,
    color: TEXT,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    lineHeight: 1.6,
  },

  // Nav
  nav: {
    position: 'sticky', top: 0, zIndex: 100,
    background: 'rgba(255,255,255,0.95)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    borderBottom: `1px solid ${BORDER}`,
  },
  navInner: {
    maxWidth: 1200, margin: '0 auto', padding: '14px 20px',
    display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap',
  },
  brand: {
    display: 'flex', alignItems: 'center', gap: 10,
    textDecoration: 'none', color: TEXT,
  },
  brandLogo: {
    width: 38, height: 38, borderRadius: '50%',
    background: BRAND,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: `0 6px 18px ${BRAND}44`,
  },
  brandName: { fontSize: 18, fontWeight: 900, letterSpacing: 0.2 },
  brandTag:  { fontSize: 9,  fontWeight: 800, color: BRAND, letterSpacing: 1.4, textTransform: 'uppercase' },
  navLinks:  { display: 'flex', gap: 22, flex: 1, justifyContent: 'center', flexWrap: 'wrap' },
  navLink:   { color: MUTED, textDecoration: 'none', fontSize: 14, fontWeight: 700 },
  navCtas:   { display: 'flex', gap: 10 },
  navGhost:  {
    padding: '9px 16px', border: `1px solid ${BORDER}`,
    borderRadius: 10, color: TEXT, textDecoration: 'none',
    fontSize: 13, fontWeight: 700,
  },
  navPrimary: {
    padding: '9px 16px', borderRadius: 10, background: BRAND, color: '#fff',
    textDecoration: 'none', fontSize: 13, fontWeight: 800,
    boxShadow: `0 6px 18px ${BRAND}44`,
  },

  // Hero
  hero: { background: `linear-gradient(180deg, ${BRAND_SOFT} 0%, #FFFFFF 100%)` },
  heroInner: {
    maxWidth: 1200, margin: '0 auto',
    padding: 'clamp(40px, 8vw, 96px) 20px',
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: 48, alignItems: 'center',
  },
  heroLeft: { maxWidth: 560 },
  heroPill: {
    display: 'inline-block', padding: '6px 14px', borderRadius: 999,
    background: '#FFE4E6', color: BRAND_DARK, fontSize: 11, fontWeight: 800,
    letterSpacing: 1, marginBottom: 18,
  },
  heroTitle: {
    fontSize: 'clamp(32px, 5vw, 56px)',
    fontWeight: 900, lineHeight: 1.05, margin: '0 0 18px',
    letterSpacing: -1,
  },
  heroSub: { fontSize: 17, color: MUTED, margin: '0 0 28px' },
  heroCtas: { display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 32 },
  ctaPrimary: {
    display: 'inline-flex', alignItems: 'center', padding: '13px 22px',
    borderRadius: 12, background: BRAND, color: '#fff',
    textDecoration: 'none', fontSize: 14, fontWeight: 800,
    boxShadow: `0 10px 30px ${BRAND}55`,
  },
  ctaGhost: {
    display: 'inline-flex', alignItems: 'center', padding: '13px 22px',
    borderRadius: 12, border: `1px solid ${BORDER}`,
    color: TEXT, textDecoration: 'none', fontSize: 14, fontWeight: 700,
  },
  heroStats: { display: 'flex', gap: 40, flexWrap: 'wrap' },
  heroRight: { display: 'flex', justifyContent: 'center' },

  // Phone mockup
  phoneWrap: { position: 'relative', width: 260, height: 520 },
  phoneShadow: {
    position: 'absolute', inset: 0,
    background: `radial-gradient(circle, ${BRAND}33 0%, transparent 70%)`,
    filter: 'blur(40px)',
  },
  phone: {
    position: 'relative', width: 260, height: 520,
    background: '#1F2937',
    borderRadius: 42, padding: 8,
    boxShadow: '0 30px 60px rgba(15,23,42,0.4), inset 0 0 0 2px #374151',
  },
  phoneNotch: {
    position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)',
    width: 90, height: 22, borderRadius: 12,
    background: '#000', zIndex: 2,
  },
  phoneScreen: {
    width: '100%', height: '100%',
    background: '#F5F3FF',
    borderRadius: 34,
    padding: 16, paddingTop: 44,
    overflow: 'hidden',
  },
  mockHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 },
  mockAvatar: {
    width: 34, height: 34, borderRadius: 17, background: BRAND,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#fff', fontWeight: 900, fontSize: 14,
  },
  mockCard: {
    background: '#fff', borderRadius: 14, padding: 14, marginBottom: 12,
    boxShadow: '0 4px 12px rgba(15,23,42,0.04)',
  },
  mockBar: { marginTop: 10, height: 6, background: '#F3F4F6', borderRadius: 3, overflow: 'hidden' },
  mockBarFill: { height: '100%', background: BRAND, borderRadius: 3 },
  mockGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 },
  mockTile: { background: '#fff', borderRadius: 12, padding: 12,
    boxShadow: '0 4px 12px rgba(15,23,42,0.04)', textAlign: 'center' },
  mockList: { background: '#fff', borderRadius: 12, padding: 10,
    boxShadow: '0 4px 12px rgba(15,23,42,0.04)' },
  mockRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' },
  mockDot: { width: 8, height: 8, borderRadius: 4 },

  // Trust strip
  trustStrip: { background: BG_SOFT, borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` },
  trustInner: {
    maxWidth: 1200, margin: '0 auto', padding: '24px 20px',
    display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
  },
  trustLabel: { fontSize: 12, fontWeight: 800, color: MUTED, letterSpacing: 1, textTransform: 'uppercase' },
  trustSkills: { display: 'flex', gap: 8, flexWrap: 'wrap', flex: 1 },
  trustSkill: {
    fontSize: 12, fontWeight: 700, color: TEXT,
    background: '#fff', padding: '6px 12px',
    borderRadius: 999, border: `1px solid ${BORDER}`,
  },

  // Sections
  section: { padding: 'clamp(60px, 10vw, 100px) 0' },
  sectionInner: { maxWidth: 1200, margin: '0 auto', padding: '0 20px' },
  eyebrow: { fontSize: 12, fontWeight: 800, color: BRAND, letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 12 },
  sectionTitle: {
    fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 900,
    color: TEXT, margin: 0, letterSpacing: -0.5,
  },
  sectionLead: { textAlign: 'center', fontSize: 16, color: MUTED, maxWidth: 720, margin: '0 auto 40px' },

  // Features
  featureGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 20,
  },
  featureCard: {
    background: '#fff', border: `1px solid ${BORDER}`,
    borderRadius: 16, padding: 24,
    transition: 'all 200ms',
  },
  featureIcon: { fontSize: 32, marginBottom: 12 },
  featureTitle: { fontSize: 16, fontWeight: 800, color: TEXT, margin: '0 0 8px' },
  featureBody:  { fontSize: 14, color: MUTED, margin: 0, lineHeight: 1.55 },

  // Benefits
  benefitGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: 20,
  },
  benefitCard: {
    background: '#fff', borderRadius: 16, padding: 28,
    position: 'relative', overflow: 'hidden',
    boxShadow: '0 4px 12px rgba(15,23,42,0.04)',
  },
  benefitAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 4 },
  benefitTitle: { fontSize: 18, fontWeight: 900, margin: '4px 0 16px' },
  benefitList:  { listStyle: 'none', padding: 0, margin: 0 },
  benefitLi: {
    display: 'flex', alignItems: 'flex-start', gap: 8,
    padding: '6px 0', fontSize: 14, color: TEXT,
  },
  benefitCheck: { fontWeight: 900, marginTop: 1 },

  // How it works
  stepGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 24,
  },
  stepCard: { textAlign: 'center', padding: 20 },
  stepBubble: {
    width: 64, height: 64, borderRadius: '50%',
    background: BRAND, color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 24, fontWeight: 900,
    margin: '0 auto 18px',
    boxShadow: `0 10px 25px ${BRAND}55`,
  },
  stepTitle: { fontSize: 17, fontWeight: 800, color: TEXT, margin: '0 0 8px' },
  stepBody:  { fontSize: 14, color: MUTED, margin: 0 },

  // Courses
  courseGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 14, marginBottom: 40,
  },
  courseCard: {
    background: '#fff', border: `1px solid ${BORDER}`,
    borderRadius: 14, padding: 20, textAlign: 'center',
    textDecoration: 'none', transition: 'all 200ms',
  },
  courseEmoji: { fontSize: 36, marginBottom: 8 },
  courseName:  { fontSize: 15, fontWeight: 800, color: TEXT, marginBottom: 2 },
  courseCount: { fontSize: 11, color: MUTED, fontWeight: 600 },
  certRow: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: 20, marginTop: 20,
  },
  certCard: {
    background: '#fff', border: `1px solid ${BORDER}`,
    borderRadius: 16, padding: 28,
  },
  certTitle: { fontSize: 18, fontWeight: 900, color: TEXT, margin: '0 0 10px' },
  certBody:  { fontSize: 14, color: MUTED, margin: 0, lineHeight: 1.6 },

  // Events
  eventGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 32, alignItems: 'center',
  },
  eventFeature: {},
  eventFeatureTitle: { fontSize: 24, fontWeight: 900, color: TEXT, margin: '0 0 12px' },
  eventFeatureBody:  { fontSize: 15, color: MUTED, marginBottom: 20 },
  eventFeatureList:  { listStyle: 'none', padding: 0, margin: 0, fontSize: 14, color: TEXT, lineHeight: 2 },
  eventCardCol: { display: 'flex', flexDirection: 'column', gap: 14 },
  miniEvent: {
    background: '#fff', border: `1px solid ${BORDER}`,
    borderRadius: 12, padding: 18,
    boxShadow: '0 4px 12px rgba(15,23,42,0.04)',
  },
  miniEventTag: {
    display: 'inline-block', padding: '3px 10px', borderRadius: 999,
    background: BRAND_SOFT, color: BRAND, fontSize: 10, fontWeight: 900,
    letterSpacing: 1, marginBottom: 8,
  },
  miniEventTitle: { fontSize: 15, fontWeight: 800, color: TEXT, marginBottom: 6 },
  miniEventMeta:  { display: 'flex', gap: 16, fontSize: 12, color: MUTED, fontWeight: 600 },

  // Testimonials
  testimonialGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 20,
  },
  testimonialCard: {
    background: '#fff', borderRadius: 16, padding: 24,
    boxShadow: '0 4px 12px rgba(15,23,42,0.04)',
  },
  stars: { color: '#F59E0B', fontSize: 16, marginBottom: 12, letterSpacing: 2 },
  testimonialText: { fontSize: 15, color: TEXT, lineHeight: 1.6, margin: '0 0 18px', fontStyle: 'italic' },
  testimonialFoot: { display: 'flex', alignItems: 'center', gap: 12 },
  testimonialAvatar: {
    width: 40, height: 40, borderRadius: 20, background: BRAND,
    color: '#fff', fontWeight: 900, fontSize: 16,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },

  // FAQ
  faqList: { maxWidth: 780, margin: '0 auto' },
  faq: {
    background: '#fff', border: `1px solid ${BORDER}`,
    borderRadius: 12, marginBottom: 10, overflow: 'hidden',
  },
  faqBtn: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 12,
    padding: '16px 20px', background: 'transparent',
    border: 'none', cursor: 'pointer',
    fontSize: 15, fontWeight: 700, color: TEXT,
    fontFamily: 'inherit',
  },
  faqBody: {
    padding: '0 20px 18px', fontSize: 14, color: MUTED, lineHeight: 1.6,
  },

  // Big CTA
  ctaBigTitle: {
    fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 900,
    color: '#fff', margin: '0 0 12px', letterSpacing: -0.5,
  },
  ctaBigSub: { fontSize: 17, color: 'rgba(255,255,255,0.9)', margin: '0 0 32px' },
  ctaBigRow: { display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' },
  ctaWhite: {
    display: 'inline-flex', alignItems: 'center', padding: '14px 24px',
    borderRadius: 12, background: '#fff', color: BRAND,
    textDecoration: 'none', fontSize: 14, fontWeight: 800,
  },
  ctaOutlineWhite: {
    display: 'inline-flex', alignItems: 'center', padding: '14px 24px',
    borderRadius: 12, border: '1.5px solid rgba(255,255,255,0.5)',
    color: '#fff', textDecoration: 'none', fontSize: 14, fontWeight: 700,
  },
};
