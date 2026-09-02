// src/screens/admin/EventRegistrationDetailScreen.js
//
// MODULE 4: Organizer Registration Management — single registration.
//
// Shows: student basics, registering institution, event, every
// organizer-defined answer (dynamic, no hard-coded field list), and
// a status control so the organizer can cancel / re-register.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, SafeAreaView, Alert,
} from 'react-native';
import { ChevronLeft, User, Building2, Calendar } from 'lucide-react-native';

import apiClient from '../../api/client';

const BRAND       = '#E63946';
const BRAND_SOFT  = '#FFE4E6';
const TEXT        = '#111827';
const TEXT_MUTED  = '#6B7280';
const SURFACE     = '#FFFFFF';
const BG          = '#F1F6FB';
const BORDER      = '#E5E7EB';

export default function EventRegistrationDetailScreen({ navigation, route }) {
  const eventId        = route?.params?.eventId;
  const eventTitle     = route?.params?.eventTitle || 'Event';
  const registrationId = route?.params?.registrationId;

  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [data, setData]       = useState(null);
  const [busy, setBusy]       = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await apiClient.get(`/events/${eventId}/registrations/${registrationId}`);
      setData(r.data || null);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load registration.');
    } finally {
      setLoading(false);
    }
  }, [eventId, registrationId]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (next) => {
    if (busy) return;
    setBusy(true);
    try {
      await apiClient.patch(`/events/${eventId}/registrations/${registrationId}/status`, { status: next });
      await load();
    } catch (err) {
      Alert.alert('Update failed', err.response?.data?.message || err.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <Header title="Registration" subtitle={eventTitle} navigation={navigation} />
        <View style={styles.center}><ActivityIndicator color={BRAND} /></View>
      </SafeAreaView>
    );
  }
  if (error || !data) {
    return (
      <SafeAreaView style={styles.screen}>
        <Header title="Registration" subtitle={eventTitle} navigation={navigation} />
        <View style={styles.center}>
          <Text style={styles.err}>{error || 'Not found.'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const r = data.registration;
  const isCancelled = r.status === 'cancelled';

  return (
    <SafeAreaView style={styles.screen}>
      <Header title="Registration" subtitle={eventTitle} navigation={navigation} />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 120 }}>
        {/* Student card */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <User size={16} color={BRAND} />
            <Text style={styles.cardTitle}>Student</Text>
          </View>
          <Text style={styles.name}>{r.student_name}</Text>
          <MetaRow label="Phone" value={r.student_phone} />
          <MetaRow label="Email" value={r.student_email} />
          {r.student_dob ? (
            <MetaRow label="Date of Birth" value={fmtDate(r.student_dob)} />
          ) : null}
          {r.student_gender ? (
            <MetaRow label="Gender" value={r.student_gender} />
          ) : null}
        </View>

        {/* Institution */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Building2 size={16} color={BRAND} />
            <Text style={styles.cardTitle}>Registering Institution</Text>
          </View>
          <Text style={styles.name}>{r.institution_name}</Text>
          {r.submitted_by_name ? (
            <MetaRow label="Submitted by" value={`${r.submitted_by_name}${r.submitted_by_email ? ` · ${r.submitted_by_email}` : ''}`} />
          ) : null}
        </View>

        {/* Event */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Calendar size={16} color={BRAND} />
            <Text style={styles.cardTitle}>Event</Text>
          </View>
          <Text style={styles.name}>{data.event.title}</Text>
          <MetaRow label="Event date" value={fmtDate(data.event.event_date)} />
          <MetaRow label="Registered on" value={fmtDateTime(r.created_at)} />
          <MetaRow label="Status" value={
            <StatusPillInline status={r.status} />
          } />
        </View>

        {/* Answers */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={[styles.cardTitle, { marginLeft: 0 }]}>Form Responses</Text>
          </View>
          {(data.answers || []).length === 0 ? (
            <Text style={styles.empty}>No custom fields configured for this event.</Text>
          ) : (
            data.answers.map((a) => (
              <View key={a.id} style={styles.answerRow}>
                <Text style={styles.ansLabel}>{a.label}</Text>
                <Text style={styles.ansValue}>{renderAnswerValue(a)}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {isCancelled ? (
          <TouchableOpacity
            style={[styles.primary, busy && { opacity: 0.6 }]}
            disabled={busy}
            onPress={() => setStatus('registered')}
          >
            <Text style={styles.primaryText}>{busy ? 'Updating…' : 'Restore Registration'}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.destructive, busy && { opacity: 0.6 }]}
            disabled={busy}
            onPress={() => Alert.alert(
              'Cancel registration?',
              `Mark ${r.student_name}'s registration as cancelled?`,
              [
                { text: 'Keep', style: 'cancel' },
                { text: 'Cancel Registration', style: 'destructive', onPress: () => setStatus('cancelled') },
              ],
            )}
          >
            <Text style={styles.destructiveText}>{busy ? 'Updating…' : 'Cancel Registration'}</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

function Header({ title, subtitle, navigation }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
        <ChevronLeft size={20} color={TEXT} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
      </View>
    </View>
  );
}

function MetaRow({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text style={styles.metaValue}>{String(value)}</Text>
      ) : (
        <View style={{ flex: 1, alignItems: 'flex-end' }}>{value}</View>
      )}
    </View>
  );
}

function StatusPillInline({ status }) {
  const map = {
    registered: { bg: '#DCFCE7', fg: '#166534' },
    cancelled:  { bg: '#FEE2E2', fg: '#991B1B' },
  };
  const tone = map[status] || { bg: '#F1F5F9', fg: '#334155' };
  return (
    <Text style={{
      fontSize: 11, fontWeight: '800',
      backgroundColor: tone.bg, color: tone.fg,
      paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
      overflow: 'hidden',
    }}>
      {status ? status[0].toUpperCase() + status.slice(1) : 'Unknown'}
    </Text>
  );
}

function renderAnswerValue(a) {
  if (a.type === 'checkbox' && Array.isArray(a.valueJson)) {
    return a.valueJson.length > 0 ? a.valueJson.join(', ') : '—';
  }
  if (a.type === 'file' && a.valueJson?.name) {
    return `📎 ${a.valueJson.name}`;
  }
  if (a.value && a.value.trim()) return a.value;
  return '—';
}

function fmtDate(s) {
  if (!s) return '';
  try {
    return new Date(s).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch { return String(s); }
}
function fmtDateTime(s) {
  if (!s) return '';
  try {
    return new Date(s).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch { return String(s); }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: SURFACE, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  backBtn: { padding: 6 },
  title: { fontSize: 16, fontWeight: '800', color: TEXT },
  subtitle: { fontSize: 12, color: TEXT_MUTED, marginTop: 1 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  err: { color: TEXT_MUTED, fontSize: 13, textAlign: 'center' },

  card: {
    backgroundColor: SURFACE, borderRadius: 14,
    borderWidth: 1, borderColor: BORDER,
    padding: 14, marginBottom: 12,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  cardTitle: { fontSize: 12, fontWeight: '800', color: TEXT_MUTED, letterSpacing: 0.5, textTransform: 'uppercase' },
  name: { fontSize: 16, fontWeight: '800', color: TEXT, marginTop: 2 },

  metaRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 6, gap: 12,
  },
  metaLabel: { fontSize: 12, color: TEXT_MUTED, fontWeight: '600' },
  metaValue: { fontSize: 13, color: TEXT, fontWeight: '600', textAlign: 'right', flexShrink: 1 },

  answerRow: {
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: BORDER,
  },
  ansLabel: { fontSize: 11, color: TEXT_MUTED, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  ansValue: { fontSize: 14, color: TEXT, marginTop: 4 },
  empty: { fontSize: 12, color: TEXT_MUTED, fontStyle: 'italic', marginTop: 4 },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: SURFACE, borderTopWidth: 1, borderTopColor: BORDER,
    padding: 12,
  },
  primary: {
    backgroundColor: BRAND, borderRadius: 999,
    paddingVertical: 12, alignItems: 'center',
  },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  destructive: {
    borderRadius: 999, borderWidth: 1, borderColor: '#B91C1C', backgroundColor: '#FEF2F2',
    paddingVertical: 12, alignItems: 'center',
  },
  destructiveText: { color: '#B91C1C', fontWeight: '800', fontSize: 14 },
});
