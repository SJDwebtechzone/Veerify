// src/screens/admin/AdminCourseDetailScreen.js
//
// Admin's "full view" of a course. Surfaces every field captured in the
// course-creation form plus operational data the admin actually needs:
//
//   1. Hero banner with course image, title, badge / status pills, edit
//      and back buttons.
//   2. Quick-stat strip (Batches · Enrolled students · Projected MRR).
//   3. Overview card (description, curriculum bullets, intro video link).
//   4. Class details (mode, level, age group, language, days/time,
//      batch size).
//   5. Pricing (monthly fee + admission fee + projected monthly revenue).
//   6. Batches running under this course (with trainer + schedule +
//      enrolled count). Tap to drill into that batch.
//   7. Enrolled students roster (across all batches) with payment-status
//      pills and a filter (All / Paid / Pending / Failed).
//   8. Trainer + branch + perks (belt system / certificate available).
//   9. Footer actions — Edit course / Delete course.
//
// Data:
//   GET /api/courses/:id            single course
//   GET /api/batches/course/:id     batches with trainer + enrolled count
//   GET /api/enrollments/course/:id full roster across all batches

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Image,
  StyleSheet, Alert, RefreshControl, Linking,
} from 'react-native';
import {
  ArrowLeft, Pencil, Trash2, Play, Users, BookOpen, Wallet,
  Calendar, Clock, Globe2, MapPin, GraduationCap, Award, Layers,
  CheckCircle2, AlertCircle, XCircle, ChevronRight, Mail, Phone,
  CircleDot, Tag, Star, ListChecks,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
import { billingCycleLabel } from '../../utils/billingCycle';
import CourseImage from '../../components/CourseImage';
import { formatBatchTime } from '../../utils/formatTime';

// ─── Asset host helper ─────────────────────────────────────────────────
const ASSET_HOST = (apiClient.defaults.baseURL || '').replace(/\/api\/?$/, '');
function resolveAssetUrl(src) {
  if (!src) return null;
  if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) return src;
  if (src.startsWith('/uploads/')) return ASSET_HOST + src;
  return src;
}

// ─── Static lookups ────────────────────────────────────────────────────
const MODE_LABEL = { online: 'Online', offline: 'Offline', hybrid: 'Hybrid' };
const BADGE_STYLE = {
  popular:      { label: 'Popular',      bg: palette.purple.vivid },
  new:          { label: 'New',          bg: palette.green.vivid  },
  kids_special: { label: 'Kids Special', bg: palette.orange.vivid },
};
const STATUS_STYLE = {
  active:   { label: 'Active',   bg: palette.green.soft,  fg: palette.green.on,  dot: palette.green.vivid  },
  draft:    { label: 'Draft',    bg: palette.orange.soft, fg: palette.orange.on, dot: palette.orange.vivid },
  inactive: { label: 'Inactive', bg: palette.rose.soft,   fg: palette.rose.on,   dot: palette.rose.vivid   },
};
const PAY_STYLE = {
  paid:    { label: 'Paid',    bg: palette.green.soft,  fg: palette.green.on,  icon: CheckCircle2 },
  pending: { label: 'Pending', bg: palette.orange.soft, fg: palette.orange.on, icon: AlertCircle  },
  failed:  { label: 'Failed',  bg: palette.rose.soft,   fg: palette.rose.on,   icon: XCircle      },
};

const PAY_FILTERS = ['all', 'paid', 'pending', 'failed'];

