// src/screens/student/StudentBeltJourneyScreen.js
//
// Belt Badges & Certifications — student/parent view.
//
// Layout:
//   1. Hero — current belt with the big colored chip + emoji
//   2. Achievement summary tiles (belts earned, certificates, progress %)
//   3. Belt journey list — each belt with completed/current/locked status
//   4. Recent certificates grid — tap to open detail
//   5. Timeline — chronological feed of promotions + cert issuances
//
// Route params: { student_id?, student_name? } — when supplied, used for
// the parent flow viewing a child. Defaults to the logged-in student.

import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Award, Lock, CheckCircle2, Star, FileText, Calendar,
  TrendingUp, ChevronRight, Trophy,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Colour swatch for a belt label. Institution-configured belts arrive
// with a real color_hex from the backend; the new
// belt_promotion_requests flow stores freeform labels ("Blue II",
// "Brown III") without a hex. We derive a colour by matching the
// FIRST word of the label against the standard belt palette so the
// timeline still reads visually. Ranks with no colour word fall back
// to a neutral swatch.
const BELT_COLOR_BY_KEY = {
  white:  '#FFFFFF', yellow: '#F59E0B', orange: '#F97316', green:  '#22C55E',
  blue:   '#3B82F6', gray:   '#9CA3AF', grey:   '#9CA3AF', brown:  '#A16207',
  black:  '#0F172A', red:    '#DC2626', purple: '#8B5CF6',
};
function beltColorFor(label, provided) {
  if (provided) return provided;
  const first = String(label || '').trim().toLowerCase().split(/\s+/)[0];
  return BELT_COLOR_BY_KEY[first] || palette.borderSoft;
}

// Canonical belt sequence — the 12 ranks the app renders on every
// student journey. Same list as the enrollment form's BELT_OPTIONS
// (minus "Other") and the trainer's Promote Belt dropdown, so all
// three surfaces (enrol / promote / journey) agree on the ladder a
// student walks. Rendered even when the institution's own
// belt_levels catalogue is shorter or empty — extra ranks the
// institution DID configure get merged in via buildSequence below,
// so an academy that runs 15 belts still sees every one of them.
const CANONICAL_BELT_SEQUENCE = [
  'White', 'Yellow', 'Orange', 'Green',
  'Blue', 'Blue I', 'Blue II', 'Gray',
  'Brown I', 'Brown II', 'Brown III', 'Black',
];

// Normalise a belt label for equality checks — trims, lowercases,
// strips a trailing "belt" so "White Belt" and "White" match. Blue I
// stays distinct from Blue.
function normaliseBeltKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+belt$/, '')
    .replace(/\s+/g, ' ');
}

