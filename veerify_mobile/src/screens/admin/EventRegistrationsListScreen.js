// src/screens/admin/EventRegistrationsListScreen.js
//
// MODULE 4: Organizer Registration Management — list view.
//
// Opened from EventDetail's "Registrations" button (visible only to
// the organizing institution). Renders:
//   • Summary strip: total registered, participating institutions,
//     status breakdown.
//   • Institution filter chips + status filter + search.
//   • Paginated list of registrations; tap a row to open the
//     Registration Detail screen.
//
// Route params:
//   eventId    (number, required)
//   eventTitle (string, optional)

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator,
  StyleSheet, SafeAreaView, RefreshControl,
} from 'react-native';
import { ChevronLeft, ChevronRight, Search, Users, Building2 } from 'lucide-react-native';

import apiClient from '../../api/client';

const BRAND       = '#E63946';
const BRAND_SOFT  = '#FFE4E6';
const TEXT        = '#111827';
const TEXT_MUTED  = '#6B7280';
const SURFACE     = '#FFFFFF';
const BG          = '#F1F6FB';
const BORDER      = '#E5E7EB';

const PAGE_SIZE = 25;

const STATUS_FILTERS = [
  { value: '',           label: 'All' },
  { value: 'registered', label: 'Registered' },
  { value: 'cancelled',  label: 'Cancelled' },
];

