// src/screens/admin/SelectStudentsForEventScreen.js
//
// MODULE 2: Event → Select Students for Registration.
//
// Opened from EventDetailScreen's "Register Students" button. Lists
// ONLY the caller's own students (backend enforces this) with:
//   • search (name / phone / email / id),
//   • multi-select checkboxes,
//   • "Already Registered" badge for students who can't be picked,
//   • a Continue CTA that navigates on with { eventId, studentIds }
//     for MODULE 3 to consume.
//
// Route params:
//   eventId (number, required)
//   eventTitle (string, optional — used in the header)
//   registrationClosingDate (string ISO, optional — for the closed
//     state check the backend also enforces)

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl, SafeAreaView, Modal, ScrollView,
} from 'react-native';
import { Search, ChevronLeft, Check, XCircle, ChevronDown, X } from 'lucide-react-native';

import apiClient from '../../api/client';

const BRAND       = '#E63946';
const BRAND_SOFT  = '#FFE4E6';
const TEXT        = '#111827';
const TEXT_MUTED  = '#6B7280';
const SURFACE     = '#FFFFFF';
const BG          = '#F1F6FB';
const BORDER      = '#E5E7EB';

const PAGE_SIZE = 25;

export default function SelectStudentsForEventScreen({ navigation, route }) {
  const eventId    = route?.params?.eventId;
  const eventTitle = route?.params?.eventTitle || 'Event';

  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError]         = useState('');
  const [items, setItems]         = useState([]);
  const [total, setTotal]         = useState(0);
  const [offset, setOffset]       = useState(0);
  const [q, setQ]                 = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [eventInfo, setEventInfo] = useState(null);
  // ── Filters ──────────────────────────────────────────────────
  // filterSkill:  a skill name from the ACADEMY's saved skills
  //               (Academy Registration → Skills), or '' for any.
  // filterGender: 'Male' | 'Female' | '' for any.
  // academySkills: fetched once from /institutions/me/details so
  //               the dropdown lists exactly what the academy
  //               registered — not a hard-coded catalog.
  const [filterSkill,   setFilterSkill]   = useState('');
  const [filterGender,  setFilterGender]  = useState('');
  const [academySkills, setAcademySkills] = useState([]);
  const [skillSheetOpen,  setSkillSheetOpen]  = useState(false);
  const [genderSheetOpen, setGenderSheetOpen] = useState(false);

  // Debounce search input by 300ms so we don't hit the API on
  // every keystroke.
  useEffect(() => {
    const h = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(h);
  }, [q]);

  const load = useCallback(async (opts) => {
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
      if (qDebounced) params.set('q', qDebounced);
      const r = await apiClient.get(`/events/${eventId}/eligible-students?${params.toString()}`);
      setEventInfo(r.data?.event || null);
      setTotal(r.data?.total || 0);
      // Product decision: show EVERY student at the institution by
      // default. Filtering by the event's skill list is now purely
      // opt-in — the on-screen Skill / Gender dropdowns above the
      // list handle any narrowing the operator wants.
      const rows = r.data?.students || [];
      // Sort: interested (Yes) students first, then everyone else,
      // preserving the backend's alphabetical order within each
      // group. Makes the "students who asked to participate" bucket
      // impossible to miss for the admin.
      rows.sort((a, b) => {
        const ai = a.interested === true ? 0 : 1;
        const bi = b.interested === true ? 0 : 1;
        return ai - bi;
      });
      setItems(reset ? rows : [...items, ...rows]);
      setOffset(nextOffset + rows.length);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load students.');
    } finally {
      setLoading(false);
      setPageLoading(false);
      setRefreshing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, qDebounced, offset, items]);

  // Reset + reload whenever the debounced search changes.
  useEffect(() => { load({ reset: true }); /* eslint-disable-next-line */ }, [qDebounced, eventId]);

  // ── Academy skills ────────────────────────────────────────────
  // Powers the Skills dropdown with the FULL Academy Registration
  // Setup catalog:
  //   1. GET /config/enums → skills[] — the canonical master list
  //      (same source the Academy Setup wizard, CreateCourse and
  //      CreateEvent use).
  //   2. GET /institutions/me/details → institution.skills — any
  //      custom skills the academy added on top of the master list
  //      during onboarding.
  // Merged + case-insensitively deduped so the dropdown never
  // shows a duplicate. Both fetches run in parallel; a failure in
  // one side falls back to the other so filters always render.
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      apiClient.get('/config/enums'),
      apiClient.get('/institutions/me/details'),
    ]).then(([enumsRes, detailsRes]) => {
      if (cancelled) return;
      const canonical = enumsRes.status === 'fulfilled'
        ? (Array.isArray(enumsRes.value?.data?.skills) ? enumsRes.value.data.skills : [])
        : [];
      const owned = detailsRes.status === 'fulfilled'
        ? (Array.isArray(detailsRes.value?.data?.institution?.skills)
            ? detailsRes.value.data.institution.skills
            : [])
        : [];
      const seen = new Set();
      const merged = [];
      [...canonical, ...owned].forEach((raw) => {
        const s = String(raw || '').trim();
        if (!s) return;
        const key = s.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(s);
      });
      setAcademySkills(merged);
    });
    return () => { cancelled = true; };
  }, []);

  // ── Client-side filter — Skills + Gender ─────────────────────
  // Applied on top of the server-side event-skill filter (which
  // already restricted the list to students enrolled in one of
  // the event's skills). Empty filters mean "any".
  const displayItems = useMemo(() => {
    let out = items;
    if (filterSkill) {
      const key = String(filterSkill).toLowerCase();
      out = out.filter((s) => (
        String(s.course_names || '')
          .split(',')
          .map((x) => x.trim().toLowerCase())
          .includes(key)
      ));
    }
    if (filterGender) {
      const key = String(filterGender).toLowerCase();
      out = out.filter((s) => String(s.gender || '').toLowerCase() === key);
    }
    return out;
  }, [items, filterSkill, filterGender]);
  const filtersActive = !!filterSkill || !!filterGender;
  const clearFilters = () => { setFilterSkill(''); setFilterGender(''); };

  const toggle = (id, alreadyRegistered) => {
    if (alreadyRegistered) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const canLoadMore = items.length < total;
  const registrationClosed = !!eventInfo?.registration_closed;
  const selectedCount = selectedIds.size;

  const onContinue = async () => {
    if (selectedCount === 0) return;
    if (registrationClosed) return;
    const ids = Array.from(selectedIds);

    // Re-check duplicates one last time in case another admin
    // registered any of these students since the list was fetched.
    try {
      const r = await apiClient.get(
        `/events/${eventId}/registration-check?ids=${ids.join(',')}`,
      );
      const dupes = new Set(r.data?.already_registered_ids || []);
      const fresh = ids.filter((id) => !dupes.has(id));
      if (fresh.length === 0) {
        setError('All the students you picked have already been registered.');
        // Refresh the list so the badges update.
        load({ reset: true });
        return;
      }
      // Hand off to MODULE 3's EventRegistrationForm screen (see
      // EventRegistrationFormScreen.js). Registered in the admin
      // stack at name 'EventRegistrationForm'.
      navigation.navigate('EventRegistrationForm', {
        eventId,
        studentIds: fresh,
        eventTitle,
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to verify selection.');
    }
  };

  const renderItem = ({ item }) => {
    const on         = selectedIds.has(item.id);
    const dup        = !!item.already_registered;
    // Interested students get a distinct amber-tinted row + a small
    // pill so the admin can spot them at a glance. Sort order also
    // floats them to the top of the list.
    const interested = item.interested === true;
    return (
      <TouchableOpacity
        activeOpacity={dup ? 1 : 0.75}
        onPress={() => toggle(item.id, dup)}
        style={[
          styles.row,
          interested && styles.rowInterested,
          on && styles.rowOn,
          dup && styles.rowDup,
        ]}
      >
        <View style={[styles.check, on && styles.checkOn, dup && styles.checkDup]}>
          {on ? <Check size={12} color="#fff" strokeWidth={3} /> : null}
          {dup ? <XCircle size={14} color="#B91C1C" /> : null}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.nameRow}>
            <Text
              style={[styles.name, interested && styles.nameInterested]}
              numberOfLines={1}
            >
              {item.name}
            </Text>
            {interested ? (
              <Text style={styles.interestedBadge}>Interested</Text>
            ) : null}
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            {[item.belt_level, item.course_names, item.branch_name]
              .filter((s) => s && String(s).trim())
              .join(' • ')}
          </Text>
        </View>
        {dup ? (
          <Text style={styles.dupBadge}>Already Registered</Text>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ChevronLeft size={20} color={TEXT} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Select Students</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{eventTitle}</Text>
        </View>
      </View>

      {registrationClosed ? (
        <View style={styles.closed}>
          <Text style={styles.closedText}>
            Registration is closed for this event.
          </Text>
        </View>
      ) : null}

      <View style={styles.searchWrap}>
        <Search size={16} color={TEXT_MUTED} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search students"
          placeholderTextColor={TEXT_MUTED}
          style={styles.searchInput}
        />
      </View>

      {/* Filter row — Skills dropdown + Gender dropdown + Clear.
          Skills pulls from the ACADEMY'S saved skill list (Academy
          Registration), not the event's configured skills. Gender
          is a plain Male/Female picker. Both can be used together;
          "Clear" resets to no filter. Operates client-side on top
          of the server-side event-skill filter already applied. */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          onPress={() => setSkillSheetOpen(true)}
          activeOpacity={0.85}
          style={[styles.filterChip, filterSkill && styles.filterChipOn]}
        >
          <Text
            style={[styles.filterChipText, filterSkill && styles.filterChipTextOn]}
            numberOfLines={1}
          >
            {filterSkill || 'Skill: All'}
          </Text>
          <ChevronDown size={12} color={filterSkill ? BRAND : TEXT_MUTED} strokeWidth={2.4} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setGenderSheetOpen(true)}
          activeOpacity={0.85}
          style={[styles.filterChip, filterGender && styles.filterChipOn]}
        >
          <Text
            style={[styles.filterChipText, filterGender && styles.filterChipTextOn]}
            numberOfLines={1}
          >
            {filterGender || 'Gender: All'}
          </Text>
          <ChevronDown size={12} color={filterGender ? BRAND : TEXT_MUTED} strokeWidth={2.4} />
        </TouchableOpacity>
        {filtersActive ? (
          <TouchableOpacity
            onPress={clearFilters}
            activeOpacity={0.85}
            style={styles.clearBtn}
            hitSlop={6}
          >
            <X size={12} color="#fff" strokeWidth={2.6} />
            <Text style={styles.clearBtnText}>Clear</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Sheets — modal-backed pickers matching the visual language
          of the Skills fallback dropdown elsewhere in the app. */}
      <FilterSheet
        visible={skillSheetOpen}
        title="Filter by Skill"
        options={[
          { key: '__all__', label: 'All skills', value: '' },
          ...academySkills.map((s) => ({ key: s, label: s, value: s })),
        ]}
        active={filterSkill}
        onPick={(v) => { setFilterSkill(v); setSkillSheetOpen(false); }}
        onClose={() => setSkillSheetOpen(false)}
        emptyText="This academy hasn't saved any skills yet."
      />
      <FilterSheet
        visible={genderSheetOpen}
        title="Filter by Gender"
        options={[
          { key: '__all__', label: 'All',    value: '' },
          { key: 'Male',    label: 'Male',   value: 'Male' },
          { key: 'Female',  label: 'Female', value: 'Female' },
        ]}
        active={filterGender}
        onPick={(v) => { setFilterGender(v); setGenderSheetOpen(false); }}
        onClose={() => setGenderSheetOpen(false)}
      />

      {/* Event-skill hint intentionally removed — the list no
          longer auto-narrows by event skills. Operators can still
          filter via the Skill dropdown above. */}

      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={BRAND} />
        </View>
      ) : displayItems.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>
            {filtersActive
              ? 'No students match the current filters. Tap Clear to reset.'
              : qDebounced
                ? 'No matching students.'
                : 'No students yet.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={displayItems}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load({ reset: true }); }}
              colors={[BRAND]}
              tintColor={BRAND}
            />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (canLoadMore && !pageLoading) load(); }}
          ListFooterComponent={
            pageLoading ? (
              <ActivityIndicator color={BRAND} style={{ marginVertical: 12 }} />
            ) : canLoadMore ? null : (
              <Text style={styles.footHint}>Showing all {total} students.</Text>
            )
          }
          contentContainerStyle={{ paddingBottom: 120 }}
        />
      )}

      <View style={styles.footer}>
        <Text style={styles.count}>
          {selectedCount} student{selectedCount === 1 ? '' : 's'} selected
        </Text>
        <TouchableOpacity
          disabled={selectedCount === 0 || registrationClosed}
          onPress={onContinue}
          style={[
            styles.continueBtn,
            (selectedCount === 0 || registrationClosed) && { opacity: 0.5 },
          ]}
        >
          <Text style={styles.continueText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// FilterSheet — reusable modal-backed picker used by the Skills +
// Gender filters at the top of this screen. Same visual language
// as the SkillsDropdown sheet on EventRegistrationForm so the two
// screens read consistently.
function FilterSheet({ visible, title, options, active, onPick, onClose, emptyText }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={onClose}>
        <View style={styles.sheetCard}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <XCircle size={18} color={TEXT_MUTED} />
            </TouchableOpacity>
          </View>
          <ScrollView>
            {options.length === 0 ? (
              <Text style={{ padding: 16, color: TEXT_MUTED, fontSize: 13 }}>
                {emptyText || 'Nothing to pick here.'}
              </Text>
            ) : options.map((o) => {
              const on = String(o.value || '') === String(active || '');
              return (
                <TouchableOpacity
                  key={o.key}
                  onPress={() => onPick(o.value)}
                  style={[styles.sheetItem, on && styles.sheetItemOn]}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.sheetItemText, on && styles.sheetItemTextOn]}>
                    {o.label}
                  </Text>
                  {on ? <Check size={14} color={BRAND} strokeWidth={2.6} /> : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
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

  closed: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 14, paddingVertical: 10,
  },
  closedText: { fontSize: 12, color: '#92400E', fontWeight: '700' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, borderRadius: 12,
    paddingHorizontal: 12, marginHorizontal: 12, marginVertical: 10, height: 44,
  },
  searchInput: { flex: 1, color: TEXT, padding: 0 },

  // Filter row (Skill / Gender / Clear)
  filterRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 8, flexWrap: 'wrap',
    marginHorizontal: 12, marginBottom: 8,
  },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1, borderColor: BORDER,
    backgroundColor: SURFACE,
    maxWidth: 180,
  },
  filterChipOn: {
    borderColor: BRAND,
    backgroundColor: BRAND_SOFT,
  },
  filterChipText: {
    fontSize: 12, fontWeight: '700', color: TEXT_MUTED,
    letterSpacing: 0.2, flexShrink: 1,
  },
  filterChipTextOn: { color: BRAND },
  clearBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#0F172A',
  },
  clearBtnText: {
    fontSize: 11, fontWeight: '800', color: '#fff', letterSpacing: 0.3,
  },

  // Filter-sheet modal
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24,
  },
  sheetCard: {
    width: '100%', maxWidth: 380,
    backgroundColor: SURFACE,
    borderRadius: 16,
    maxHeight: '75%',
    overflow: 'hidden',
  },
  sheetHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  sheetTitle: { fontSize: 14, fontWeight: '800', color: TEXT },
  sheetItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  sheetItemOn: { backgroundColor: BRAND_SOFT },
  sheetItemText: { fontSize: 14, color: TEXT, fontWeight: '600' },
  sheetItemTextOn: { color: BRAND, fontWeight: '800' },

  filterHint: {
    fontSize: 11, fontWeight: '700', color: BRAND,
    backgroundColor: BRAND_SOFT,
    marginHorizontal: 12, marginBottom: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8,
    lineHeight: 16,
  },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: TEXT_MUTED, fontSize: 13 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 12, marginHorizontal: 12, marginBottom: 8,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, borderRadius: 12,
  },
  rowOn:  { borderColor: BRAND, backgroundColor: BRAND_SOFT + '55' },
  rowDup: { opacity: 0.65 },
  check: {
    width: 20, height: 20, borderRadius: 6,
    borderWidth: 1.5, borderColor: '#CBD5E1',
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn:  { backgroundColor: BRAND, borderColor: BRAND },
  checkDup: { borderColor: 'transparent', backgroundColor: 'transparent' },

  nameRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap',
  },
  name: { fontSize: 14, fontWeight: '700', color: TEXT, flexShrink: 1 },
  // Bolder + amber-tinted name text when the student expressed
  // interest — reinforces the row highlight.
  nameInterested: { color: '#B45309' },
  meta: { fontSize: 12, color: TEXT_MUTED, marginTop: 2 },
  // Row-level highlight for students who tapped "Yes" on the
  // student-side "Are you interested to participate?" question.
  // Amber tint + left accent stripe so the interested cohort is
  // impossible to miss at the top of the list.
  rowInterested: {
    borderColor: '#F59E0B',
    backgroundColor: '#FFFBEB',
    borderLeftWidth: 4,
    borderLeftColor: '#F59E0B',
  },
  interestedBadge: {
    fontSize: 10, fontWeight: '800', color: '#92400E',
    backgroundColor: '#FDE68A', borderRadius: 999,
    paddingHorizontal: 8, paddingVertical: 3,
    letterSpacing: 0.4, textTransform: 'uppercase',
    overflow: 'hidden',
  },
  dupBadge: {
    fontSize: 10, fontWeight: '800', color: '#B91C1C',
    backgroundColor: '#FEE2E2', borderRadius: 999,
    paddingHorizontal: 8, paddingVertical: 4,
  },

  error: {
    color: '#B91C1C', fontSize: 12,
    paddingHorizontal: 14, paddingBottom: 4,
  },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: SURFACE, borderTopWidth: 1, borderTopColor: BORDER,
    paddingHorizontal: 14, paddingVertical: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  },
  count: { fontSize: 13, fontWeight: '700', color: TEXT },
  continueBtn: {
    backgroundColor: BRAND, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 999,
  },
  continueText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  footHint: { fontSize: 11, color: TEXT_MUTED, textAlign: 'center', marginVertical: 12 },
});
