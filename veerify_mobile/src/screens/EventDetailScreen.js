// src/screens/EventDetailScreen.js
//
// Shared event detail view — used by admin EventsList, trainer
// dashboard, and student MyDashboard / HomeTab. The whole event row is
// passed in via route params so the screen renders instantly without
// another network round-trip. (mobile_events is small enough that the
// list response already carries every field we render here.)
//
// Sections (top to bottom):
//   1. Hero banner (if image_url) with title overlay
//   2. Date + location chips
//   3. Long description
//   4. "Open link" CTA (if link is set — registration form, ticket page,
//      Google Meet, etc.)
//   5. Status pill — Live / Past
//
// Route params:
//   event   the full event row (or at least { title, event_date })

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Image, ScrollView, TouchableOpacity, Linking, StyleSheet,
  ActivityIndicator, Alert, AppState,
} from 'react-native';
import {
  ArrowLeft, Calendar, MapPin, Clock, ExternalLink,
  CheckCircle2, Share2, CreditCard, AlertCircle, RefreshCw,
} from 'lucide-react-native';

import apiClient from '../api/client';
import { useAuth } from '../context/AuthContext';
import resolveAssetUrl from '../utils/assetUrl';
import { confirm } from '../components/ConfirmDialog';
import CourseImage from '../components/CourseImage';

// Polling budget after the payer returns from the Razorpay browser.
// The webhook usually lands in 3-5s; 30s gives slow networks room
// without leaving the payer staring forever.
const POLL_INTERVAL_MS = 2500;
const POLL_MAX_MS      = 30_000;

const BRAND       = '#E63946';
const BRAND_SOFT  = '#FFE4E6';
const TEXT        = '#111827';
const TEXT_MUTED  = '#6B7280';
const TEXT_LIGHT  = '#9CA3AF';
const SURFACE     = '#FFFFFF';
const BG          = '#F4F4F8';
const BORDER      = '#E5E7EB';
const GREEN       = '#10B981';
const AMBER       = '#F59E0B';

// "Mon, 22 Jun 2026" — long-form display used in the detail card.
function formatFullDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  });
}

// End-of-day LOCAL timestamp for the given date value.
//
// The registration_closing_date column is a DATE (no time). Naive
// `new Date('2026-08-25').getTime()` returns UTC midnight, which is
// 5:30 AM IST — so a plain "<" comparison would flip the button to
// "Registration Closed" at 5:30 AM on the closing day, five hours
// EARLIER than the organiser expected. This helper parses date-only
// strings as end-of-day local (23:59:59.999) so "closes today" reads
// as "open until 11:59 PM tonight; closed at 12:00 AM tomorrow".
// Values that already carry a time component are returned as-is.
function endOfDayLocalMs(input) {
  if (!input) return null;
  // Case 1: plain 'YYYY-MM-DD' — build a local Date directly.
  const s = String(input);
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.slice(0, 10));
  if (dm && s.length <= 10) {
    return new Date(
      Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]),
      23, 59, 59, 999,
    ).getTime();
  }
  // Parse whatever we got — node-postgres serialises DATE columns as
  // JS Date at UTC midnight, which JSON.stringify() renders as an ISO
  // string like '2026-08-25T00:00:00.000Z'. That parses back to UTC
  // midnight → 5:30 AM IST → makes the deadline hit five hours EARLY.
  // Detect UTC-midnight ISOs and reinterpret them as end-of-day LOCAL
  // on the same calendar day. Real ISO timestamps that carry a
  // non-zero UTC time part are honoured verbatim.
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  // Postgres DATE columns get serialised as ISO strings, but the
  // exact ISO string depends on the backend process's TZ:
  //   • Backend in UTC     → '2026-08-25T00:00:00.000Z'
  //   • Backend in IST     → '2026-08-24T18:30:00.000Z' (Aug 25 midnight IST)
  // Neither carries a real time — they're both "just the calendar
  // day". We detect both cases by asking whether the parsed Date
  // lands on midnight in EITHER local time OR UTC. In either case
  // we reinterpret as end-of-day LOCAL on that calendar day so the
  // window matches organiser intent (open until 11:59 PM local).
  const isLocalMidnight =
    d.getHours() === 0 && d.getMinutes() === 0 &&
    d.getSeconds() === 0 && d.getMilliseconds() === 0;
  if (isLocalMidnight) {
    return new Date(
      d.getFullYear(), d.getMonth(), d.getDate(),
      23, 59, 59, 999,
    ).getTime();
  }
  const isUtcMidnight =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0;
  if (isUtcMidnight) {
    return new Date(
      d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
      23, 59, 59, 999,
    ).getTime();
  }
  return d.getTime();
}

