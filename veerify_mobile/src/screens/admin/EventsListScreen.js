// src/screens/admin/EventsListScreen.js
//
// Admin "Events" tile in the More tab opens this screen. Splits the
// list into "My Institution Events" (with an Upcoming / History
// toggle) and "Other Institution Events" (approved intras from other
// academies). Event creation is initiated from the Dashboard's
// "Add Event" quick action, not from here. Same look-and-feel as
// BatchesList / TrainersList so the admin doesn't have to learn a
// new layout.

import React, { createContext, useCallback, useMemo, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Image,
  StyleSheet, ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Calendar, MapPin, CheckCircle2, Clock,
  Check, X, AlertCircle, Pencil,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import resolveAssetUrl from '../../utils/assetUrl';
import { palette, spacing, radius, type } from '../../theme';
import { confirm } from '../../components/ConfirmDialog';
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

// Local context so nested sub-components pick up dark-mode
// overrides without prop-drilling.
const EventsListCtx = createContext({ isDark: false, dark: {} });

function buildDarkOverrides(pal) {
  return StyleSheet.create({
    screen:      { backgroundColor: pal.bg },
    header:      { backgroundColor: pal.surface, borderBottomColor: pal.border },
    headerTitle: { color: pal.text },
    headerSub:   { color: pal.textMuted },
    iconBtn:     { backgroundColor: pal.border },
    card:        { backgroundColor: pal.surface, borderColor: pal.border },
    sectionTitle:{ color: pal.textMuted },
    label:       { color: pal.textMuted },
  });
}

// Format an ISO date as "22 Jun 2026" — short month + 4-digit year.
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function EventsListScreen({ navigation }) {
  const [events, setEvents]       = useState([]);
  const [pendingBranchEvents, setPendingBranchEvents] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deciding, setDeciding] = useState({}); // { [eventId]: 'approving' | 'rejecting' }

  const load = useCallback(async () => {
    try {
      // Own events + pending branch approvals in parallel. The pending
      // endpoint 403s for sub-branch admins (only main-branch admins
      // moderate) — we catch that quietly so the screen stays clean for
      // both flavors of admin.
      const [own, pending] = await Promise.all([
        apiClient.get('/institutions/me/events/all')
          .catch((err) => {
            console.log('[EventsList] own load error:', err?.message);
            return { data: { events: [] } };
          }),
        apiClient.get('/institutions/me/events/pending')
          .catch(() => ({ data: { events: [] } })),
      ]);
      setEvents(own.data?.events || []);
      setPendingBranchEvents(pending.data?.events || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Parent-admin approve / reject actions on the "Pending from branches"
  // header section. Both fire PATCHes and then re-run load() so the row
  // moves out of pending into whatever status the branch's EventsList
  // will show it as (upcoming / scheduled).
  // Approve / Reject use the shared ConfirmDialog so the sheet lines up
  // visually with every other action across the app instead of the OS
  // native gray box. On confirm we PATCH the row and reload; on any
  // error we surface the message in a follow-up ConfirmDialog.
  const approveBranchEvent = (event) => {
    confirm({
      title:       'Approve event?',
      message:     `Approve "${event.title}" from ${event.branch_name || 'the branch'}? Students and trainers will see it immediately.`,
      variant:     'success',
      confirmText: 'Approve',
      cancelText:  'Cancel',
      onConfirm: async () => {
        setDeciding((p) => ({ ...p, [event.id]: 'approving' }));
        try {
          await apiClient.patch(`/institutions/events/${event.id}/approve`);
          await load();
        } catch (err) {
          confirm({
            title:       'Approve failed',
            message:     err?.response?.data?.message || err.message || 'Try again in a moment.',
            variant:     'destructive',
            confirmText: 'OK',
            hideCancel:  true,
          });
        } finally {
          setDeciding((p) => { const c = { ...p }; delete c[event.id]; return c; });
        }
      },
    });
  };

  const rejectBranchEvent = (event) => {
    confirm({
      title:       'Reject event?',
      message:     `Reject "${event.title}"? The branch admin will be notified.`,
      variant:     'destructive',
      confirmText: 'Reject',
      cancelText:  'Cancel',
      onConfirm: async () => {
        setDeciding((p) => ({ ...p, [event.id]: 'rejecting' }));
        try {
          await apiClient.patch(`/institutions/events/${event.id}/reject`, {
            reason: 'Not approved by the main institution.',
          });
          await load();
        } catch (err) {
          confirm({
            title:       'Reject failed',
            message:     err?.response?.data?.message || err.message || 'Try again in a moment.',
            variant:     'destructive',
            confirmText: 'OK',
            hideCancel:  true,
          });
        } finally {
          setDeciding((p) => { const c = { ...p }; delete c[event.id]; return c; });
        }
      },
    });
  };

  // Refetch every time the screen is focused — covers the "admin just
  // published a new event, comes back to this screen" path.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // MODULE 5: separate the API's flat event list into three buckets:
  //   • My Institution Events — Upcoming (own + is_own=true, status
  //     not 'past'/'rejected')
  //   • My Institution Events — History (own + past OR rejected)
  //   • Other Institution Events — approved intras from OTHER
  //     institutions. Backend already filters these to event_date >=
  //     CURRENT_DATE so expired externals aren't in the payload.
  const [historyOpen, setHistoryOpen] = useState(false);

  const { myUpcoming, myHistory, otherUpcoming } = useMemo(() => {
    const mu = [];
    const mh = [];
    const ou = [];
    const nowMs = Date.now();
    events.forEach((e) => {
      const isOwn = e.is_own !== false; // undefined defaults to own
      const eventMs = e.event_date ? new Date(e.event_date).getTime() : null;
      const isPast = e.status === 'past'
        || e.status === 'rejected'
        || (eventMs != null && eventMs < nowMs - 24 * 60 * 60 * 1000);
      if (isOwn) {
        if (isPast) mh.push(e); else mu.push(e);
      } else {
        // External rows the backend returned are already upcoming.
        // Extra client-side guard in case the API sent a same-day
        // row after the event finished.
        if (!isPast) ou.push(e);
      }
    });
    mu.sort((a, b) => new Date(a.event_date) - new Date(b.event_date));
    mh.sort((a, b) => new Date(b.event_date) - new Date(a.event_date));
    ou.sort((a, b) => new Date(a.event_date) - new Date(b.event_date));
    return { myUpcoming: mu, myHistory: mh, otherUpcoming: ou };
  }, [events]);

  // Flatten into a single list with section headers so we get one
  // smooth FlatList. History rows are only emitted when the History
  // toggle is on.
  const data = useMemo(() => {
    const rows = [];
    // Pending branch approvals sit above everything else — that's what
    // demands the main admin's attention.
    if (pendingBranchEvents.length) {
      rows.push({ type: 'header', label: `Pending Approvals · ${pendingBranchEvents.length}` });
      pendingBranchEvents.forEach((e) =>
        rows.push({ type: 'pending', event: e })
      );
    }

    // ── My Institution Events ─────────────────────────────
    rows.push({
      type:     'group',
      label:    'My Institution Events',
      // Right-side action button — jumps to History and back.
      // Always tappable so the admin can enter the History view
      // even when it's empty (the empty-state row explains why).
      action:   {
        label: historyOpen
          ? 'Show upcoming'
          : (myHistory.length ? `History · ${myHistory.length}` : 'History'),
        onPress: () => setHistoryOpen((v) => !v),
      },
    });
    if (!historyOpen) {
      if (myUpcoming.length === 0) {
        rows.push({ type: 'emptyOwn' });
      } else {
        rows.push({ type: 'header', label: `Upcoming · ${myUpcoming.length}` });
        myUpcoming.forEach((e) => rows.push({ type: 'event', event: e }));
      }
    } else {
      if (myHistory.length === 0) {
        rows.push({ type: 'emptyHistory' });
      } else {
        rows.push({ type: 'header', label: `Conducted / Past · ${myHistory.length}` });
        myHistory.forEach((e) => rows.push({ type: 'event', event: e }));
      }
    }

    // ── Other Institution Events ──────────────────────────
    rows.push({ type: 'group', label: 'Other Institution Events' });
    if (otherUpcoming.length === 0) {
      rows.push({ type: 'emptyOther' });
    } else {
      rows.push({ type: 'header', label: `Upcoming · ${otherUpcoming.length}` });
      otherUpcoming.forEach((e) => rows.push({ type: 'event', event: e }));
    }
    return rows;
  }, [myUpcoming, myHistory, otherUpcoming, pendingBranchEvents, historyOpen]);

  const renderItem = ({ item }) => {
    if (item.type === 'group') {
      // Big group heading — "My Institution Events" / "Other
      // Institution Events". Includes an optional right-side
      // action (History toggle for the My section).
      return (
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          marginTop: 18, marginBottom: 4,
        }}>
          <Text style={[styles.sectionTitle, { fontSize: 15, marginTop: 0 }]}>
            {item.label}
          </Text>
          {item.action ? (
            <TouchableOpacity
              onPress={item.action.onPress}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{
                paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
                borderWidth: 1, borderColor: BRAND,
                backgroundColor: BRAND_SOFT,
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: '800', color: BRAND }}>
                {item.action.label}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      );
    }
    if (item.type === 'header') {
      return <Text style={styles.sectionTitle}>{item.label}</Text>;
    }
    if (item.type === 'emptyOwn') {
      return (
        <Text style={{ color: TEXT_MUTED, fontSize: 12, paddingVertical: 12 }}>
          You haven't published any upcoming events yet.   </Text>
      );
    }
    if (item.type === 'emptyHistory') {
      return (
        <Text style={{ color: TEXT_MUTED, fontSize: 12, paddingVertical: 12 }}>
          Your conducted events will appear here after they finish.
        </Text>
      );
    }
    if (item.type === 'emptyOther') {
      return (
        <Text style={{ color: TEXT_MUTED, fontSize: 12, paddingVertical: 12 }}>
          No cross-institution events from other academies right now.
        </Text>
      );
    }
    if (item.type === 'pending') {
      return (
        <PendingApprovalCard
          event={item.event}
          busy={deciding[item.event.id]}
          onApprove={() => approveBranchEvent(item.event)}
          onReject={() => rejectBranchEvent(item.event)}
          onPress={() => navigation.navigate('InstitutionEventDetail', { event: item.event })}
        />
      );
    }
    return (
      <EventCard
        event={item.event}
        onPress={() => navigation.navigate('InstitutionEventDetail', { event: item.event })}
        // Edit is only offered on Inter-Level (event_type='intra')
        // events that the current institution owns AND that are
        // still awaiting super-admin approval. Passing null makes
        // EventCard skip the Edit button entirely — approved /
        // rejected / non-intra / other-institution rows never see
        // it, so the check lives entirely in this parent decision.
        onEdit={
          item.event.event_type === 'intra'
            && item.event.is_own !== false
            && (item.event.status === 'pending' || item.event.approval_status === 'pending')
            ? () => navigation.navigate('CreateEvent', {
                eventType: 'intra',
                editEvent: item.event,
              })
            : null
        }
      />
    );
  };

  // Dark-mode overrides pulled from the shared ThemeContext.
  // Institution Home's ambient background is skipped in dark mode.
  const { mode, palette: themePalette } = useTheme();
  const isDark = mode === 'dark';
  const dark   = useMemo(() => (isDark ? buildDarkOverrides(themePalette) : {}), [isDark, themePalette]);

  return (
    <EventsListCtx.Provider value={{ isDark, dark }}>
    <View style={[styles.screen, isDark && dark.screen]}>
      {/* Institution Home ambient wash — sits behind all content. */}
      {!isDark ? <InstitutionScreenBackground layer /> : null}
      {/* ───── Header ───── */}
      <View style={[styles.header, isDark && dark.header]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.iconBtn, isDark && dark.iconBtn]} activeOpacity={0.7}>
          <ArrowLeft size={20} color={isDark ? themePalette.text : TEXT} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, isDark && dark.headerTitle]}>Events</Text>
          <Text style={[styles.headerSub, isDark && dark.headerSub]}>
            {myUpcoming.length} upcoming · {otherUpcoming.length} from other academies
          </Text>
        </View>
      </View>

      {/* ───── List / loading / empty ───── */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={BRAND} />
        </View>
      ) : data.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <Calendar size={32} color={BRAND} strokeWidth={2} />
          </View>
          <Text style={styles.emptyTitle}>No events yet</Text>
          <Text style={styles.emptySub}>
            Tap the + button to publish your first event. It'll show up on
            every student and trainer's home screen straight away.
          </Text>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item, i) => {
            // New row types added in MODULE 5 don't carry an event
            // reference — they're pure UI rows (group headings and
            // empty-state placeholders). Only 'event' / 'pending'
            // rows have item.event, so guard the id access.
            if (item.event && item.event.id != null) return `e-${item.type}-${item.event.id}`;
            return `${item.type}-${i}`;
          }}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={BRAND}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}

    </View>
    </EventsListCtx.Provider>
  );
}

