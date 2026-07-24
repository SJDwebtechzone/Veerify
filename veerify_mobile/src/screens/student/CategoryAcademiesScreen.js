// src/screens/student/CategoryAcademiesScreen.js
//
// Opened from the Home tab's Categories row. Given a category, we hit
// GET /api/academies/by-category and render a scrollable list of the
// active + approved academies that offer it. Tap a card → the shared
// InstitutionDetail screen.
//
// Route params:
//   category   — the category object as it arrived from /cms/categories
//                ({ id, name, image_url, ... })
//
// Empty state: "No academies found" with a soft illustration so guests
// know the tap did fire, they just haven't reached an academy for this
// discipline yet.

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator, Image,
  StyleSheet, RefreshControl, Linking,
} from 'react-native';
import {
  ArrowLeft, MapPin, Star, Sparkles, Building2, Navigation2, ChevronRight,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import apiClient from '../../api/client';
import resolveAssetUrl from '../../utils/assetUrl';
import { useInstitution } from '../../context/InstitutionContext';

const BRAND      = '#E63946';
const BRAND_SOFT = '#FFE4E6';
const TEXT       = '#111827';
const TEXT_MUTED = '#6B7280';
const TEXT_LIGHT = '#9CA3AF';
const SURFACE    = '#FFFFFF';
const BG         = '#F4F4F8';
const BORDER     = '#E5E7EB';

const NEARBY_ORIGIN_KEY = 'nearbyOrigin';

export default function CategoryAcademiesScreen({ navigation, route }) {
  const { selectInstitution } = useInstitution();
  const category = route?.params?.category || null;
  const categoryName = category?.name || '';

  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]         = useState('');

  // Reuse the origin the Nearby search already set (GPS or pincode) so
  // results here can be distance-sorted without asking for permission
  // again. Falls back to no-geo if nothing's stored yet.
  const [origin, setOrigin] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(NEARBY_ORIGIN_KEY);
        if (raw) {
          const p = JSON.parse(raw);
          if (p?.lat && p?.lng) setOrigin({ lat: p.lat, lng: p.lng });
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!categoryName) {
      setLoading(false);
      return;
    }
    try {
      setError('');
      const params = new URLSearchParams({ name: categoryName });
      if (origin?.lat && origin?.lng) {
        params.set('lat', String(origin.lat));
        params.set('lng', String(origin.lng));
      }
      const res = await apiClient.get(`/academies/by-category?${params.toString()}`);
      setItems(res.data?.results || []);
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Failed to load academies.');
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [categoryName, origin?.lat, origin?.lng]);

  useEffect(() => { load(); }, [load]);

  const openAcademy = (academy) => {
    // InstitutionDetail was removed — its content now renders inline
    // on the Home tab. Select the academy so Home hydrates its
    // banner / details / courses, then pop back to the tab
    // navigator root (which is what mounts the Home tab).
    //
    // Route naming: guests land inside "GuestHome" (defined on the
    // guest stack in AppNavigator), signed-in students land inside
    // "StudentTabs". Both host the same StudentTabNavigator, so once
    // we're at the tab navigator root the Home tab picks up the
    // context change from useInstitution() and re-fetches banner /
    // details / courses for the new academy. popToTop covers both
    // stacks without needing to guess the route name; the try/catch
    // fallbacks are a safety net for older nav trees.
    selectInstitution({
      id:       academy.id,
      name:     academy.name,
      logo_url: academy.logo_url,
      city:     academy.city,
    });
    // Route to the tab-navigator root explicitly by name — DO NOT use
    // popToTop() here. The guest stack registers Welcome at index 0,
    // Login/Register/ForgotPassword next, then GuestHome. If a guest
    // arrives via Welcome → GuestHome, popToTop() walks all the way
    // back to Welcome, which is the bug this branch fixes. `navigate`
    // with a specific name lands on GuestHome / StudentTabs whether
    // it's already in the stack (React Navigation pops back to it) or
    // not (it's pushed on top).
    try { navigation.navigate('GuestHome'); return; } catch (_) { /* try next */ }
    try { navigation.navigate('StudentTabs'); return; } catch (_) { /* try next */ }
    try { navigation.getParent()?.navigate('GuestHome'); return; } catch (_) { /* noop */ }
    try { navigation.getParent()?.navigate('StudentTabs'); } catch (_) { /* noop */ }
  };

  const openDirections = (academy) => {
    if (academy.latitude != null && academy.longitude != null) {
      Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&destination=${academy.latitude},${academy.longitude}`,
      ).catch(() => {});
    } else {
      const q = encodeURIComponent(
        [academy.name, academy.address, academy.city, academy.pincode].filter(Boolean).join(' '),
      );
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`).catch(() => {});
    }
  };

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8}>
          <ArrowLeft size={20} color={TEXT} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {categoryName || 'Category'}
          </Text>
          <Text style={styles.headerSub}>
            {loading
              ? 'Finding academies…'
              : items.length === 0
                ? 'No academies yet'
                : `${items.length} ${items.length === 1 ? 'academy' : 'academies'}`}
          </Text>
        </View>
        <CategoryHeaderImage category={category} />

      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={BRAND} />
        </View>
      ) : items.length === 0 ? (
        <EmptyState categoryName={categoryName} error={error} onRetry={load} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={BRAND}
            />
          }
          renderItem={({ item }) => (
            <AcademyCard
              academy={item}
              onPress={() => openAcademy(item)}
              onDirections={() => openDirections(item)}
            />
          )}
        />
      )}
    </View>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────
