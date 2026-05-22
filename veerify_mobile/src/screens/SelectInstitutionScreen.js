import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, RefreshControl, Image, Alert,
} from 'react-native';
import { MapPin, Search, ChevronRight, Building2, Locate, Check } from 'lucide-react-native';

import { useInstitution } from '../context/InstitutionContext';
import apiClient from '../api/client';
import { palette, spacing, radius, shadows, type } from '../theme';

// ─────────────────────────────────────────────────────────────────────────────
// SelectInstitutionScreen
//
// Lets the user pick their academy. Two paths:
//   1. "Use my location" — auto-pick the nearest (currently STUBBED, will be
//      wired once react-native-geolocation-service is installed).
//   2. Manual picker — searchable list of all browsable institutions.
//
// Used in two flows:
//   - First-time launch flow (no institution selected yet)
//   - "Change academy" flow (accessed from Home / Profile)
//
// Picking an institution calls selectInstitution() from InstitutionContext
// which persists it, and then we navigate back / forward depending on context.
// ─────────────────────────────────────────────────────────────────────────────

const ASSET_HOST = (apiClient.defaults.baseURL || '').replace(/\/api\/?$/, '');
function resolveAssetUrl(src) {
  if (!src) return null;
  if (src.startsWith('data:')) return src;
  if (src.startsWith('/uploads/')) return ASSET_HOST + src;
  if (src.includes('://localhost:') || src.includes('://127.0.0.1:')) {
    return src.replace(/:\/\/(localhost|127\.0\.0\.1)(?=[:\/])/, '://10.0.2.2');
  }
  return src;
}

export default function SelectInstitutionScreen({ navigation, route }) {
  const {
    selectedInstitution, institutions, fetchingList, listError,
    refreshList, selectInstitution,
  } = useInstitution();

  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  // Fetch on mount (without GPS for now).
  useEffect(() => { refreshList(); }, [refreshList]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return institutions;
    return institutions.filter((i) =>
      (i.name || '').toLowerCase().includes(q) ||
      (i.city || '').toLowerCase().includes(q) ||
      (i.pincode || '').toLowerCase().includes(q),
    );
  }, [institutions, search]);

  const handlePick = async (inst) => {
    setBusy(true);
    await selectInstitution(inst);
    setBusy(false);
    // If navigated from "Change academy", just go back. Otherwise (first-time
    // flow) the navigator will re-render and replace this screen automatically.
    if (navigation?.canGoBack?.()) navigation.goBack();
  };

  // Stub for GPS auto-pick. We wire react-native-geolocation-service in a
  // follow-up step (needs a native rebuild). For now this just nudges users
  // toward manual picking.
  const handleUseMyLocation = () => {
    Alert.alert(
      'Location coming soon',
      "We'll auto-pick the nearest academy once GPS is wired up. For now, please choose one from the list below.",
    );
  };

  if (fetchingList && institutions.length === 0) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={palette.purple.vivid} />
        <Text style={styles.loadingText}>Finding academies near you…</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Choose your academy</Text>
        <Text style={styles.subtitle}>
          Pick the academy you train at. You can switch anytime.
        </Text>
      </View>

      {/* GPS CTA */}
      <TouchableOpacity
        onPress={handleUseMyLocation}
        activeOpacity={0.85}
        style={styles.gpsButton}
      >
        <Locate size={18} color={palette.purple.vivid} strokeWidth={2.4} />
        <Text style={styles.gpsText}>Use my location</Text>
        <Text style={styles.gpsBadge}>Soon</Text>
      </TouchableOpacity>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Search size={18} color={palette.textMuted} strokeWidth={2.2} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name, city, or pincode"
          placeholderTextColor={palette.textLight}
          style={styles.searchInput}
        />
      </View>

      {/* Error */}
      {listError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{listError}</Text>
        </View>
      ) : null}

      {/* List */}
      <FlatList
        data={visible}
        keyExtractor={(i) => String(i.id)}
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: 40 }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        refreshControl={
          <RefreshControl
            refreshing={fetchingList}
            onRefresh={() => refreshList()}
            tintColor={palette.purple.vivid}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Building2 size={36} color={palette.textLight} strokeWidth={2} />
            <Text style={styles.emptyTitle}>
              {search ? 'No academies match your search' : 'No academies available yet'}
            </Text>
            <Text style={styles.emptyBody}>
              {search ? 'Try a different name or city.' : 'Check back soon — new academies are joining all the time.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <InstitutionRow
            item={item}
            selected={selectedInstitution?.id === item.id}
            disabled={busy}
            onPress={() => handlePick(item)}
          />
        )}
      />
    </View>
  );
}

function InstitutionRow({ item, selected, disabled, onPress }) {
  const logo = resolveAssetUrl(item.logo_url);
  const distanceLabel = Number.isFinite(item.distance_km)
    ? `${item.distance_km.toFixed(1)} km away`
    : null;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      style={[styles.row, selected && styles.rowSelected]}
    >
      {logo ? (
        <Image source={{ uri: logo }} style={styles.logo} resizeMode="cover" />
      ) : (
        <View style={[styles.logo, { backgroundColor: palette.purple.soft, alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={{ ...type.h2, color: palette.purple.on }}>
            {item.name?.charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
        <View style={styles.metaRow}>
          <MapPin size={12} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.meta} numberOfLines={1}>
            {item.city || 'India'}{item.pincode ? ` • ${item.pincode}` : ''}
          </Text>
        </View>
        {distanceLabel ? <Text style={styles.distance}>{distanceLabel}</Text> : null}
      </View>
      {selected
        ? <View style={styles.selectedDot}><Check size={14} color="#fff" strokeWidth={3} /></View>
        : <ChevronRight size={18} color={palette.textLight} strokeWidth={2} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  loadingText: { ...type.body, color: palette.textMuted, marginTop: spacing.md },

  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.xxl, paddingBottom: spacing.md },
  title:    { ...type.display, color: palette.text },
  subtitle: { ...type.caption, color: palette.textMuted, marginTop: 4 },

  gpsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: palette.purple.soft,
    borderWidth: 1,
    borderColor: palette.purple.vivid + '30',
  },
  gpsText: { flex: 1, ...type.bodyBold, color: palette.purple.on },
  gpsBadge: {
    fontSize: 10, fontWeight: '700',
    color: palette.purple.on,
    backgroundColor: 'rgba(255,255,255,0.6)',
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: radius.pill,
  },

  searchWrap: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    height: 48,
    ...shadows.card,
  },
  searchInput: { flex: 1, ...type.body, color: palette.text, padding: 0 },

  errorBox: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: palette.rose.soft,
    borderRadius: radius.md,
  },
  errorText: { ...type.caption, color: palette.rose.on, fontWeight: '600' },

  empty: { alignItems: 'center', paddingVertical: 60, gap: spacing.sm, paddingHorizontal: spacing.xl },
  emptyTitle: { ...type.h2, color: palette.text, marginTop: spacing.md, textAlign: 'center' },
  emptyBody:  { ...type.body, color: palette.textMuted, textAlign: 'center' },

  // Row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: 'transparent',
    ...shadows.card,
  },
  rowSelected: { borderColor: palette.purple.vivid },
  logo: { width: 50, height: 50, borderRadius: 25 },
  name: { ...type.bodyBold, color: palette.text, fontSize: 15 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  meta: { ...type.caption, color: palette.textMuted },
  distance: { ...type.micro, color: palette.purple.on, marginTop: 4 },
  selectedDot: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: palette.purple.vivid,
    alignItems: 'center', justifyContent: 'center',
  },
});
