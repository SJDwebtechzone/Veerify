// src/components/NearbyLocationPicker.js
//
// Inline card the student sees above "Other Academies Near You". Lets
// them pick between:
//   • Use my location — fires Geolocation.getCurrentPosition and stores
//     the resulting { lat, lng }. Survives between sessions.
//   • Enter pincode   — typed in a TextInput, validated against the
//     backend pincodes lookup, and stored as the active origin.
//
// The component is fully self-contained: it shows the current origin
// pill, lets the user re-pick at any time, and surfaces a soft yellow
// banner when nothing is set so the home screen falls back to the
// generic "newest first" academy list.
//
// Persistence is in AsyncStorage under `nearbyOrigin` so the next app
// launch remembers the choice.

import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  Platform, PermissionsAndroid, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  MapPin, Crosshair, Search, X, AlertTriangle, Check,
} from 'lucide-react-native';

import apiClient from '../api/client';

// Lazy require so the app still boots if the native module is missing
// (e.g. fresh checkout that hasn't `pod install`ed). Mirrors how the
// SetupInstitutionScreen handles it.
let Geolocation = null;
try {
  const mod = require('react-native-geolocation-service');
  Geolocation = (mod && mod.default) || mod || null;
} catch (_) {
  Geolocation = null;
}

const STORAGE_KEY = 'nearbyOrigin';

const BRAND = '#E63946';
const BRAND_SOFT = '#FFE4E6';
const TEXT = '#111827';
const TEXT_MUTED = '#6B7280';
const TEXT_LIGHT = '#9CA3AF';
const SURFACE = '#FFFFFF';
const BG = '#F4F4F8';
const BORDER = '#E5E7EB';
const GREEN = '#10B981';

// origin shape: { source: 'gps' | 'pincode', lat, lng,
//                 pincode?, district?, state? }

