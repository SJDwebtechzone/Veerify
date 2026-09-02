// src/screens/admin/InstitutionEventDetailScreen.js
//
// View-only event detail screen for institution admins. Displays all
// information entered during event creation in a clean, organized
// layout. Opened when the admin taps an event in the Events list.

import React, { createContext, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking,
} from 'react-native';
import {
  ArrowLeft, Calendar, MapPin, Clock, CreditCard, ExternalLink,
  CheckCircle2, AlertCircle, Layers, Users, FileText, Info,
  Building2,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import resolveAssetUrl from '../../utils/assetUrl';
import CourseImage from '../../components/CourseImage';
// Institution Home visual system — ambient blue wash + glass
// cards + navy accents. Reused verbatim so this screen belongs to
// the same design language as the rest of the institution UI.
import InstitutionScreenBackground, {
  INSTITUTION_BG_BASE,
} from '../../components/InstitutionScreenBackground';
import { useTheme } from '../../theme/ThemeContext';

// ── Institution-Home glass tokens ─────────────────────────────
const GLASS_FILL         = 'rgba(255,255,255,0.72)';
const GLASS_FILL_STRONG  = 'rgba(255,255,255,0.88)';
const GLASS_BORDER_LIGHT = 'rgba(255,255,255,0.55)';
const GLASS_HIGHLIGHT    = 'rgba(255,255,255,0.9)';
const GLASS_SHADOW       = '#1E40AF';
const BRAND_DARK_BLUE    = '#1E3A8A';
const BRAND_ACCENT_SOFT  = 'rgba(30,58,138,0.10)';
const HEADER_NAVY        = '#0F172A';

// Local tokens — names kept unchanged so every existing card /
// border / text style inherits the Institution Home look
// automatically.
const BRAND       = '#E63946';
const BRAND_SOFT  = '#FFE4E6';
const TEXT        = HEADER_NAVY;
const TEXT_MUTED  = '#6B7280';
const TEXT_LIGHT  = '#9CA3AF';
const SURFACE     = GLASS_FILL_STRONG;
const BG          = INSTITUTION_BG_BASE;
const BORDER      = GLASS_BORDER_LIGHT;
const GREEN       = '#10B981';
const AMBER       = '#F59E0B';
const PURPLE      = '#6D28D9';

// Local context so nested sub-components pick up dark-mode
// overrides without prop-drilling.
const InstEventDetailCtx = createContext({ isDark: false, dark: {} });

function buildDarkOverrides(pal) {
  return StyleSheet.create({
    screen:      { backgroundColor: pal.bg },
    header:      { backgroundColor: pal.surface, borderBottomColor: pal.border },
    headerTitle: { color: pal.text },
    iconBtn:     { backgroundColor: pal.border },
    titleCard:   { backgroundColor: pal.surface, borderColor: pal.border },
    section:     { backgroundColor: pal.surface, borderColor: pal.border },
    sectionTitle:{ color: pal.textMuted },
    metaLabel:   { color: pal.textMuted },
    metaValue:   { color: pal.text },
    body:        { color: pal.text },
  });
}

function formatFullDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  });
}

function formatTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = String(hhmm).split(':').map((n) => parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function formatShortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// End-of-day LOCAL timestamp for a registration_closing_date /
// event_date value coming out of node-postgres. See the twin helper
// in EventDetailScreen.js for the full rationale — TL;DR: DATE
// columns serialise to '2026-08-25T00:00:00.000Z' which naively
// parses to UTC midnight (5:30 AM IST) and closes registration
// five hours early. This reinterprets a UTC-midnight value as
// 23:59:59.999 LOCAL on the same calendar day so registration
// stays open all day and shuts at 00:00 the next day.
function endOfDayLocalMs(input) {
  if (!input) return null;
  const s = String(input);
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.slice(0, 10));
  if (dm && s.length <= 10) {
    return new Date(+dm[1], +dm[2] - 1, +dm[3], 23, 59, 59, 999).getTime();
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  // Postgres DATE columns serialise as ISO strings whose exact
  // shape depends on the backend TZ:
  //   • UTC backend → '2026-08-25T00:00:00.000Z'
  //   • IST backend → '2026-08-24T18:30:00.000Z' (Aug 25 00:00 IST)
  // Both are "just the calendar day" — no real time. If the parsed
  // Date is midnight in EITHER local or UTC we reinterpret it as
  // end-of-day LOCAL on that calendar day, so registration stays
  // open until 11:59 PM local as the organiser intended.
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
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  if (isUtcMidnight) {
    return new Date(
      d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
      23, 59, 59, 999,
    ).getTime();
  }
  return d.getTime();
}

export default function InstitutionEventDetailScreen({ route, navigation }) {
  const event = route?.params?.event || {};
  const [regForm, setRegForm] = useState(null);

  useEffect(() => {
    if (!event?.id) return;
    let cancelled = false;
    apiClient.get(`/events/${event.id}/registration-form`)
      .then((r) => {
        if (cancelled) return;
        setRegForm({
          enabled:  !!r.data?.enabled,
          fields:   r.data?.fields || [],
          categories: r.data?.categories || [],
        });
      })
      .catch(() => {
        if (!cancelled) setRegForm({ enabled: false, fields: [], categories: [] });
      });
    return () => { cancelled = true; };
  }, [event?.id]);

  const isPast      = event.status === 'past';
  const isScheduled = event.status === 'scheduled';
  const isPending   = event.status === 'pending';
  const isRejected  = event.status === 'rejected';
  const isLive      = !isPast && !isPending && !isRejected && !isScheduled;

  const eventDate = event.event_date ? new Date(event.event_date) : null;
  const day   = eventDate ? String(eventDate.getDate()).padStart(2, '0') : '--';
  const mon   = eventDate ? eventDate.toLocaleString('en-US', { month: 'short' }).toUpperCase() : '---';

  // Categories can arrive from two sources: the event row itself
  // (route params — populated by the list endpoint) OR the freshly-
  // fetched registration-form endpoint which also carries the event's
  // categories block. Prefer whichever is populated so a stale list
  // fetch (before migration 096) doesn't hide the section.
  const categories = (() => {
    const fromEvent = Array.isArray(event.categories) ? event.categories : [];
    const fromForm  = Array.isArray(regForm?.categories) ? regForm.categories : [];
    if (fromEvent.some((c) => (c?.skills || []).length > 0)) return fromEvent;
    if (fromForm.some((c) => (c?.skills || []).length > 0))  return fromForm;
    return fromEvent.length > 0 ? fromEvent : fromForm;
  })();
  const hasCategories = categories.length > 0
    && categories.some((c) => (c.skills || []).length > 0);

  const statusColor = isPending  ? '#B45309'
    : isRejected ? '#B91C1C'
    : isPast     ? TEXT_MUTED
    : isScheduled ? '#B45309'
    : GREEN;

  const statusBg = isPending  ? '#FEF3C7'
    : isRejected ? '#FEE2E2'
    : isPast     ? '#F1F5F9'
    : isScheduled ? '#FEF3C7'
    : GREEN + '22';

  const statusLabel = isPending  ? 'Pending Approval'
    : isRejected ? 'Rejected'
    : isPast     ? 'Past Event'
    : isScheduled ? 'Scheduled'
    : 'Live';

  // Dark-mode overrides pulled from the shared ThemeContext.
  // Institution Home's ambient background is skipped in dark mode.
  const { mode, palette: themePalette } = useTheme();
  const isDark = mode === 'dark';
  const dark   = useMemo(() => (isDark ? buildDarkOverrides(themePalette) : {}), [isDark, themePalette]);

  return (
    <InstEventDetailCtx.Provider value={{ isDark, dark }}>
    <View style={[styles.screen, isDark && dark.screen]}>
      {/* Institution Home ambient wash — sits behind all content. */}
      {!isDark ? <InstitutionScreenBackground layer /> : null}
      {/* Header */}
      <View style={[styles.header, isDark && dark.header]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.iconBtn, isDark && dark.iconBtn]} activeOpacity={0.7}>
          <ArrowLeft size={20} color={isDark ? themePalette.text : TEXT} strokeWidth={2.2} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, isDark && dark.headerTitle]} numberOfLines={1}>Event Details</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero banner */}
        <CourseImage
          uri={event.image_url}
          width="100%"
          height={200}
          radius={0}
          fit="contain"
          icon="image"
          style={{ backgroundColor: BRAND_SOFT }}
        />

        {/* Title card */}
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
              {/* Event level badge — stored event_type is inverted from
                  the UI label: 'intra' in DB = Inter-Level in the UI
                  (the admin's "Inter-Level Event" tile sends
                  eventType='intra'). So we flip the display. */}
              <View style={styles.badgeRow}>
                <View style={[
                  styles.levelBadge,
                  event.event_type === 'inter'
                    ? { backgroundColor: '#EDE9FE' }
                    : { backgroundColor: '#DBEAFE' },
                ]}>
                  <Text style={[
                    styles.levelBadgeText,
                    { color: event.event_type === 'inter' ? PURPLE : '#1E40AF' },
                  ]}>
                    {event.event_type === 'inter' ? 'INTRA-LEVEL' : 'INTER-LEVEL'}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Status pill */}
          <View style={styles.pillRow}>
            <View style={[styles.statusPill, { backgroundColor: statusBg }]}>
              {isPending || isRejected ? (
                <AlertCircle size={11} color={statusColor} strokeWidth={2.4} />
              ) : (
                <CheckCircle2 size={11} color={statusColor} strokeWidth={2.4} />
              )}
              <Text style={[styles.statusText, { color: statusColor }]}>
                {statusLabel}
              </Text>
            </View>
          </View>
        </View>

        {/* ── Date & Time ── */}
        <View style={styles.metaCard}>
          <MetaRow
            icon={Calendar}
            label="Event Date"
            value={formatFullDate(event.event_date)}
          />
          {event.event_time ? (
            <>
              <Divider />
              <MetaRow
                icon={Clock}
                label="Event Time"
                value={formatTime(event.event_time)}
              />
            </>
          ) : null}
          {event.registration_closing_date ? (
            <>
              <Divider />
              <MetaRow
                icon={Clock}
                label="Registration Deadline"
                value={formatFullDate(event.registration_closing_date)}
              />
            </>
          ) : null}
          {event.location ? (
            <>
              <Divider />
              <MetaRow
                icon={MapPin}
                label="Venue / Location"
                value={event.location}
              />
            </>
          ) : null}
          {event.link ? (
            <>
              <Divider />
              <TouchableOpacity
                onPress={() => Linking.openURL(event.link).catch(() => {})}
                activeOpacity={0.7}
              >
                <View style={styles.metaRow}>
                  <View style={styles.metaIconWrap}>
                    <ExternalLink size={14} color={BRAND} strokeWidth={2.4} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.metaLabel}>Location Link</Text>
                    <Text style={[styles.metaValue, { color: BRAND }]} numberOfLines={1}>
                      {event.link}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            </>
          ) : null}
        </View>

        {/* ── Organizer Details ── */}
        {event.organizing_institution_name || event.institution_name ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIconWrap}>
                <Building2 size={14} color={BRAND} strokeWidth={2.4} />
              </View>
              <Text style={styles.sectionTitle}>Organizer</Text>
            </View>
            <Text style={styles.body}>
              {event.organizing_institution_name || event.institution_name}
            </Text>
            {event.branch_name && event.branch_name !== (event.organizing_institution_name || event.institution_name) ? (
              <Text style={[styles.body, { marginTop: 4, color: TEXT_MUTED }]}>
                Branch: {event.branch_name}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* ── Description ── */}
        {event.description ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIconWrap}>
                <FileText size={14} color={BRAND} strokeWidth={2.4} />
              </View>
              <Text style={styles.sectionTitle}>Description</Text>
            </View>
            <Text style={styles.body}>{event.description}</Text>
          </View>
        ) : null}

        {/* ── Categories & Skills ── */}
        {categories.length > 0 && categories.some((c) => (c.skills || []).length > 0) ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIconWrap}>
                <Layers size={14} color={BRAND} strokeWidth={2.4} />
              </View>
              <Text style={styles.sectionTitle}>Categories & Skills</Text>
            </View>
            {categories.map((cat, ci) => {
              const skills = Array.isArray(cat.skills) ? cat.skills : [];
              if (skills.length === 0) return null;
              return (
                <View key={ci} style={styles.catBlock}>
                  <View style={styles.catHeader}>
                    <View style={styles.catBadge}>
                      <Text style={styles.catBadgeText}>{ci + 1}</Text>
                    </View>
                    <Text style={styles.catName}>
                      {cat.name || `Category ${ci + 1}`}
                    </Text>
                    {/* Gender pill — 'Male' / 'Female' as persisted
                        on the category. Silent for older rows that
                        predate the gender field. */}
                    {cat?.gender ? (
                      <View style={styles.genderPill}>
                        <Text style={styles.genderPillText}>{cat.gender}</Text>
                      </View>
                    ) : null}
                  </View>
                  {skills.map((sk, si) => {
                    const skillName = sk.name || 'Unnamed';
                    const ageFrom = sk.age_from;
                    const ageTo = sk.age_to;
                    const hasAge = ageFrom != null || ageTo != null;
                    const divisions = Array.isArray(sk.divisions) ? sk.divisions : [];
                    return (
                      <View key={si} style={styles.skillCell}>
                        <View style={styles.skillRow}>
                          <Text style={styles.skillIndex}>{si + 1}.</Text>
                          <Text style={styles.skillName}>{skillName}</Text>
                          {hasAge ? (
                            <Text style={styles.skillAge}>
                              Age {ageFrom ?? '—'} – {ageTo ?? '—'}
                            </Text>
                          ) : null}
                        </View>
                        {/* Divisions — free-text tags under the skill
                            (e.g. Karate → Single stick / Double stick).
                            Silent when the organiser saved none. */}
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
        ) : null}

        {/* ── Payment Details ─────────────────────────────────────
            Rendered ONLY when the organiser enabled "Payment
            Required" during event creation. When payment is
            disabled the whole section is hidden — no "Free event"
            placeholder, no empty payment card. This mirrors the
            Web Admin Event Details modal so both surfaces read
            the same. Doesn't change registration or backend logic;
            purely a display gate on event.payment_required. */}
        {event.payment_required ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIconWrap}>
                <CreditCard size={14} color={BRAND} strokeWidth={2.4} />
              </View>
              <Text style={styles.sectionTitle}>Payment Details</Text>
            </View>
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>Registration Fee</Text>
              <Text style={styles.paymentAmount}>
                ₹{Number(event.payment_amount || 0).toLocaleString('en-IN')}
              </Text>
            </View>
          </View>
        ) : null}

        {/* ── Registration Details ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIconWrap}>
              <Users size={14} color={BRAND} strokeWidth={2.4} />
            </View>
            <Text style={styles.sectionTitle}>Registration</Text>
          </View>
          {regForm === null ? (
            <Text style={[styles.body, { color: TEXT_LIGHT }]}>Loading…</Text>
          ) : regForm.enabled ? (
            <>
              <View style={styles.regEnabledRow}>
                <View style={styles.regDot} />
                <Text style={styles.regEnabledText}>Registration Enabled</Text>
              </View>
              {regForm.fields.length > 0 ? (
                <Text style={[styles.body, { marginTop: 6 }]}>
                  {regForm.fields.length} custom field{regForm.fields.length !== 1 ? 's' : ''} configured
                </Text>
              ) : (
                <Text style={[styles.body, { marginTop: 6, color: TEXT_MUTED }]}>
                  No custom fields — using default registration
                </Text>
              )}
            </>
          ) : (
            <Text style={[styles.body, { color: TEXT_MUTED }]}>
              Registration is not enabled for this event
            </Text>
          )}
        </View>

        {/* ── Scheduling Info ── */}
        {event.publish_at ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIconWrap}>
                <Clock size={14} color={BRAND} strokeWidth={2.4} />
              </View>
              <Text style={styles.sectionTitle}>Scheduling</Text>
            </View>
            <Text style={styles.body}>
              Scheduled to publish on {formatFullDate(event.publish_at)}
            </Text>
          </View>
        ) : null}

        {/* ── Approval / Submission Info (Intra-level) ── */}
        {event.event_type === 'intra' ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIconWrap}>
                <Info size={14} color={BRAND} strokeWidth={2.4} />
              </View>
              <Text style={styles.sectionTitle}>Approval Status</Text>
            </View>
            {event.submitted_at ? (
              <MetaInline label="Submitted" value={formatFullDate(event.submitted_at)} />
            ) : null}
            {event.approved_at ? (
              <MetaInline label="Approved" value={formatFullDate(event.approved_at)} />
            ) : null}
            {event.rejected_at ? (
              <MetaInline label="Rejected" value={formatFullDate(event.rejected_at)} />
            ) : null}
            {event.approval_reason ? (
              <Text style={[styles.body, { marginTop: 8 }]}>
                Reason: {event.approval_reason}
              </Text>
            ) : null}
            {!event.submitted_at && !event.approved_at && !event.rejected_at && !event.approval_reason ? (
              <Text style={[styles.body, { color: TEXT_MUTED }]}>
                No approval information available
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* ── Register Students CTA ──────────────────────────────
            Institution admins can register their own students on
            any approved, registration-enabled event — their own
            or another academy's approved cross-institution event.
            Hidden when the event is still pending / rejected /
            past. Button is disabled once the deadline (end-of-day
            LOCAL on the closing date) has elapsed. */}
        {(() => {
          // Reg-enabled flag can arrive on either the event blob or
          // the freshly-fetched form (see the effect at the top of
          // this screen). Accept either.
          const regEnabled = !!event.registration_enabled || !!regForm?.enabled;
          const isApproved =
            !event.approval_status || event.approval_status === 'approved';
          // Never show on non-approved rows, past rows, or when
          // registration is disabled by the organiser.
          if (!regEnabled || !isApproved || isPast || isPending || isRejected) {
            return null;
          }
          const deadlineMs =
            endOfDayLocalMs(event.registration_closing_date)
            ?? endOfDayLocalMs(event.event_date);
          const closed = deadlineMs != null && deadlineMs < Date.now();
          return (
            <View style={styles.section}>
              <TouchableOpacity
                activeOpacity={0.85}
                disabled={closed}
                style={[styles.registerBtn, closed && styles.registerBtnDisabled]}
                onPress={() => navigation.navigate('SelectStudentsForEvent', {
                  eventId:    event.id,
                  eventTitle: event.title || 'Event',
                  registrationClosingDate: event.registration_closing_date,
                })}
              >
                <Users size={16} color="#fff" strokeWidth={2.4} />
                <Text style={styles.registerBtnText}>
                  {closed ? 'Registration Closed' : 'Register Students'}
                </Text>
              </TouchableOpacity>

              {/* Registered Students — sits directly below the
                  Register Students CTA. Opens the table view where
                  every registration is listed row-by-row with all
                  default + custom fields and an Export button. */}
              <TouchableOpacity
                activeOpacity={0.85}
                style={styles.registeredBtn}
                onPress={() => navigation.navigate('EventRegistrationsTable', {
                  eventId:    event.id,
                  eventTitle: event.title || 'Event',
                })}
              >
                <Users size={16} color={BRAND} strokeWidth={2.4} />
                <Text style={styles.registeredBtnText}>Registered Students</Text>
              </TouchableOpacity>

              {closed ? (
                <Text style={[styles.body, { color: TEXT_MUTED, marginTop: 8, textAlign: 'center' }]}>
                  The registration window ended on{' '}
                  {formatFullDate(event.registration_closing_date || event.event_date)}.
                </Text>
              ) : null}
            </View>
          );
        })()}
      </ScrollView>
    </View>
    </InstEventDetailCtx.Provider>
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

function MetaInline({ label, value }) {
  return (
    <View style={{ flexDirection: 'row', marginTop: 4 }}>
      <Text style={[styles.body, { color: TEXT_MUTED, flex: 0 }]}>{label}: </Text>
      <Text style={styles.body}>{value}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

// ─── Styles ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  // Header — glass slab with a navy title and soft blue lift
  // shadow. Matches every other Institution Home surface.
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 44, paddingBottom: 12,
    backgroundColor: GLASS_FILL_STRONG,
    borderBottomWidth: 1, borderBottomColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.10,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: BRAND_ACCENT_SOFT,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
  },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '800', color: HEADER_NAVY, textAlign: 'center', letterSpacing: 0.2 },

  // Title card — glass panel with matching lift shadow so it reads
  // as a lifted glass slab on the ambient wash.
  titleCard: {
    backgroundColor: GLASS_FILL_STRONG,
    marginHorizontal: 16, marginTop: -22,
    borderRadius: 18, padding: 16,
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
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

  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  levelBadge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  levelBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  pillRow: { marginTop: 12, flexDirection: 'row' },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
  },
  statusText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },

  // Meta card — glass panel with matching blue lift shadow.
  metaCard: {
    backgroundColor: GLASS_FILL_STRONG,
    marginHorizontal: 16, marginTop: 16,
    borderRadius: 16, paddingVertical: 6,
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
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

  // Section — glass panel with matching blue lift shadow.
  section: {
    backgroundColor: GLASS_FILL_STRONG,
    marginHorizontal: 16, marginTop: 16,
    borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 10,
  },
  sectionIconWrap: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 12, fontWeight: '800', color: TEXT_MUTED,
    letterSpacing: 0.6, textTransform: 'uppercase',
  },
  body: { fontSize: 14, color: TEXT, lineHeight: 21, fontWeight: '500' },

  // Register Students CTA — pill button styled like the shared
  // primary CTAs elsewhere in the app so the affordance is
  // immediately recognisable. Disabled state greys out.
  registerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#0F172A',
  },
  registerBtnDisabled: { backgroundColor: '#94A3B8' },
  registerBtnText: {
    fontSize: 14, fontWeight: '800', color: '#fff', letterSpacing: 0.3,
  },
  // Secondary CTA — sits directly under Register Students so the
  // two related affordances read as a pair. Outlined, brand-tinted
  // pill so it doesn't visually compete with the primary CTA above.
  registeredBtn: {
    marginTop: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: BRAND_SOFT,
    borderWidth: 1, borderColor: BRAND_SOFT,
  },
  registeredBtnText: {
    fontSize: 13, fontWeight: '800', color: BRAND, letterSpacing: 0.3,
  },

  // Categories
  catBlock: {
    marginTop: 8, padding: 12,
    borderRadius: 10, borderWidth: 1, borderColor: BORDER,
    backgroundColor: BG,
  },
  catHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 8,
  },
  catBadge: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  catBadgeText: { fontSize: 10, fontWeight: '800', color: BRAND },
  catName: { fontSize: 13, fontWeight: '700', color: TEXT, flex: 1 },
  // Gender pill in the category header. Small tinted capsule that
  // matches the "Male"/"Female" tokens on the builder + shared
  // EventDetailScreen so the same data reads consistently across
  // every event-detail surface.
  genderPill: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#E0E7FF',
  },
  genderPillText: {
    fontSize: 10, fontWeight: '800', color: '#4338CA',
    letterSpacing: 0.4, textTransform: 'uppercase',
  },

  // Wraps a skill row + its optional divisions row so the divisions
  // sit visually under the same skill.
  skillCell: {},
  skillRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 5, paddingHorizontal: 6,
  },
  skillIndex: { fontSize: 12, fontWeight: '700', color: TEXT_MUTED, width: 20 },
  skillName: { fontSize: 13, fontWeight: '600', color: TEXT, flex: 1 },
  skillAge: { fontSize: 11, fontWeight: '600', color: TEXT_MUTED },

  // Division chips — wrap-row of small capsules beneath the skill
  // (e.g. Karate → [Single stick][Double stick]).
  divisionRow: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: 6, marginLeft: 26, marginTop: 4, marginBottom: 4,
  },
  divisionChip: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: BORDER,
  },
  divisionText: { fontSize: 11, fontWeight: '700', color: TEXT_MUTED },

  // Payment
  paymentRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8,
  },
  paymentLabel: { fontSize: 14, fontWeight: '600', color: TEXT },
  paymentAmount: { fontSize: 18, fontWeight: '900', color: BRAND },

  // Registration
  regEnabledRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  regDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: GREEN,
  },
  regEnabledText: { fontSize: 14, fontWeight: '700', color: GREEN },
});
