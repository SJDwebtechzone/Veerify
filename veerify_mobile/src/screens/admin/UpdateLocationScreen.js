// src/screens/admin/UpdateLocationScreen.js
//
// Sub-branch admin's "Update Location" screen — reachable from the
// More tab (only visible for sub-branch admins). Lets them pin their
// branch's current GPS coordinates and edit the address bits.
//
// Backend:
//   GET   /api/institutions/me/details   — current values
//   PATCH /api/institutions/me/location  — save { latitude, longitude,
//                                                 address, city, pincode }
//
// Location capture UX mirrors what NearbyLocationPicker + the setup
// wizard already use so the sub-branch admin sees a familiar flow:
// tap "Use my current location" → OS prompt for GPS permission → we
// set lat/lng. Address / city / pincode remain manually editable
// (sometimes a branch's postal address doesn't quite match the GPS
// pin's reverse-geocode).

import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, Alert, Platform, PermissionsAndroid, KeyboardAvoidingView,
} from 'react-native';
import {
  ArrowLeft, MapPin, Navigation, Save, CheckCircle2,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { confirm } from '../../components/ConfirmDialog';

// Lazy require — same trick NearbyLocationPicker uses so the app still
// boots on a fresh checkout that hasn't linked the native module yet.
let Geolocation = null;
try {
  const mod = require('react-native-geolocation-service');
  Geolocation = (mod && mod.default) || mod || null;
} catch (_) {
  Geolocation = null;
}

const BRAND      = '#E63946';
const BRAND_SOFT = '#FFE4E6';
const TEXT       = '#111827';
const TEXT_MUTED = '#6B7280';
const TEXT_LIGHT = '#9CA3AF';
const SURFACE    = '#FFFFFF';
const BG         = '#F4F4F8';
const BORDER     = '#E5E7EB';
const GREEN      = '#10B981';

export default function UpdateLocationScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [form, setForm] = useState({
    latitude:  '',
    longitude: '',
    address:   '',
    city:      '',
    pincode:   '',
  });
  const [meta, setMeta] = useState({ name: '', parentName: '' });

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // Pull current values so the fields aren't blank if the branch already
  // has an address saved from setup.
  useEffect(() => {
    let cancelled = false;
    apiClient.get('/institutions/me/details')
      .then((r) => {
        if (cancelled) return;
        const inst = r.data?.institution || {};
        setForm({
          latitude:  inst.latitude  != null ? String(inst.latitude)  : '',
          longitude: inst.longitude != null ? String(inst.longitude) : '',
          address:   inst.address   || '',
          city:      inst.city      || '',
          pincode:   inst.pincode   || '',
        });
        setMeta({
          name:       inst.name || 'This branch',
          // parent-inherited fields land on the same row for sub-branches
          // (see getInstitutionById), so a sub-branch's brand_name is the
          // parent's name — good enough for the header hint.
          parentName: inst.brand_name && inst.brand_name !== inst.name
            ? inst.brand_name : '',
        });
      })
      .catch(() => { /* leave form blank — user can still enter fresh values */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ── GPS capture ────────────────────────────────────────────────────
  const captureGps = async () => {
    if (!Geolocation) {
      Alert.alert(
        'GPS not available',
        'This build is missing the location module. Enter latitude / longitude manually.',
      );
      return;
    }
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Location permission',
            message: 'Veerify uses your GPS to save this branch\'s exact location.',
            buttonPositive: 'Allow',
            buttonNegative: 'Deny',
          },
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert(
            'Permission denied',
            'Enable location permission in your phone settings, or enter latitude / longitude by hand.',
          );
          return;
        }
      } catch {
        Alert.alert('Permission error', 'Could not request location permission.');
        return;
      }
    } else if (typeof Geolocation.requestAuthorization === 'function') {
      try { await Geolocation.requestAuthorization('whenInUse'); } catch { /* noop */ }
    }

    setGpsBusy(true);
    Geolocation.getCurrentPosition(
      (pos) => {
        setGpsBusy(false);
        const c = pos?.coords || {};
        if (typeof c.latitude !== 'number' || typeof c.longitude !== 'number') {
          Alert.alert('No location', 'Could not read your GPS. Enter latitude / longitude by hand.');
          return;
        }
        // 6 decimal places = ~11 cm precision, plenty for a branch pin.
        setForm((p) => ({
          ...p,
          latitude:  c.latitude.toFixed(6),
          longitude: c.longitude.toFixed(6),
        }));
      },
      () => {
        setGpsBusy(false);
        Alert.alert(
          'GPS timed out',
          'Try again outdoors, or enter latitude / longitude by hand.',
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  };

  // ── Save ──────────────────────────────────────────────────────────
  const save = async () => {
    const lat = form.latitude.trim() === '' ? null : Number(form.latitude);
    const lng = form.longitude.trim() === '' ? null : Number(form.longitude);
    if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) {
      confirm({
        title: 'Invalid latitude',
        message: 'Latitude must be between -90 and 90.',
        variant: 'destructive', confirmText: 'OK', hideCancel: true,
      });
      return;
    }
    if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) {
      confirm({
        title: 'Invalid longitude',
        message: 'Longitude must be between -180 and 180.',
        variant: 'destructive', confirmText: 'OK', hideCancel: true,
      });
      return;
    }

    setSaving(true);
    try {
      await apiClient.patch('/institutions/me/location', {
        latitude:  lat,
        longitude: lng,
        address:   form.address.trim() || null,
        city:      form.city.trim()    || null,
        pincode:   form.pincode.trim() || null,
      });
      confirm({
        title: 'Location updated',
        message: 'Your branch will now appear on students\' nearby search using the new coordinates.',
        variant: 'success', confirmText: 'OK', hideCancel: true,
        onConfirm: () => navigation.goBack(),
      });
    } catch (err) {
      Alert.alert('Save failed', err?.response?.data?.message || err.message || 'Could not update location.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={BRAND} />
      </View>
    );
  }

  const hasCoords = form.latitude && form.longitude;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* ───── Header ───── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={8}>
          <ArrowLeft size={20} color={TEXT} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Update Location</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {meta.name}{meta.parentName ? ` · ${meta.parentName}` : ''}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* GPS card */}
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <View style={styles.cardIconWrap}>
              <Navigation size={16} color={BRAND} strokeWidth={2.4} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Set from your current location</Text>
              <Text style={styles.cardHint}>
                Stand at the branch, tap the button, and we'll record your GPS.
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.gpsBtn, gpsBusy && { opacity: 0.6 }]}
            onPress={captureGps}
            disabled={gpsBusy}
            activeOpacity={0.85}
          >
            {gpsBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <MapPin size={14} color="#fff" strokeWidth={2.6} />
                <Text style={styles.gpsBtnText}>Use my current location</Text>
              </>
            )}
          </TouchableOpacity>

          {hasCoords ? (
            <View style={styles.coordsBadge}>
              <CheckCircle2 size={12} color={GREEN} strokeWidth={2.4} />
              <Text style={styles.coordsBadgeText}>
                {Number(form.latitude).toFixed(5)}, {Number(form.longitude).toFixed(5)}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Coordinates (editable) */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Latitude</Text>
            <TextInput
              style={styles.input}
              value={form.latitude}
              onChangeText={(v) => set('latitude', v.replace(/[^0-9.\-]/g, ''))}
              placeholder="12.9716"
              placeholderTextColor={TEXT_LIGHT}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Longitude</Text>
            <TextInput
              style={styles.input}
              value={form.longitude}
              onChangeText={(v) => set('longitude', v.replace(/[^0-9.\-]/g, ''))}
              placeholder="77.5946"
              placeholderTextColor={TEXT_LIGHT}
              keyboardType="numbers-and-punctuation"
            />
          </View>
        </View>

        {/* Address block */}
        <View style={{ marginTop: 14 }}>
          <Text style={styles.label}>Address</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={form.address}
            onChangeText={(v) => set('address', v)}
            placeholder="Street, landmark, area…"
            placeholderTextColor={TEXT_LIGHT}
            multiline
            textAlignVertical="top"
            maxLength={300}
          />
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          <View style={{ flex: 1.4 }}>
            <Text style={styles.label}>City</Text>
            <TextInput
              style={styles.input}
              value={form.city}
              onChangeText={(v) => set('city', v)}
              placeholder="e.g. Bengaluru"
              placeholderTextColor={TEXT_LIGHT}
              maxLength={80}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Pincode</Text>
            <TextInput
              style={styles.input}
              value={form.pincode}
              onChangeText={(v) => set('pincode', v.replace(/[^0-9]/g, '').slice(0, 6))}
              placeholder="560034"
              placeholderTextColor={TEXT_LIGHT}
              keyboardType="numeric"
              maxLength={6}
            />
          </View>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>

      {/* ───── Footer ───── */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.7 }]}
          onPress={save}
          disabled={saving}
          activeOpacity={0.88}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Save size={16} color="#fff" strokeWidth={2.4} />
              <Text style={styles.saveBtnText}>Save location</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
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
  headerTitle: { fontSize: 17, fontWeight: '800', color: TEXT },
  headerSub: { fontSize: 11, color: TEXT_MUTED, fontWeight: '600', marginTop: 2 },

  body: { padding: 16, paddingBottom: 32 },

  card: {
    backgroundColor: SURFACE, borderRadius: 14, padding: 14, marginBottom: 16,
    borderWidth: 1, borderColor: BORDER,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardIconWrap: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 13, fontWeight: '800', color: TEXT },
  cardHint:  { fontSize: 11, color: TEXT_MUTED, marginTop: 2, fontWeight: '500' },

  gpsBtn: {
    marginTop: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 11, borderRadius: 10,
    backgroundColor: BRAND,
  },
  gpsBtnText: { fontSize: 13, color: '#fff', fontWeight: '800', letterSpacing: 0.2 },

  coordsBadge: {
    marginTop: 10,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: GREEN + '15',
    alignSelf: 'flex-start',
  },
  coordsBadgeText: { fontSize: 11, color: GREEN, fontWeight: '800' },

  label: { fontSize: 12, fontWeight: '700', color: TEXT, marginBottom: 6, letterSpacing: 0.3 },
  input: {
    backgroundColor: SURFACE, borderRadius: 10,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 11,
    fontSize: 14, color: TEXT,
  },
  textarea: { minHeight: 80, paddingTop: 11 },

  footer: {
    paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 22,
    backgroundColor: SURFACE,
    borderTopWidth: 1, borderTopColor: BORDER,
  },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, borderRadius: 12,
    backgroundColor: BRAND,
  },
  saveBtnText: { fontSize: 14, color: '#fff', fontWeight: '800', letterSpacing: 0.2 },
});
