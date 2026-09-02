// src/screens/admin/CreateBranchScreen.js
//
// Institution-admin "Add / Edit branch" form. Used for both create AND
// edit flows depending on whether route.params.branch was passed:
//
//   navigate('CreateBranch')                    → create mode
//   navigate('CreateBranch', { branch: item })  → edit mode, prefilled
//
// Backend:
//   POST /api/branches           — create; hits ensureCapacity('branches')
//                                  and returns 402 PLAN_LIMIT_REACHED
//                                  when the plan cap is met.
//   PUT  /api/branches/:id       — update
//
// Plan-limit enforcement: on a 402 with code=PLAN_LIMIT_REACHED we show
// the requested "Branch limit reached. Please upgrade your plan…" copy
// (a hard block; the user has to upgrade or delete a branch).

import React, { createContext, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, Alert, KeyboardAvoidingView, Platform, PermissionsAndroid,
} from 'react-native';
import {
  ArrowLeft, Save, MapPin, Navigation, Phone, Mail, Building2,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { confirm } from '../../components/ConfirmDialog';

// Lazy geolocation — same pattern the setup wizard uses so a missing
// native module doesn't crash the whole screen.
let Geolocation = null;
try {
  const mod = require('react-native-geolocation-service');
  Geolocation = (mod && mod.default) || mod || null;
} catch (_) {
  Geolocation = null;
}

// Institution Home visual system — ambient blue wash + glass
// cards + navy accents. Reused verbatim so this screen belongs to
// the same design language as the rest of the institution UI.
import InstitutionScreenBackground, {
  INSTITUTION_BG_BASE,
} from '../../components/InstitutionScreenBackground';
import { useTheme } from '../../theme/ThemeContext';

// ── Institution-Home glass tokens ─────────────────────────────
const GLASS_FILL         = 'rgba(255,255,255,0.72)';
const GLASS_FILL_STRONG  = 'rgba(255,255,255,0.88)';
const GLASS_BORDER_LIGHT = 'rgba(255,255,255,0.55)';
const GLASS_HIGHLIGHT    = 'rgba(255,255,255,0.9)';
const GLASS_SHADOW       = '#1E40AF';
const BRAND_DARK_BLUE    = '#1E3A8A';
const BRAND_ACCENT_SOFT  = 'rgba(30,58,138,0.10)';
const HEADER_NAVY        = '#0F172A';

// Local tokens — names kept unchanged so every existing card /
// border / text style inherits the Institution Home look
// automatically.
const BRAND      = '#E63946';
const BRAND_SOFT = '#FFE4E6';
const TEXT       = HEADER_NAVY;
const TEXT_MUTED = '#6B7280';
const TEXT_LIGHT = '#9CA3AF';
const SURFACE    = GLASS_FILL_STRONG;
const BG         = INSTITUTION_BG_BASE;
const BORDER     = GLASS_BORDER_LIGHT;
const GREEN      = '#10B981';

// Local context so nested sub-components pick up dark-mode
// overrides without prop-drilling.
const CreateBranchCtx = createContext({ isDark: false, dark: {} });

function buildDarkOverrides(pal) {
  return StyleSheet.create({
    screen:      { backgroundColor: pal.bg },
    header:      { backgroundColor: pal.surface, borderBottomColor: pal.border },
    headerTitle: { color: pal.text },
    headerSub:   { color: pal.textMuted },
    iconBtn:     { backgroundColor: pal.border },
    section:     { backgroundColor: pal.surface, borderColor: pal.border },
    sectionTitle:{ color: pal.textMuted },
    label:       { color: pal.textMuted },
  });
}

export default function CreateBranchScreen({ navigation, route }) {
  // Edit mode when we were passed an existing branch.
  const existing    = route?.params?.branch || null;
  const isSubBranch = existing?.branch_kind === 'sub_branch';
  const isEdit      = !!existing;

  const [form, setForm] = useState({
    name:         existing?.name         || '',
    address_line: existing?.address_line || existing?.address || '',
    city:         existing?.city         || '',
    state:        existing?.state        || '',
    pin_code:     existing?.pin_code     || existing?.pincode || '',
    country:      existing?.country      || 'India',
    phone:        existing?.phone        || '',
    email:        existing?.email        || '',
    latitude:     existing?.latitude     != null ? String(existing.latitude)  : '',
    longitude:    existing?.longitude    != null ? String(existing.longitude) : '',
    is_primary:   !!existing?.is_primary,
    status:       existing?.status || 'active',
  });
  const [saving,  setSaving]  = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // ── GPS ──────────────────────────────────────────────────────────────
  const captureGps = async () => {
    if (!Geolocation) {
      Alert.alert('GPS not available', 'Enter latitude / longitude by hand.');
      return;
    }
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Location permission',
            message: 'Save this branch\'s exact GPS coordinates.',
            buttonPositive: 'Allow', buttonNegative: 'Deny',
          },
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) return;
      } catch { return; }
    } else if (typeof Geolocation.requestAuthorization === 'function') {
      try { await Geolocation.requestAuthorization('whenInUse'); } catch { /* noop */ }
    }
    setGpsBusy(true);
    Geolocation.getCurrentPosition(
      (pos) => {
        setGpsBusy(false);
        const c = pos?.coords || {};
        if (typeof c.latitude !== 'number' || typeof c.longitude !== 'number') return;
        set('latitude',  c.latitude.toFixed(6));
        set('longitude', c.longitude.toFixed(6));
      },
      () => setGpsBusy(false),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  };

  // ── Save ─────────────────────────────────────────────────────────────
  const save = async () => {
    if (!form.name.trim()) {
      confirm({
        title: 'Name required',
        message: 'Give the branch a name.',
        variant: 'destructive', confirmText: 'OK', hideCancel: true,
      });
      return;
    }
    // Trim + coerce numeric fields.
    const trim = (v) => (v == null ? null : String(v).trim() || null);
    const num  = (v) => {
      const s = trim(v);
      if (!s) return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };
    const payload = {
      name:         trim(form.name),
      address_line: trim(form.address_line),
      city:         trim(form.city),
      state:        trim(form.state),
      pin_code:     trim(form.pin_code),
      country:      trim(form.country) || 'India',
      phone:        trim(form.phone),
      email:        trim(form.email),
      latitude:     num(form.latitude),
      longitude:    num(form.longitude),
      is_primary:   !!form.is_primary,
      status:       form.status || 'active',
    };

    setSaving(true);
    try {
      if (isEdit && isSubBranch) {
        // Sub-branches live in the institutions table — a different
        // endpoint owns their location + contact fields. The wire shape
        // here uses institution-column names, so we remap the branch
        // form's keys before sending.
        await apiClient.patch(`/institutions/sub-branches/${existing.id}`, {
          name:      payload.name,
          address:   payload.address_line,
          city:      payload.city,
          pincode:   payload.pin_code,
          phone:     payload.phone,
          email:     payload.email,
          latitude:  payload.latitude,
          longitude: payload.longitude,
        });
      } else if (isEdit) {
        await apiClient.put(`/branches/${existing.id}`, payload);
      } else {
        await apiClient.post('/branches', payload);
      }
      confirm({
        title:       isEdit ? 'Branch updated' : 'Branch added',
        message:     isEdit
          ? 'The branch was updated. Super admin has been notified.'
          : 'The branch is live now. Super admin has been notified.',
        variant:     'success',
        confirmText: 'OK', hideCancel: true,
        onConfirm:   () => navigation.goBack(),
      });
    } catch (err) {
      // Special-case the plan-limit 402 — the spec asks for a specific
      // "Branch limit reached" copy that trumps the backend's generic
      // "Your Free plan allows up to 1 branch…" message.
      const data = err?.response?.data;
      if (err?.response?.status === 402 && data?.code === 'PLAN_LIMIT_REACHED') {
        confirm({
          title:       'Branch limit reached',
          message:     'Branch limit reached. Please upgrade your plan to add more branches.',
          variant:     'destructive',
          confirmText: 'OK', hideCancel: true,
        });
        return;
      }
      confirm({
        title:       isEdit ? 'Update failed' : 'Create failed',
        message:     data?.message || err.message || 'Try again in a moment.',
        variant:     'destructive',
        confirmText: 'OK', hideCancel: true,
      });
    } finally {
      setSaving(false);
    }
  };

  const hasCoords = form.latitude && form.longitude;

  // Dark-mode overrides pulled from the shared ThemeContext.
  // Institution Home's ambient background is skipped in dark mode.
  const { mode, palette: themePalette } = useTheme();
  const isDark = mode === 'dark';
  const dark   = useMemo(() => (isDark ? buildDarkOverrides(themePalette) : {}), [isDark, themePalette]);

  return (
    <CreateBranchCtx.Provider value={{ isDark, dark }}>
    <KeyboardAvoidingView
      style={[styles.screen, isDark && dark.screen]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Institution Home ambient wash — sits behind all content. */}
      {!isDark ? <InstitutionScreenBackground layer /> : null}
      <View style={[styles.header, isDark && dark.header]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.iconBtn, isDark && dark.iconBtn]} hitSlop={8}>
          <ArrowLeft size={20} color={isDark ? themePalette.text : TEXT} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, isDark && dark.headerTitle]}>
            {isSubBranch ? 'Edit sub-branch' : isEdit ? 'Edit branch' : 'New branch'}
          </Text>
          <Text style={[styles.headerSub, isDark && dark.headerSub]}>
            {isSubBranch
              ? 'Update this sub-branch academy\'s details.'
              : isEdit
                ? 'Update this location\'s details.'
                : 'Add a new physical location.'}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Name */}
        <Field label="Branch name *">
          <View style={styles.inputRow}>
            <Building2 size={14} color={TEXT_MUTED} strokeWidth={2.2} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={form.name}
              onChangeText={(v) => set('name', v)}
              placeholder="e.g. T. Nagar"
              placeholderTextColor={TEXT_LIGHT}
              maxLength={120}
            />
          </View>
        </Field>

        {/* Address */}
        <Field label="Address">
          <TextInput
            style={[styles.input, styles.textarea]}
            value={form.address_line}
            onChangeText={(v) => set('address_line', v)}
            placeholder="Street, landmark, area…"
            placeholderTextColor={TEXT_LIGHT}
            multiline
            textAlignVertical="top"
            maxLength={300}
          />
        </Field>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1.4 }}>
            <Field label="City">
              <TextInput
                style={styles.input}
                value={form.city}
                onChangeText={(v) => set('city', v)}
                placeholder="e.g. Chennai"
                placeholderTextColor={TEXT_LIGHT}
                maxLength={80}
              />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="State">
              <TextInput
                style={styles.input}
                value={form.state}
                onChangeText={(v) => set('state', v)}
                placeholder="TN"
                placeholderTextColor={TEXT_LIGHT}
                maxLength={40}
              />
            </Field>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Field label="Pincode">
              <TextInput
                style={styles.input}
                value={form.pin_code}
                onChangeText={(v) => set('pin_code', v.replace(/[^0-9]/g, '').slice(0, 6))}
                placeholder="600001"
                placeholderTextColor={TEXT_LIGHT}
                keyboardType="numeric"
                maxLength={6}
              />
            </Field>
          </View>
          <View style={{ flex: 1.2 }}>
            <Field label="Country">
              <TextInput
                style={styles.input}
                value={form.country}
                onChangeText={(v) => set('country', v)}
                placeholder="India"
                placeholderTextColor={TEXT_LIGHT}
                maxLength={40}
              />
            </Field>
          </View>
        </View>

        {/* Contact */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Field label="Phone">
              <View style={styles.inputRow}>
                <Phone size={14} color={TEXT_MUTED} strokeWidth={2.2} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={form.phone}
                  onChangeText={(v) => set('phone', v)}
                  placeholder="9876543210"
                  placeholderTextColor={TEXT_LIGHT}
                  keyboardType="phone-pad"
                  maxLength={20}
                />
              </View>
            </Field>
          </View>
          <View style={{ flex: 1.3 }}>
            <Field label="Email">
              <View style={styles.inputRow}>
                <Mail size={14} color={TEXT_MUTED} strokeWidth={2.2} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={form.email}
                  onChangeText={(v) => set('email', v)}
                  placeholder="branch@…"
                  placeholderTextColor={TEXT_LIGHT}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  maxLength={150}
                />
              </View>
            </Field>
          </View>
        </View>

        {/* GPS — hidden when editing a sub-branch. The sub-branch admin
            captures their own coordinates via More → Update Location on
            their own login, since they're the one physically at the
            branch. Editing coords from HQ isn't useful. */}
        {!isSubBranch ? (
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <View style={styles.cardIconWrap}>
              <Navigation size={16} color={BRAND} strokeWidth={2.4} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Location on map</Text>
              <Text style={styles.cardHint}>
                Set the branch's GPS so it appears in students' Nearby search.
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

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Latitude</Text>
              <TextInput
                style={styles.input}
                value={form.latitude}
                onChangeText={(v) => set('latitude', v.replace(/[^0-9.\-]/g, ''))}
                placeholder="13.0827"
                placeholderTextColor={TEXT_LIGHT}
                keyboardType="numbers-and-punctuation"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Longitude</Text>
              <TextInput
                style={styles.input}
                value={form.longitude}
                onChangeText={(v) => set('longitude', v.replace(/[^0-9.\-]/g, ''))}
                placeholder="80.2707"
                placeholderTextColor={TEXT_LIGHT}
                keyboardType="numbers-and-punctuation"
              />
            </View>
          </View>

          {hasCoords ? (
            <Text style={styles.coordsHint}>
              📍 {Number(form.latitude).toFixed(5)}, {Number(form.longitude).toFixed(5)}
            </Text>
          ) : null}
        </View>
        ) : null}

        {/* Flags — hidden for sub-branch academies because those two
            toggles apply only to satellite locations in the
            institution_branches table. */}
        {!isSubBranch ? (
        <View style={styles.flagCard}>
          <TouchableOpacity
            style={styles.flagRow}
            onPress={() => set('is_primary', !form.is_primary)}
            activeOpacity={0.85}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.flagTitle}>Primary branch</Text>
              <Text style={styles.flagHint}>Mark this as the head office.</Text>
            </View>
            <View style={[
              styles.togglePill,
              form.is_primary ? styles.togglePillOn : styles.togglePillOff,
            ]}>
              <Text style={[
                styles.togglePillText,
                { color: form.is_primary ? '#fff' : TEXT_MUTED },
              ]}>
                {form.is_primary ? 'Yes' : 'No'}
              </Text>
            </View>
          </TouchableOpacity>

          <View style={styles.flagDivider} />

          <TouchableOpacity
            style={styles.flagRow}
            onPress={() => set('status', form.status === 'active' ? 'inactive' : 'active')}
            activeOpacity={0.85}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.flagTitle}>Status</Text>
              <Text style={styles.flagHint}>
                {form.status === 'active'
                  ? 'Visible to students and staff.'
                  : 'Hidden — no student or staff sees this branch.'}
              </Text>
            </View>
            <View style={[
              styles.togglePill,
              form.status === 'active' ? styles.togglePillActive : styles.togglePillOff,
            ]}>
              <Text style={[
                styles.togglePillText,
                { color: form.status === 'active' ? '#065F46' : TEXT_MUTED },
              ]}>
                {form.status === 'active' ? 'Active' : 'Inactive'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
        ) : null}

        <View style={{ height: 20 }} />
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.footerBtn, styles.footerGhost]}
          onPress={() => navigation.goBack()}
          disabled={saving}
          activeOpacity={0.85}
        >
          <Text style={styles.footerGhostText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.footerBtn, styles.footerPrimary, saving && { opacity: 0.6 }]}
          onPress={save}
          disabled={saving}
          activeOpacity={0.88}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Save size={16} color="#fff" strokeWidth={2.4} />
              <Text style={styles.footerPrimaryText}>
                {isEdit ? 'Save changes' : 'Add branch'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
    </CreateBranchCtx.Provider>
  );
}