// ─── Event card ─────────────────────────────────────────────────────────
function EventCard({ event, onPress, onEdit }) {
  const d = event.event_date ? new Date(event.event_date) : null;
  const day = d ? String(d.getDate()).padStart(2, '0') : '--';
  const mon = d ? d.toLocaleString('en-US', { month: 'short' }).toUpperCase() : '---';
  const isPast      = event.status === 'past';
  const isScheduled = event.status === 'scheduled';
  const isPending   = event.status === 'pending';
  const isRejected  = event.status === 'rejected';

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.card, isPast && styles.cardPast]}
    >
      {/* Top row: date block + title block */}
      <View style={styles.cardTop}>
        <View
          style={[
            styles.dateBlock,
            isPast ? { backgroundColor: '#F1F5F9' } : { backgroundColor: BRAND_SOFT },
          ]}
        >
          <Text style={[
            styles.dateDay,
            { color: isPast ? TEXT_MUTED : BRAND },
          ]}>
            {day}
          </Text>
          <Text style={[
            styles.dateMonth,
            { color: isPast ? TEXT_MUTED : BRAND },
          ]}>
            {mon}
          </Text>
        </View>

        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text style={styles.title} numberOfLines={2}>{event.title}</Text>
            {/* Type badge — stored event_type is inverted from the UI
                label: 'intra' in DB = Inter-Level (cross-institution).
                Show INTER badge for cross-institution events, INTRA for
                institution-local. */}
            {event.event_type === 'intra' ? (
              <View style={{
                paddingHorizontal: 6, paddingVertical: 2,
                borderRadius: 4,
                backgroundColor: '#DBEAFE',
              }}>
                <Text style={{
                  fontSize: 9, fontWeight: '800', color: '#1E40AF',
                  letterSpacing: 0.5,
                }}>
                  INTER
                </Text>
              </View>
            ) : event.event_type === 'inter' ? (
              <View style={{
                paddingHorizontal: 6, paddingVertical: 2,
                borderRadius: 4,
                backgroundColor: '#EDE9FE',
              }}>
                <Text style={{
                  fontSize: 9, fontWeight: '800', color: '#6D28D9',
                  letterSpacing: 0.5,
                }}>
                  INTRA
                </Text>
              </View>
            ) : null}
          </View>
          {event.subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>{event.subtitle}</Text>
          ) : null}
          {/* Organizer line — shown for cross-institution intras
              (event.is_own === false) so admins immediately see
              WHICH academy submitted the event they're looking at.
              Hidden for the admin's own rows to avoid the noise of
              seeing their own academy's name on every card. */}
          {event.event_type === 'intra' && event.is_own === false && event.organizing_institution_name ? (
            <Text
              style={[styles.metaText, { color: BRAND, fontWeight: '700', marginTop: 2 }]}
              numberOfLines={1}
            >
              Organized by {event.organizing_institution_name}
            </Text>
          ) : null}
          <View style={styles.metaRow}>
            <View style={styles.metaPiece}>
              <Calendar size={11} color={TEXT_MUTED} strokeWidth={2.2} />
              <Text style={styles.metaText}>{formatDate(event.event_date)}</Text>
            </View>
            {event.location ? (
              <View style={styles.metaPiece}>
                <MapPin size={11} color={TEXT_MUTED} strokeWidth={2.2} />
                <Text style={styles.metaText} numberOfLines={1}>{event.location}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Status pill — Pending / Rejected / Past / Scheduled / Live.
            Approval outcomes take priority over date state (a rejected
            event is rejected regardless of when it was scheduled). */}
        <View
          style={[
            styles.statusPill,
            isPending
              ? { backgroundColor: '#FEF3C7' }
              : isRejected
                ? { backgroundColor: '#FEE2E2' }
                : isPast
                  ? { backgroundColor: '#F1F5F9' }
                  : isScheduled
                    ? { backgroundColor: '#FEF3C7' }
                    : { backgroundColor: GREEN + '22' },
          ]}
        >
          {isPending ? (
            <AlertCircle size={10} color="#B45309" strokeWidth={2.4} />
          ) : isRejected ? (
            <X size={10} color="#B91C1C" strokeWidth={2.4} />
          ) : isPast ? (
            <Clock size={10} color={TEXT_MUTED} strokeWidth={2.4} />
          ) : isScheduled ? (
            <Clock size={10} color="#B45309" strokeWidth={2.4} />
          ) : (
            <CheckCircle2 size={10} color={GREEN} strokeWidth={2.4} />
          )}
          <Text
            style={[
              styles.statusText,
              {
                color: isPending  ? '#B45309'
                     : isRejected ? '#B91C1C'
                     : isPast     ? TEXT_MUTED
                     : isScheduled ? '#B45309'
                     : GREEN,
              },
            ]}
          >
            {isPending  ? 'Pending'
             : isRejected ? 'Rejected'
             : isPast    ? 'Past'
             : isScheduled ? 'Scheduled'
             : 'Live'}
          </Text>
        </View>
      </View>

      {/* Banner image (if any) — use resizeMode="contain" so the
          uploaded image preserves its original aspect ratio (portrait,
          landscape, square, 4:3, 16:9 all render without cropping
          or stretching). The container is a max-height frame so the
          image can grow vertically for tall portrait shots. */}
      {event.image_url ? (
        <Image
          source={{ uri: resolveAssetUrl(event.image_url) }}
          style={styles.banner}
          resizeMode="contain"
        />
      ) : null}

      {/* Description preview */}
      {event.description ? (
        <Text style={styles.description} numberOfLines={3}>
          {event.description}
        </Text>
      ) : null}

      {/* Edit — only rendered when the parent decided this row is
          eligible (own Inter-Level event still awaiting super-admin
          approval). onEdit is null for every other card, so the
          button never even mounts. Uses stopPropagation-equivalent
          by not bubbling to the outer TouchableOpacity's onPress
          when the small button is tapped (RN nested Touchables
          swallow the tap by default). */}
      {onEdit ? (
        <View style={styles.editRow}>
          <TouchableOpacity
            onPress={onEdit}
            activeOpacity={0.85}
            style={styles.editBtn}
          >
            <Pencil size={12} color={BRAND} strokeWidth={2.6} />
            <Text style={styles.editBtnText}>Edit event</Text>
          </TouchableOpacity>
          <Text style={styles.editHint}>
            Editable until the platform reviewer approves.
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

// ─── Pending Approval card ──────────────────────────────────────────────
// Rendered only in the parent admin's EventsList, at the top under a
// "Pending Approvals" section header. Each card shows the branch name
// so the parent knows which sub-branch submitted the event, plus
// Approve / Reject action buttons.
function PendingApprovalCard({ event, busy, onApprove, onReject, onPress }) {
  const d = event.event_date ? new Date(event.event_date) : null;
  const day = d ? String(d.getDate()).padStart(2, '0') : '--';
  const mon = d ? d.toLocaleString('en-US', { month: 'short' }).toUpperCase() : '---';
  const approving = busy === 'approving';
  const rejecting = busy === 'rejecting';
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.9}
      style={[styles.card, styles.pendingCard]}
    >
      <View style={styles.cardTop}>
        <View style={[styles.dateBlock, { backgroundColor: '#FEF3C7' }]}>
          <Text style={[styles.dateDay, { color: '#B45309' }]}>{day}</Text>
          <Text style={[styles.dateMonth, { color: '#B45309' }]}>{mon}</Text>
        </View>

        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={2}>{event.title}</Text>
          {event.branch_name ? (
            <Text style={styles.branchLine} numberOfLines={1}>
              From: {event.branch_name}
            </Text>
          ) : null}
          <View style={styles.metaRow}>
            <View style={styles.metaPiece}>
              <Calendar size={11} color={TEXT_MUTED} strokeWidth={2.2} />
              <Text style={styles.metaText}>{formatDate(event.event_date)}</Text>
            </View>
            {event.location ? (
              <View style={styles.metaPiece}>
                <MapPin size={11} color={TEXT_MUTED} strokeWidth={2.2} />
                <Text style={styles.metaText} numberOfLines={1}>{event.location}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={[styles.statusPill, { backgroundColor: '#FEF3C7' }]}>
          <AlertCircle size={10} color="#B45309" strokeWidth={2.4} />
          <Text style={[styles.statusText, { color: '#B45309' }]}>Pending</Text>
        </View>
      </View>

      {event.payment_required ? (
        <Text style={styles.feeHint}>
          Paid event · ₹{Number(event.payment_amount || 0).toLocaleString('en-IN')}
        </Text>
      ) : null}

      <View style={styles.decideRow}>
        <TouchableOpacity
          onPress={onReject}
          disabled={approving || rejecting}
          activeOpacity={0.85}
          style={[styles.rejectBtn, (approving || rejecting) && { opacity: 0.6 }]}
        >
          {rejecting ? (
            <ActivityIndicator color="#B91C1C" />
          ) : (
            <>
              <X size={12} color="#B91C1C" strokeWidth={2.6} />
              <Text style={styles.rejectBtnText}>Reject</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onApprove}
          disabled={approving || rejecting}
          activeOpacity={0.85}
          style={[styles.approveBtn, (approving || rejecting) && { opacity: 0.6 }]}
        >
          {approving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Check size={12} color="#fff" strokeWidth={2.6} />
              <Text style={styles.approveBtnText}>Approve</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  // Header — glass slab with navy title and a soft blue lift
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
  headerTitle: { fontSize: 17, fontWeight: '800', color: HEADER_NAVY, letterSpacing: 0.2 },
  headerSub:   { fontSize: 11, color: TEXT_MUTED, marginTop: 2, fontWeight: '600' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: TEXT, marginBottom: 6 },
  emptySub: {
    fontSize: 13, color: TEXT_MUTED, textAlign: 'center',
    lineHeight: 19, paddingHorizontal: 12,
  },

  sectionTitle: {
    fontSize: 11, fontWeight: '700', color: TEXT_MUTED,
    letterSpacing: 1, textTransform: 'uppercase',
    marginTop: 12, marginBottom: 8,
  },

  // Event card — translucent glass fill + light glass border + soft
  // blue lift shadow so each card reads as a glass panel on the
  // Institution Home ambient wash.
  card: {
    backgroundColor: GLASS_FILL_STRONG,
    borderRadius: 16,
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
    padding: 14, marginBottom: 12,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  cardPast: { opacity: 0.85 },

  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },

  dateBlock: {
    width: 52, height: 60, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  dateDay: { fontSize: 18, fontWeight: '900' },
  dateMonth: { fontSize: 10, fontWeight: '800', letterSpacing: 1, marginTop: -2 },

  title: { fontSize: 15, fontWeight: '800', color: TEXT, marginBottom: 3 },
  subtitle: { fontSize: 12, color: TEXT_MUTED, fontWeight: '600', marginBottom: 6 },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 2 },
  metaPiece: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  metaText: { fontSize: 11, color: TEXT_MUTED, fontWeight: '600' },

  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
  },
  statusText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },

  // Adaptive banner frame — width fills, height caps at 220 so a
  // portrait image can stretch tall without dominating the card,
  // and a landscape image letterboxes cleanly inside the frame.
  // resizeMode="contain" on the Image itself preserves the
  // original aspect ratio without cropping or stretching.
  banner: {
    width: '100%',
    height: 220,
    borderRadius: 10,
    marginTop: 12,
    backgroundColor: BG,
  },

  description: {
    fontSize: 12, color: TEXT_MUTED,
    lineHeight: 17, marginTop: 10,
  },

  // Edit row on Inter-Level events awaiting super-admin approval.
  // Sits at the bottom of the card, gets its own separator so it
  // reads as a distinct affordance rather than another meta line.
  editRow: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: BRAND_SOFT,
    borderWidth: 1, borderColor: BRAND_SOFT,
  },
  editBtnText: {
    fontSize: 11, fontWeight: '800', color: BRAND, letterSpacing: 0.2,
  },
  editHint: {
    flex: 1,
    fontSize: 10, color: TEXT_MUTED, fontWeight: '600',
  },

  // ── Pending-approval card ────────────────────────────────────────
  pendingCard: {
    borderColor: '#FCD34D',
    borderLeftWidth: 4,
    borderLeftColor: '#F59E0B',
  },
  branchLine: {
    fontSize: 11, color: '#B45309', fontWeight: '800',
    marginTop: 2,
    letterSpacing: 0.2,
  },
  feeHint: {
    marginTop: 8, fontSize: 11, color: '#059669', fontWeight: '700',
  },
  decideRow: {
    flexDirection: 'row', gap: 8, marginTop: 12,
  },
  rejectBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 10, borderRadius: 10,
    backgroundColor: '#FEE2E2', borderWidth: 1, borderColor: '#FCA5A5',
  },
  rejectBtnText: { fontSize: 12, fontWeight: '800', color: '#B91C1C' },
  approveBtn: {
    flex: 1.4,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 10, borderRadius: 10,
    backgroundColor: GREEN,
  },
  approveBtnText: { fontSize: 12, fontWeight: '800', color: '#fff' },
});
