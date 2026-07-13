// src/screens/admin/AdminCertificatesScreen.js
//
// Institution Login → Certificates. Lists every student in the caller's
// academy tree whose status is 'awaiting_certificate' — i.e. the trainer
// has already recorded belt-test remarks and the row is now waiting for
// the admin to review + dispatch the certificate.
//
// Per row we display: Student Name, Course, Trainer Remarks, Course
// Completion Date, Belt Test Completion Date, plus a brand-red
// "Send Certificate" button.
//
// On Send Certificate:
//   POST /api/course-completions/:id/send-certificate
//   → status flips to 'certificate_sent', row drops out of this list.
//   The endpoint also creates a matching row in the shared certificates
//   table so the student's belt/journey history reflects it.

import React, { useCallback, useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl, Modal, Image, Dimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft, Award, ShieldCheck, BookOpen, Calendar,
  User, MessageSquare, Send, Trophy, X as XIcon, Eye, FileCheck2,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
import { confirm } from '../../components/ConfirmDialog';
import resolveAssetUrl from '../../utils/assetUrl';

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export default function AdminCertificatesScreen({ navigation }) {
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  // Preview flow — when the admin taps Send Certificate we first
  // fetch the merged template + placeholder payload and render it
  // in a modal. Only after they tap Confirm & Send do we POST.
  const [previewRow, setPreviewRow] = useState(null);
  const [previewPayload, setPreviewPayload] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [pickedTemplateId, setPickedTemplateId] = useState(null);

  // Load templates once so the picker chip row inside the preview
  // doesn't have to fetch again.
  useEffect(() => {
    apiClient.get('/certificate-templates')
      .then((r) => {
        setTemplates(r.data?.templates || []);
        const def = (r.data?.templates || []).find((t) => t.is_default);
        if (def) setPickedTemplateId(def.id);
      })
      .catch(() => setTemplates([]));
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get(
        '/course-completions/institution/awaiting-certificate',
      );
      setRows(r.data?.completions || []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log('[AdminCertificates] load error:',
        err?.response?.status, err?.response?.data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Open the template + merged data as a preview modal. The admin
  // eyeballs the placeholder values (student name, dates, remarks etc.
  // laid onto the actual template artwork) before committing to send.
  const openPreview = async (row) => {
    if (templates.length === 0) {
      confirm({
        title: 'No template yet',
        message: 'Add a certificate template first (More → Certificate Templates).',
        variant: 'warning', confirmText: 'OK', hideCancel: true,
      });
      return;
    }
    const tplId = pickedTemplateId
      || templates.find((t) => t.is_default)?.id
      || templates[0]?.id;
    setPreviewRow(row);
    setPickedTemplateId(tplId);
    setPreparing(true);
    setPreviewPayload(null);
    try {
      const r = await apiClient.post(`/certificate-templates/${tplId}/prepare`, {
        completion_id: row.id,
      });
      setPreviewPayload(r.data);
    } catch (err) {
      confirm({
        title: 'Could not build preview',
        message: err?.response?.data?.message || 'Try again.',
        variant: 'warning', confirmText: 'OK', hideCancel: true,
      });
      setPreviewRow(null);
    } finally {
      setPreparing(false);
    }
  };

  // On confirm, POST to the completion's send-certificate endpoint
  // with the template_id so the backend renders + stores the same
  // layout the admin just approved.
  const dispatchCertificate = async () => {
    if (!previewRow) return;
    setSendingId(previewRow.id);
    try {
      await apiClient.post(
        `/course-completions/${previewRow.id}/send-certificate`,
        { template_id: pickedTemplateId },
      );
      setRows((prev) => prev.filter((x) => x.id !== previewRow.id));
      const name = previewRow.student_name;
      setPreviewRow(null);
      setPreviewPayload(null);
      setTimeout(() => {
        confirm({
          title: 'Certificate dispatched',
          message: `${name} now has a Certificate Sent status on their record.`,
          variant: 'success', confirmText: 'Done', hideCancel: true,
        });
      }, 260);
    } catch (err) {
      confirm({
        title: 'Send failed',
        message: err?.response?.data?.message || 'Try again.',
        variant: 'warning', confirmText: 'OK', hideCancel: true,
      });
    } finally {
      setSendingId(null);
    }
  };

  // Kept for the row's Send button — funnels through the preview flow.
  const sendCertificate = openPreview;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.iconBtn}
          hitSlop={8}
          activeOpacity={0.85}
        >
          <ArrowLeft size={20} color={'#111827'} strokeWidth={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Certificates</Text>
          <Text style={styles.subtitle}>
            {rows.length === 0 ? 'No students awaiting certificate' : `${rows.length} awaiting certificate`}
          </Text>
        </View>
        <View style={styles.headerBadge}>
          <Award size={13} color="#B45309" strokeWidth={2.4} />
          <Text style={styles.headerBadgeText}>{rows.length}</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={palette.purple.vivid} />
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.emptyCard}>
          <Trophy size={32} color={palette.textLight} strokeWidth={1.6} />
          <Text style={styles.emptyTitle}>Inbox is empty</Text>
          <Text style={styles.emptySub}>
            Rows appear here as soon as a trainer submits belt-test remarks
            for a student who finished the curriculum.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={palette.purple.vivid}
            />
          }
        >
          {rows.map((row) => (
            <AwaitingCard
              key={row.id}
              row={row}
              sending={sendingId === row.id}
              onSend={() => sendCertificate(row)}
            />
          ))}
        </ScrollView>
      )}

      {/* ── Template preview modal ── */}
      <PreviewModal
        visible={!!previewRow}
        preparing={preparing}
        payload={previewPayload}
        templates={templates}
        pickedTemplateId={pickedTemplateId}
        onPickTemplate={async (tplId) => {
          if (!previewRow) return;
          setPickedTemplateId(tplId);
          setPreparing(true);
          try {
            const r = await apiClient.post(`/certificate-templates/${tplId}/prepare`, {
              completion_id: previewRow.id,
            });
            setPreviewPayload(r.data);
          } finally { setPreparing(false); }
        }}
        onClose={() => { setPreviewRow(null); setPreviewPayload(null); }}
        onConfirm={dispatchCertificate}
        sending={!!sendingId}
      />
    </View>
  );
}