// Build the full sequence to render. We ALWAYS render the canonical
// 12-belt ladder so every student sees the same recognisable path
// regardless of what their institution has configured on the
// backend. Then:
//   • Institution-configured extras (belts in `belts[]` that aren't
//     in the canonical list) are appended in their configured order,
//     so an academy with "1st Dan / 2nd Dan / Assistant Instructor"
//     ranks after Black still gets them visible.
//   • Any belt appearing in `belt_history` that isn't already in the
//     sequence gets appended too — the student's earned belts must
//     ALL be represented.
//
// Colour + emoji fall back to the catalogue row when available so
// custom colours (e.g. an academy's dark-green Green Belt) still
// win over the derived hex.
//
// Each output entry: { key, name, color_hex, emoji, event,
//                      unlocked, isCurrent }.
function buildSequence(catalogue, history) {
  // Catalogue lookup by normalised key — used to enrich canonical
  // entries with the institution's real colour_hex / emoji when
  // they exist.
  const catByKey = new Map();
  (catalogue || []).forEach((b) => {
    const k = normaliseBeltKey(b.name);
    if (k && !catByKey.has(k)) {
      catByKey.set(k, { name: b.name, color_hex: b.color_hex || null, emoji: b.emoji || null });
    }
  });

  const seen = new Set();
  const base = [];

  // 1) The canonical 12.
  CANONICAL_BELT_SEQUENCE.forEach((name) => {
    const key = normaliseBeltKey(name);
    if (seen.has(key)) return;
    seen.add(key);
    const cat = catByKey.get(key);
    base.push({
      key,
      // Prefer the institution's exact label if they've configured
      // one for this rank (e.g. "White Belt" vs "White").
      name:      cat?.name || name,
      color_hex: cat?.color_hex || null,
      emoji:     cat?.emoji || null,
    });
  });

  // 2) Any extras the institution defined that aren't in the canonical
  //    list, in their configured order.
  (catalogue || []).forEach((b) => {
    const key = normaliseBeltKey(b.name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    base.push({
      key,
      name:      b.name,
      color_hex: b.color_hex || null,
      emoji:     b.emoji || null,
    });
  });

  // 3) Belts in belt_history that aren't in the base yet (custom
  //    labels the trainer picked "freeform" that don't match either
  //    the canonical list or the institution catalogue).
  (history || []).forEach((h) => {
    const key = normaliseBeltKey(h.belt_name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    base.push({
      key,
      name:      h.belt_name,
      color_hex: h.color_hex || null,
      emoji:     h.emoji || null,
    });
  });

  // Index history by normalised key for O(1) lookup.
  const eventByKey = new Map();
  (history || []).forEach((h) => {
    const k = normaliseBeltKey(h.belt_name);
    if (k && !eventByKey.has(k)) eventByKey.set(k, h);
  });

  // Find the highest rank the student has actually reached in this
  // sequence. Everything at or below is unlocked; everything above
  // is locked. Handles the "jumped a rank" case cleanly — a
  // promotion straight to Blue II implicitly unlocks all the ranks
  // before it in the ladder.
  let latestReachedIdx = -1;
  base.forEach((b, i) => {
    if (eventByKey.has(b.key)) latestReachedIdx = Math.max(latestReachedIdx, i);
  });

  return base.map((b, i) => {
    const event = eventByKey.get(b.key) || null;
    const unlocked = event != null || i <= latestReachedIdx;
    return { ...b, event, unlocked, isCurrent: i === latestReachedIdx };
  });
}

export default function StudentBeltJourneyScreen({ navigation, route }) {
  const studentIdParam = route?.params?.student_id || null;
  const studentNameParam = route?.params?.student_name || null;

  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const url = studentIdParam
        ? `/belts/journey/${studentIdParam}`
        : '/belts/my-journey';
      const res = await apiClient.get(url);
      setData(res.data || null);
    } catch (err) {
      console.log('[BeltJourney] load error:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [studentIdParam]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !data) {
    return (
      <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={palette.purple.vivid} />
      </View>
    );
  }

  const {
    belts = [],
    belt_history = [],
    current_belt: current,
    certificates = [],
    summary = {},
    timeline = [],
  } = data;
  // Progress % uses the catalogue view when available (how far
  // through the institution's belt sequence the student has walked).
  // Falls back to the belt_history count when the catalogue is empty
  // so a freshly seeded institution still shows a sane number.
  const totalBelts = belts.length || belt_history.length || 1;
  const completed = belts.length > 0
    ? belts.filter((b) => b.status === 'completed' || b.status === 'current').length
    : belt_history.length;
  const progressPct = Math.round((completed / totalBelts) * 100);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft size={20} color={palette.dark} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Belt Journey</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {studentNameParam || data.student?.name || 'Your progress'}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.purple.vivid}
          />
        }
      >
        {/* Hero — current belt */}
        <View style={styles.hero}>
          <View style={styles.heroBlobA} />
          <View style={styles.heroBlobB} />
          <View style={styles.heroRow}>
            <View
              style={[
                styles.heroBeltChip,
                { backgroundColor: beltColorFor(current?.name, current?.color_hex) },
              ]}
            >
              <Text style={styles.heroBeltEmoji}>{current?.emoji || '🥋'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroEyebrow}>CURRENT BELT</Text>
              <Text style={styles.heroBeltName}>
                {current ? current.name : 'No belt yet'}
              </Text>
              {current?.earned_at ? (
                <Text style={styles.heroEarned}>Earned {fmtDate(current.earned_at)}</Text>
              ) : (
                <Text style={styles.heroEarned}>Your first belt is coming soon!</Text>
              )}
            </View>
          </View>
        </View>

        {/* Achievement summary */}
        <View style={styles.summaryRow}>
          <SummaryTile
            icon={Award}
            label="Belts Earned"
            value={summary.belts_earned || 0}
            accent={palette.purple}
          />
          <SummaryTile
            icon={FileText}
            label="Certificates"
            value={summary.certificates || 0}
            accent={palette.green}
          />
          <SummaryTile
            icon={TrendingUp}
            label="Progress"
            value={`${progressPct}%`}
            accent={palette.orange}
          />
        </View>

        {/* ── Belt Journey ─────────────────────────────────────
            Shows EVERY belt in the institution's sequence (falls back
            to the canonical 12-rank list when the institution hasn't
            defined a custom catalogue). Each belt is one of:
              • Unlocked — student has reached this belt (or a higher
                           one in the sequence). Shows event details
                           when we have them from belt_history.
              • Locked   — upcoming belts the student hasn't reached
                           yet. Rendered muted with a padlock so the
                           progression is visible without misleading
                           them into thinking they've earned it.
            The latest unlocked belt carries the CURRENT pill. Order
            is first-to-latest per spec. */}
        <Text style={styles.sectionTitle}>Belt Journey</Text>
        <View style={styles.journeyCard}>
          {(() => {
            const sequence = buildSequence(belts, belt_history);
            if (sequence.length === 0) {
              return (
                <Text style={styles.emptyText}>
                  No belt sequence configured yet. Your institution will publish the belt progression soon.
                </Text>
              );
            }
            return sequence.map((seq, i) => (
              <BeltJourneyRow
                key={`${seq.key}-${i}`}
                seq={seq}
                isLast={i === sequence.length - 1}
              />
            ));
          })()}
        </View>

        {/* Certificates */}
        <Text style={styles.sectionTitle}>Certificates</Text>
        {certificates.length === 0 ? (
          <View style={styles.emptyCert}>
            <FileText size={24} color={palette.textLight} />
            <Text style={styles.emptyText}>No certificates yet.</Text>
          </View>
        ) : (
          certificates.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={styles.certCard}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('CertificateDetail', { certificate: c })}
            >
              <View style={styles.certIcon}>
                <Trophy
                  size={18}
                  color={c.kind === 'tournament' ? palette.orange.vivid : palette.purple.vivid}
                  strokeWidth={2.4}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.certTitle} numberOfLines={1}>{c.title}</Text>
                <Text style={styles.certMeta}>
                  {fmtDate(c.issue_date)} · #{c.certificate_no}
                </Text>
              </View>
              <View style={[
                styles.certStatus,
                c.status === 'verified' ? styles.certVerified : styles.certRevoked,
              ]}>
                <CheckCircle2 size={11} color={c.status === 'verified' ? '#15803D' : '#991B1B'} strokeWidth={2.4} />
                <Text style={[
                  styles.certStatusText,
                  { color: c.status === 'verified' ? '#15803D' : '#991B1B' },
                ]}>
                  {c.status === 'verified' ? 'VERIFIED' : 'REVOKED'}
                </Text>
              </View>
              <ChevronRight size={16} color={palette.textLight} />
            </TouchableOpacity>
          ))
        )}

        {/* Timeline */}
        {timeline.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Timeline</Text>
            <View style={styles.timelineCard}>
              {timeline.map((t, i) => (
                <View key={`${t.kind}-${i}`} style={styles.timelineRow}>
                  <View style={styles.timelineDot}>
                    <Text style={{ fontSize: 14 }}>{t.emoji || '•'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.timelineTitle}>{t.title}</Text>
                    <Text style={styles.timelineDate}>{fmtDate(t.date)}</Text>
                    {t.notes ? (
                      <Text style={styles.timelineNotes} numberOfLines={2}>{t.notes}</Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
}

function SummaryTile({ icon: Icon, label, value, accent }) {
  return (
    <View style={[styles.summaryTile, { borderColor: accent.soft }]}>
      <View style={[styles.summaryIcon, { backgroundColor: accent.soft }]}>
        <Icon size={16} color={accent.vivid} strokeWidth={2.4} />
      </View>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

// One row in the Belt Journey timeline — a stop on the sequence
// (built by buildSequence()). Renders either the Unlocked state
// (colour swatch + event details when we have them, else just the
// belt name + "Unlocked" pill) or the Locked state (muted swatch +
// padlock). The latest unlocked belt carries the CURRENT pill.
function BeltJourneyRow({ seq, isLast }) {
  const { unlocked, isCurrent, event } = seq;
  const swatchBase = beltColorFor(seq.name, seq.color_hex);
  // Locked belts get a muted swatch so the row reads as "future"
  // without hiding the belt's colour identity entirely — students
  // can still see which colour is coming next.
  const swatch = unlocked ? swatchBase : palette.borderSoft;
  const borderColor = unlocked
    ? (swatchBase.toLowerCase() === '#ffffff' ? '#D1D5DB' : swatchBase)
    : palette.borderSoft;

  return (
    <View style={styles.historyRow}>
      <View style={styles.historyDotCol}>
        <View
          style={[
            styles.historyChip,
            {
              backgroundColor: swatch,
              borderColor,
              opacity: unlocked ? 1 : 0.55,
            },
          ]}
        >
          {unlocked ? (
            <Text style={styles.historyChipEmoji}>{seq.emoji || '🥋'}</Text>
          ) : (
            <Lock size={14} color={palette.textLight} strokeWidth={2.4} />
          )}
        </View>
        {!isLast ? (
          <View
            style={[
              styles.historyConnector,
              !unlocked && { opacity: 0.4 },
            ]}
          />
        ) : null}
      </View>
      <View style={{ flex: 1, paddingBottom: isLast ? 0 : 10 }}>
        <View style={styles.historyHeadRow}>
          <Text
            style={[
              styles.historyName,
              !unlocked && { color: palette.textLight, fontWeight: '700' },
            ]}
            numberOfLines={1}
          >
            {seq.name}
          </Text>
          {isCurrent ? (
            <View style={styles.historyCurrentPill}>
              <Star size={9} color={palette.purple.vivid} strokeWidth={2.6} />
              <Text style={styles.historyCurrentPillText}>CURRENT</Text>
            </View>
          ) : unlocked ? (
            <View style={styles.historyUnlockedPill}>
              <CheckCircle2 size={9} color={palette.green.vivid} strokeWidth={2.6} />
              <Text style={styles.historyUnlockedPillText}>UNLOCKED</Text>
            </View>
          ) : (
            <View style={styles.historyLockedPill}>
              <Lock size={9} color={palette.textLight} strokeWidth={2.6} />
              <Text style={styles.historyLockedPillText}>LOCKED</Text>
            </View>
          )}
        </View>

        {/* Event details — only rendered when the belt is unlocked
            AND we have a real promotion event on file. Skipping this
            block for "implicitly unlocked" belts (student jumped
            ranks) keeps the row honest. */}
        {unlocked && event ? (
          <>
            {event.promoted_at ? (
              <View style={styles.historyMetaRow}>
                <Calendar size={10} color={palette.textLight} strokeWidth={2.4} />
                <Text style={styles.historyMetaText}>{fmtDate(event.promoted_at)}</Text>
              </View>
            ) : null}
            {event.promoted_by ? (
              <View style={styles.historyMetaRow}>
                <Award size={10} color={palette.textLight} strokeWidth={2.4} />
                <Text style={styles.historyMetaText}>Promoted by {event.promoted_by}</Text>
              </View>
            ) : null}
            {event.remarks ? (
              <Text style={styles.historyRemarks} numberOfLines={4}>
                “{event.remarks}”
              </Text>
            ) : null}
          </>
        ) : null}
      </View>
    </View>
  );
}

// One row in the Belt Journey timeline (real promotion event).
// Colour dot on the left connects with a vertical line to the next
// row for a clean stepper look. The latest entry gets a highlighted
// "Current" pill so the student sees which belt is their live rank.
function BeltHistoryRow({ entry, isLast }) {
  const swatch = beltColorFor(entry?.belt_name, entry?.color_hex);
  return (
    <View style={styles.historyRow}>
      <View style={styles.historyDotCol}>
        <View
          style={[
            styles.historyChip,
            {
              backgroundColor: swatch,
              // Darken the border for very-light swatches (white / yellow)
              // so the dot doesn't blur into the card.
              borderColor: swatch.toLowerCase() === '#ffffff' ? '#D1D5DB' : swatch,
            },
          ]}
        >
          <Text style={styles.historyChipEmoji}>{entry?.emoji || '🥋'}</Text>
        </View>
        {!isLast ? <View style={styles.historyConnector} /> : null}
      </View>
      <View style={{ flex: 1, paddingBottom: isLast ? 0 : 10 }}>
        <View style={styles.historyHeadRow}>
          <Text style={styles.historyName} numberOfLines={1}>{entry?.belt_name || 'Belt'}</Text>
          {isLast ? (
            <View style={styles.historyCurrentPill}>
              <Star size={9} color={palette.purple.vivid} strokeWidth={2.6} />
              <Text style={styles.historyCurrentPillText}>CURRENT</Text>
            </View>
          ) : null}
        </View>
        {entry?.promoted_at ? (
          <View style={styles.historyMetaRow}>
            <Calendar size={10} color={palette.textLight} strokeWidth={2.4} />
            <Text style={styles.historyMetaText}>{fmtDate(entry.promoted_at)}</Text>
          </View>
        ) : null}
        {entry?.promoted_by ? (
          <View style={styles.historyMetaRow}>
            <Award size={10} color={palette.textLight} strokeWidth={2.4} />
            <Text style={styles.historyMetaText}>Promoted by {entry.promoted_by}</Text>
          </View>
        ) : null}
        {entry?.remarks ? (
          <Text style={styles.historyRemarks} numberOfLines={4}>
            “{entry.remarks}”
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function BeltRow({ belt, isLast }) {
  const isCurrent   = belt.status === 'current';
  const isCompleted = belt.status === 'completed';
  const isLocked    = belt.status === 'locked';
  return (
    <View style={styles.beltRow}>
      <View style={styles.beltDotCol}>
        <View
          style={[
            styles.beltChip,
            { backgroundColor: belt.color_hex },
            isLocked && { opacity: 0.4 },
          ]}
        >
          <Text style={styles.beltChipEmoji}>{belt.emoji || '🥋'}</Text>
        </View>
        {!isLast ? <View style={[styles.beltConnector, isLocked && { opacity: 0.4 }]} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.beltName, isLocked && styles.beltNameLocked]}>{belt.name}</Text>
        {isCompleted ? (
          <View style={styles.beltStatusRow}>
            <CheckCircle2 size={11} color={palette.green.vivid} strokeWidth={2.4} />
            <Text style={[styles.beltStatusText, { color: palette.green.vivid }]}>
              Completed · {fmtDate(belt.earned_at)}
            </Text>
          </View>
        ) : isCurrent ? (
          <View style={styles.beltStatusRow}>
            <Star size={11} color={palette.purple.vivid} strokeWidth={2.4} />
            <Text style={[styles.beltStatusText, { color: palette.purple.vivid }]}>
              Current{belt.earned_at ? ` · earned ${fmtDate(belt.earned_at)}` : ''}
            </Text>
          </View>
        ) : (
          <View style={styles.beltStatusRow}>
            <Lock size={11} color={palette.textLight} strokeWidth={2.4} />
            <Text style={[styles.beltStatusText, { color: palette.textLight }]}>
              Locked
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingTop: 48, paddingHorizontal: spacing.xl, paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    borderBottomWidth: 1, borderBottomColor: palette.borderSoft,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: palette.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: palette.dark },
  headerSubtitle: { fontSize: 12, color: palette.textLight, marginTop: 1 },

  scrollContent: { padding: spacing.xl },

  hero: {
    overflow: 'hidden',
    backgroundColor: palette.purple.vivid,
    borderRadius: radius.xl,
    padding: 16,
    marginBottom: spacing.lg,
    ...shadows.raised,
  },
  heroBlobA: {
    position: 'absolute', top: -30, right: -20,
    width: 130, height: 130, borderRadius: 65,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  heroBlobB: {
    position: 'absolute', bottom: -40, left: -20,
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  heroBeltChip: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.4)',
  },
  heroBeltEmoji: { fontSize: 30 },
  heroEyebrow: { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.85)', letterSpacing: 1 },
  heroBeltName: { fontSize: 20, fontWeight: '800', color: '#fff', marginTop: 2 },
  heroEarned: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 4 },

  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: spacing.lg },
  summaryTile: {
    flex: 1, backgroundColor: palette.surface,
    borderRadius: radius.lg, padding: 12,
    borderWidth: 1,
  },
  summaryIcon: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 8,
  },
  summaryValue: { fontSize: 18, fontWeight: '800', color: palette.dark },
  summaryLabel: { fontSize: 10, color: palette.textLight, marginTop: 2, fontWeight: '700' },

  sectionTitle: {
    fontSize: 12, color: palette.textLight, fontWeight: '800',
    letterSpacing: 0.5, textTransform: 'uppercase',
    marginTop: spacing.md, marginBottom: 8,
  },

  journeyCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: 14,
    ...shadows.soft,
  },

  // ── Belt history timeline (from belt_history[]) ───────────
  historyRow: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 4,
  },
  historyDotCol: {
    alignItems: 'center',
    width: 40,
  },
  historyChip: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5,
  },
  historyChipEmoji: { fontSize: 16 },
  historyConnector: {
    width: 2, flex: 1,
    backgroundColor: palette.borderSoft,
    marginTop: 4, minHeight: 24,
  },
  historyHeadRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  historyName: {
    flex: 1,
    fontSize: 14, fontWeight: '800', color: palette.dark,
  },
  historyCurrentPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3,
    backgroundColor: palette.purple.soft,
    borderRadius: 999,
  },
  historyCurrentPillText: {
    fontSize: 9, fontWeight: '800', letterSpacing: 0.5,
    color: palette.purple.vivid,
  },
  historyUnlockedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3,
    backgroundColor: palette.green.soft,
    borderRadius: 999,
  },
  historyUnlockedPillText: {
    fontSize: 9, fontWeight: '800', letterSpacing: 0.5,
    color: palette.green.vivid,
  },
  historyLockedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3,
    backgroundColor: palette.surfaceAlt,
    borderRadius: 999,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  historyLockedPillText: {
    fontSize: 9, fontWeight: '800', letterSpacing: 0.5,
    color: palette.textLight,
  },
  historyMetaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginTop: 3,
  },
  historyMetaText: {
    fontSize: 11, color: palette.textLight, fontWeight: '600',
  },
  historyRemarks: {
    fontSize: 12, color: palette.text,
    marginTop: 6, lineHeight: 17, fontStyle: 'italic',
  },
  beltRow: { flexDirection: 'row', gap: 12, paddingVertical: 6 },
  beltDotCol: { alignItems: 'center' },
  beltChip: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  beltChipEmoji: { fontSize: 18 },
  beltConnector: {
    width: 2, flex: 1, backgroundColor: palette.borderSoft,
    marginTop: 4, marginBottom: -4,
  },
  beltName: { fontSize: 14, fontWeight: '700', color: palette.dark, marginTop: 6 },
  beltNameLocked: { color: palette.textLight },
  beltStatusRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 3,
  },
  beltStatusText: { fontSize: 11, fontWeight: '700' },

  certCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: 12,
    marginBottom: 8,
    ...shadows.soft,
  },
  certIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  certTitle: { fontSize: 14, fontWeight: '700', color: palette.dark },
  certMeta: { fontSize: 11, color: palette.textLight, marginTop: 2 },
  certStatus: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: 999,
  },
  certVerified: { backgroundColor: '#DCFCE7' },
  certRevoked: { backgroundColor: '#FEE2E2' },
  certStatusText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },

  emptyCert: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: palette.surface,
    borderRadius: radius.lg, padding: 14,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  emptyText: { fontSize: 12, color: palette.textLight },

  timelineCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: 14,
    ...shadows.soft,
  },
  timelineRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  timelineDot: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: palette.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  timelineTitle: { fontSize: 13, fontWeight: '700', color: palette.dark },
  timelineDate: { fontSize: 11, color: palette.textLight, marginTop: 1 },
  timelineNotes: { fontSize: 11, color: palette.text, marginTop: 4, lineHeight: 16 },
});
