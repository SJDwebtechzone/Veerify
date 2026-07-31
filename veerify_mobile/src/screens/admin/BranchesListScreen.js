// src/screens/admin/BranchesListScreen.js
//
// Institution admin's branches roster. Each branch card shows the name,
// address line, city, primary badge, distance from the head office (if
// known), and Edit / Delete actions. A red + FAB opens the create form.
//
// Backend:
//   GET    /api/branches            — list own branches
//   DELETE /api/branches/:id        — remove a branch

import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator,
  RefreshControl, StyleSheet, Alert, Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Plus, MapPin, Phone, Mail, Building2,
  Edit3, Trash2, Star, ChevronRight,
} from 'lucide-react-native';

import apiClient from '../../api/client';

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

export default function BranchesListScreen({ navigation }) {
  const [branches, setBranches]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get('/branches');
      setBranches(r.data?.branches || []);
    } catch (err) {
      console.log('[Branches] load failed:', err?.response?.data || err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onDelete = (branch) => {
    Alert.alert(
      'Remove branch?',
      `Are you sure you want to remove "${branch.name}"? Students will no longer see this location in their nearby search.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.delete(`/branches/${branch.id}`);
              load();
            } catch (err) {
              Alert.alert('Error', err?.response?.data?.message || 'Failed to remove');
            }
          },
        },
      ],
    );
  };

  // Pre-flight plan-limit check — we call /plans/usage before opening
  // the Add form so the user sees the upgrade block immediately instead
  // of filling out the whole form only to be 402'd on Save. If the
  // usage endpoint itself fails we fall through and let the create
  // endpoint be the source of truth (the backend re-checks anyway).
  const openCreate = async () => {
    try {
      const r = await apiClient.get('/plans/usage');
      const b = r.data?.branches || {};
      const limit  = Number(b.limit  || 0);
      const used   = Number(b.current || 0);
      const unlim  = !!b.unlimited || limit >= 999 || limit === 0;
      if (!unlim && used >= limit) {
        Alert.alert(
          'Branch limit reached',
          'Branch limit reached. Please upgrade your plan to add more branches.',
        );
        return;
      }
    } catch { /* fall through — backend will re-check on POST */ }
    navigation.navigate('CreateBranch');
  };

  const openEdit = (branch) => {
    // Editing works for both flavors. Sub-branch edits route through a
    // dedicated main-admin endpoint (PATCH /institutions/sub-branches/:id)
    // that updates the institutions row; satellite edits use PUT
    // /branches/:id. The CreateBranch screen switches between them by
    // reading branch.branch_kind.
    navigation.navigate('CreateBranch', { branch });
  };

  const openMaps = (branch) => {
    if (branch.latitude && branch.longitude) {
      Linking.openURL(
        `https://www.google.com/maps/search/?api=1&query=${branch.latitude},${branch.longitude}`,
      ).catch(() => {});
    } else if (branch.address_line || branch.city) {
      const q = encodeURIComponent(
        `${branch.address_line || ''} ${branch.city || ''} ${branch.state || ''}`.trim(),
      );
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`).catch(() => {});
    }
  };

  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={BRAND} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8}>
          <ArrowLeft size={20} color={TEXT} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Branches</Text>
          <Text style={styles.headerSub}>
            {branches.length === 0
              ? 'Add your first branch'
              : `${branches.length} ${branches.length === 1 ? 'location' : 'locations'}`}
          </Text>
        </View>
      </View>

      <FlatList
        data={branches}
        keyExtractor={(b) => String(b.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={BRAND}
          />
        }
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconWrap}>
              <Building2 size={32} color={BRAND} strokeWidth={1.6} />
            </View>
            <Text style={styles.emptyTitle}>No branches yet</Text>
            <Text style={styles.emptySub}>
              Add the physical locations of your academy so students nearby can
              find you in the app's Nearby Academies section.
            </Text>
            <TouchableOpacity
              style={styles.emptyCta}
              onPress={openCreate}
              activeOpacity={0.85}
            >
              <Plus size={14} color="#fff" strokeWidth={2.6} />
              <Text style={styles.emptyCtaText}>Add Branch</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <BranchCard
            branch={item}
            onEdit={() => openEdit(item)}
            // Per spec: every branch — sub-branch, satellite, or
            // wizard entry — is deletable from the institution portal.
            // The backend picks up the right paired rows and cleans
            // both institutions + institution_branches so the Web
            // Admin's Linked Branches section reflects it after
            // refresh.
            onDelete={() => onDelete(item)}
            onMap={() => openMaps(item)}
            // Tapping a sub-branch card opens the read-only Branch
            // Dashboard (students / revenue / attendance). Satellite
            // rows don't have their own students, so we don't expose
            // the drill-in for them.
            onOpen={
              item.branch_kind === 'sub_branch'
                ? () => navigation.navigate('BranchDashboard', {
                    branchId: item.id,
                    branch: item,
                  })
                : null
            }
          />
        )}
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={openCreate}
        activeOpacity={0.85}
      >
        <Plus size={22} color="#fff" strokeWidth={2.8} />
      </TouchableOpacity>
    </View>
  );
}

function BranchCard({ branch, onEdit, onDelete, onMap, onOpen }) {
  const hasCoords = branch.latitude != null && branch.longitude != null;
  // Two flavors of branch coexist on the list:
  //   sub_branch → its own login credentials, its own students
  //   satellite  → additional physical address on the same academy
  const isSubBranch = branch.branch_kind === 'sub_branch';
  // Sub-branch cards are tappable — they open the Branch Dashboard.
  // Satellite cards stay static (no per-satellite student roster).
  const CardWrap = onOpen ? TouchableOpacity : View;
  return (
    <CardWrap
      style={styles.card}
      onPress={onOpen || undefined}
      activeOpacity={0.9}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardIcon}>
          <Building2 size={16} color={BRAND} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle} numberOfLines={1}>{branch.name}</Text>
            {branch.is_primary ? (
              <View style={styles.primaryBadge}>
                <Star size={9} color="#fff" strokeWidth={2.6} />
                <Text style={styles.primaryBadgeText}>Primary</Text>
              </View>
            ) : null}
            {/* Per spec: no sub-branch hierarchy — every card just
                reads as a plain Branch. The old SUB-BRANCH badge was
                removed here; the internal branch_kind flag is still
                used for delete plumbing but the UI never surfaces
                the sub-branch/satellite distinction anymore. */}
          </View>
          <Text style={styles.cardCity} numberOfLines={1}>
            {branch.city || '—'}{branch.state ? `, ${branch.state}` : ''}
          </Text>
        </View>
        <View style={[
          styles.statusPill,
          branch.status === 'active' ? styles.statusActive : styles.statusInactive,
        ]}>
          <Text style={[
            styles.statusText,
            { color: branch.status === 'active' ? GREEN : AMBER },
          ]}>
            {branch.status === 'active' ? 'Active' : 'Inactive'}
          </Text>
        </View>
      </View>

      {branch.address_line ? (
        <TouchableOpacity
          style={styles.metaRow}
          onPress={(e) => { e.stopPropagation?.(); onMap && onMap(); }}
          activeOpacity={0.85}
        >
          <MapPin size={12} color={TEXT_MUTED} strokeWidth={2.2} />
          <Text style={styles.metaText} numberOfLines={2}>{branch.address_line}</Text>
          {hasCoords ? <ChevronRight size={12} color={TEXT_LIGHT} strokeWidth={2.4} /> : null}
        </TouchableOpacity>
      ) : null}
      {branch.phone ? (
        <View style={styles.metaRow}>
          <Phone size={12} color={TEXT_MUTED} strokeWidth={2.2} />
          <Text style={styles.metaText} numberOfLines={1}>{branch.phone}</Text>
        </View>
      ) : null}
      {branch.email ? (
        <View style={styles.metaRow}>
          <Mail size={12} color={TEXT_MUTED} strokeWidth={2.2} />
          <Text style={styles.metaText} numberOfLines={1}>{branch.email}</Text>
        </View>
      ) : null}

      {!hasCoords ? (
        <View style={styles.warnRow}>
          <Text style={styles.warnText}>
            No GPS coordinates set — this branch won't show in students' nearby
            search until you pick a location on the map.
          </Text>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.editBtn}
          onPress={(e) => { e.stopPropagation?.(); onEdit(); }}
          activeOpacity={0.85}
        >
          <Edit3 size={12} color={BRAND} strokeWidth={2.4} />
          <Text style={styles.editBtnText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={(e) => { e.stopPropagation?.(); onDelete(); }}
          activeOpacity={0.85}
        >
          <Trash2 size={12} color="#fff" strokeWidth={2.4} />
          <Text style={styles.deleteBtnText}>Remove</Text>
        </TouchableOpacity>
      </View>

      {/* Drill-in hint — only for sub-branches, since satellites don't
          carry their own students / batches to dashboard from. */}
      {onOpen ? (
        <View style={styles.dashboardHint}>
          <Text style={styles.dashboardHintText}>Tap card to view dashboard</Text>
          <ChevronRight size={12} color={BRAND} strokeWidth={2.6} />
        </View>
      ) : null}
    </CardWrap>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  header: {
    backgroundColor: SURFACE, paddingTop: 48, paddingBottom: 14, paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: TEXT, letterSpacing: -0.2 },
  headerSub: { fontSize: 11, color: TEXT_MUTED, fontWeight: '600', marginTop: 1 },

  card: {
    backgroundColor: SURFACE, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: BORDER,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  cardIcon: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { fontSize: 14, fontWeight: '800', color: TEXT, flexShrink: 1 },
  cardCity: { fontSize: 11, color: TEXT_MUTED, marginTop: 2 },

  primaryBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999,
    backgroundColor: BRAND,
  },
  primaryBadgeText: { fontSize: 9, color: '#fff', fontWeight: '800', letterSpacing: 0.3 },

  // Sub-branch chip — signals "has its own admin login" so the mobile
  // admin can tell wizard-created child institutions apart from plain
  // satellite locations.
  kindBadge: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999,
    backgroundColor: '#E0E7FF', borderWidth: 1, borderColor: '#C7D2FE',
  },
  kindBadgeText: { fontSize: 9, color: '#3730A3', fontWeight: '800', letterSpacing: 0.4 },

  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  statusActive: { backgroundColor: '#D1FAE5' },
  statusInactive: { backgroundColor: '#FEF3C7' },
  statusText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  metaText: { flex: 1, fontSize: 12, color: TEXT, fontWeight: '600' },

  warnRow: {
    marginTop: 10, padding: 10, borderRadius: 10,
    backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FCD34D',
  },
  warnText: { fontSize: 11, color: '#92400E', fontWeight: '700', lineHeight: 16 },

  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  editBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 9, borderRadius: 10,
    backgroundColor: BRAND_SOFT, borderWidth: 1, borderColor: BRAND,
  },
  editBtnText: { fontSize: 12, color: BRAND, fontWeight: '800' },
  deleteBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 9, borderRadius: 10, backgroundColor: BRAND,
  },
  deleteBtnText: { fontSize: 12, color: '#fff', fontWeight: '800' },

  // Small "Tap card to view dashboard →" strip rendered at the bottom
  // of sub-branch cards. Purely a discoverability affordance — the
  // whole card is already tappable.
  dashboardHint: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4,
    marginTop: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: BRAND_SOFT,
  },
  dashboardHintText: {
    fontSize: 10.5, fontWeight: '800', color: BRAND, letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  emptyCard: {
    backgroundColor: SURFACE, borderRadius: 16, padding: 24, alignItems: 'center',
    borderWidth: 1, borderColor: BORDER,
  },
  emptyIconWrap: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: TEXT, marginBottom: 6 },
  emptySub: {
    fontSize: 12, color: TEXT_MUTED, textAlign: 'center', lineHeight: 18, marginBottom: 16,
  },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: BRAND, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
  },
  emptyCtaText: { fontSize: 12, color: '#fff', fontWeight: '800' },

  fab: {
    position: 'absolute', right: 18, bottom: 22,
    width: 54, height: 54, borderRadius: 27, backgroundColor: BRAND,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8, elevation: 6,
  },
});
