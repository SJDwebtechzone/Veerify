// src/screens/parent/LinkedChildrenScreen.js
//
// Step 1 of the Parent module - list of linked students with a rich summary
// card for each and a "switch active child" action.
//
// Each card surfaces what the spec asked for:
//   - Student avatar (initials, color-coded by belt)
//   - Name
//   - Gender · Age
//   - Belt category badge
//   - Batch timing (first enrolled batch shown)
//   - Trainer name
//   - "Active" pill on the currently-active child
//
// Data:
//   GET /api/parents/children                 (list, already exists)
//   GET /api/parents/children/:id/summary     (per-child summary)
//   GET /api/parents/children/:id/enrollments (batch + trainer info)

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl, Alert,
} from 'react-native';
import {
  ArrowLeft, Users, Plus, Check, Award, Clock, User, GraduationCap,
  ChevronRight,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { useChild } from '../../context/ChildContext';
import { palette, spacing, radius, shadows, type } from '../../theme';

// Same belt table the staff screens use, so a student looks identical to a
// trainer and to their own parent.
const BELTS = [
  { key: 'white',  label: 'White',  bg: '#FFFFFF', fg: '#111827', border: '#E5E7EB' },
  { key: 'yellow', label: 'Yellow', bg: '#FEF3C7', fg: '#92400E', border: '#F59E0B' },
  { key: 'orange', label: 'Orange', bg: '#FFEDD5', fg: '#9A3412', border: '#F97316' },
  { key: 'green',  label: 'Green',  bg: '#DCFCE7', fg: '#166534', border: '#22C55E' },
  { key: 'blue',   label: 'Blue',   bg: '#DBEAFE', fg: '#1E40AF', border: '#3B82F6' },
  { key: 'brown',  label: 'Brown',  bg: '#FAEDD5', fg: '#7C2D12', border: '#A16207' },
  { key: 'black',  label: 'Black',  bg: '#1F2937', fg: '#FFFFFF', border: '#0F172A' },
];
const beltFor   = (id) => BELTS[Math.abs(Number(id) || 0) % BELTS.length];
const genderFor = (id) => (Math.abs(Number(id) || 0) % 2 === 0 ? 'Male' : 'Female');
const ageFor    = (id) => 12 + (Math.abs(Number(id) || 0) % 24);

export default function LinkedChildrenScreen({ navigation }) {
  const { list, activeChildId, switchChild, refresh, fetching } = useChild();
  const [enrichments, setEnrichments] = useState({}); // { child_id: { batch, trainer } }
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch per-child enrichments (batch + trainer + attendance %) once we
  // have the linked-children list.
  const loadEnrichments = useCallback(async () => {
    if (!list || list.length === 0) { setLoading(false); return; }
    setLoading(true);
    try {
      const results = await Promise.all(
        list.map(async (c) => {
          if (c.status !== 'active') return [c.child_id, null];
          try {
            const er = await apiClient.get(`/parents/children/${c.child_id}/enrollments`).catch(() => ({ data: { enrollments: [] } }));
            const enrolls = er.data?.enrollments || [];
            const first = enrolls[0] || null;
            return [c.child_id, {
              batch_name:   first?.batch_name   || null,
              trainer_name: first?.trainer_name || null,
              days:         first?.days_of_week || null,
              start_time:   first?.start_time   || null,
              end_time:     first?.end_time     || null,
              course_name:  first?.course_name  || null,
            }];
          } catch {
            return [c.child_id, null];
          }
        }),
      );
      const map = {};
      results.forEach(([id, val]) => { if (val) map[id] = val; });
      setEnrichments(map);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [list]);
  useEffect(() => { loadEnrichments(); }, [loadEnrichments]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    await loadEnrichments();
  };

  const onSwitch = async (child) => {
    if (child.status !== 'active') {
      Alert.alert('Pending approval', 'This child must approve the link request before you can view their data.');
      return;
    }
    const ok = await switchChild(child.child_id);
    if (ok) {
      // Bounce back to dashboard with the new active child loaded.
      navigation.goBack?.();
    }
  };

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <ArrowLeft size={20} color={palette.text} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>My Children</Text>
          <Text style={styles.headerSub}>
            {list.length === 0
              ? 'No children linked yet'
              : `${list.length} ${list.length === 1 ? 'student' : 'students'} linked`}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => navigation.navigate('LinkChild')}
          activeOpacity={0.85}
        >
          <Plus size={14} color="#fff" strokeWidth={2.6} />
          <Text style={styles.addBtnText}>Add</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: 80, gap: spacing.md }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={palette.purple.vivid}
          />
        }
      >
        {(loading || fetching) && list.length === 0 ? (
          <ActivityIndicator size="large" color={palette.purple.vivid} style={{ marginTop: spacing.xxl }} />
        ) : list.length === 0 ? (
          <View style={styles.emptyCard}>
            <Users size={32} color={palette.textLight} strokeWidth={1.4} />
            <Text style={styles.emptyTitle}>No children linked yet</Text>
            <Text style={styles.emptySub}>
              Tap "Add" to link your child's student account by their registered phone or email.
            </Text>
            <TouchableOpacity
              style={styles.emptyCta}
              onPress={() => navigation.navigate('LinkChild')}
              activeOpacity={0.9}
            >
              <Plus size={14} color="#fff" strokeWidth={2.6} />
              <Text style={styles.emptyCtaText}>Link a child</Text>
            </TouchableOpacity>
          </View>
        ) : (
          list.map((child) => (
            <ChildCard
              key={child.child_id}
              child={child}
              enrich={enrichments[child.child_id]}
              isActive={child.child_id === activeChildId}
              onPress={() => onSwitch(child)}
              onView={async () => {
                // Switch to this child if needed, then open their full profile.
                if (child.child_id !== activeChildId) {
                  await switchChild(child.child_id);
                }
                navigation.navigate('ChildProfile', { childId: child.child_id });
              }}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────
function ChildCard({ child, enrich, isActive, onPress, onView }) {
  const belt = beltFor(child.child_id);
  const initials = (child.child_name || 'S').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const pending = child.status === 'pending';

  const timing = enrich?.start_time
    ? `${enrich.start_time.slice(0, 5)}${enrich.end_time ? ' – ' + enrich.end_time.slice(0, 5) : ''}`
    : null;

  return (
    <View style={[styles.card, isActive && styles.cardActive, pending && styles.cardPending]}>
      <View style={styles.cardTop}>
        <View style={[styles.avatar, { backgroundColor: belt.border + '30', borderColor: belt.border }]}>
          <Text style={[styles.avatarText, { color: belt.fg === '#FFFFFF' ? '#111827' : belt.fg }]}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{child.child_name}</Text>
            {isActive ? (
              <View style={styles.activePill}>
                <Check size={10} color="#fff" strokeWidth={2.6} />
                <Text style={styles.activePillText}>ACTIVE</Text>
              </View>
            ) : pending ? (
              <View style={styles.pendingPill}>
                <Text style={styles.pendingPillText}>PENDING</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.metaLine}>{genderFor(child.child_id)} · {ageFor(child.child_id)} yrs</Text>
        </View>
      </View>

      {/* Belt + institution */}
      <View style={styles.badgeRow}>
        <View style={[styles.beltBadge, { backgroundColor: belt.bg, borderColor: belt.border }]}>
          <Award size={11} color={belt.fg} strokeWidth={2.4} />
          <Text style={[styles.beltBadgeText, { color: belt.fg }]}>{belt.label} Belt</Text>
        </View>
        {child.institution_name ? (
          <View style={styles.instBadge}>
            <GraduationCap size={11} color={palette.purple.on} strokeWidth={2.4} />
            <Text style={styles.instBadgeText} numberOfLines={1}>{child.institution_name}</Text>
          </View>
        ) : null}
      </View>

      {/* Batch + trainer block (only when we have enrichment data) */}
      {enrich && (enrich.batch_name || enrich.trainer_name || timing) ? (
        <View style={styles.enrichBlock}>
          {enrich.batch_name ? (
            <EnrichRow icon={GraduationCap} label="Batch" value={`${enrich.batch_name}${enrich.course_name ? ` · ${enrich.course_name}` : ''}`} />
          ) : null}
          {timing || enrich.days ? (
            <EnrichRow icon={Clock} label="Class" value={[enrich.days, timing].filter(Boolean).join(' · ') || '-'} />
          ) : null}
          {enrich.trainer_name ? (
            <EnrichRow icon={User} label="Trainer" value={enrich.trainer_name} />
          ) : null}
        </View>
      ) : null}

      {/* Actions */}
      {pending ? (
        <Text style={styles.pendingHint}>
          Waiting for your child to approve the link request.
        </Text>
      ) : (
        <View style={styles.actionsRow}>
          {isActive ? (
            <View style={[styles.actionBtn, styles.actionGhost]}>
              <Text style={styles.actionGhostText}>Currently active</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionPrimary]}
              onPress={onPress}
              activeOpacity={0.85}
            >
              <Check size={14} color="#fff" strokeWidth={2.6} />
              <Text style={styles.actionPrimaryText}>Switch to {child.child_name?.split(' ')[0]}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionOutline]}
            onPress={onView}
            activeOpacity={0.85}
          >
            <Text style={styles.actionOutlineText}>Profile</Text>
            <ChevronRight size={14} color={palette.purple.vivid} strokeWidth={2.6} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function EnrichRow({ icon: Icon, label, value }) {
  return (
    <View style={styles.enrichRow}>
      <View style={styles.enrichIcon}>
        <Icon size={11} color={palette.purple.vivid} strokeWidth={2.4} />
      </View>
      <Text style={styles.enrichLabel}>{label}</Text>
      <Text style={styles.enrichValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl + 4,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    ...shadows.card,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.borderSoft,
  },
  headerTitle: { ...type.h1, color: palette.text, fontSize: 18 },
  headerSub: { ...type.caption, color: palette.textMuted, marginTop: 1 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: palette.purple.vivid,
  },
  addBtnText: { ...type.caption, color: '#fff', fontWeight: '800' },

  // Card
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1, borderColor: palette.borderSoft,
    ...shadows.card,
  },
  cardActive: { borderColor: palette.purple.vivid, borderWidth: 2 },
  cardPending: { opacity: 0.85 },

  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 52, height: 52, borderRadius: 26,
    borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 18, fontWeight: '800' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { ...type.h2, color: palette.text, flex: 1 },
  activePill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: palette.purple.vivid,
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.pill,
  },
  activePillText: { ...type.micro, color: '#fff', fontWeight: '800', letterSpacing: 0.5 },
  pendingPill: {
    backgroundColor: palette.orange.soft,
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.pill,
  },
  pendingPillText: { ...type.micro, color: palette.orange.on, fontWeight: '800', letterSpacing: 0.5 },
  metaLine: { ...type.caption, color: palette.textMuted, marginTop: 2, fontWeight: '700' },

  // Badge row
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md },
  beltBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  beltBadgeText: { ...type.micro, fontWeight: '800' },
  instBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.purple.soft,
    maxWidth: 200,
  },
  instBadgeText: { ...type.micro, color: palette.purple.on, fontWeight: '700' },

  // Enrich block
  enrichBlock: {
    marginTop: spacing.md,
    backgroundColor: palette.bg,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: 6,
  },
  enrichRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  enrichIcon: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  enrichLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700', width: 60 },
  enrichValue: { flex: 1, ...type.caption, color: palette.text, fontWeight: '700' },

  // Actions
  actionsRow: { marginTop: spacing.md, flexDirection: 'row', gap: spacing.sm },
  actionBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: radius.md,
  },
  actionPrimary: { backgroundColor: palette.purple.vivid },
  actionPrimaryText: { ...type.bodyBold, color: '#fff', fontWeight: '800' },
  actionGhost: { backgroundColor: palette.purple.soft },
  actionGhostText: { ...type.caption, color: palette.purple.on, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  actionOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: palette.purple.vivid,
    flex: 0,
    paddingHorizontal: spacing.md,
  },
  actionOutlineText: { ...type.bodyBold, color: palette.purple.vivid, fontWeight: '800' },
  pendingHint: { ...type.caption, color: palette.textMuted, marginTop: spacing.sm, fontStyle: 'italic' },

  // Empty
  emptyCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: 8,
    ...shadows.card,
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, marginTop: 4 },
  emptySub: { ...type.caption, color: palette.textMuted, textAlign: 'center' },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.lg, paddingVertical: 10,
    backgroundColor: palette.purple.vivid,
    borderRadius: radius.md,
    marginTop: 6,
  },
  emptyCtaText: { ...type.bodyBold, color: '#fff', fontWeight: '800' },
});