function EmptyState({ categoryName, error, onRetry }) {
  return (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyIcon}>
        <Building2 size={36} color={BRAND} strokeWidth={1.6} />
      </View>
      <Text style={styles.emptyTitle}>No academies found</Text>
      <Text style={styles.emptySub}>
        {error
          ? error
          : `We don't have any active academies offering ${categoryName || 'this category'} yet. Check back soon — new ones join every week.`}
      </Text>
      <TouchableOpacity style={styles.emptyBtn} onPress={onRetry} activeOpacity={0.85}>
        <Text style={styles.emptyBtnText}>Refresh</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Academy card ───────────────────────────────────────────────────────
// Header thumbnail with graceful fallback. If the uploaded image URL
// 404s (or was never uploaded), we render a soft brand-tinted tile
// with the category's initial letter so the header slot is never
// blank.
function CategoryHeaderImage({ category }) {
  const [imgError, setImgError] = React.useState(false);
  const url = category?.image_url && !imgError
    ? resolveAssetUrl(category.image_url)
    : null;
  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={styles.categoryChipImg}
        resizeMode="cover"
        onError={() => setImgError(true)}
      />
    );
  }
  const initial = (category?.name || '?').trim().charAt(0).toUpperCase();
  return (
    <View style={[styles.categoryChipImg, styles.categoryChipFallback]}>
      <Text style={styles.categoryChipFallbackText}>{initial}</Text>
    </View>
  );
}

function AcademyCard({ academy, onPress, onDirections }) {
  const logo = resolveAssetUrl(academy.logo_url);
  const dist = Number.isFinite(Number(academy.distance_km))
    ? `${Number(academy.distance_km).toFixed(1)} km`
    : null;
  const rating = academy.rating != null ? Number(academy.rating) : null;
  const initial = (academy.name || '?').trim().charAt(0).toUpperCase();

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.card}>
      {/* Logo */}
      <View style={styles.logoWrap}>
        {logo ? (
          <Image source={{ uri: logo }} style={styles.logoImg} resizeMode="cover" />
        ) : (
          <Text style={styles.logoInitial}>{initial}</Text>
        )}
      </View>

      {/* Body */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>{academy.name || '—'}</Text>
          {rating != null ? (
            <View style={styles.ratingPill}>
              <Star size={9} color="#B45309" strokeWidth={2.6} fill="#F59E0B" />
              <Text style={styles.ratingText}>{rating.toFixed(1)}</Text>
            </View>
          ) : null}
        </View>

        {academy.primary_category ? (
          <View style={styles.categoryChip}>
            <Sparkles size={9} color={BRAND} strokeWidth={2.4} />
            <Text style={styles.categoryText} numberOfLines={1}>
              {academy.primary_category}
            </Text>
          </View>
        ) : null}

        <View style={styles.metaRow}>
          <MapPin size={11} color={TEXT_MUTED} strokeWidth={2.2} />
          <Text style={styles.metaText} numberOfLines={1}>
            {[academy.city, academy.pincode].filter(Boolean).join(' · ') || 'India'}
            {dist ? ` · ${dist}` : ''}
          </Text>
        </View>
      </View>

      {/* Actions */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <TouchableOpacity
          onPress={(e) => { e.stopPropagation?.(); onDirections(); }}
          hitSlop={8}
          style={styles.dirBtn}
        >
          <Navigation2 size={14} color="#2563EB" strokeWidth={2.4} />
        </TouchableOpacity>
        <ChevronRight size={16} color={TEXT_LIGHT} strokeWidth={2.2} />
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingTop: 44, paddingBottom: 12,
    backgroundColor: SURFACE,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: TEXT, letterSpacing: -0.2 },
  headerSub:   { fontSize: 11, color: TEXT_MUTED, fontWeight: '600', marginTop: 2 },
  categoryChipImg: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: BRAND_SOFT,
  },
  categoryChipFallback: {
    alignItems: 'center', justifyContent: 'center',
  },
  categoryChipFallbackText: {
    fontSize: 15, fontWeight: '900', color: BRAND, letterSpacing: -0.2,
  },

  // Card
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER,
    padding: 12,
  },
  logoWrap: {
    width: 54, height: 54, borderRadius: 12,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImg: { width: '100%', height: '100%' },
  logoInitial: { fontSize: 22, fontWeight: '900', color: BRAND },

  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  name: { flex: 1, fontSize: 14, fontWeight: '800', color: TEXT },
  ratingPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#FEF3C7',
  },
  ratingText: { fontSize: 10, fontWeight: '800', color: '#B45309' },

  categoryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: BRAND_SOFT,
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  categoryText: { fontSize: 10, fontWeight: '800', color: BRAND, letterSpacing: 0.3 },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 11, color: TEXT_MUTED, fontWeight: '600', flexShrink: 1 },

  dirBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#EFF6FF',
    alignItems: 'center', justifyContent: 'center',
  },

  // Empty state
  emptyWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32, gap: 12,
  },
  emptyIcon: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: TEXT, textAlign: 'center' },
  emptySub: { fontSize: 13, color: TEXT_MUTED, textAlign: 'center', lineHeight: 19, fontWeight: '500' },
  emptyBtn: {
    marginTop: 6, paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: BRAND,
  },
  emptyBtnText: { fontSize: 13, fontWeight: '800', color: '#fff' },
});