function fmtINR(n) {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString('en-IN')}`;
}
function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function parseCurriculum(c) {
  if (!c) return [];
  if (Array.isArray(c)) return c;
  try {
    const parsed = JSON.parse(c);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Fallback: treat as newline-delimited
    return String(c).split('\n').map((s) => s.trim()).filter(Boolean);
  }
}

export default function AdminCourseDetailScreen({ route, navigation }) {
  const courseId = route?.params?.courseId;
  // When true, hide every edit / delete affordance. Passed from
  // CoursesListScreen when the caller is a sub-branch admin — the
  // course catalog is owned by the main institution and shouldn't
  // be mutated from a branch login.
  const readOnly = !!route?.params?.readOnly;

  const [course, setCourse] = useState(null);
  const [batches, setBatches] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [payFilter, setPayFilter] = useState('all');

  const load = useCallback(async () => {
    if (!courseId) {
      setLoading(false);
      return;
    }
    try {
      const [courseRes, batchRes, enrollRes] = await Promise.all([
        apiClient.get(`/courses/${courseId}`).catch(() => ({ data: { course: null } })),
        apiClient.get(`/batches/course/${courseId}`).catch(() => ({ data: { batches: [] } })),
        apiClient.get(`/enrollments/course/${courseId}`).catch(() => ({ data: { enrollments: [] } })),
      ]);
      setCourse(courseRes.data?.course || null);
      setBatches(batchRes.data?.batches || []);
      setEnrollments(enrollRes.data?.enrollments || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [courseId]);

  useEffect(() => { load(); }, [load]);

  // ── Derived numbers ──
  const totals = useMemo(() => {
    const paid = enrollments.filter((e) => e.payment_status === 'paid').length;
    const pending = enrollments.filter((e) => e.payment_status === 'pending').length;
    const failed = enrollments.filter((e) => e.payment_status === 'failed').length;
    const monthlyFee = Number(course?.price) || 0;
    const projectedMRR = paid * monthlyFee;
    return { paid, pending, failed, total: enrollments.length, monthlyFee, projectedMRR };
  }, [enrollments, course]);

  const filteredEnrollments = useMemo(() => {
    if (payFilter === 'all') return enrollments;
    return enrollments.filter((e) => (e.payment_status || 'pending') === payFilter);
  }, [enrollments, payFilter]);

  const handleEdit = () => {
    navigation.navigate('CreateCourse', { courseId: course.id, course });
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete course?',
      `"${course.name}" will be removed. Existing enrollments and batches will lose this course association. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.delete(`/courses/${course.id}`);
              navigation.goBack();
            } catch (err) {
              Alert.alert('Error', err.response?.data?.message || 'Delete failed');
            }
          },
        },
      ],
    );
  };

  // ── Loading / empty ──
  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={palette.purple.vivid} />
      </View>
    );
  }
  if (!course) {
    return (
      <View style={[styles.screen, styles.center, { padding: spacing.xl }]}>
        <Text style={styles.emptyText}>Course not found or you don't have access.</Text>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={[styles.btn, styles.btnGhost, { marginTop: spacing.md, width: 180 }]}
        >
          <Text style={styles.btnGhostText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const banner = resolveAssetUrl(course.image_url);
  const status = STATUS_STYLE[course.status] || STATUS_STYLE.active;
  const badge = course.badge ? BADGE_STYLE[course.badge] : null;
  const curriculum = parseCurriculum(course.curriculum);

  return (
    <View style={styles.screen}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={palette.purple.vivid}
          />
        }
      >
        {/* ───── Hero ───── */}
        <View style={styles.hero}>
          {/* Course cover — contain-fit inside the fixed 220dp band so
              the full poster shows without cropping. Neutral bg fills
              any letterboxing when the source is not exactly the
              hero's aspect ratio. */}
          <CourseImage
            uri={course.image_url}
            width="100%"
            height={220}
            radius={0}
            fit="contain"
            icon="course"
          />
          <View style={styles.heroOverlay} />

          {/* Top bar — back + edit */}
          <View style={styles.heroTopBar}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.heroIconBtn}
              activeOpacity={0.85}
            >
              <ArrowLeft size={20} color="#fff" strokeWidth={2.4} />
            </TouchableOpacity>
            {/* Edit pencil is hidden for sub-branch admins (readOnly) —
                the course catalog is owned by the main institution. */}
            {readOnly ? (
              <View style={{ width: 40 }} />
            ) : (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  onPress={handleEdit}
                  style={styles.heroIconBtn}
                  activeOpacity={0.85}
                >
                  <Pencil size={18} color="#fff" strokeWidth={2.4} />
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Badge + status floating on banner */}
          <View style={styles.heroPillRow}>
            {badge ? (
              <View style={[styles.heroBadge, { backgroundColor: badge.bg }]}>
                <Star size={11} color="#fff" strokeWidth={2.6} />
                <Text style={styles.heroBadgeText}>{badge.label}</Text>
              </View>
            ) : null}
            <View style={[styles.heroStatusPill, { backgroundColor: 'rgba(255,255,255,0.95)' }]}>
              <View style={[styles.statusDot, { backgroundColor: status.dot }]} />
              <Text style={[styles.heroStatusText, { color: status.fg }]}>{status.label}</Text>
            </View>
          </View>
        </View>

        {/* ───── Title + meta ───── */}
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{course.name}</Text>
          {course.short_description ? (
            <Text style={styles.subtitle}>{course.short_description}</Text>
          ) : null}
          <View style={styles.metaRow}>
            {course.category ? (
              <View style={styles.metaPill}>
                <Tag size={11} color={palette.purple.vivid} strokeWidth={2.4} />
                <Text style={styles.metaPillText}>{course.category}</Text>
              </View>
            ) : null}
            <View style={styles.metaPill}>
              <Layers size={11} color={palette.purple.vivid} strokeWidth={2.4} />
              <Text style={styles.metaPillText}>{MODE_LABEL[course.mode] || course.mode || 'Offline'}</Text>
            </View>
            {course.level ? (
              <View style={styles.metaPill}>
                <Award size={11} color={palette.purple.vivid} strokeWidth={2.4} />
                <Text style={styles.metaPillText}>{course.level}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* ───── Stat strip ───── */}
        <View style={styles.statStrip}>
          <StatTile
            icon={Layers}
            label="Batches"
            value={batches.length}
            accent={palette.blue}
          />
          <StatTile
            icon={Users}
            label="Enrolled"
            value={totals.total}
            accent={palette.green}
          />
          <StatTile
            icon={Wallet}
            label="Monthly"
            value={fmtINR(totals.projectedMRR)}
            accent={palette.orange}
          />
        </View>

        {/* ───── Overview ───── */}
        {(course.description || course.intro_video_url || curriculum.length > 0) && (
          <Section title="Overview" icon={BookOpen}>
            {course.description ? (
              <Text style={styles.body}>{course.description}</Text>
            ) : null}

            {course.intro_video_url ? (
              <TouchableOpacity
                style={styles.videoBtn}
                onPress={() => Linking.openURL(course.intro_video_url)}
                activeOpacity={0.85}
              >
                <View style={styles.videoIcon}>
                  <Play size={14} color="#fff" strokeWidth={2.4} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.videoTitle}>Watch intro video</Text>
                  <Text style={styles.videoUrl} numberOfLines={1}>{course.intro_video_url}</Text>
                </View>
                <ChevronRight size={16} color={palette.textLight} strokeWidth={2.2} />
              </TouchableOpacity>
            ) : null}

            {curriculum.length > 0 ? (
              <View style={{ marginTop: spacing.md }}>
                <View style={styles.subhead}>
                  <ListChecks size={12} color={palette.textMuted} strokeWidth={2.4} />
                  <Text style={styles.subheadText}>Curriculum</Text>
                </View>
                <View style={{ gap: 6, marginTop: 6 }}>
                  {curriculum.map((item, i) => (
                    <View key={i} style={styles.curriculumRow}>
                      <View style={styles.curriculumDot}>
                        <Text style={styles.curriculumDotText}>{i + 1}</Text>
                      </View>
                      <Text style={styles.curriculumText}>
                        {typeof item === 'string' ? item : (item?.title || item?.name || JSON.stringify(item))}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </Section>
        )}

        {/* ───── Course Details ───── */}
        <Section title="Course Details" icon={Calendar}>
          <View style={styles.kvGrid}>
            <KV label="Duration"  value={course.duration_months ? `${course.duration_months} month${course.duration_months === 1 ? '' : 's'}` : '—'} />
            <KV label="Mode"      value={MODE_LABEL[course.mode] || course.mode || '—'} />
            <KV label="Level"     value={course.level || '—'} />
            <KV label="Age group" value={course.min_age != null && course.max_age != null ? `${course.min_age} – ${course.max_age} yrs` : (course.age_group || '—')} />
            <KV label="Language"  value={course.language || '—'} />
          </View>

          {(course.belt_system || course.certificate_available) ? (
            <View style={[styles.chipRow, { marginTop: spacing.md }]}>
              {course.belt_system ? (
                <View style={styles.perkChip}>
                  <Award size={11} color={palette.purple.on} strokeWidth={2.4} />
                  <Text style={styles.perkChipText}>Belt system</Text>
                </View>
              ) : null}
              {course.certificate_available ? (
                <View style={styles.perkChip}>
                  <Award size={11} color={palette.purple.on} strokeWidth={2.4} />
                  <Text style={styles.perkChipText}>Certificate</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </Section>

        {/* ───── Pricing ───── */}
        <Section title="Pricing" icon={Wallet}>
          <View style={styles.priceCard}>
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>{billingCycleLabel(course.billing_cycle)}</Text>
              <Text style={styles.priceValue}>{fmtINR(totals.monthlyFee)}</Text>
            </View>
            {Number(course.admission_fee) > 0 ? (
              <View style={[styles.priceRow, { marginTop: 6 }]}>
                <Text style={styles.priceLabel}>One-time admission</Text>
                <Text style={styles.priceValue}>{fmtINR(course.admission_fee)}</Text>
              </View>
            ) : null}
            {Array.isArray(course.additional_fees) && course.additional_fees.length > 0 ? (
              course.additional_fees.map((fee, idx) => {
                if (!fee || !fee.amount || Number(fee.amount) <= 0) return null;
                const feeTitle = fee.title || fee.custom_title || fee.type || 'Fee';
                if (fee.type === 'Admission Fee' && Number(course.admission_fee) > 0) return null;
                return (
                  <View key={idx} style={[styles.priceRow, { marginTop: 6 }]}>
                    <Text style={styles.priceLabel}>{feeTitle}</Text>
                    <Text style={styles.priceValue}>{fmtINR(fee.amount)}</Text>
                  </View>
                );
              })
            ) : null}
            <View style={styles.priceDivider} />
            <View style={styles.priceRow}>
              <Text style={styles.priceLabelStrong}>Projected MRR</Text>
              <Text style={styles.priceValueStrong}>{fmtINR(totals.projectedMRR)}</Text>
            </View>
            <Text style={styles.priceFootnote}>
              Based on {totals.paid} paid enrollment{totals.paid === 1 ? '' : 's'} at {fmtINR(totals.monthlyFee)}/month.
            </Text>
          </View>
        </Section>

        {/* ───── Trainer + branch ───── */}
        {(course.trainer_name || course.branch_name) ? (
          <Section title="Trainer & Branch" icon={GraduationCap}>
            <View style={styles.kvGrid}>
              <KV label="Lead trainer" value={course.trainer_name || '—'} />
              <KV label="Branch"        value={course.branch_name  || '—'} />
            </View>
          </Section>
        ) : null}

        {/* ───── Batches ───── */}
        <Section
          title="Batches"
          icon={Layers}
          subtitle={`${batches.length} ${batches.length === 1 ? 'batch' : 'batches'}`}
        >
          {batches.length === 0 ? (
            <Text style={styles.placeholderText}>
              {readOnly
                ? 'No batches under this course yet.'
                : 'No batches yet. Tap "Edit" then add a batch to start enrolling students.'}
            </Text>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {batches.map((b) => (
                <TouchableOpacity
                  key={b.id}
                  style={styles.batchRow}
                  activeOpacity={0.85}
                  onPress={() => navigation.navigate('BatchesList')}
                >
                  <View style={styles.batchIcon}>
                    <Layers size={16} color={palette.purple.vivid} strokeWidth={2.4} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.batchName} numberOfLines={1}>{b.name}</Text>
                    <View style={styles.batchMeta}>
                      {b.days_of_week ? <Text style={styles.batchMetaText}>{b.days_of_week}</Text> : null}
                      {b.start_time ? (
                        <Text style={styles.batchMetaText}>
                          {b.days_of_week ? ' · ' : ''}
                          {formatBatchTime(b.start_time)}
                          {b.end_time ? ` – ${formatBatchTime(b.end_time)}` : ''}
                        </Text>
                      ) : null}
                    </View>
                    <View style={[styles.batchMeta, { marginTop: 2 }]}>
                      {b.trainer_name ? (
                        <Text style={styles.batchMetaText}>
                          <GraduationCap size={10} color={palette.textMuted} /> {b.trainer_name}
                        </Text>
                      ) : (
                        <Text style={[styles.batchMetaText, { color: palette.orange.on }]}>Trainer not assigned</Text>
                      )}
                    </View>
                  </View>
                  <View style={styles.batchCountBubble}>
                    <Text style={styles.batchCountText}>{b.enrolled_count || 0}</Text>
                    <Text style={styles.batchCountLabel}>
                      / {b.capacity || '—'}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </Section>

        {/* ───── Enrolled students ───── */}
        <Section
          title="Enrolled Students"
          icon={Users}
          subtitle={`${enrollments.length} ${enrollments.length === 1 ? 'student' : 'students'}`}
        >
          {/* Filter chips */}
          <View style={[styles.chipRow, { marginBottom: spacing.md }]}>
            {PAY_FILTERS.map((f) => {
              const on = payFilter === f;
              const count = f === 'all'
                ? enrollments.length
                : enrollments.filter((e) => (e.payment_status || 'pending') === f).length;
              return (
                <TouchableOpacity
                  key={f}
                  style={[styles.filterChip, on && styles.filterChipOn]}
                  onPress={() => setPayFilter(f)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.filterChipText, on && styles.filterChipTextOn]}>
                    {f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}
                    <Text style={{ fontWeight: '600' }}> · {count}</Text>
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {filteredEnrollments.length === 0 ? (
            <Text style={styles.placeholderText}>
              {enrollments.length === 0
                ? 'No students enrolled yet.'
                : `No ${payFilter} enrollments.`}
            </Text>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {filteredEnrollments.map((e) => {
                const pay = PAY_STYLE[e.payment_status] || PAY_STYLE.pending;
                const PayIcon = pay.icon;
                const initials = (e.student_name || '?')
                  .split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
                return (
                  <TouchableOpacity
                    key={e.enrollment_id}
                    style={styles.studentRow}
                    activeOpacity={0.85}
                    onPress={() => navigation.navigate('StudentDetail', { studentId: e.student_id })}
                  >
                    <View style={styles.studentAvatar}>
                      <Text style={styles.studentInitials}>{initials}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.studentName} numberOfLines={1}>{e.student_name}</Text>
                      <View style={styles.studentMeta}>
                        {e.batch_name ? (
                          <Text style={styles.studentMetaText} numberOfLines={1}>
                            {e.batch_name}
                          </Text>
                        ) : null}
                        <Text style={styles.studentMetaText}>· {fmtDate(e.enrolled_at)}</Text>
                      </View>
                      <View style={[styles.studentMeta, { marginTop: 2 }]}>
                        {e.student_email ? (
                          <Text style={[styles.studentMetaText, { color: palette.textMuted }]} numberOfLines={1}>
                            {e.student_email}
                          </Text>
                        ) : null}
                        {e.student_phone ? (
                          <Text style={[styles.studentMetaText, { color: palette.textMuted }]}>
                            {e.student_email ? ' · ' : ''}{e.student_phone}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    <View style={[styles.payPill, { backgroundColor: pay.bg }]}>
                      <PayIcon size={11} color={pay.fg} strokeWidth={2.4} />
                      <Text style={[styles.payPillText, { color: pay.fg }]}>{pay.label}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </Section>

        {/* ───── Lifecycle ───── */}
        <Section title="Lifecycle" icon={CircleDot}>
          <View style={styles.kvGrid}>
            <KV label="Created"      value={fmtDate(course.created_at)} />
            <KV label="Last updated" value={fmtDate(course.updated_at || course.created_at)} />
            <KV label="Course ID"    value={`#${course.id}`} />
            <KV label="Institution"  value={course.institution_name || '—'} />
          </View>
        </Section>

        {/* ───── Footer actions ───── */}
        {/* Hidden entirely for sub-branch admins (readOnly). Their view
            of a course is informational only — the catalog lives at
            the main institution. */}
        {readOnly ? null : (
          <View style={styles.footerActions}>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary]}
              onPress={handleEdit}
              activeOpacity={0.85}
            >
              <Pencil size={16} color="#fff" strokeWidth={2.4} />
              <Text style={styles.btnPrimaryText}>Edit Course</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnDanger]}
              onPress={handleDelete}
              activeOpacity={0.85}
            >
              <Trash2 size={16} color={palette.rose.on} strokeWidth={2.4} />
              <Text style={styles.btnDangerText}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────
function Section({ title, icon: Icon, subtitle, children }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionIcon}>
          <Icon size={14} color={palette.purple.vivid} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
        </View>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function StatTile({ icon: Icon, label, value, accent }) {
  return (
    <View style={styles.statTile}>
      <View style={[styles.statIcon, { backgroundColor: accent.soft }]}>
        <Icon size={14} color={accent.vivid} strokeWidth={2.4} />
      </View>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function KV({ label, value }) {
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={styles.kvValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { ...type.body, color: palette.textMuted, textAlign: 'center' },

  // Hero
  hero: { position: 'relative' },
  heroImage: { width: '100%', height: 220 },
  heroPlaceholder: {
    backgroundColor: palette.purple.vivid,
    alignItems: 'center', justifyContent: 'center',
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  heroTopBar: {
    position: 'absolute',
    top: 44, left: spacing.lg, right: spacing.lg,
    flexDirection: 'row', justifyContent: 'space-between',
  },
  heroIconBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroPillRow: {
    position: 'absolute',
    bottom: spacing.md, left: spacing.lg,
    flexDirection: 'row', gap: 6,
  },
  heroBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
  },
  heroBadgeText: { ...type.micro, color: '#fff', fontWeight: '800', letterSpacing: 0.4 },
  heroStatusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  heroStatusText: { ...type.micro, fontWeight: '800', letterSpacing: 0.4 },

  // Title + meta
  titleBlock: {
    paddingHorizontal: spacing.xl, paddingTop: spacing.lg,
  },
  title: { ...type.display, color: palette.text, fontSize: 22 },
  subtitle: { ...type.body, color: palette.textMuted, marginTop: 4 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  metaPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.purple.soft,
  },
  metaPillText: { ...type.micro, color: palette.purple.on, fontWeight: '700' },

  // Stat strip
  statStrip: {
    flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: spacing.xl, marginTop: spacing.lg,
  },
  statTile: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.sm + 2,
    ...shadows.card,
  },
  statIcon: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 6,
  },
  statValue: { ...type.bodyBold, color: palette.text, fontSize: 14 },
  statLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700', marginTop: 1 },

  // Section
  section: {
    marginTop: spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionIcon: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: { ...type.h2, color: palette.text },
  sectionSub: { ...type.micro, color: palette.textMuted, marginTop: 1, fontWeight: '700' },
  sectionBody: {
    marginHorizontal: spacing.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },

  body: { ...type.body, color: palette.text, lineHeight: 20 },
  subhead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  subheadText: { ...type.micro, color: palette.textMuted, fontWeight: '700', letterSpacing: 0.3 },
  placeholderText: { ...type.caption, color: palette.textMuted, fontStyle: 'italic' },

  // Video link
  videoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: palette.bg,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    marginTop: spacing.md,
  },
  videoIcon: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: palette.purple.vivid,
    alignItems: 'center', justifyContent: 'center',
  },
  videoTitle: { ...type.bodyBold, color: palette.text, fontSize: 13 },
  videoUrl: { ...type.micro, color: palette.purple.vivid, marginTop: 1 },

  // Curriculum
  curriculumRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  curriculumDot: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  curriculumDotText: { ...type.micro, color: palette.purple.on, fontWeight: '800' },
  curriculumText: { flex: 1, ...type.caption, color: palette.text, lineHeight: 18 },

  // Key-value grid
  kvGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  kvRow: { width: '50%', paddingVertical: 6, paddingRight: 8 },
  kvLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700', letterSpacing: 0.3 },
  kvValue: { ...type.caption, color: palette.text, fontWeight: '700', marginTop: 2 },

  // Pricing
  priceCard: {
    backgroundColor: palette.bg,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  priceLabel: { ...type.caption, color: palette.textMuted, fontWeight: '700' },
  priceValue: { ...type.bodyBold, color: palette.text },
  priceLabelStrong: { ...type.bodyBold, color: palette.text, fontWeight: '800' },
  priceValueStrong: { ...type.h2, color: palette.purple.vivid },
  priceDivider: { height: 1, backgroundColor: palette.borderSoft, marginVertical: spacing.sm },
  priceFootnote: { ...type.micro, color: palette.textMuted, marginTop: 6, fontStyle: 'italic' },

  // Chip rows
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  perkChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    backgroundColor: palette.purple.soft,
    borderRadius: radius.pill,
  },
  perkChipText: { ...type.micro, color: palette.purple.on, fontWeight: '700' },

  filterChip: {
    paddingHorizontal: spacing.sm + 2, paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.bg,
    borderWidth: 1, borderColor: palette.borderSoft,
  },
  filterChipOn: { backgroundColor: palette.purple.vivid, borderColor: palette.purple.vivid },
  filterChipText: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  filterChipTextOn: { color: '#fff', fontWeight: '800' },

  // Batches
  batchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: palette.bg,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
  },
  batchIcon: {
    width: 36, height: 36, borderRadius: radius.md,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  batchName: { ...type.bodyBold, color: palette.text, fontSize: 14 },
  batchMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 2 },
  batchMetaText: { ...type.micro, color: palette.textMuted, fontWeight: '600' },
  batchCountBubble: {
    minWidth: 56, alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.purple.vivid,
    paddingHorizontal: spacing.sm, paddingVertical: 6,
    borderRadius: radius.md,
  },
  batchCountText: { ...type.bodyBold, color: '#fff', fontSize: 14 },
  batchCountLabel: { ...type.micro, color: 'rgba(255,255,255,0.85)', fontWeight: '700' },

  // Students
  studentRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: palette.bg,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
  },
  studentAvatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  studentInitials: { ...type.bodyBold, color: palette.purple.on, fontSize: 13 },
  studentName: { ...type.bodyBold, color: palette.text, fontSize: 14 },
  studentMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 0 },
  studentMetaText: { ...type.micro, color: palette.text, fontWeight: '600' },
  payPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
  },
  payPillText: { ...type.micro, fontWeight: '800', letterSpacing: 0.3 },

  // Footer
  footerActions: {
    flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: spacing.xl, marginTop: spacing.xl,
  },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: radius.md,
    flex: 1,
  },
  btnPrimary: { backgroundColor: palette.purple.vivid, flex: 1.8 },
  btnPrimaryText: { ...type.bodyBold, color: '#fff', fontWeight: '800' },
  btnGhost: { backgroundColor: palette.bg },
  btnGhostText: { ...type.bodyBold, color: palette.textMuted, fontWeight: '700' },
  btnDanger: { backgroundColor: palette.rose.soft },
  btnDangerText: { ...type.bodyBold, color: palette.rose.on, fontWeight: '800' },
});
