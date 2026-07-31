// src/components/ExportAttendanceModal.js
//
// Modal dialog for selecting Attendance Export parameters in both
// Institution Admin and Branch Admin portals.

import React, { useState, useEffect } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Linking, ScrollView,
} from 'react-native';
import {
  X, FileSpreadsheet, FileText, Calendar, Filter, Building2, Layers, Download,
} from 'lucide-react-native';

import apiClient from '../api/client';
import { palette, spacing, radius, shadows, type } from '../theme';
import DateField from './DateField';
import { getToken } from '../utils/storage';

function currentMonthStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function thirtyDaysAgoStr() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

export default function ExportAttendanceModal({
  visible,
  onClose,
  initialBranchId = null,
  isBranchAdmin = false,
}) {
  const [format, setFormat] = useState('excel'); // 'excel' | 'pdf'
  // 'date' (single day) | 'month' | 'date_range' (from/to)
  const [filterType, setFilterType] = useState('month');
  const [singleDate, setSingleDate] = useState(todayStr());
  const [month, setMonth] = useState(currentMonthStr());
  const [startDate, setStartDate] = useState(thirtyDaysAgoStr());
  const [endDate, setEndDate] = useState(todayStr());

  const [batches, setBatches] = useState([]);
  const [selectedBatchId, setSelectedBatchId] = useState('all');

  const [branches, setBranches] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState(initialBranchId || 'all');

  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    // Load available batches for picker
    apiClient.get('/batches?branch_id=all')
      .then((r) => {
        if (!cancelled) setBatches(r.data?.batches || []);
      })
      .catch(() => {});

    // Load branches for main admin picker
    if (!isBranchAdmin) {
      apiClient.get('/branches')
        .then((r) => {
          if (!cancelled) {
            const subs = (r.data?.branches || []).filter((b) => b.branch_kind === 'sub_branch');
            setBranches(subs);
          }
        })
        .catch(() => {});
    }

    return () => { cancelled = true; };
  }, [visible, isBranchAdmin]);

  const handleExport = async () => {
    try {
      setExporting(true);

      // Auth via query token — Linking.openURL hands the URL to the
      // OS browser, which won't send our Authorization header. The
      // backend's verifyToken middleware also accepts ?token=<jwt>,
      // so appending it here keeps the download authenticated
      // whether the caller is a main admin or a branch admin.
      const token = await getToken();

      const queryParams = new URLSearchParams({
        format,
        filter_type: filterType,
        // Include all three date params — backend picks the one that
        // matches filter_type. Sending the unused ones is harmless.
        date: singleDate,
        month,
        start_date: startDate,
        end_date: endDate,
        batch_id: selectedBatchId,
        // Branch admins get server-side scoping via the JWT (backend
        // getBranchScope resolves callerInstId), so we don't need to
        // send a branch_id at all — sending 'all' would let the
        // caller ATTEMPT to see other branches, but the guard rejects
        // it. Kept 'all' explicitly so payload shape matches the main
        // admin path when reading the ledger.
        branch_id: isBranchAdmin ? 'all' : selectedBranchId,
      });
      if (token) queryParams.set('token', token);

      const exportUrl = `${apiClient.defaults.baseURL}/attendance/export?${queryParams.toString()}`;

      // Open export URL directly or via browser/download
      const canOpen = await Linking.canOpenURL(exportUrl);
      if (canOpen) {
        await Linking.openURL(exportUrl);
        onClose();
      } else {
        Alert.alert('Export Started', `Downloading ${format.toUpperCase()} attendance report...`);
        onClose();
      }
    } catch (err) {
      Alert.alert('Export Error', err?.message || 'Could not export attendance report');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Export Attendance Report</Text>
              <Text style={styles.subtitle}>
                {isBranchAdmin ? 'Branch Attendance Report' : 'Institution & Branch Attendance'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={18} color={palette.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
            {/* Format Selection */}
            <Text style={styles.sectionLabel}>Report Format</Text>
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.formatTile, format === 'excel' && styles.formatTileSelected]}
                onPress={() => setFormat('excel')}
              >
                <FileSpreadsheet size={20} color={format === 'excel' ? palette.green.vivid : palette.textMuted} />
                <Text style={[styles.formatText, format === 'excel' && styles.formatTextSelected]}>
                  Excel (.xlsx)
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.formatTile, format === 'pdf' && styles.formatTileSelected]}
                onPress={() => setFormat('pdf')}
              >
                <FileText size={20} color={format === 'pdf' ? palette.purple.vivid : palette.textMuted} />
                <Text style={[styles.formatText, format === 'pdf' && styles.formatTextSelected]}>
                  PDF Document
                </Text>
              </TouchableOpacity>
            </View>

            {/* Filter Type Toggle — Single Date / Monthly / Custom Range */}
            <Text style={styles.sectionLabel}>Time Range</Text>
            <View style={styles.toggleRow}>
              <TouchableOpacity
                style={[styles.toggleBtn, filterType === 'date' && styles.toggleBtnSelected]}
                onPress={() => setFilterType('date')}
              >
                <Text style={[styles.toggleText, filterType === 'date' && styles.toggleTextSelected]}>
                  Single Date
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.toggleBtn, filterType === 'month' && styles.toggleBtnSelected]}
                onPress={() => setFilterType('month')}
              >
                <Text style={[styles.toggleText, filterType === 'month' && styles.toggleTextSelected]}>
                  Month
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.toggleBtn, filterType === 'date_range' && styles.toggleBtnSelected]}
                onPress={() => setFilterType('date_range')}
              >
                <Text style={[styles.toggleText, filterType === 'date_range' && styles.toggleTextSelected]}>
                  Date Range
                </Text>
              </TouchableOpacity>
            </View>

            {filterType === 'date' ? (
              <View style={{ marginTop: spacing.xs }}>
                <Text style={styles.fieldLabel}>Select Date</Text>
                <DateField value={singleDate} onChange={setSingleDate} />
              </View>
            ) : filterType === 'month' ? (
              <View style={{ marginTop: spacing.xs }}>
                <Text style={styles.fieldLabel}>Select Month (YYYY-MM)</Text>
                <DateField
                  value={month}
                  onChange={(v) => setMonth(v.slice(0, 7))}
                />
              </View>
            ) : (
              <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
                <Text style={styles.fieldLabel}>From Date</Text>
                <DateField value={startDate} onChange={setStartDate} />

                <Text style={[styles.fieldLabel, { marginTop: spacing.xs }]}>To Date</Text>
                <DateField value={endDate} onChange={setEndDate} />
              </View>
            )}

            {/* Branch Filter (Main Admin only) */}
            {!isBranchAdmin && branches.length > 0 ? (
              <View style={{ marginTop: spacing.md }}>
                <Text style={styles.sectionLabel}>Branch</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={[styles.chip, selectedBranchId === 'all' && styles.chipSelected]}
                    onPress={() => setSelectedBranchId('all')}
                  >
                    <Text style={[styles.chipText, selectedBranchId === 'all' && styles.chipTextSelected]}>
                      All Branches
                    </Text>
                  </TouchableOpacity>
                  {branches.map((b) => (
                    <TouchableOpacity
                      key={b.id}
                      style={[styles.chip, String(selectedBranchId) === String(b.id) && styles.chipSelected]}
                      onPress={() => setSelectedBranchId(b.id)}
                    >
                      <Text style={[styles.chipText, String(selectedBranchId) === String(b.id) && styles.chipTextSelected]}>
                        {b.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {/* Batch Filter */}
            <View style={{ marginTop: spacing.md }}>
              <Text style={styles.sectionLabel}>Batch</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  style={[styles.chip, selectedBatchId === 'all' && styles.chipSelected]}
                  onPress={() => setSelectedBatchId('all')}
                >
                  <Text style={[styles.chipText, selectedBatchId === 'all' && styles.chipTextSelected]}>
                    All Batches
                  </Text>
                </TouchableOpacity>
                {batches.map((b) => (
                  <TouchableOpacity
                    key={b.id}
                    style={[styles.chip, String(selectedBatchId) === String(b.id) && styles.chipSelected]}
                    onPress={() => setSelectedBatchId(b.id)}
                  >
                    <Text style={[styles.chipText, String(selectedBatchId) === String(b.id) && styles.chipTextSelected]}>
                      {b.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </ScrollView>

          {/* Footer Action */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.exportBtn} onPress={handleExport} disabled={exporting}>
              {exporting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Download size={16} color="#fff" strokeWidth={2.4} />
                  <Text style={styles.exportBtnText}>Generate {format.toUpperCase()}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%', maxWidth: 440,
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadows.lg,
  },
  header: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: spacing.md, paddingBottom: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: palette.borderSoft,
  },
  title: { fontSize: 16, fontWeight: '800', color: palette.text },
  subtitle: { fontSize: 11, color: palette.textMuted, marginTop: 2 },
  closeBtn: { padding: 4 },

  sectionLabel: { fontSize: 12, fontWeight: '700', color: palette.text, marginTop: spacing.sm, marginBottom: spacing.xs },
  fieldLabel: { fontSize: 11, fontWeight: '600', color: palette.textMuted },

  row: { flexDirection: 'row', gap: spacing.md },
  formatTile: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    padding: spacing.md, borderRadius: radius.lg,
    borderWidth: 1.5, borderColor: palette.borderSoft,
    backgroundColor: palette.surface,
  },
  formatTileSelected: {
    borderColor: palette.purple.vivid,
    backgroundColor: palette.purple.soft,
  },
  formatText: { fontSize: 12, fontWeight: '700', color: palette.textMuted },
  formatTextSelected: { color: palette.purple.vivid, fontWeight: '800' },

  toggleRow: { flexDirection: 'row', backgroundColor: palette.bg, borderRadius: radius.md, padding: 3, marginBottom: spacing.xs },
  toggleBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radius.sm },
  toggleBtnSelected: { backgroundColor: palette.surface, ...shadows.sm },
  toggleText: { fontSize: 11, fontWeight: '600', color: palette.textMuted },
  toggleTextSelected: { color: palette.purple.vivid, fontWeight: '800' },

  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full,
    borderWidth: 1, borderColor: palette.borderSoft, backgroundColor: palette.surface,
  },
  chipSelected: { backgroundColor: palette.purple.vivid, borderColor: palette.purple.vivid },
  chipText: { fontSize: 11, fontWeight: '700', color: palette.textMuted },
  chipTextSelected: { color: '#fff' },

  footer: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm,
    marginTop: spacing.lg, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: palette.borderSoft,
  },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md },
  cancelBtnText: { fontSize: 13, fontWeight: '700', color: palette.textMuted },
  exportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: palette.purple.vivid,
    paddingHorizontal: 18, paddingVertical: 10, borderRadius: radius.md,
  },
  exportBtnText: { fontSize: 13, fontWeight: '800', color: '#fff' },
});
