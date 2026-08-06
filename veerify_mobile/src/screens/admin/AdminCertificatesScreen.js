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

  // ── Belt Promotion Requests (trainer → institution) ───────────
  // Second inbox on this screen. Rendered above the classic
  // course-completion inbox so pending promotions get first
  // attention. Each row surfaces two admin actions:
  //   • Notify Trainer (modal for institution remarks → returns
  //     the request to the trainer with a note)
  //   • Send Certificate (confirm → hits /approve which mints the
  //     belt certificate + updates the student's belt_category +
  //     notifies both parties)
  const [promoRequests, setPromoRequests] = useState([]);
  const [promoLoading, setPromoLoading] = useState(true);
  const [promoActingId, setPromoActingId] = useState(null);
  const [notifyModal, setNotifyModal] = useState(null); // {id, student_name}
  const [notifyRemarks, setNotifyRemarks] = useState('');
  const [notifySubmitting, setNotifySubmitting] = useState(false);
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
      // Fire both inboxes in parallel — awaiting course-certificates
      // and pending belt-promotion requests. Independent so one
      // failure doesn't blank the other.
      const [rRes, pRes] = await Promise.all([
        apiClient.get('/course-completions/institution/awaiting-certificate')
          .catch((err) => { console.log('[AdminCertificates] awaiting load error:', err?.response?.data); return { data: {} }; }),
        apiClient.get('/belt-promotion-requests/institution')
          .catch((err) => { console.log('[AdminCertificates] promo load error:', err?.response?.data); return { data: {} }; }),
      ]);
      setRows(rRes.data?.completions || []);
      setPromoRequests(pRes.data?.requests || []);
    } finally {
      setLoading(false);
      setPromoLoading(false);
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Promotion admin actions ─────────────────────────────────
  const openNotifyModal = (req) => {
    setNotifyRemarks('');
    setNotifyModal({ id: req.id, student_name: req.student_name });
  };
  const submitNotifyTrainer = async () => {
    if (!notifyModal) return;
    const remarks = notifyRemarks.trim();
    if (!remarks) {
      confirm({
        title: 'Add remarks',
        message: 'Tell the trainer what needs to change before resubmitting.',
        variant: 'warning', confirmText: 'OK', hideCancel: true,
      });
      return;
    }
    try {
      setNotifySubmitting(true);
      await apiClient.post(
        `/belt-promotion-requests/${notifyModal.id}/notify-trainer`,
        { remarks },
      );
      setPromoRequests((prev) => prev.filter((r) => r.id !== notifyModal.id));
      setNotifyModal(null);
      setNotifyRemarks('');
      setTimeout(() => confirm({
        title: 'Trainer notified',
        message: 'The trainer will see your remarks in their inbox.',
        variant: 'success', confirmText: 'OK', hideCancel: true,
      }), 200);
    } catch (err) {
      confirm({
        title: 'Could not notify',
        message: err?.response?.data?.message || 'Try again.',
        variant: 'warning', confirmText: 'OK', hideCancel: true,
      });
    } finally {
      setNotifySubmitting(false);
    }
  };
  const approvePromotion = (req) => {
    confirm({
      title:       'Send certificate?',
      message:     `Approve promotion to ${req.requested_belt} for ${req.student_name}? This mints the belt certificate and updates the student's belt category.`,
      variant:     'info',
      confirmText: 'Yes, send',
      cancelText:  'Cancel',
      onConfirm: async () => {
        try {
          setPromoActingId(req.id);
          await apiClient.post(`/belt-promotion-requests/${req.id}/approve`);
          setPromoRequests((prev) => prev.filter((r) => r.id !== req.id));
          setTimeout(() => confirm({
            title:       'Promotion approved',
            message:     `${req.student_name} is now ${req.requested_belt}. Certificate delivered.`,
            variant:     'success',
            confirmText: 'Done',
            hideCancel:  true,
          }), 260);
        } catch (err) {
          confirm({
            title: 'Approve failed',
            message: err?.response?.data?.message || 'Try again.',
            variant: 'warning', confirmText: 'OK', hideCancel: true,
          });
        } finally {
          setPromoActingId(null);
        }
      },
    });
  };

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
            {promoRequests.length > 0
              ? `${promoRequests.length} belt request${promoRequests.length === 1 ? '' : 's'} · ${rows.length} awaiting certificate`
              : rows.length === 0
                ? 'Nothing pending'
                : `${rows.length} awaiting certificate`}
          </Text>
        </View>
        <View style={styles.headerBadge}>
          <Award size={13} color="#B45309" strokeWidth={2.4} />
          <Text style={styles.headerBadgeText}>{rows.length + promoRequests.length}</Text>
        </View>
      </View>

      {loading && promoLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={palette.purple.vivid} />
        </View>
      ) : rows.length === 0 && promoRequests.length === 0 ? (
        <View style={styles.emptyCard}>
          <Trophy size={32} color={palette.textLight} strokeWidth={1.6} />
          <Text style={styles.emptyTitle}>Inbox is empty</Text>
          <Text style={styles.emptySub}>
            Belt promotion requests and course-completion certificates land here for your review.
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
          {/* ── Belt Promotion Requests ── */}
          {promoRequests.length > 0 ? (
            <View style={{ marginBottom: spacing.lg }}>
              <Text style={styles.sectionLabel}>BELT PROMOTION REQUESTS</Text>
              {promoRequests.map((req) => (
                <PromotionRequestCard
                  key={req.id}
                  request={req}
                  acting={promoActingId === req.id}
                  onNotify={() => openNotifyModal(req)}
                  onApprove={() => approvePromotion(req)}
                />
              ))}
            </View>
          ) : null}

          {/* ── Awaiting course-completion certificates (existing flow) ── */}
          {rows.length > 0 ? (
            <>
              {promoRequests.length > 0 ? (
                <Text style={styles.sectionLabel}>AWAITING CERTIFICATES</Text>
              ) : null}
              {rows.map((row) => (
                <AwaitingCard
                  key={row.id}
                  row={row}
                  sending={sendingId === row.id}
                  onSend={() => sendCertificate(row)}
                />
              ))}
            </>
          ) : null}
        </ScrollView>
      )}

      {/* ── Notify Trainer modal ── */}
      <Modal
        visible={!!notifyModal}
        transparent
        animationType="fade"
        onRequestClose={() => !notifySubmitting && setNotifyModal(null)}
      >
        <View style={styles.notifyOverlay}>
          <View style={styles.notifyCard}>
            <View style={styles.notifyHead}>
              <MessageSquare size={18} color={palette.purple.vivid} strokeWidth={2.4} />
              <Text style={styles.notifyTitle}>Notify Trainer</Text>
              <TouchableOpacity
                onPress={() => !notifySubmitting && setNotifyModal(null)}
                style={{ padding: 4 }}
                hitSlop={8}
              >
                <XIcon size={16} color={palette.textMuted} strokeWidth={2.4} />
              </TouchableOpacity>
            </View>
            <Text style={styles.notifyHint}>
              Remarks for {notifyModal?.student_name || 'this student'}'s trainer. The request stays pending until they resubmit.
            </Text>
            <View style={styles.notifyInputWrap}>
              <Text style={styles.notifyLabel}>Institution Remarks *</Text>
              <View style={styles.notifyInputBox}>
                <Text
                  onPress={() => {}}
                  style={{ display: 'none' }}
                />
                {/* Using TextInput via a lazy import so the modal can
                    live alongside the existing screen without pulling
                    the whole form kit. */}
                {(() => {
                  const { TextInput } = require('react-native');
                  return (
                    <TextInput
                      value={notifyRemarks}
                      onChangeText={setNotifyRemarks}
                      placeholder="e.g. Attendance below 75%. Please have the student attend more sessions before resubmitting."
                      placeholderTextColor={palette.textLight}
                      multiline
                      style={styles.notifyInput}
                    />
                  );
                })()}
              </View>
            </View>
            <View style={styles.notifyFooter}>
              <TouchableOpacity
                style={styles.notifyCancel}
                onPress={() => !notifySubmitting && setNotifyModal(null)}
                activeOpacity={0.85}
              >
                <Text style={styles.notifyCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.notifySubmit, (!notifyRemarks.trim() || notifySubmitting) && { opacity: 0.6 }]}
                onPress={submitNotifyTrainer}
                disabled={!notifyRemarks.trim() || notifySubmitting}
                activeOpacity={0.85}
              >
                {notifySubmitting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.notifySubmitText}>Send</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
              {/* Backend already dropped inactive pins from
                  payload.placeholders in the prepare handler, so
                  everything we iterate here MUST render. Image-backed
                  placeholders (digital_signature / seal) render the
                  uploaded image when pin.image_url is set; if not,
                  they collapse silently instead of showing raw text
                  ("[Signature]") on a real certificate. */}
              {(payload.placeholders || []).map((pin, i) => {
                const isImage = pin.key === 'digital_signature' || pin.key === 'seal';
                if (isImage) {
                  if (!pin.image_url) return null;
                  const w = Math.max(40, (pin.width  || 0.20) * CANVAS_W);
                  const h = Math.max(24, (pin.height || 0.10) * canvasH);
                  return (
                    <Image
                      key={i}
                      source={{ uri: resolveAssetUrl(pin.image_url) }}
                      style={{
                        position: 'absolute',
                        left: pin.x * CANVAS_W - w / 2,
                        top:  pin.y * canvasH - h / 2,
                        width: w, height: h,
                      }}
                      resizeMode="contain"
                    />
                  );
                }
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

// ─── Belt Promotion Request card ───────────────────────────────────
function PromotionRequestCard({ request, acting, onNotify, onApprove }) {
  const att = request.attendance_summary || {};
  const percent = Number.isFinite(Number(att.percent)) ? Number(att.percent) : 0;
  return (
    <View style={[styles.card, { borderColor: palette.purple.soft, borderWidth: 1 }]}>
      <View style={[styles.ribbon, { backgroundColor: palette.purple.soft }]}>
        <Award size={12} color={palette.purple.on} strokeWidth={2.6} />
        <Text style={[styles.ribbonText, { color: palette.purple.on }]}>Belt Promotion Request</Text>
      </View>

      <View style={styles.cardHeader}>
        <View style={styles.avatar}>
          <User size={18} color={palette.purple.vivid} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.studentName} numberOfLines={1}>
            {request.student_name || 'Student'}
          </Text>
          <Text style={styles.courseLine} numberOfLines={1}>
            Trainer: {request.trainer_name || '—'}
            {request.course_name ? ` · ${request.course_name}` : ''}
          </Text>
        </View>
      </View>

      {/* Belt transition line — current → requested */}
      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Current</Text>
          <Text style={styles.metaValue}>{request.current_belt || '—'}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Requested</Text>
          <Text style={[styles.metaValue, { color: palette.purple.vivid }]}>
            {request.requested_belt || '—'}
          </Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Attendance</Text>
          <Text style={styles.metaValue}>{percent}%</Text>
        </View>
      </View>

      {request.trainer_remarks ? (
        <View style={styles.remarksBox}>
          <Text style={styles.remarksLabel}>Trainer Remarks</Text>
          <Text style={styles.remarksText}>{request.trainer_remarks}</Text>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        <TouchableOpacity
          onPress={onNotify}
          disabled={acting}
          style={[styles.ghostBtn, acting && { opacity: 0.6 }]}
          activeOpacity={0.85}
        >
          <MessageSquare size={14} color={palette.purple.vivid} strokeWidth={2.4} />
          <Text style={styles.ghostBtnText}>Notify Trainer</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onApprove}
          disabled={acting}
          style={[styles.sendBtn, acting && { opacity: 0.6 }]}
          activeOpacity={0.85}
        >
          {acting
            ? <ActivityIndicator color="#fff" size="small" />
            : (
              <>
                <Send size={14} color="#fff" strokeWidth={2.4} />
                <Text style={styles.sendBtnText}>Send Certificate</Text>
              </>
            )}
        </TouchableOpacity>
      </View>
    </View>
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

  // Section labels between the two inbox groups (Belt Promotion
  // Requests / Awaiting Certificates).
  sectionLabel: {
    fontSize: 11, fontWeight: '800', letterSpacing: 0.6,
    color: palette.textMuted, textTransform: 'uppercase',
    marginBottom: spacing.sm, marginTop: spacing.xs,
  },

  // Belt promotion — meta row (current / requested / attendance).
  metaRow: {
    flexDirection: 'row', gap: spacing.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  metaItem: { flex: 1, minWidth: 0 },
  metaLabel: {
    fontSize: 10, color: palette.textLight, fontWeight: '800',
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  metaValue: {
    fontSize: 13, color: palette.text, fontWeight: '700', marginTop: 2,
  },
  remarksBox: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: palette.bg,
  },
  remarksLabel: {
    fontSize: 10, color: palette.textLight, fontWeight: '800',
    textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4,
  },
  remarksText: { fontSize: 12, color: palette.text, lineHeight: 18 },
  actionRow: {
    flexDirection: 'row', gap: spacing.sm,
    marginTop: spacing.md,
  },
  ghostBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6,
    paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: palette.purple.soft,
    borderWidth: 1, borderColor: palette.purple.soft,
  },
  ghostBtnText: { color: palette.purple.on, fontWeight: '800', fontSize: 12 },

  // Notify Trainer modal
  notifyOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center',
    padding: spacing.lg,
  },
  notifyCard: {
    width: '100%', maxWidth: 440,
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadows.raised,
  },
  notifyHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: palette.borderSoft,
  },
  notifyTitle: { flex: 1, fontSize: 16, fontWeight: '800', color: palette.text },
  notifyHint: {
    fontSize: 12, color: palette.textMuted, lineHeight: 18,
    marginBottom: spacing.md,
  },
  notifyInputWrap: { marginBottom: spacing.md },
  notifyLabel: {
    fontSize: 11, fontWeight: '800', letterSpacing: 0.4,
    color: palette.textMuted, textTransform: 'uppercase', marginBottom: 6,
  },
  notifyInputBox: {
    borderRadius: radius.md,
    borderWidth: 1, borderColor: palette.borderSoft,
    backgroundColor: palette.surface,
  },
  notifyInput: {
    minHeight: 100,
    padding: spacing.sm,
    fontSize: 13, color: palette.text,
    textAlignVertical: 'top',
  },
  notifyFooter: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm,
    marginTop: spacing.sm,
  },
  notifyCancel: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md },
  notifyCancelText: { fontSize: 13, fontWeight: '700', color: palette.textMuted },
  notifySubmit: {
    paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: palette.purple.vivid,
    minWidth: 96, alignItems: 'center',
  },
  notifySubmitText: { color: '#fff', fontWeight: '800', fontSize: 13 },

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
