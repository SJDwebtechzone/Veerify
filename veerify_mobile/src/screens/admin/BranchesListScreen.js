// src/screens/admin/BranchesListScreen.js
//
// Institution admin's branches roster. Each branch card shows the name,
// address line, city, primary badge, distance from the head office (if
// known), and Edit / Delete actions. A red + FAB opens the create form.
//
// Backend:
//   GET    /api/branches            — list own branches
//   DELETE /api/branches/:id        — remove a branch

import React, { useCallback, useState, useContext, useMemo, createContext } from 'react';
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
// Institution Home glass system — ambient wash + glass cards +
// dark-blue primary. Reused verbatim so this screen belongs to the
// same design language.
import InstitutionScreenBackground, {
  INSTITUTION_BG_BASE,
} from '../../components/InstitutionScreenBackground';
import { useTheme } from '../../theme/ThemeContext';

// Institution-Home tokens (mirror AdminDashboardScreen values so the
// two screens paint identical surfaces).
const GLASS_FILL_STRONG  = 'rgba(255,255,255,0.88)';
const GLASS_BORDER_LIGHT = 'rgba(255,255,255,0.55)';
const GLASS_HIGHLIGHT    = 'rgba(255,255,255,0.9)';
const GLASS_SHADOW       = '#1E40AF';
const BRAND_DARK_BLUE    = '#1E3A8A';
const BRAND_ACCENT_SOFT  = 'rgba(30,58,138,0.10)';
const HEADER_NAVY        = '#0F172A';

// Kept for backward-compat with a few status-pill / error banners
// that read them by name.
const BRAND       = BRAND_DARK_BLUE;
const BRAND_SOFT  = BRAND_ACCENT_SOFT;
const TEXT        = HEADER_NAVY;
const TEXT_MUTED  = '#64748B';
const TEXT_LIGHT  = '#94A3B8';
const SURFACE     = '#FFFFFF';
const BG          = INSTITUTION_BG_BASE;
const BORDER      = 'rgba(148,163,184,0.22)';
const GREEN       = '#10B981';
const AMBER       = '#F59E0B';

// Local context so BranchCard can pick up dark-mode overrides.
const BranchesCtx = createContext({ isDark: false, dark: {} });

function buildDarkOverrides(pal) {
  return StyleSheet.create({
    screen:      { backgroundColor: pal.bg },
    header:      { backgroundColor: pal.surface, borderBottomColor: pal.border },
    iconBtn:     { backgroundColor: pal.border },
    headerTitle: { color: pal.text },
    headerSub:   { color: pal.textMuted },
    card:        { backgroundColor: pal.surface, borderTopColor: pal.border, borderRightColor: pal.border, borderBottomColor: pal.border, borderLeftColor: pal.border },
    cardTitle:   { color: pal.text },
    cardCity:    { color: pal.textMuted },
    metaText:    { color: pal.text },
    emptyCard:   { backgroundColor: pal.surface, borderTopColor: pal.border, borderRightColor: pal.border, borderBottomColor: pal.border, borderLeftColor: pal.border },
    emptyTitle:  { color: pal.text },
    emptySub:    { color: pal.textMuted },
  });
}

export default function BranchesListScreen({ navigation }) {
  const { mode, palette: themePalette } = useTheme();
  const isDark = mode === 'dark';
  const dark   = useMemo(() => buildDarkOverrides(themePalette), [themePalette]);
  const ctxValue = useMemo(() => ({ isDark, dark }), [isDark, dark]);
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
      <View style={[styles.screen, isDark && dark.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        {!isDark ? <InstitutionScreenBackground layer /> : null}
        <ActivityIndicator color={BRAND_DARK_BLUE} />
      </View>
    );
  }

  return (
    <BranchesCtx.Provider value={ctxValue}>
    <View style={[styles.screen, isDark && dark.screen]}>
      {!isDark ? <InstitutionScreenBackground layer /> : null}
      <View style={[styles.header, isDark && dark.header]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.iconBtn, isDark && dark.iconBtn]} hitSlop={8}>
          <ArrowLeft size={20} color={isDark ? '#F8FAFC' : HEADER_NAVY} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, isDark && dark.headerTitle]}>Branches</Text>
          <Text style={[styles.headerSub, isDark && dark.headerSub]}>
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
          <View style={[styles.emptyCard, isDark && dark.emptyCard]}>
            <View style={styles.emptyIconWrap}>
              <Building2 size={32} color={BRAND_DARK_BLUE} strokeWidth={1.6} />
            </View>
            <Text style={[styles.emptyTitle, isDark && dark.emptyTitle]}>No branches yet</Text>
            <Text style={[styles.emptySub, isDark && dark.emptySub]}>
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
    </BranchesCtx.Provider>
  );
}

