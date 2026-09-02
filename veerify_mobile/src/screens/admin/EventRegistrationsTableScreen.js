// src/screens/admin/EventRegistrationsTableScreen.js
//
// Opened from InstitutionEventDetailScreen's "Registered Students"
// button. Renders every registration for the event as a horizontally-
// scrollable table so the organiser can eyeball every default +
// custom field on one screen, and can export the whole batch as CSV.
//
// Data flow:
//   • GET /events/:id/registrations?include=answers&limit=200
//       Returns every registration row with a nested `answers` array
//       (one entry per default/custom field the participant filled
//       in on the Registration Form).
//   • Header columns are derived dynamically from the union of every
//       field-label that appears across every registration — no
//       hard-coded field list, so a Category / Skill / Division /
//       custom field added later flows through automatically.
//   • Export builds a CSV from the same header + row model that the
//       table renders, then hands it to the OS Share sheet so the
//       operator can save/mail it.
//
// Route params:
//   eventId    (required)
//   eventTitle (optional, header decoration)

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, SafeAreaView, Share, Alert, Linking,
  StatusBar, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Download, RefreshCw } from 'lucide-react-native';

import apiClient from '../../api/client';
import { getToken } from '../../utils/storage';

const BRAND       = '#E63946';
const BRAND_SOFT  = '#FFE4E6';
const TEXT        = '#111827';
const TEXT_MUTED  = '#6B7280';
const SURFACE     = '#FFFFFF';
const BG          = '#F1F6FB';
const BORDER      = '#E5E7EB';