export default function EventRegistrationsListScreen({ navigation, route }) {
  const eventId    = route?.params?.eventId;
  const eventTitle = route?.params?.eventTitle || 'Event';

  const [summary, setSummary]         = useState(null);
  const [institutions, setInstitutions] = useState([]);
  const [filterInst, setFilterInst]   = useState(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [q, setQ]                     = useState('');
  const [qDebounced, setQDebounced]   = useState('');

  const [items, setItems]         = useState([]);
  const [total, setTotal]         = useState(0);
  const [offset, setOffset]       = useState(0);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError]         = useState('');

  useEffect(() => {
    const h = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(h);
  }, [q]);

  const loadTopMatter = useCallback(async () => {
    if (!eventId) return;
    try {
      const [s, i] = await Promise.all([
        apiClient.get(`/events/${eventId}/registrations/summary`),
        apiClient.get(`/events/${eventId}/registrations/institutions`),
      ]);
      setSummary(s.data || null);
      setInstitutions(i.data?.institutions || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load registrations.');
    }
  }, [eventId]);

  const loadPage = useCallback(async (opts) => {
    if (!eventId) return;
    const reset = !!opts?.reset;
    if (reset) setLoading(true); else setPageLoading(true);
    setError('');
    try {
      const nextOffset = reset ? 0 : offset;
      const params = new URLSearchParams({
        limit:  String(PAGE_SIZE),
        offset: String(nextOffset),
      });
      if (qDebounced)   params.set('q', qDebounced);
      if (filterInst)   params.set('institution_id', String(filterInst));
      if (filterStatus) params.set('status', filterStatus);
      const r = await apiClient.get(`/events/${eventId}/registrations?${params.toString()}`);
      const rows = r.data?.registrations || [];
      setItems(reset ? rows : [...items, ...rows]);
      setTotal(r.data?.total || 0);
      setOffset(nextOffset + rows.length);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load registrations.');
    } finally {
      setLoading(false);
      setPageLoading(false);
      setRefreshing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, offset, items, qDebounced, filterInst, filterStatus]);

  useEffect(() => { loadTopMatter(); /* eslint-disable-next-line */ }, [eventId]);
  useEffect(() => { loadPage({ reset: true }); /* eslint-disable-next-line */ }, [qDebounced, filterInst, filterStatus]);

  const canLoadMore = items.length < total;

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.75}
      onPress={() => navigation.navigate('EventRegistrationDetail', {
        eventId, eventTitle, registrationId: item.id,
      })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowName} numberOfLines={1}>{item.student_name}</Text>
        <Text style={styles.rowInst} numberOfLines={1}>
          {item.institution_name || `Institution #${item.institution_id}`}
        </Text>
        <View style={styles.rowMeta}>
          <StatusPill status={item.status} />
          <Text style={styles.rowMetaText}>
            {new Date(item.created_at).toLocaleString('en-IN', {
              day: '2-digit', month: 'short', year: 'numeric',
              hour: 'numeric', minute: '2-digit', hour12: true,
            })}
          </Text>
        </View>
      </View>
      <ChevronRight size={18} color={TEXT_MUTED} />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ChevronLeft size={20} color={TEXT} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Registrations</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{eventTitle}</Text>
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadTopMatter(); loadPage({ reset: true }); }}
            colors={[BRAND]}
            tintColor={BRAND}
          />
        }
        ListHeaderComponent={
          <View>
            {/* Summary strip */}
            <View style={styles.summary}>
              <Stat label="Registered" value={summary?.registered ?? summary?.total ?? 0} Icon={Users} />
              <Stat label="Institutions" value={summary?.institutions ?? 0} Icon={Building2} />
              {summary?.cancelled ? (
                <Stat label="Cancelled" value={summary.cancelled} tone="muted" />
              ) : null}
            </View>

            {/* Search */}
            <View style={styles.searchWrap}>
              <Search size={16} color={TEXT_MUTED} />
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder="Search student or institution"
                placeholderTextColor={TEXT_MUTED}
                style={styles.searchInput}
              />
            </View>

            {/* Status filter */}
            <View style={styles.chipRow}>
              {STATUS_FILTERS.map((f) => {
                const on = filterStatus === f.value;
                return (
                  <TouchableOpacity
                    key={f.value || 'all'}
                    onPress={() => setFilterStatus(f.value)}
                    style={[styles.chip, on && styles.chipOn]}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{f.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Institution filter */}
            {institutions.length > 0 ? (
              <View style={styles.chipRow}>
                <TouchableOpacity
                  onPress={() => setFilterInst(null)}
                  style={[styles.chip, filterInst == null && styles.chipOn]}
                >
                  <Text style={[styles.chipText, filterInst == null && styles.chipTextOn]}>All academies</Text>
                </TouchableOpacity>
                {institutions.map((inst) => {
                  const on = filterInst === inst.id;
                  return (
                    <TouchableOpacity
                      key={inst.id}
                      onPress={() => setFilterInst(inst.id)}
                      style={[styles.chip, on && styles.chipOn]}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>
                        {inst.name} · {inst.student_count}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}

            {error ? <Text style={styles.err}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={{ paddingVertical: 40 }}>
              <ActivityIndicator color={BRAND} />
            </View>
          ) : (
            <View style={{ padding: 24, alignItems: 'center' }}>
              <Text style={{ color: TEXT_MUTED, fontSize: 13, textAlign: 'center' }}>
                No registrations yet.
              </Text>
            </View>
          )
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (canLoadMore && !pageLoading && !loading) loadPage(); }}
        ListFooterComponent={
          pageLoading ? <ActivityIndicator color={BRAND} style={{ marginVertical: 12 }} /> :
          !loading && items.length > 0 && !canLoadMore ? (
            <Text style={styles.footHint}>Showing all {total} registrations.</Text>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

function StatusPill({ status }) {
  const map = {
    registered: { bg: '#DCFCE7', fg: '#166534' },
    cancelled:  { bg: '#FEE2E2', fg: '#991B1B' },
  };
  const tone = map[status] || { bg: '#F1F5F9', fg: '#334155' };
  return (
    <Text style={[styles.statusPill, { backgroundColor: tone.bg, color: tone.fg }]}>
      {status ? status[0].toUpperCase() + status.slice(1) : 'Unknown'}
    </Text>
  );
}

function Stat({ label, value, Icon, tone }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tone === 'muted' && { color: TEXT_MUTED }]}>{value}</Text>
      <View style={styles.statLabelRow}>
        {Icon ? <Icon size={12} color={TEXT_MUTED} /> : null}
        <Text style={styles.statLabel}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: SURFACE, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  backBtn: { padding: 6 },
  title:    { fontSize: 16, fontWeight: '800', color: TEXT },
  subtitle: { fontSize: 12, color: TEXT_MUTED, marginTop: 1 },

  summary: {
    flexDirection: 'row', gap: 10,
    padding: 14,
  },
  stat: {
    flex: 1, backgroundColor: SURFACE, borderRadius: 12,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 10, gap: 4,
  },
  statValue: { fontSize: 20, fontWeight: '900', color: TEXT },
  statLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statLabel: { fontSize: 11, color: TEXT_MUTED, fontWeight: '600' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, borderRadius: 12,
    paddingHorizontal: 12, marginHorizontal: 14, height: 42,
  },
  searchInput: { flex: 1, color: TEXT, padding: 0 },

  chipRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    paddingHorizontal: 14, marginTop: 10,
  },
  chip: {
    borderWidth: 1, borderColor: BORDER, backgroundColor: SURFACE,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
  },
  chipOn:      { backgroundColor: BRAND, borderColor: BRAND },
  chipText:    { fontSize: 12, fontWeight: '700', color: TEXT_MUTED },
  chipTextOn:  { color: '#fff' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, marginHorizontal: 14, marginTop: 10,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, borderRadius: 12,
  },
  rowName: { fontSize: 14, fontWeight: '800', color: TEXT },
  rowInst: { fontSize: 12, color: TEXT_MUTED, marginTop: 2 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  rowMetaText: { fontSize: 11, color: TEXT_MUTED },
  statusPill: {
    fontSize: 10, fontWeight: '800',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999,
    overflow: 'hidden',
  },

  err: {
    color: '#B91C1C', fontSize: 12,
    paddingHorizontal: 14, marginTop: 10,
  },
  footHint: { fontSize: 11, color: TEXT_MUTED, textAlign: 'center', marginVertical: 12 },
});