export default function NearbyLocationPicker({ origin, onChange }) {
  const [mode, setMode] = useState(null); // null | 'choose' | 'pincode'
  const [pinInput, setPinInput] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);

  // Hydrate from AsyncStorage on first mount so the chosen origin
  // survives across launches.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.lat && parsed.lng) onChange?.(parsed);
        }
      } catch (_) { /* noop */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = async (next) => {
    try {
      if (next) await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      else      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (_) { /* noop */ }
  };

  const useGps = async () => {
    if (!Geolocation) {
      Alert.alert(
        'GPS not available',
        'This build is missing the location module. Enter a pincode instead.',
      );
      setMode('pincode');
      return;
    }
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Location permission',
            message: 'Veerify uses your location to show academies near you.',
            buttonPositive: 'Allow',
            buttonNegative: 'Deny',
          },
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          // User declined — silently flip them to pincode mode so the
          // feature still works.
          setMode('pincode');
          return;
        }
      } catch (_) {
        setMode('pincode');
        return;
      }
    } else if (typeof Geolocation.requestAuthorization === 'function') {
      try { await Geolocation.requestAuthorization('whenInUse'); } catch (_) { /* noop */ }
    }

    setGpsBusy(true);
    Geolocation.getCurrentPosition(
      (pos) => {
        setGpsBusy(false);
        const c = pos?.coords || {};
        if (typeof c.latitude !== 'number' || typeof c.longitude !== 'number') {
          Alert.alert('No location', 'Could not read your GPS. Try a pincode instead.');
          setMode('pincode');
          return;
        }
        const next = { source: 'gps', lat: c.latitude, lng: c.longitude };
        persist(next);
        onChange?.(next);
        setMode(null);
      },
      (_err) => {
        setGpsBusy(false);
        setMode('pincode');
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 },
    );
  };

  const usePincode = async () => {
    const pin = pinInput.replace(/[^0-9]/g, '').slice(0, 6);
    if (pin.length !== 6) {
      Alert.alert('Pincode incomplete', 'Enter the full 6-digit pincode.');
      return;
    }
    setPinBusy(true);
    try {
      const r = await apiClient.get(`/academies/pincode-lookup?pin=${pin}`);
      const m = r?.data?.match;
      if (!m) {
        Alert.alert(
          'Pincode not found',
          'We could not resolve that pincode. Try a nearby one (same first 3 digits) for now.',
        );
        return;
      }
      const next = {
        source:   'pincode',
        lat:      m.latitude,
        lng:      m.longitude,
        pincode:  m.pincode,
        district: m.district,
        state:    m.state,
      };
      persist(next);
      onChange?.(next);
      setMode(null);
      setPinInput('');
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.message || 'Could not look up pincode.');
    } finally {
      setPinBusy(false);
    }
  };

  const clear = () => {
    persist(null);
    onChange?.(null);
    setMode(null);
  };

  // ── Render ───────────────────────────────────────────────────────────

  // 1) Origin is set → compact summary chip with a "change" link.
  if (origin && mode == null) {
    return (
      <View style={styles.summary}>
        <View style={styles.summaryIcon}>
          {origin.source === 'gps'
            ? <Crosshair size={14} color={BRAND} strokeWidth={2.4} />
            : <MapPin size={14} color={BRAND} strokeWidth={2.4} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.summaryLabel}>Showing academies near</Text>
          <Text style={styles.summaryValue} numberOfLines={1}>
            {origin.source === 'gps'
              ? 'Your current location'
              : `${origin.pincode}${origin.district ? ` · ${origin.district}` : ''}`}
          </Text>
        </View>
        <TouchableOpacity onPress={() => setMode('choose')} style={styles.changeBtn} activeOpacity={0.85}>
          <Text style={styles.changeBtnText}>Change</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // 2) Picking — show two big tiles to pick GPS or pincode entry.
  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <View style={styles.cardHeaderIcon}>
          <MapPin size={14} color={BRAND} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Find academies near you</Text>
          <Text style={styles.cardSub}>
            Use GPS, or type a 6-digit pincode if you'd rather not share location.
          </Text>
        </View>
        {origin ? (
          <TouchableOpacity onPress={clear} style={styles.cardClose} hitSlop={8} activeOpacity={0.7}>
            <X size={14} color={TEXT_MUTED} strokeWidth={2.4} />
          </TouchableOpacity>
        ) : null}
      </View>

      {mode !== 'pincode' ? (
        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.modeTile, styles.modeTileGps]}
            onPress={useGps}
            disabled={gpsBusy}
            activeOpacity={0.85}
          >
            {gpsBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Crosshair size={16} color="#fff" strokeWidth={2.4} />
                <Text style={styles.modeTileTextOn}>Use my location</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeTile, styles.modeTilePin]}
            onPress={() => setMode('pincode')}
            activeOpacity={0.85}
          >
            <MapPin size={16} color={BRAND} strokeWidth={2.4} />
            <Text style={styles.modeTileTextOff}>Enter pincode</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View>
          <View style={styles.pinInputWrap}>
            <Search size={14} color={TEXT_MUTED} strokeWidth={2.4} />
            <TextInput
              style={styles.pinInput}
              placeholder="Enter 6-digit pincode (e.g. 600001)"
              placeholderTextColor={TEXT_LIGHT}
              value={pinInput}
              onChangeText={(v) => setPinInput(v.replace(/[^0-9]/g, '').slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />
          </View>
          <View style={styles.pinActions}>
            <TouchableOpacity
              style={[styles.pinBack]}
              onPress={() => setMode(null)}
              activeOpacity={0.85}
            >
              <Text style={styles.pinBackText}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pinGo, pinInput.length !== 6 && { opacity: 0.5 }]}
              onPress={usePincode}
              disabled={pinBusy || pinInput.length !== 6}
              activeOpacity={0.85}
            >
              {pinBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Check size={14} color="#fff" strokeWidth={2.6} />
                  <Text style={styles.pinGoText}>Apply</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {!origin && mode !== 'pincode' ? (
        <View style={styles.softWarn}>
          <AlertTriangle size={12} color="#92400E" strokeWidth={2.4} />
          <Text style={styles.softWarnText}>
            No location set yet — we're showing the newest academies. Pick GPS or a pincode for nearby results.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Compact summary chip
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  summaryIcon: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  summaryLabel: { fontSize: 10, color: TEXT_MUTED, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  summaryValue: { fontSize: 13, color: TEXT, fontWeight: '800', marginTop: 1 },
  changeBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: BG },
  changeBtnText: { fontSize: 11, fontWeight: '800', color: BRAND },

  // Picker card
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  cardHeaderIcon: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 13, fontWeight: '800', color: TEXT },
  cardSub: { fontSize: 11, color: TEXT_MUTED, marginTop: 2, lineHeight: 15 },
  cardClose: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },

  modeRow: { flexDirection: 'row', gap: 8 },
  modeTile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
  },
  modeTileGps: { backgroundColor: BRAND },
  modeTilePin: { backgroundColor: BRAND_SOFT, borderWidth: 1, borderColor: BRAND },
  modeTileTextOn: { fontSize: 12, color: '#fff', fontWeight: '800' },
  modeTileTextOff: { fontSize: 12, color: BRAND, fontWeight: '800' },

  pinInputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: BG,
    borderRadius: 10, paddingHorizontal: 12,
    borderWidth: 1, borderColor: BORDER,
  },
  pinInput: {
    flex: 1,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 14, fontWeight: '700', color: TEXT, letterSpacing: 2,
  },
  pinActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  pinBack: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: 10, backgroundColor: BG,
  },
  pinBackText: { fontSize: 12, fontWeight: '800', color: TEXT_MUTED },
  pinGo: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: BRAND,
  },
  pinGoText: { fontSize: 12, fontWeight: '800', color: '#fff' },

  softWarn: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-start',
    marginTop: 12,
    padding: 10,
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  softWarnText: { flex: 1, fontSize: 11, color: '#92400E', fontWeight: '700', lineHeight: 15 },
});