// Compute a student's whole-years age from a DOB string. Same
// helper shape as the one on EventRegistrationFormScreen so the
// number the operator saw at registration time matches here.
function ageFromDob(dob) {
  if (!dob) return null;
  const s = String(dob).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const dobDate = new Date(+m[1], +m[2] - 1, +m[3]);
  if (Number.isNaN(dobDate.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dobDate.getFullYear();
  const before =
    now.getMonth()  < (+m[2] - 1) ||
    (now.getMonth() === (+m[2] - 1) && now.getDate() < +m[3]);
  if (before) age -= 1;
  return age >= 0 ? age : null;
}

// Format 'YYYY-MM-DD' (or full ISO) as '25 Aug 2026'. Same
// treatment as the rest of the app so dates read consistently.
function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Value coercion for the table cell + CSV export. Handles nested
// value_json shapes (checkbox arrays, file upload blobs) so the
// display never renders "[object Object]".
function coerceValue(a) {
  if (a == null) return '';
  if (a.value != null && String(a.value).length > 0) return String(a.value);
  const v = a.valueJson;
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return v.name || v.label || v.url || JSON.stringify(v);
  return String(v);
}

// CSV cell escaper — wraps values that contain commas, quotes or
// newlines in double-quotes and doubles any embedded quote so the
// exported file survives Excel's CSV parser.
function csvCell(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default function EventRegistrationsTableScreen({ route, navigation }) {
  const eventId    = route?.params?.eventId;
  const eventTitle = route?.params?.eventTitle || 'Event';
  // Push the header below the Android status bar / iOS notch.
  // React Native's SafeAreaView only handles iOS insets, so on
  // Android the Export/Refresh buttons in the header row were
  // rendering underneath the battery/clock. Using
  // useSafeAreaInsets() from react-native-safe-area-context (same
  // helper the rest of the app uses) makes the padding cross-
  // platform. Fall back to StatusBar.currentHeight when the
  // inset itself is zero, which happens on some emulators.
  const insets = useSafeAreaInsets();
  const topPad = Math.max(
    insets.top,
    Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 0,
  );

  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [rows,    setRows]    = useState([]);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true); setError('');
    try {
      // Pull a generous page (up to 200 rows) so the table is a
      // single load — pagination for very large events is a future
      // enhancement; the summary screen still handles those.
      const r = await apiClient.get(
        `/events/${eventId}/registrations?include=answers&limit=200&offset=0`,
      );
      setRows(Array.isArray(r.data?.registrations) ? r.data.registrations : []);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load registrations.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  // Dynamic column set. The FIXED columns cover every field the
  // spec called out explicitly (Student Name, Student ID, Gender,
  // DOB, Age, Category, Skill, Division, Institution, Status).
  // The DYNAMIC columns are every unique custom/default field label
  // that appears in the answer arrays, in first-seen order — so a
  // brand-new custom field the organiser added yesterday shows up
  // automatically with no client change.
  const { columns, tableRows } = useMemo(() => {
    // Column priority — the four fields most operators care about
    // (Student Name, Skill, Division, Gender) sit at the front so
    // they're visible without a long horizontal scroll on narrow
    // phones. Institution + demographics + status follow. Rest of
    // the dynamic answers get appended after the fixed block.
    const fixed = [
      'Student Name', 'Skill', 'Division', 'Gender',
      'Institution',
      'DOB', 'Age', 'Category',
      'Status', 'Registered On',
    ];
    // Fixed labels we already surface — skip these in the dynamic
    // section so an operator doesn't see two "Gender" columns when
    // the org configured a Gender field on the Registration Form.
    // Also skip anything whose lower-cased label collides with a
    // fixed column heading — prevents duplicate React keys when the
    // organiser named a custom field "Category" / "Skill" etc.
    const skipDynamic = new Set([
      // Student-source defaults already surfaced via row.student_*.
      'name', 'student name', 'gender', 'dob', 'date of birth',
      // Fixed column headings — dedupe by lower-cased match.
      ...fixed.map((s) => s.toLowerCase()),
    ]);

    const dynamicLabels = [];
    const seenLabels = new Set();
    rows.forEach((r) => {
      (r.answers || []).forEach((a) => {
        const lbl = String(a?.label || '').trim();
        if (!lbl) return;
        const key = lbl.toLowerCase();
        if (skipDynamic.has(key)) return;
        if (seenLabels.has(key)) return;
        seenLabels.add(key);
        dynamicLabels.push(lbl);
      });
    });

    const cols = [...fixed, ...dynamicLabels];

    // Assemble one flat row per registration. Selection metadata for
    // Category / Skill / Division is derived by inspecting the
    // matching student-source answers — those keys are set by the
    // Registration Form's default fields.
    const trows = rows.map((r) => {
      const answers = Array.isArray(r.answers) ? r.answers : [];
      const bySourceKey = {};
      const byLabelLower = {};
      answers.forEach((a) => {
        if (a?.fieldKey) bySourceKey[String(a.fieldKey).toLowerCase()] = a;
        if (a?.label)    byLabelLower[String(a.label).toLowerCase()]   = a;
      });
      const findByAnyLabel = (candidates) => {
        for (const c of candidates) {
          const a = byLabelLower[c.toLowerCase()];
          if (a) return coerceValue(a);
        }
        return '';
      };
      const dobStr = r.student_dob || findByAnyLabel(['Date of Birth', 'DOB']) || '';
      const age    = ageFromDob(dobStr);
      const row = {
        'Student Name': r.student_name || '',
        'Gender':       r.student_gender || findByAnyLabel(['Gender']) || '',
        'DOB':          dobStr ? fmtDate(dobStr) : '',
        'Age':          age != null ? String(age) : '',
        'Category':     findByAnyLabel(['Category', 'Category Name', 'Event Category']),
        'Skill':        findByAnyLabel(['Skill', 'Skills']),
        'Division':     findByAnyLabel(['Division', 'Divisions']),
        'Institution':  r.institution_name || '',
        'Status':       r.status || '',
        'Registered On': r.created_at ? fmtDate(r.created_at) : '',
      };
      dynamicLabels.forEach((lbl) => {
        const a = byLabelLower[lbl.toLowerCase()];
        row[lbl] = a ? coerceValue(a) : '';
      });
      return row;
    });

    return { columns: cols, tableRows: trows };
  }, [rows]);

  // ── Export ──────────────────────────────────────────────────
  // The on-screen table dedupes overlapping headings for readability,
  // but the export must be exhaustive: every field the institution
  // submitted for every student on THIS event, plus every default
  // student attribute we have. We build the export column set
  // independently from the table's column set:
  //
  //   • Core identity + contact columns (from the row itself).
  //   • Selection metadata (Category / Skill / Division / Gender /
  //     Age range) surfaced from the answers.
  //   • EVERY answer label the operator submitted — no dedupe, no
  //     skip list — in first-seen order across the whole batch.
  //
  // The exported header includes both a system-column and a raw
  // field-label section so a custom form field named exactly
  // "Category" or "Gender" still round-trips into its own column.
  // Export routes through the backend so the output is a proper
  // institution-wise Excel workbook (Summary + one sheet per
  // institution + all custom fields), generated with ExcelJS on
  // the server. The mobile side just hands the download URL to the
  // OS via Linking.openURL — same pattern the Attendance Export
  // modal uses so branch admins and organisers both get a native
  // "Save/Share" prompt without a new native dependency.
  const onExport = async () => {
    try {
      // Auth via query token — Linking.openURL launches the OS
      // browser, which won't send our Authorization header. The
      // backend's verifyToken middleware also accepts ?token=<jwt>
      // so appending it keeps the download authenticated.
      const token = await getToken();
      const qs = new URLSearchParams();
      if (token) qs.set('token', token);
      const url = `${apiClient.defaults.baseURL}/events/${eventId}/registrations/export.xlsx?${qs.toString()}`;

      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        Alert.alert('Export started', 'Downloading Excel workbook…');
      }
    } catch (err) {
      Alert.alert('Export failed', err?.message || 'Could not export workbook.');
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={[styles.header, { paddingTop: topPad + 10 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft size={20} color={TEXT} />
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>Registered Students</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{eventTitle}</Text>
        </View>
        <TouchableOpacity onPress={load} style={styles.iconBtn} hitSlop={8}>
          <RefreshCw size={16} color={TEXT} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onExport}
          disabled={loading || tableRows.length === 0}
          style={[
            styles.exportBtn,
            (loading || tableRows.length === 0) && { opacity: 0.5 },
          ]}
        >
          <Download size={14} color="#fff" strokeWidth={2.4} />
          <Text style={styles.exportBtnText}>Export</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={BRAND} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : tableRows.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No students have registered for this event yet.</Text>
        </View>
      ) : (
        // Outer vertical ScrollView for many rows; inner horizontal
        // ScrollView so the wide column set never truncates. The
        // header + body share the same nested layout so column
        // widths stay aligned as the user scrolls.
        <ScrollView style={{ flex: 1 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View>
              <View style={styles.headerRow}>
                {columns.map((c) => (
                  <View key={c} style={styles.headerCell}>
                    <Text style={styles.headerCellText} numberOfLines={2}>{c}</Text>
                  </View>
                ))}
              </View>
              {tableRows.map((row, i) => (
                <View
                  key={i}
                  style={[
                    styles.bodyRow,
                    i % 2 === 1 && styles.bodyRowAlt,
                  ]}
                >
                  {columns.map((c) => (
                    <View key={c} style={styles.bodyCell}>
                      <Text style={styles.bodyCellText} numberOfLines={3}>
                        {row[c] || '—'}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const CELL_WIDTH = 160;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: SURFACE, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  backBtn: { padding: 6 },
  iconBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  title:    { fontSize: 16, fontWeight: '800', color: TEXT },
  subtitle: { fontSize: 12, color: TEXT_MUTED, marginTop: 1 },
  exportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: BRAND,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999,
  },
  exportBtnText: { fontSize: 12, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: TEXT_MUTED, fontSize: 13 },
  errorText: { color: '#B91C1C', fontSize: 13, textAlign: 'center' },

  headerRow: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
  },
  headerCell: {
    width: CELL_WIDTH,
    paddingHorizontal: 10, paddingVertical: 10,
    borderRightWidth: 1, borderRightColor: '#1E293B',
  },
  headerCellText: {
    fontSize: 11, fontWeight: '800', color: '#fff',
    letterSpacing: 0.4, textTransform: 'uppercase',
  },

  bodyRow: {
    flexDirection: 'row',
    backgroundColor: SURFACE,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  bodyRowAlt: {
    backgroundColor: '#F8FAFC',
  },
  bodyCell: {
    width: CELL_WIDTH,
    paddingHorizontal: 10, paddingVertical: 10,
    borderRightWidth: 1, borderRightColor: BORDER,
  },
  bodyCellText: {
    fontSize: 12, color: TEXT, lineHeight: 17,
  },
});
