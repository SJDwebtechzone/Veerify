// src/screens/admin/RecentActivityScreen.js
//
// Full "Recent Activity" feed for institution + branch admins.
//
// Product rules (per spec):
//   • Initial view = activities from the past 14 days, newest first.
//   • Bottom "Load more" button fetches STRICTLY OLDER rows in
//     chronological batches until the backend reports has_more=false.
//   • Every row shows date + time in 12-hour AM/PM.
//   • Branch admins see only their branch — the backend already scopes
//     via the same batchScope helper the dashboard uses. Main admins
//     see everything (or the picked branch, if the header dropdown
//     handed us a branch_id via route.params).
//
// The screen is a thin FlatList — the data is fully driven by
// GET /admin/recent-activity with { before, days, branch_id, limit }
// query params. See admin.controller.getRecentActivity.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, RefreshControl,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { UserPlus, Bell } from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
import { formatDateTime12h } from '../../utils/formatTime';

const PAGE_SIZE = 20;

// Kind → accent color, matching the dashboard teaser.
function accentFor(activity) {
  if (activity.kind === 'enrollment') {
    if (activity.status === 'paid')   return palette.green;
    if (activity.status === 'failed') return palette.rose;
    return palette.orange;
  }
  if (activity.kind === 'notification') {
    return activity.read ? { vivid: palette.textLight } : palette.purple;
  }
  return palette.blue;
}

function iconFor(activity) {
  if (activity.kind === 'enrollment')   return UserPlus;
  if (activity.kind === 'notification') return Bell;
  return Bell;
}

export default function RecentActivityScreen({ navigation, route }) {
  const branchIdParam = route?.params?.branchId ?? null;

  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore]     = useState(false);
  const [nextBefore, setNextBefore] = useState(null);
  const [error, setError]         = useState(null);

  const load = useCallback(async (opts = {}) => {
    // opts.reset = true when we're re-fetching the initial 14-day
    // window (mount, pull-to-refresh, or branch change).
    // opts.reset = false when we're chasing older rows via cursor.
    const isReset = !!opts.reset;
    if (isReset) setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      if (branchIdParam !== null) params.set('branch_id', String(branchIdParam));
      if (isReset) {
        // First-page fetch — 14-day window, no cursor.
        params.set('days', '14');
      } else if (nextBefore) {
        // "Load more" — chronological batches older than the last
        // row we already have on screen.
        params.set('before', nextBefore);
      }
      const res = await apiClient.get(`/admin/recent-activity?${params.toString()}`);
      const list = Array.isArray(res.data?.activities) ? res.data.activities : [];
      setRows((prev) => (isReset ? list : [...prev, ...list]));
      setHasMore(!!res.data?.has_more);
      setNextBefore(res.data?.next_before || null);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Failed to load activity';
      setError(msg);
      if (isReset) setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [branchIdParam, nextBefore]);

  // Initial fetch — the first "past 14 days" batch.
  useEffect(() => {
    setLoading(true);
    // We intentionally call load with reset:true here without adding
    // `load` to the deps — `load` closes over nextBefore which we
    // reset ourselves. Refetching would cause an infinite loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    (async () => { await load({ reset: true }); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchIdParam]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setNextBefore(null);
    setHasMore(false);
    load({ reset: true });
  }, [load]);

  const onLoadMore = useCallback(() => {
    if (loadingMore || !hasMore || !nextBefore) return;
    setLoadingMore(true);
    load({ reset: false });
  }, [loadingMore, hasMore, nextBefore, load]);

  if (loading && rows.length === 0) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={palette.purple.vivid} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Recent Activity</Text>
        <Text style={styles.headerSubtitle}>Newest first</Text>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={rows}
        keyExtractor={(item, idx) => `${item.kind}-${item.at}-${idx}`}
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: 40 }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={palette.purple.vivid}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No activity in the last 14 days.</Text>
            <Text style={styles.emptyBody}>
              New enrolments and notifications will show up here.
            </Text>
          </View>
        }
        ListFooterComponent={
          rows.length === 0
            ? null
            : hasMore
              ? (
                <TouchableOpacity
                  style={styles.loadMoreBtn}
                  onPress={onLoadMore}
                  disabled={loadingMore}
                  activeOpacity={0.85}
                >
                  {loadingMore ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.loadMoreText}>Load more</Text>
                  )}
                </TouchableOpacity>
              )
              : (
                <Text style={styles.endOfList}>You&apos;ve reached the end.</Text>
              )
        }
        renderItem={({ item }) => {
          const accent = accentFor(item);
          const Icon = iconFor(item);
          return (
            <View style={styles.row}>
              <View style={[styles.iconWrap, { backgroundColor: (accent.soft || palette.borderSoft) }]}>
                <Icon size={16} color={accent.vivid} strokeWidth={2.2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                {item.meta ? (
                  <Text style={styles.meta} numberOfLines={2}>{item.meta}</Text>
                ) : null}
                <Text style={styles.when}>
                  {formatDateTime12h(item.at)}
                </Text>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.xxl, paddingBottom: spacing.md },
  headerTitle:    { ...type.display, color: palette.text },
  headerSubtitle: { ...type.caption, color: palette.textMuted, marginTop: 4 },

  errorBox: {
    marginHorizontal: spacing.xl,
    padding: spacing.md,
    backgroundColor: palette.rose?.soft || '#FEE2E2',
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  errorText: { ...type.caption, color: palette.rose?.on || '#991B1B', fontWeight: '600' },

  empty: { alignItems: 'center', paddingVertical: 60, gap: spacing.xs },
  emptyTitle: { ...type.h2, color: palette.text, marginBottom: 4, textAlign: 'center' },
  emptyBody: { ...type.body, color: palette.textMuted, textAlign: 'center' },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  iconWrap: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { ...type.bodyBold, color: palette.text, fontSize: 14 },
  meta:  { ...type.caption, color: palette.textMuted, marginTop: 2 },
  when:  { ...type.micro, color: palette.textLight, marginTop: 4, fontWeight: '600' },

  loadMoreBtn: {
    marginTop: spacing.lg,
    backgroundColor: palette.purple.vivid,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    alignItems: 'center',
    ...shadows.card,
  },
  loadMoreText: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 0.4 },

  endOfList: {
    ...type.caption,
    color: palette.textLight,
    textAlign: 'center',
    marginTop: spacing.lg,
    fontStyle: 'italic',
  },
});