function BranchCard({ branch, onEdit, onDelete, onMap, onOpen }) {
  const { isDark, dark } = useContext(BranchesCtx);
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
      style={[styles.card, isDark && dark.card]}
      onPress={onOpen || undefined}
      activeOpacity={0.9}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardIcon}>
          <Building2 size={16} color={BRAND_DARK_BLUE} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.cardTitleRow}>
            <Text style={[styles.cardTitle, isDark && dark.cardTitle]} numberOfLines={1}>{branch.name}</Text>
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
          <Text style={[styles.cardCity, isDark && dark.cardCity]} numberOfLines={1}>
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
          <Text style={[styles.metaText, isDark && dark.metaText]} numberOfLines={2}>{branch.address_line}</Text>
          {hasCoords ? <ChevronRight size={12} color={TEXT_LIGHT} strokeWidth={2.4} /> : null}
        </TouchableOpacity>
      ) : null}
      {branch.phone ? (
        <View style={styles.metaRow}>
          <Phone size={12} color={TEXT_MUTED} strokeWidth={2.2} />
          <Text style={[styles.metaText, isDark && dark.metaText]} numberOfLines={1}>{branch.phone}</Text>
        </View>
      ) : null}
      {branch.email ? (
        <View style={styles.metaRow}>
          <Mail size={12} color={TEXT_MUTED} strokeWidth={2.2} />
          <Text style={[styles.metaText, isDark && dark.metaText]} numberOfLines={1}>{branch.email}</Text>
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
  screen: { flex: 1, backgroundColor: INSTITUTION_BG_BASE },

  header: {
    backgroundColor: '#FFFFFF', paddingTop: 48, paddingBottom: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: 'rgba(148,163,184,0.22)',
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#EEF2F7',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: HEADER_NAVY, letterSpacing: -0.2 },
  headerSub: { fontSize: 11, color: '#64748B', fontWeight: '600', marginTop: 1 },

  // Card — premium glass surface matching Institution Home.
  card: {
    backgroundColor: GLASS_FILL_STRONG,
    borderRadius: 20,
    padding: 14,
    borderTopWidth: 1.5,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderTopColor: GLASS_HIGHLIGHT,
    borderRightColor: GLASS_BORDER_LIGHT,
    borderBottomColor: GLASS_BORDER_LIGHT,
    borderLeftColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.11,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  cardIcon: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: BRAND_ACCENT_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { fontSize: 14, fontWeight: '800', color: HEADER_NAVY, flexShrink: 1, letterSpacing: 0.1 },
  cardCity: { fontSize: 11, color: '#64748B', marginTop: 2 },

  primaryBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999,
    backgroundColor: BRAND_DARK_BLUE,
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
  metaText: { flex: 1, fontSize: 12, color: HEADER_NAVY, fontWeight: '600' },

  warnRow: {
    marginTop: 10, padding: 10, borderRadius: 10,
    backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FCD34D',
  },
  warnText: { fontSize: 11, color: '#92400E', fontWeight: '700', lineHeight: 16 },

  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  // Edit — outlined dark-blue pill matches the Institution Home
  // secondary-action idiom (light halo + brand border + brand text).
  editBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 9, borderRadius: 12,
    backgroundColor: BRAND_ACCENT_SOFT, borderWidth: 1.5, borderColor: BRAND_DARK_BLUE,
  },
  editBtnText: { fontSize: 12, color: BRAND_DARK_BLUE, fontWeight: '800' },
  // Remove — kept red for destructive affordance.
  deleteBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 9, borderRadius: 12, backgroundColor: '#B91C1C',
    shadowColor: '#B91C1C',
    shadowOpacity: 0.20,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  deleteBtnText: { fontSize: 12, color: '#fff', fontWeight: '800' },

  // "Tap card to view dashboard →" hint at the bottom of sub-branch
  // cards. Dark-blue soft to match the rest of the accent language.
  dashboardHint: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4,
    marginTop: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: BRAND_ACCENT_SOFT,
  },
  dashboardHintText: {
    fontSize: 10.5, fontWeight: '800', color: BRAND_DARK_BLUE, letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  // Empty state — full glass card, dark-blue soft icon halo, dark-blue
  // CTA with matching cobalt drop-shadow.
  emptyCard: {
    backgroundColor: GLASS_FILL_STRONG,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderTopWidth: 1.5,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderTopColor: GLASS_HIGHLIGHT,
    borderRightColor: GLASS_BORDER_LIGHT,
    borderBottomColor: GLASS_BORDER_LIGHT,
    borderLeftColor: GLASS_BORDER_LIGHT,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.11,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  emptyIconWrap: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: BRAND_ACCENT_SOFT,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: HEADER_NAVY, marginBottom: 6 },
  emptySub: {
    fontSize: 12, color: '#64748B', textAlign: 'center', lineHeight: 18, marginBottom: 16,
  },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: BRAND_DARK_BLUE, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
    shadowColor: BRAND_DARK_BLUE,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  emptyCtaText: { fontSize: 12, color: '#fff', fontWeight: '800' },

  // FAB — dark-blue with cobalt glow shadow, matching Institution
  // Home / other rebranded screens.
  fab: {
    position: 'absolute', right: 18, bottom: 22,
    width: 54, height: 54, borderRadius: 27, backgroundColor: BRAND_DARK_BLUE,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: BRAND_DARK_BLUE, shadowOpacity: 0.32,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14, elevation: 8,
  },
});