// "HH:MM" 24h → "h:mm AM/PM" for the Event Time meta row.
function formatTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = String(hhmm).split(':').map((n) => parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export default function EventDetailScreen({ route, navigation }) {
  // Local mirror of the event so we can flip has_paid to true after a
  // successful pay round-trip without needing the caller screen to
  // refetch.
  const [event, setEvent] = useState(route?.params?.event || {});
  // Auth context — used to decide whether the "Register Students"
  // button should render (only Institution admins can select their
  // own students; students / trainers / parents see the event
  // details but not the organizer flow).
  const { user, institution } = useAuth();

  // Authoritative registration status. The event object passed in
  // via route params comes from whichever list screen navigated
  // here — some of those lists were built before the backend added
  // registration_enabled to their SELECT lists, so the flag can
  // arrive as undefined. Fetching /registration-form here gives us
  // a trustworthy boolean + the current field count without waiting
  // on a client rebuild.
  // fieldList holds the full { label, type, required, options,
  // sourceType, sourceKey } array so the Registration Form section
  // below can render every field dynamically — no hardcoded list.
  // fieldList holds the registration-form fields (used only for the
  // count summary now). categories holds the event's saved
  // Categories & Skills tree — the same endpoint returns it, so we
  // pull it as a fallback for callers whose list feed sent a thin
  // event object without categories.
  const [regStatus, setRegStatus] = useState({
    loading: true, enabled: false, fields: 0, fieldList: [], categories: [],
  });
  useEffect(() => {
    let cancelled = false;
    if (!event?.id) {
      setRegStatus({ loading: false, enabled: false, fields: 0, fieldList: [], categories: [] });
      return;
    }
    apiClient.get(`/events/${event.id}/registration-form`)
      .then((r) => {
        if (cancelled) return;
        const fields = Array.isArray(r.data?.fields) ? r.data.fields : [];
        const cats   = Array.isArray(r.data?.categories) ? r.data.categories : [];
        setRegStatus({
          loading:    false,
          enabled:    !!r.data?.enabled,
          fields:     fields.length,
          fieldList:  fields,
          categories: cats,
        });
      })
      .catch(() => {
        if (cancelled) return;
        // Endpoint may 404 on very old rows or when the caller isn't
        // authed to that specific event — default to disabled so the
        // button silently hides rather than crashing the screen.
        setRegStatus({ loading: false, enabled: false, fields: 0, fieldList: [], categories: [] });
      });
    return () => { cancelled = true; };
  }, [event?.id]);
  const [paying, setPaying] = useState(false);

  // ── Student "Are you interested to participate?" ──────────────
  // Only meaningful for the student role — every other role sees
  // its own set of CTAs (Register / Registered Students / Pay).
  // `interest` is a tri-state: null = never answered, true = Yes,
  // false = No. Persisted server-side via /events/:id/my-interest
  // so the student's answer follows them to any device and drives
  // the highlight on the institution's Select Students screen.
  const [interest, setInterest] = useState(null);
  const [interestSaving, setInterestSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const role = String(user?.role || '').toLowerCase();
    if (role !== 'student' || !event?.id) return undefined;
    apiClient.get(`/events/${event.id}/my-interest`)
      .then((r) => { if (!cancelled) setInterest(r.data?.interested ?? null); })
      .catch(() => { /* soft-fail — the picker just renders neutral */ });
    return () => { cancelled = true; };
  }, [event?.id, user?.role]);
  const submitInterest = async (value) => {
    if (interestSaving) return;
    setInterestSaving(true);
    // Optimistic UI — flip immediately so the tap feels
    // instantaneous, roll back on error.
    const prev = interest;
    setInterest(value);
    try {
      await apiClient.put(`/events/${event.id}/my-interest`, { interested: !!value });
    } catch (err) {
      setInterest(prev);
      const msg = err?.response?.data?.message || err?.message || 'Please try again.';
      confirm({ title: 'Could not save', message: msg, variant: 'destructive', confirmText: 'OK', hideCancel: true });
    } finally {
      setInterestSaving(false);
    }
  };

  // Payment lifecycle stage — drives the CTA render tree:
  //   'idle'      → show Pay Now
  //   'awaiting'  → payer is in the Razorpay browser
  //   'verifying' → polling backend for webhook flip
  //   'pending'   → poll timed out / payer returned unpaid; retry available
  //   'failed'    → poll saw an explicit 'failed' status
  //   'done'      → server confirmed 'paid'; badge shows Paid
  const [stage, setStage] = useState('idle');
  const pollTimer   = useRef(null);
  const pollStart   = useRef(0);
  const appStateSub = useRef(null);
  const sentToRzp   = useRef(false);

  // ── Cleanup ───────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (pollTimer.current)  clearTimeout(pollTimer.current);
      if (appStateSub.current) appStateSub.current.remove();
    };
  }, []);

  // ── Poll the server for the webhook's payment flip ───────────────
  // We NEVER mark the row paid client-side. The only path from
  // pending → paid is the signed webhook flipping event_payments on
  // the server, which this endpoint reads back.
  const pollPaymentStatus = async () => {
    if (!event?.id) return;
    try {
      const r = await apiClient.get(
        `/institutions/events/${event.id}/payment-status`,
      );
      const s = r.data?.status;
      if (s === 'paid') {
        setEvent((e) => ({ ...e, has_paid: true }));
        setStage('done');
        return;
      }
      if (s === 'failed') {
        setStage('failed');
        return;
      }
    } catch (err) {
      // Swallow — keep polling; a transient 500 shouldn't abort the loop.
      // eslint-disable-next-line no-console
      console.log('[EventPay] poll error:', err?.message);
    }
    if (Date.now() - pollStart.current < POLL_MAX_MS) {
      pollTimer.current = setTimeout(pollPaymentStatus, POLL_INTERVAL_MS);
    } else {
      setStage('pending');
    }
  };

  const startPolling = () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollStart.current = Date.now();
    setStage('verifying');
    // Small initial delay so the webhook can race the return-to-app.
    pollTimer.current = setTimeout(pollPaymentStatus, 800);
  };

  // Detect the payer coming back from Razorpay's hosted page and
  // kick off polling. The Payment Link page doesn't deep-link back
  // into the RN app, so AppState 'active' is our best signal.
  useEffect(() => {
    if (!sentToRzp.current) return;
    const handleChange = (next) => {
      if (next === 'active' && sentToRzp.current) {
        sentToRzp.current = false;
        startPolling();
      }
    };
    appStateSub.current = AppState.addEventListener('change', handleChange);
    return () => { if (appStateSub.current) appStateSub.current.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // Manual "check status" from the Pending state — hits the same
  // endpoint once so the payer doesn't have to wait for a tick.
  const recheckStatus = async () => {
    if (!event?.id) return;
    setStage('verifying');
    try {
      const r = await apiClient.get(
        `/institutions/events/${event.id}/payment-status`,
      );
      const s = r.data?.status;
      if (s === 'paid') {
        setEvent((e) => ({ ...e, has_paid: true }));
        setStage('done');
      } else if (s === 'failed') {
        setStage('failed');
      } else {
        setStage('pending');
      }
    } catch (_) {
      setStage('pending');
    }
  };

  const isPast = event.status === 'past'
    || (event.event_date && new Date(event.event_date) < new Date(new Date().toDateString()));

  const eventDate = event.event_date ? new Date(event.event_date) : null;
  const day = eventDate ? String(eventDate.getDate()).padStart(2, '0') : '--';
  const mon = eventDate ? eventDate.toLocaleString('en-US', { month: 'short' }).toUpperCase() : '---';

  const openLink = () => {
    if (!event.link) return;
    Linking.openURL(event.link).catch(() => {});
  };

  // ── Pay Now ────────────────────────────────────────────────────────
  //
  // Contract: never marks paid client-side. Only:
  //   1. Ask backend to mint (or reuse) a Razorpay Payment Link.
  //   2. If server already sees the row as paid (webhook landed
  //      earlier), flip to 'done' — server is source of truth.
  //   3. Otherwise open the Payment Link in the OS browser and
  //      enter 'awaiting'. The AppState listener starts polling
  //      the moment the payer returns to Veerify.
  //   4. Poll → 'paid' → 'done'; poll timeout → 'pending' with
  //      Retry Payment; poll → 'failed' → 'failed' with Retry.
  //
  // No mock/fake-success fallback — if the gateway isn't configured
  // we surface a real error. Nothing gets "Registered" without a
  // server-verified payment.
  const payForEvent = async () => {
    if (paying) return;
    if (!event?.id) return;

    setPaying(true);
    try {
      const res = await apiClient.post(`/institutions/events/${event.id}/pay`);
      if (res.data?.already_paid) {
        setEvent((e) => ({ ...e, has_paid: true }));
        setStage('done');
        return;
      }
      const url = res.data?.short_url;
      if (!url) {
        throw new Error('Payment link is missing from the server response.');
      }
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        throw new Error('This device cannot open the payment page.');
      }
      sentToRzp.current = true;
      setStage('awaiting');
      await Linking.openURL(url);
    } catch (err) {
      const msg =
        err.response?.data?.message ||
        err.message ||
        'We could not start the payment. Your registration is still Pending — you can retry any time.';
      confirm({
        title:       'Payment could not start',
        message:     msg,
        variant:     'destructive',
        confirmText: 'Got it',
        hideCancel:  true,
      });
      setStage('idle');
      sentToRzp.current = false;
    } finally {
      setPaying(false);
    }
  };

  return (
    <View style={styles.screen}>
      {/* ───── Header ───── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} activeOpacity={0.7}>
          <ArrowLeft size={20} color={TEXT} strokeWidth={2.2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Event</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero banner — contain-fit so the full event poster shows
            without cropping (e.g. tall Instagram-format flyers). */}
        <CourseImage
          uri={event.image_url}
          width="100%"
          height={200}
          radius={0}
          fit="contain"
          icon="image"
          style={{ backgroundColor: BRAND_SOFT }}
        />

        {/* Title block — overlaps the banner with a card lift */}
        <View style={styles.titleCard}>
          <View style={styles.titleRow}>
            <View style={[styles.dateBlock, isPast ? styles.dateBlockPast : styles.dateBlockLive]}>
              <Text style={[styles.dateDay, { color: isPast ? TEXT_MUTED : BRAND }]}>{day}</Text>
              <Text style={[styles.dateMonth, { color: isPast ? TEXT_MUTED : BRAND }]}>{mon}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{event.title || 'Event'}</Text>
              {event.subtitle ? (
                <Text style={styles.subtitle}>{event.subtitle}</Text>
              ) : null}
              {/* Organizer credit — surfaces the submitting academy
                  name whenever it's available. Broad predicate so it
                  works whether the caller passed `organizing_institution_name`
                  (new field), `institution_name` (older field), and
                  for both event_type='intra' and rows whose backend
                  source flag has already been resolved to 'global'.
                  Never hard-coded — always sourced from the event
                  row's own institution name. */}
              {(() => {
                const org =
                  event.organizing_institution_name ||
                  event.institution_name ||
                  null;
                const isGlobalish =
                  event.event_type === 'intra' ||
                  event.source === 'global';
                if (!org || !isGlobalish) return null;
                return (
                  <Text style={{ fontSize: 12, color: BRAND, fontWeight: '700', marginTop: 4 }}>
                    Organized by {org}
                  </Text>
                );
              })()}
            </View>
          </View>

          {/* Status pill + Level pill. The stored event_type is
              inverted from the UI label (the admin's "Inter-Level
              Event" tile sends eventType='intra'). We flip the
              display so the pill reads what the organiser saw
              when creating the event. */}
          <View style={styles.pillRow}>
            <View style={[
              styles.statusPill,
              isPast ? { backgroundColor: '#F1F5F9' } : { backgroundColor: GREEN + '22' },
            ]}>
              {isPast ? (
                <Clock size={11} color={TEXT_MUTED} strokeWidth={2.4} />
              ) : (
                <CheckCircle2 size={11} color={GREEN} strokeWidth={2.4} />
              )}
              <Text style={[styles.statusText, { color: isPast ? TEXT_MUTED : GREEN }]}>
                {isPast ? 'Past event' : 'Upcoming'}
              </Text>
            </View>
            {event.event_type === 'intra' || event.event_type === 'inter' ? (
              <View style={[
                styles.statusPill,
                event.event_type === 'inter'
                  ? { backgroundColor: '#EDE9FE' }
                  : { backgroundColor: '#DBEAFE' },
              ]}>
                <Text style={[
                  styles.statusText,
                  { color: event.event_type === 'inter' ? '#6D28D9' : '#1E40AF' },
                ]}>
                  {event.event_type === 'inter' ? 'INTRA-LEVEL' : 'INTER-LEVEL'}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Meta facts — date / time / location / registration cut-off */}
        <View style={styles.metaCard}>
          <MetaRow
            icon={Calendar}
            label="Date"
            value={formatFullDate(event.event_date)}
          />
          {/* Event Time — captured on the Create Event form. Rendered
              right after Date so "when" reads as one grouped block. */}
          {event.event_time ? (
            <>
              <Divider />
              <MetaRow
                icon={Clock}
                label="Time"
                value={formatTime(event.event_time)}
              />
            </>
          ) : null}
          {event.registration_closing_date ? (
            <>
              <Divider />
              <MetaRow
                icon={Clock}
                label="Registration closes"
                // Clarify the exact cutoff for the organiser and the
                // person registering — we allow submissions all day on
                // the closing date and shut off at midnight local.
                value={`${formatFullDate(event.registration_closing_date)} · 11:59 PM`}
              />
            </>
          ) : null}
          {event.location ? (
            <>
              <Divider />
              <MetaRow
                icon={MapPin}
                label="Location"
                value={event.location}
              />
            </>
          ) : null}
          {/* Location Link — the URL captured on the create form as
              `link`. Renders as a tappable row when set so the viewer
              can jump straight to a map / registration URL. */}
          {event.link ? (
            <>
              <Divider />
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => {
                  const url = String(event.link).trim();
                  if (!url) return;
                  Linking.openURL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
                    .catch(() => { /* silent — some devices refuse odd schemes */ });
                }}
              >
                <MetaRow
                  icon={ExternalLink}
                  label="Location link"
                  value={event.link}
                />
              </TouchableOpacity>
            </>
          ) : null}
        </View>

        {/* Description */}
        {event.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About this event</Text>
            <Text style={styles.body}>{event.description}</Text>
          </View>
        ) : null}

        {/* ── Categories & Skills ─────────────────────────────────
            Every eligibility bucket (Junior / Senior / custom) the
            organiser authored on the Create Event form, with the
            per-skill age range. Rendered whenever the event carries
            at least one populated skill regardless of viewer role
            so cross-institution admins see the same info as the
            owner. Silent when the event has no categories. */}
        {(() => {
          // Categories can arrive from two sources — the event blob
          // itself (populated by the calling list endpoint) or the
          // freshly-fetched registration-form endpoint (which also
          // ships the event's own categories block). We prefer
          // whichever source has actual populated skills so a thin
          // list-payload never hides the Categories & Skills section
          // when the data is really there in the DB.
          const fromEvent = Array.isArray(event.categories) ? event.categories : [];
          const fromForm  = Array.isArray(regStatus.categories) ? regStatus.categories : [];
          let categories = fromEvent;
          const hasEventSkills = fromEvent.some((c) => (c?.skills || []).length > 0);
          const hasFormSkills  = fromForm.some((c) => (c?.skills || []).length > 0);
          if (!hasEventSkills && hasFormSkills) categories = fromForm;
          const hasSkills = categories.some((c) => (c?.skills || []).length > 0);
          if (!hasSkills) return null;
          return (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Categories &amp; Skills</Text>
              {categories.map((cat, ci) => {
                const skills = Array.isArray(cat?.skills) ? cat.skills : [];
                if (skills.length === 0) return null;
                return (
                  <View key={ci} style={styles.catBlock}>
                    <View style={styles.catHeader}>
                      <View style={styles.catBadge}>
                        <Text style={styles.catBadgeText}>{ci + 1}</Text>
                      </View>
                      <Text style={styles.catName}>{cat.name || `Category ${ci + 1}`}</Text>
                      {/* Gender pill — either 'Male' or 'Female' as
                          persisted in the categories JSONB. Silent on
                          older rows that predate the gender field. */}
                      {cat?.gender ? (
                        <View style={styles.genderPill}>
                          <Text style={styles.genderPillText}>{cat.gender}</Text>
                        </View>
                      ) : null}
                    </View>
                    {skills.map((sk, si) => {
                      const name = sk?.name || 'Unnamed';
                      const from = sk?.age_from;
                      const to   = sk?.age_to;
                      const hasAge = from != null || to != null;
                      const divisions = Array.isArray(sk?.divisions) ? sk.divisions : [];
                      return (
                        <View key={si} style={styles.skillCell}>
                          <View style={styles.skillRow}>
                            <Text style={styles.skillIndex}>{si + 1}.</Text>
                            <Text style={styles.skillName} numberOfLines={1}>{name}</Text>
                            {hasAge ? (
                              <Text style={styles.skillAge}>
                                Age {from ?? '—'} – {to ?? '—'}
                              </Text>
                            ) : null}
                          </View>
                          {/* Divisions — free-text tags authored per
                              skill (e.g. Karate → Division A, B, C).
                              Rendered as compact chips beneath the
                              skill row. Silent when the skill has
                              none. */}
                          {divisions.length > 0 ? (
                            <View style={styles.divisionRow}>
                              {divisions.map((d, di) => (
                                <View key={di} style={styles.divisionChip}>
                                  <Text style={styles.divisionText}>{d?.name || ''}</Text>
                                </View>
                              ))}
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          );
        })()}

        {/* ── Registration Form (summary only) ─────────────────────
            The Event Detail screen shows ONLY the count of fields
            configured on the registration form — never the fields
            themselves. The actual form (defaults + custom fields +
            declaration) still renders when the operator taps
            "Register Students" and reaches EventRegistrationFormScreen.
            Hidden entirely when the organiser didn't turn
            registration on. */}
        {regStatus.enabled && regStatus.fieldList.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Registration Form</Text>
            <Text style={styles.body}>
              {`Registration Form: ${regStatus.fieldList.length} Field${regStatus.fieldList.length === 1 ? '' : 's'}`}
            </Text>
            <Text style={[styles.body, { color: TEXT_MUTED, marginTop: 4 }]}>
              The fields open when you tap Register Students.
            </Text>
          </View>
        ) : null}

        {/* Payment CTA — only when the admin turned on Payment Required
            AND the event isn't already past. The rendered block
            depends on the payment lifecycle stage:
              • 'done' or event.has_paid → Paid badge, registration
                complete, no CTA.
              • 'awaiting' or 'verifying' → progress card so the payer
                sees us confirming with Razorpay after their return.
                Never flips to registered until the webhook lands.
              • 'pending' or 'failed' → status card + Retry Payment.
              • 'idle' → the primary Pay Now CTA. */}
        {event.payment_required && !isPast ? (
          (stage === 'done' || event.has_paid) ? (
            <View style={styles.paidBadge}>
              <CheckCircle2 size={16} color={GREEN} strokeWidth={2.4} />
              <Text style={styles.paidBadgeText}>
                Paid — you're registered for this event.
              </Text>
            </View>
          ) : (stage === 'awaiting' || stage === 'verifying') ? (
            <View style={styles.verifyingCard}>
              <ActivityIndicator color={BRAND} />
              <View style={{ flex: 1 }}>
                <Text style={styles.verifyingTitle}>
                  {stage === 'awaiting' ? 'Waiting for payment…' : 'Verifying payment…'}
                </Text>
                <Text style={styles.verifyingSub}>
                  {stage === 'awaiting'
                    ? 'Complete the payment in your browser, then return to Veerify.'
                    : "We're confirming with Razorpay. This usually takes a few seconds."}
                </Text>
              </View>
            </View>
          ) : (stage === 'pending' || stage === 'failed') ? (
            <View style={styles.pendingCard}>
              <View style={styles.pendingHead}>
                <AlertCircle size={20} color={AMBER} strokeWidth={2.2} />
                <Text style={styles.pendingTitle}>
                  {stage === 'failed' ? 'Payment failed' : 'Payment pending'}
                </Text>
              </View>
              <Text style={styles.pendingSub}>
                Your registration is saved as{' '}
                <Text style={{ fontWeight: '800' }}>Pending Payment</Text>{' '}
                and not yet active. If you already paid, tap Check again — the
                confirmation may still be on its way.
              </Text>
              <View style={styles.pendingBtnRow}>
                <TouchableOpacity
                  style={[styles.retryBtnGhost]}
                  onPress={recheckStatus}
                  activeOpacity={0.85}
                >
                  <RefreshCw size={14} color={TEXT} strokeWidth={2.4} />
                  <Text style={styles.retryBtnGhostText}>Check again</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.retryBtn, paying && { opacity: 0.7 }]}
                  onPress={payForEvent}
                  disabled={paying}
                  activeOpacity={0.85}
                >
                  {paying ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <CreditCard size={14} color="#fff" strokeWidth={2.4} />
                      <Text style={styles.retryBtnText}>Retry payment</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.payBtn, paying && { opacity: 0.7 }]}
              onPress={payForEvent}
              disabled={paying}
              activeOpacity={0.85}
            >
              {paying ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <CreditCard size={16} color="#fff" strokeWidth={2.4} />
                  <Text style={styles.payBtnText}>
                    Pay ₹{Number(event.payment_amount || 0).toLocaleString('en-IN')} · Pay Now
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )
        ) : null}

        {/* ── MODULE 2: Register Students CTA ──
            Shown to Institution admins ONLY when the event has
            registration enabled and (per the deadline check below)
            the registration window is still open. The button
            navigates to SelectStudentsForEventScreen which then
            gates on the same conditions server-side. */}
        {(() => {
          // Show for anyone whose role isn't clearly a student /
          // trainer / parent — the server-side check on the
          // Select Students endpoint is the final authority, and
          // this way the button never gets accidentally hidden
          // because a role string arrived in an unexpected case.
          const role = String(user?.role || '').toLowerCase();
          const nonAdminRoles = new Set(['student', 'trainer', 'staff', 'parent']);
          const isAdminish = user && !nonAdminRoles.has(role);
          // Registration status comes from the authoritative
          // /events/:id/registration-form fetch above; falls back
          // to the flag on the passed event object if the fetch is
          // still in flight, so admins never see a flicker.
          const regEnabled = regStatus.enabled || !!event.registration_enabled;
          if (!isAdminish || regStatus.loading || !regEnabled) return null;
          // Deadline is end-of-day LOCAL on the closing date. A
          // stored value like '2026-08-25' means "registration is
          // open until 2026-08-25 23:59:59.999 local" and closes at
          // 00:00 the next day — matches how organisers think about
          // the field. When the raw value already carries a time
          // component we honour it verbatim.
          const deadlineMs = endOfDayLocalMs(event.registration_closing_date)
            ?? (event.event_date ? endOfDayLocalMs(event.event_date) : null);
          const closed = deadlineMs != null && deadlineMs < Date.now();
          return (
            <TouchableOpacity
              style={[
                styles.linkBtn,
                { backgroundColor: closed ? '#94A3B8' : '#0F172A' },
              ]}
              activeOpacity={0.85}
              disabled={closed}
              onPress={() => navigation.navigate('SelectStudentsForEvent', {
                eventId:    event.id,
                eventTitle: event.title || 'Event',
                registrationClosingDate: event.registration_closing_date,
              })}
            >
              <Text style={styles.linkBtnText}>
                {closed ? 'Registration Closed' : 'Register Students'}
              </Text>
            </TouchableOpacity>
          );
        })()}

        {/* ── Registered Students CTA ─────────────────────────────
            Institution admins can review + export their OWN
            students registered for this event, even when the event
            was published by another institution. Server-side scope
            in listRegistrations pins participating institutions to
            their own students automatically, so this button is safe
            to render for every institution admin. Hidden for
            students / trainers / parents / staff — the same role
            gate the primary Register Students CTA uses. */}
        {(() => {
          const role = String(user?.role || '').toLowerCase();
          const nonAdminRoles = new Set(['student', 'trainer', 'staff', 'parent']);
          const isAdminish = user && !nonAdminRoles.has(role);
          if (!isAdminish) return null;
          return (
            <TouchableOpacity
              style={[styles.linkBtn, { backgroundColor: '#E63946' }]}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('EventRegistrationsTable', {
                eventId:    event.id,
                eventTitle: event.title || 'Event',
              })}
            >
              <Text style={styles.linkBtnText}>Registered Students</Text>
            </TouchableOpacity>
          );
        })()}

        {/* ── Student interest picker + view-only hint ──────────
            Rendered ONLY for the student role. Students can flag
            themselves as interested (Yes) or not (No); the answer
            is persisted server-side and their institution admin
            sees the interested rows highlighted on Select Students.
            Below the picker sits the view-only reminder so the
            absence of a Register button doesn't feel like a bug —
            registration is handled by the academy. */}
        {(() => {
          const role = String(user?.role || '').toLowerCase();
          if (role !== 'student') return null;
          const isYes = interest === true;
          const isNo  = interest === false;
          return (
            <>
              <View style={styles.interestCard}>
                <Text style={styles.interestTitle}>Are you interested to participate?</Text>
                <View style={styles.interestRow}>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    disabled={interestSaving}
                    onPress={() => submitInterest(true)}
                    style={[
                      styles.interestBtn,
                      isYes ? styles.interestBtnYesOn : styles.interestBtnYesOff,
                    ]}
                  >
                    <Text style={[
                      styles.interestBtnText,
                      isYes ? styles.interestBtnTextOn : styles.interestBtnTextYes,
                    ]}>Yes</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    disabled={interestSaving}
                    onPress={() => submitInterest(false)}
                    style={[
                      styles.interestBtn,
                      isNo ? styles.interestBtnNoOn : styles.interestBtnNoOff,
                    ]}
                  >
                    <Text style={[
                      styles.interestBtnText,
                      isNo ? styles.interestBtnTextOn : styles.interestBtnTextNo,
                    ]}>No</Text>
                  </TouchableOpacity>
                </View>
                {isYes ? (
                  <Text style={styles.interestConfirmYes}>
                    Great — your academy admin has been notified. They will verify
                    your eligibility and complete the registration.
                  </Text>
                ) : isNo ? (
                  <Text style={styles.interestConfirmNo}>
                    Noted. You can change your answer any time.
                  </Text>
                ) : null}
              </View>

              <View style={styles.studentInfoNote}>
                <Text style={styles.studentInfoNoteText}>
                  This is a view-only event announcement. Registration is handled
                  through your academy — tap Yes above to let your academy admin
                  know you'd like to participate.
                </Text>
              </View>
            </>
          );
        })()}

        {/* ── MODULE 4: Organizer Registrations CTA ──
            Visible only when the caller's institution matches the
            event's organizing institution — server-side auth on
            /events/:id/registrations also enforces this. */}
        {(() => {
          const myInstId = institution?.id || user?.institution_id || null;
          const isOrganizer = myInstId && event?.institution_id
            && Number(myInstId) === Number(event.institution_id);
          if (!isOrganizer) return null;
          return (
            <TouchableOpacity
              style={[styles.linkBtn, { backgroundColor: '#1E3A8A' }]}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('EventRegistrationsList', {
                eventId:    event.id,
                eventTitle: event.title || 'Event',
              })}
            >
              <Text style={styles.linkBtnText}>Registrations</Text>
            </TouchableOpacity>
          );
        })()}

        {/* External link CTA */}
        {event.link ? (
          <TouchableOpacity
            style={styles.linkBtn}
            onPress={openLink}
            activeOpacity={0.85}
          >
            <ExternalLink size={16} color="#fff" strokeWidth={2.4} />
            <Text style={styles.linkBtnText}>Open registration / details</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────
function MetaRow({ icon: Icon, label, value }) {
  return (
    <View style={styles.metaRow}>
      <View style={styles.metaIconWrap}>
        <Icon size={14} color={BRAND} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.metaLabel}>{label}</Text>
        <Text style={styles.metaValue}>{value}</Text>
      </View>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

// ─── Styles ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 44, paddingBottom: 12,
    backgroundColor: SURFACE,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '800', color: TEXT, textAlign: 'center' },

  // Banner
  banner: {
    width: '100%', height: 200,
    backgroundColor: BRAND_SOFT,
  },
  bannerEmpty: {
    alignItems: 'center', justifyContent: 'center',
  },

  // Title card — sits under the banner with a slight lift
  titleCard: {
    backgroundColor: SURFACE,
    marginHorizontal: 16,
    marginTop: -22,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1, borderColor: BORDER,
  },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  dateBlock: {
    width: 56, height: 64, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  dateBlockLive: { backgroundColor: BRAND_SOFT },
  dateBlockPast: { backgroundColor: '#F1F5F9' },
  dateDay: { fontSize: 20, fontWeight: '900' },
  dateMonth: { fontSize: 10, fontWeight: '800', letterSpacing: 1, marginTop: -2 },

  title: { fontSize: 18, fontWeight: '900', color: TEXT, letterSpacing: -0.2 },
  subtitle: { fontSize: 13, color: TEXT_MUTED, marginTop: 4, fontWeight: '600', lineHeight: 18 },

  pillRow: { marginTop: 12, flexDirection: 'row' },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
  },
  statusText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },

  // Meta facts card
  metaCard: {
    backgroundColor: SURFACE,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 14,
    paddingVertical: 6,
    borderWidth: 1, borderColor: BORDER,
  },
  metaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 14,
  },
  metaIconWrap: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  metaLabel: { fontSize: 11, color: TEXT_MUTED, fontWeight: '700', letterSpacing: 0.4 },
  metaValue: { fontSize: 14, color: TEXT, fontWeight: '700', marginTop: 1 },
  divider: { height: 1, backgroundColor: BORDER, marginHorizontal: 14 },

  // Description
  section: {
    backgroundColor: SURFACE,
    marginHorizontal: 16, marginTop: 16,
    borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: BORDER,
  },
  sectionTitle: {
    fontSize: 11, fontWeight: '700', color: TEXT_MUTED,
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8,
  },
  body: { fontSize: 14, color: TEXT, lineHeight: 21, fontWeight: '500' },

  // ── Categories & Skills ──────────────────────────────────────
  catBlock: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1, borderColor: BORDER,
    backgroundColor: BG,
  },
  catHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 8,
  },
  catBadge: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  catBadgeText: { fontSize: 11, fontWeight: '800', color: BRAND },
  catName: {
    flex: 1,
    fontSize: 13, fontWeight: '800', color: TEXT, letterSpacing: 0.2,
  },
  skillRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 6,
    borderTopWidth: 1, borderTopColor: BORDER,
  },
  skillIndex: {
    fontSize: 12, fontWeight: '800', color: TEXT_MUTED, width: 18,
  },
  skillName: {
    flex: 1,
    fontSize: 13, fontWeight: '700', color: TEXT,
  },
  skillAge: {
    fontSize: 11, fontWeight: '700', color: BRAND,
    backgroundColor: BRAND_SOFT,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
  },
  // Wraps a skill row + optional divisions chip row so the divisions
  // sit visually under the same skill and keep the top border logic
  // (only the skill row draws the divider between skills).
  skillCell: {},
  // Gender pill sits inline in the category header — small tinted
  // capsule matching the "Male"/"Female" tokens used in the builder.
  genderPill: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#E0E7FF',
  },
  genderPillText: {
    fontSize: 10, fontWeight: '800', color: '#4338CA',
    letterSpacing: 0.4, textTransform: 'uppercase',
  },
  // Division chips render as a wrap row of small tag-style capsules
  // beneath their skill (e.g. Karate → [Division A][Division B]).
  divisionRow: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: 6, marginLeft: 26, marginTop: 4, marginBottom: 4,
  },
  divisionChip: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  divisionText: { fontSize: 11, fontWeight: '700', color: TEXT_MUTED },

  // Registration Form fields — one row per field with a label +
  // Required badge, a small meta line (TYPE · source), and an
  // options chip row for enum-typed fields.
  regFieldRow: {
    paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: BORDER,
  },
  regFieldTop: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  regFieldLabel: {
    flex: 1,
    fontSize: 13, fontWeight: '800', color: TEXT,
  },
  reqPill: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#FEE2E2',
  },
  reqPillText: {
    fontSize: 10, fontWeight: '800', color: '#B91C1C',
    letterSpacing: 0.4, textTransform: 'uppercase',
  },
  regFieldMeta: {
    marginTop: 3,
    fontSize: 11, fontWeight: '700', color: TEXT_MUTED,
    letterSpacing: 0.3,
  },
  regFieldOpts: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: 6, marginTop: 6,
  },
  regOptChip: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  regOptChipText: { fontSize: 11, fontWeight: '700', color: TEXT_MUTED },

  // External link CTA
  linkBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16, marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: BRAND,
    shadowColor: BRAND, shadowOpacity: 0.3, shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },

  // Pay Now — same shape as linkBtn but on a green shade so it reads as
  // a distinct action from Open registration / details.
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16, marginTop: 18,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: GREEN,
    shadowColor: GREEN, shadowOpacity: 0.3, shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  payBtnText: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 0.2 },

  // Green success chip shown after a successful payment (has_paid=true).
  paidBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 18,
    paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: GREEN + '15',
    borderRadius: 12,
    borderWidth: 1, borderColor: GREEN + '55',
  },
  paidBadgeText: { color: GREEN, fontWeight: '800', fontSize: 13 },
  linkBtnText: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
  // View-only banner shown to student-role viewers so the absence
  // of a Register CTA is explicit rather than confusing.
  studentInfoNote: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    borderWidth: 1, borderColor: '#DBEAFE',
  },
  studentInfoNoteText: {
    fontSize: 12, fontWeight: '600', color: '#1E40AF', lineHeight: 17,
  },
  // "Are you interested to participate?" card — student-only.
  interestCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: SURFACE,
    borderWidth: 1, borderColor: BORDER,
  },
  interestTitle: {
    fontSize: 13, fontWeight: '800', color: TEXT,
    marginBottom: 10,
  },
  interestRow: {
    flexDirection: 'row', gap: 10,
  },
  interestBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  interestBtnYesOff: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  interestBtnYesOn:  { backgroundColor: GREEN,      borderColor: GREEN },
  interestBtnNoOff:  { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  interestBtnNoOn:   { backgroundColor: '#B91C1C', borderColor: '#B91C1C' },
  interestBtnText:   { fontSize: 13, fontWeight: '800', letterSpacing: 0.4 },
  interestBtnTextYes:{ color: GREEN },
  interestBtnTextNo: { color: '#B91C1C' },
  interestBtnTextOn: { color: '#fff' },
  interestConfirmYes: {
    marginTop: 8, fontSize: 11, fontWeight: '700',
    color: '#065F46', lineHeight: 16,
  },
  interestConfirmNo: {
    marginTop: 8, fontSize: 11, fontWeight: '700',
    color: TEXT_MUTED, lineHeight: 16,
  },

  // Verifying / awaiting card — used while the mobile is either
  // waiting for the payer to return from Razorpay or polling the
  // backend for the webhook flip.
  verifyingCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    marginHorizontal: 16, marginTop: 18,
    paddingVertical: 14, paddingHorizontal: 16,
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1, borderColor: BORDER,
  },
  verifyingTitle: { color: TEXT, fontWeight: '800', fontSize: 14 },
  verifyingSub:   {
    color: TEXT_MUTED, fontWeight: '600', fontSize: 12,
    marginTop: 2, lineHeight: 17,
  },

  // Pending / failed card — payment didn't complete; payer can
  // retry from here.
  pendingCard: {
    marginHorizontal: 16, marginTop: 18,
    paddingVertical: 14, paddingHorizontal: 16,
    backgroundColor: '#FFF7ED',
    borderRadius: 12,
    borderWidth: 1, borderColor: '#FED7AA',
  },
  pendingHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pendingTitle: { color: TEXT, fontWeight: '800', fontSize: 14 },
  pendingSub:   {
    color: TEXT_MUTED, fontWeight: '600', fontSize: 12,
    marginTop: 6, lineHeight: 17,
  },
  pendingBtnRow: {
    flexDirection: 'row', gap: 8, marginTop: 12,
  },
  retryBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6,
    backgroundColor: BRAND,
    paddingVertical: 10, borderRadius: 10,
  },
  retryBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  retryBtnGhost: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6,
    backgroundColor: SURFACE,
    paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: BORDER,
  },
  retryBtnGhostText: { color: TEXT, fontWeight: '700', fontSize: 13 },
});