// ─── Preview Modal ──────────────────────────────────────────────────
function PreviewModal({
  visible, preparing, payload, templates, pickedTemplateId,
  onPickTemplate, onClose, onConfirm, sending,
}) {
  const SCREEN_W = Dimensions.get('window').width;
  const CANVAS_W = SCREEN_W - spacing.lg * 2;
  const bg = payload?.template?.background_url
    ? resolveAssetUrl(payload.template.background_url)
    : null;
  const canvasH = payload
    ? Math.min(CANVAS_W * ((payload.template.canvas_height || 700) / (payload.template.canvas_width || 1000)), 520)
    : 320;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.iconBtn} hitSlop={8}>
            <XIcon size={20} color={palette.text} strokeWidth={2.4} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Review certificate</Text>
            <Text style={styles.subtitle}>Verify placeholders, then dispatch.</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
          {/* Template picker chips */}
          {templates.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6, paddingBottom: spacing.md }}
            >
              {templates.map((t) => {
                const active = t.id === pickedTemplateId;
                return (
                  <TouchableOpacity
                    key={t.id}
                    onPress={() => onPickTemplate(t.id)}
                    style={[
                      { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: palette.surface,
                        borderWidth: 1, borderColor: palette.borderSoft },
                      active && { backgroundColor: palette.purple.vivid, borderColor: palette.purple.vivid },
                    ]}
                    activeOpacity={0.85}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '800', color: active ? '#fff' : palette.text }}>
                      {t.name}{t.is_default ? '  ★' : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : null}

          {preparing ? (
            <View style={{ alignItems: 'center', padding: spacing.xxl }}>
              <ActivityIndicator size="large" color={palette.purple.vivid} />
            </View>
          ) : payload ? (
            <View style={[
              { width: CANVAS_W, height: canvasH, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#fff',
                alignSelf: 'center' },
              shadows.card,
            ]}>
              {bg ? (
                <Image source={{ uri: bg }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              ) : null}
              {(payload.placeholders || []).map((pin, i) => {
                const est = Math.max(60, String(pin.value || pin.label).length * (pin.font_size || 16) * 0.55);
                return (
                  <View
                    key={i}
                    style={{
                      position: 'absolute',
                      left: pin.x * CANVAS_W - est / 2,
                      top:  pin.y * canvasH - (pin.font_size || 16),
                      width: est,
                    }}
                  >
                    <Text style={{
                      fontSize: Math.max(9, (pin.font_size || 16) * 0.6),
                      color: pin.color || '#111827',
                      fontWeight: pin.bold ? '800' : '600',
                      fontStyle: pin.italic ? 'italic' : 'normal',
                      textAlign: pin.align || 'center',
                    }}>
                      {String(pin.value || '')}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={{ color: palette.textMuted, textAlign: 'center', padding: spacing.xl }}>
              No preview available.
            </Text>
          )}
        </ScrollView>

        {/* Sticky confirm bar */}
        <View style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: spacing.lg, backgroundColor: palette.surface,
          borderTopWidth: 1, borderTopColor: palette.borderSoft,
          flexDirection: 'row', gap: 10,
        }}>
          <TouchableOpacity
            onPress={onClose}
            style={{
              flex: 1, alignItems: 'center', justifyContent: 'center',
              paddingVertical: 12, borderRadius: 12,
              borderWidth: 1, borderColor: palette.borderSoft,
            }}
            activeOpacity={0.85}
          >
            <Text style={{ fontSize: 14, fontWeight: '800', color: palette.text }}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onConfirm}
            disabled={sending || preparing}
            style={{
              flex: 2, flexDirection: 'row', gap: 6,
              alignItems: 'center', justifyContent: 'center',
              paddingVertical: 12, borderRadius: 12,
              backgroundColor: '#E63946', opacity: (sending || preparing) ? 0.7 : 1,
            }}
            activeOpacity={0.85}
          >
            {sending ? <ActivityIndicator color="#fff" /> : (
              <>
                <FileCheck2 size={14} color="#fff" strokeWidth={2.6} />
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>Confirm & Send</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Card ───────────────────────────────────────────────────────────
function AwaitingCard({ row, sending, onSend }) {
  return (
    <View style={styles.card}>
      <View style={styles.ribbon}>
        <ShieldCheck size={12} color={palette.blue.on} strokeWidth={2.6} />
        <Text style={styles.ribbonText}>Awaiting Certificate</Text>
      </View>

      <View style={styles.cardHeader}>
        <View style={styles.avatar}>
          <User size={18} color={palette.purple.vivid} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.studentName} numberOfLines={1}>{row.student_name}</Text>
          <View style={styles.courseRow}>
            <BookOpen size={11} color={palette.textMuted} strokeWidth={2.4} />
            <Text style={styles.courseName} numberOfLines={1}>{row.course_name}</Text>
          </View>
          {row.trainer_name ? (
            <Text style={styles.trainerLine} numberOfLines={1}>
              Signed off by {row.trainer_name}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Date + belt grid */}
      <View style={styles.grid}>
        <ReadOnlyField
          icon={Calendar}
          label="Course Completed"
          value={fmtDate(row.course_completed_at)}
        />
        <ReadOnlyField
          icon={Calendar}
          label="Test Completed"
          value={fmtDate(row.belt_test_completed_at)}
        />
      </View>
      <View style={[styles.grid, { marginTop: spacing.sm }]}>
        <ReadOnlyField
          icon={Award}
          label="Belt"
          value={row.belt_name || row.batch_name || '—'}
        />
      </View>

      {/* Trainer remarks — read-only for the admin */}
      <View style={styles.remarksBlock}>
        <View style={styles.remarksHead}>
          <MessageSquare size={11} color={palette.textMuted} strokeWidth={2.4} />
          <Text style={styles.remarksLabel}>Trainer Remarks</Text>
        </View>
        <View style={styles.remarksBox}>
          <Text style={styles.remarksText}>
            {row.test_remarks || 'No remarks provided.'}
          </Text>
        </View>
      </View>

      <TouchableOpacity
        onPress={onSend}
        disabled={sending}
        activeOpacity={0.85}
        style={[styles.sendBtn, sending && { opacity: 0.7 }]}
      >
        {sending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Send size={14} color="#fff" strokeWidth={2.6} />
            <Text style={styles.sendBtnText}>Send Certificate</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

function ReadOnlyField({ icon: Icon, label, value }) {
  return (
    <View style={styles.roField}>
      <View style={styles.roLabelRow}>
        {Icon ? <Icon size={11} color={palette.textMuted} strokeWidth={2.4} /> : null}
        <Text style={styles.roLabel}>{label}</Text>
      </View>
      <Text style={styles.roValue}>{value}</Text>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: palette.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    ...shadows.card,
    gap: spacing.md,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.borderSoft,
  },
  title:    { ...type.h1, color: palette.text, fontSize: 18 },
  subtitle: { ...type.caption, color: palette.textMuted, marginTop: 1 },
  headerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: '#FEF3C7',
  },
  headerBadgeText: { ...type.micro, color: '#B45309', fontWeight: '800' },

  emptyCard: {
    marginHorizontal: spacing.lg, marginTop: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.xxl,
    alignItems: 'center', gap: 6,
    ...shadows.card,
  },
  emptyTitle: { ...type.bodyBold, color: palette.text, marginTop: 6 },
  emptySub:   { ...type.caption, color: palette.textMuted, textAlign: 'center' },

  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  ribbon: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.blue.soft,
    marginBottom: spacing.md,
  },
  ribbonText: { ...type.micro, color: palette.blue.on, fontWeight: '800', letterSpacing: 0.4 },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginBottom: spacing.md,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  studentName: { ...type.bodyBold, color: palette.text, fontSize: 15 },
  courseRow:   { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  courseName:  { ...type.caption, color: palette.textMuted, fontWeight: '700', flexShrink: 1 },
  trainerLine: { ...type.micro, color: palette.textLight, fontWeight: '600', marginTop: 2 },

  grid: {
    flexDirection: 'row', gap: spacing.sm,
    marginBottom: spacing.md,
  },
  roField: {
    flex: 1,
    backgroundColor: palette.bg,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  roLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  roLabel: {
    ...type.micro, color: palette.textMuted,
    fontWeight: '800', letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  roValue: {
    ...type.bodyBold, color: palette.text,
    fontSize: 13, marginTop: 4,
  },

  remarksBlock: { gap: 6, marginBottom: spacing.md },
  remarksHead:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  remarksLabel: {
    ...type.micro, color: palette.textMuted,
    fontWeight: '800', letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  remarksBox: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1, borderColor: '#FDE68A',
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  remarksText: {
    ...type.caption, color: '#78350F',
    fontWeight: '600', lineHeight: 18,
  },

  sendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#E63946',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  sendBtnText: {
    color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 0.3,
  },
});