// ─── Field wrapper ─────────────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.rowLabel}>{label}</Text>
      {children}
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  // Header — glass slab with navy title + soft blue lift shadow.
  header: {
    backgroundColor: GLASS_FILL_STRONG, paddingTop: 48, paddingBottom: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: GLASS_BORDER_LIGHT,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    shadowColor: GLASS_SHADOW,
    shadowOpacity: 0.10,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: BRAND_ACCENT_SOFT,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: GLASS_BORDER_LIGHT,
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: HEADER_NAVY, letterSpacing: 0.2 },
  headerSub:   { fontSize: 11, color: TEXT_MUTED, fontWeight: '600', marginTop: 2 },

  body: { padding: 16, paddingBottom: 40 },

  rowLabel: { fontSize: 11, fontWeight: '800', color: TEXT_MUTED, marginBottom: 5, letterSpacing: 0.3 },

  input: {
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 11,
    fontSize: 14, color: TEXT,
    flex: 1,
  },
  textarea: { minHeight: 80, paddingTop: 11 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: SURFACE,
    borderRadius: 10,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 8,
  },
  inputIcon: { marginLeft: 4 },

  // GPS card
  card: {
    backgroundColor: SURFACE, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: BORDER,
    marginTop: 4, marginBottom: 14,
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
  coordsHint: {
    marginTop: 10, fontSize: 12, color: GREEN, fontWeight: '700',
  },

  // Flag card (Primary + Status)
  flagCard: {
    backgroundColor: SURFACE, borderRadius: 14,
    borderWidth: 1, borderColor: BORDER,
    marginBottom: 14,
  },
  flagRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
  },
  flagDivider: {
    height: StyleSheet.hairlineWidth, backgroundColor: BORDER,
    marginHorizontal: 14,
  },
  flagTitle: { fontSize: 13, fontWeight: '800', color: TEXT },
  flagHint:  { fontSize: 11, color: TEXT_MUTED, marginTop: 2, fontWeight: '500' },
  togglePill: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 999, borderWidth: 1,
    minWidth: 66, alignItems: 'center',
  },
  togglePillOn:     { backgroundColor: BRAND, borderColor: BRAND },
  togglePillActive: { backgroundColor: '#D1FAE5', borderColor: '#6EE7B7' },
  togglePillOff:    { backgroundColor: BG, borderColor: BORDER },
  togglePillText:   { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },

  // Footer
  footer: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 22,
    backgroundColor: SURFACE,
    borderTopWidth: 1, borderTopColor: BORDER,
  },
  footerBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, borderRadius: 12,
  },
  footerGhost: { backgroundColor: BG },
  footerGhostText: { fontSize: 14, fontWeight: '700', color: TEXT_MUTED },
  footerPrimary: { backgroundColor: BRAND, flex: 1.6 },
  footerPrimaryText: { fontSize: 14, fontWeight: '800', color: '#fff' },
});
