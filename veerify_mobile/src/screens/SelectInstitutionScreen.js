import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, RefreshControl, Image, Alert,
  Platform, PermissionsAndroid, Linking,
} from 'react-native';
import { MapPin, Search, ChevronRight, Building2, Locate, Check } from 'lucide-react-native';

import { useInstitution } from '../context/InstitutionContext';
import apiClient from '../api/client';
import { palette, spacing, radius, shadows, type } from '../theme';
import { confirm } from '../components/ConfirmDialog';
import Avatar from '../components/Avatar';

// Lazy require so the app still boots on a fresh checkout that hasn't
// linked the native module yet. Same pattern the NearbyLocationPicker
// component uses.
let Geolocation = null;
try {
  const mod = require('react-native-geolocation-service');
  Geolocation = (mod && mod.default) || mod || null;
} catch (_) {
  Geolocation = null;
}

// Haversine — used to decide whether the watchPosition update is far
// enough from the last fetch to warrant a fresh API call. Prevents
// GPS jitter from spamming /institutions/nearby every second.
function distanceKm(a, b) {
  if (!a || !b) return Infinity;
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

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

  // GPS lifecycle state:
  //   • coords         — latest lat/lng from the OS
  //   • locating       — true while permission prompt or first fix is
  //                      in flight (drives the button spinner)
  //   • locationActive — true when the watchPosition subscription is
  //                      live; drives the "Using your location" pill
  const [coords, setCoords] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locationActive, setLocationActive] = useState(false);
  // watchId comes back from Geolocation.watchPosition. Kept in a ref
  // so the cleanup effect can clear it without triggering re-renders.
  const watchIdRef = useRef(null);
  // Track the last-fetched coords so watchPosition doesn't refire the
  // API for every 5-metre GPS wobble. We only re-fetch when the user
  // has moved > 100 m.
  const lastFetchedRef = useRef(null);

  // Fetch on mount (without GPS for now).
  useEffect(() => { refreshList(); }, [refreshList]);

  // Clear the watchPosition subscription on unmount so the OS doesn't
  // keep spinning the GPS after the user navigates away.
  useEffect(() => {
    return () => {
      if (watchIdRef.current != null && Geolocation?.clearWatch) {
        try { Geolocation.clearWatch(watchIdRef.current); } catch (_) { /* noop */ }
        watchIdRef.current = null;
      }
    };
  }, []);

  // Filter matches both the parent institution's name AND the branch
  // label so a search for "Anna Nagar" still finds "Tiger Martial Arts
  // — Anna Nagar Branch". De-dup by row id — the backend already
  // returns each row (main + each branch) exactly once, but we defend
  // against upstream duplication defensively.
  const visible = useMemo(() => {
    const seen = new Set();
    const deduped = institutions.filter((i) => {
      const key = String(i.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const q = search.trim().toLowerCase();
    if (!q) return deduped;
    return deduped.filter((i) =>
      (i.display_name || i.name || '').toLowerCase().includes(q) ||
      (i.branch_label || '').toLowerCase().includes(q) ||
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

  // Shared "denied / disabled" handler. Uses the app's branded
  // confirm() dialog so the copy sits alongside the rest of the
  // student flows instead of the raw OS Alert. Confirm = open OS
  // settings, Cancel = fall back to manual search.
  const promptEnableLocation = (message) => {
    setLocating(false);
    confirm({
      title:       'Location access needed',
      message:     message ||
        'Veerify uses your location to find academies near you. ' +
        'Enable location permission or continue searching manually.',
      variant:     'destructive',
      confirmText: 'Open settings',
      cancelText:  'Search manually',
      onConfirm:   () => {
        try { Linking.openSettings(); } catch (_) { /* noop */ }
      },
    });
  };

  // Ask for location permission on both platforms. Returns true iff
  // the OS granted access.
  const requestLocationPermission = async () => {
    if (!Geolocation) return false;
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title:            'Location permission',
            message:          'Veerify uses your location to show academies near you.',
            buttonPositive:   'Allow',
            buttonNegative:   'Deny',
            buttonNeutral:    'Ask later',
          },
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } catch (_) {
        return false;
      }
    }
    // iOS
    if (typeof Geolocation.requestAuthorization === 'function') {
      try {
        const r = await Geolocation.requestAuthorization('whenInUse');
        return r === 'granted';
      } catch (_) {
        return false;
      }
    }
    return true;
  };

  // Tap handler for "Use my location". Requests permission, gets a
  // first fix, refetches the nearby list, then starts watchPosition
  // so the results stay live if the user moves.
  const handleUseMyLocation = async () => {
    if (locating) return;
    if (!Geolocation) {
      confirm({
        title:       'GPS not available',
        message:
          'This build is missing the location module. ' +
          'Search manually below.',
        variant:     'warning',
        confirmText: 'Got it',
        hideCancel:  true,
      });
      return;
    }
    setLocating(true);
    const ok = await requestLocationPermission();
    if (!ok) {
      promptEnableLocation();
      return;
    }
    // First fix — a one-shot getCurrentPosition. This is the value we
    // pass to refreshList so the list re-sorts immediately.
    Geolocation.getCurrentPosition(
      async (pos) => {
        const c = pos?.coords || {};
        if (typeof c.latitude !== 'number' || typeof c.longitude !== 'number') {
          setLocating(false);
          confirm({
            title:       'Could not read your location',
            message:
              'Try again in a moment, or search manually below.',
            variant:     'warning',
            confirmText: 'Got it',
            hideCancel:  true,
          });
          return;
        }
        const next = { lat: c.latitude, lng: c.longitude };
        setCoords(next);
        lastFetchedRef.current = next;
        await refreshList(next.lat, next.lng);
        setLocating(false);
        setLocationActive(true);

        // Kick off watchPosition so the results stay accurate as the
        // user moves. We refetch only when they've moved > 100 m so
        // GPS jitter doesn't hammer the API.
        if (watchIdRef.current != null && Geolocation.clearWatch) {
          try { Geolocation.clearWatch(watchIdRef.current); } catch (_) {}
          watchIdRef.current = null;
        }
        if (typeof Geolocation.watchPosition === 'function') {
          watchIdRef.current = Geolocation.watchPosition(
            (upd) => {
              const u = upd?.coords || {};
              if (typeof u.latitude !== 'number' || typeof u.longitude !== 'number') return;
              const now = { lat: u.latitude, lng: u.longitude };
              setCoords(now);
              const moved = distanceKm(lastFetchedRef.current, now);
              if (moved > 0.1) {
                lastFetchedRef.current = now;
                refreshList(now.lat, now.lng).catch(() => {});
              }
            },
            (_err) => { /* silent — first fix already succeeded */ },
            {
              enableHighAccuracy: true,
              distanceFilter:     50,   // meters — OS-level throttle
              interval:           10000,
              fastestInterval:    5000,
            },
          );
        }
      },
      (err) => {
        setLocating(false);
        // Permission denied at OS level or GPS off. Guide the user.
        promptEnableLocation(
          err?.code === 1
            ? 'Location permission was denied. Enable it from Settings to see academies near you.'
            : 'Could not read your location. Check that GPS is enabled on your device.',
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
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

      {/* GPS CTA — three states:
             idle   → shows the Locate icon + "Use my location"
             busy   → shows spinner + "Finding your location…"
             active → filled purple + "Using your location" + checkmark.
                       Tapping while active re-runs the flow (fresh fix). */}
      <TouchableOpacity
        onPress={handleUseMyLocation}
        activeOpacity={0.85}
        style={[styles.gpsButton, locationActive && styles.gpsButtonActive]}
        disabled={locating}
      >
        {locating ? (
          <ActivityIndicator
            size="small"
            color={locationActive ? '#fff' : palette.purple.vivid}
          />
        ) : locationActive ? (
          <Check size={18} color="#fff" strokeWidth={2.6} />
        ) : (
          <Locate size={18} color={palette.purple.vivid} strokeWidth={2.4} />
        )}
        <Text
          style={[
            styles.gpsText,
            locationActive && { color: '#fff' },
          ]}
        >
          {locating
            ? 'Finding your location…'
            : locationActive
              ? 'Using your location'
              : 'Use my location'}
        </Text>
        {locationActive && coords ? (
          <Text style={[styles.gpsBadge, styles.gpsBadgeActive]}>Live</Text>
        ) : null}
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
  const distanceLabel = Number.isFinite(item.distance_km)
    ? `${item.distance_km.toFixed(1)} km away`
    : null;

  // Backend supplies both derived fields:
  //   • display_name  — the parent institution name (or the row's own
  //                     name if this row IS the main institution)
  //   • branch_label  — "Main Branch" for a main institution, or the
  //                     branch's own name (e.g. "Anna Nagar Branch")
  // The three-line stack is exactly:
  //   Tiger Martial Arts
  //   Main Branch / Anna Nagar Branch / Velachery Branch
  //   Chennai • 600040
  const institutionName = item.display_name || item.name || '';
  const branchLabel     = item.branch_label || (item.parent_institution_id ? item.name : 'Main Branch');
  const isBranch        = !!item.is_branch || !!item.parent_institution_id;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      style={[styles.row, selected && styles.rowSelected]}
    >
      <Avatar
        uri={item.logo_url}
        name={institutionName}
        size={50}
        tone="purple"
        fit="contain"
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{institutionName}</Text>
        <View style={styles.branchPillRow}>
          <View style={[
            styles.branchPill,
            isBranch ? styles.branchPillSub : styles.branchPillMain,
          ]}>
            <Text style={[
              styles.branchPillText,
              isBranch ? styles.branchPillTextSub : styles.branchPillTextMain,
            ]} numberOfLines={1}>
              {branchLabel}
            </Text>
          </View>
        </View>
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
  // Filled brand-purple treatment for when location is live.
  gpsButtonActive: {
    backgroundColor: palette.purple.vivid,
    borderColor: palette.purple.vivid,
  },
  gpsText: { flex: 1, ...type.bodyBold, color: palette.purple.on },
  gpsBadge: {
    fontSize: 10, fontWeight: '700',
    color: palette.purple.on,
    backgroundColor: 'rgba(255,255,255,0.6)',
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: radius.pill,
  },
  // "Live" pill on the active button — reversed color so it pops
  // against the filled purple background.
  gpsBadgeActive: {
    color: palette.purple.vivid,
    backgroundColor: '#fff',
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
  // Branch label pill — sits between the institution name and the
  // city line so the row reads Name / Branch / Location vertically.
  branchPillRow: { flexDirection: 'row', marginTop: 4 },
  branchPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    maxWidth: '100%',
  },
  branchPillMain: { backgroundColor: palette.purple.soft || '#EDE9FE' },
  branchPillSub:  { backgroundColor: '#DBEAFE' },
  branchPillText: { fontSize: 11, fontWeight: '700' },
  branchPillTextMain: { color: palette.purple.on || '#5B21B6' },
  branchPillTextSub:  { color: '#1E40AF' },
  selectedDot: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: palette.purple.vivid,
    alignItems: 'center', justifyContent: 'center',
  },
});
