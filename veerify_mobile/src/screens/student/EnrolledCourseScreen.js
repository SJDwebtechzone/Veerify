// src/screens/student/EnrolledCourseScreen.js
//
// Opened when a student taps a "My Courses" card on the MyDashboard.
// Shows everything they need about a course they've already paid for:
//
//   1. Banner hero with course title + paid badge
//   2. Course description + curriculum
//   3. Schedule card (days, time, trainer, batch name)
//   4. Payment receipt card (amount, reference, paid date, status)
//   5. Recorded Videos list (filtered to this batch)
//   6. Institution card
//
// Data:
//   GET /api/enrollments/my       (find this enrollment by id)
//   GET /api/courses/:id          (full course details)
//   GET /api/students/my-videos   (filter to this batch)

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image, ActivityIndicator,
  StyleSheet, Alert, Linking, RefreshControl,
} from 'react-native';
import {
  ArrowLeft, BookOpen, Calendar, Clock, GraduationCap, Building2,
  PlayCircle, CheckCircle2, Wallet, Receipt, User, FileText,
  ChevronRight, Award, ExternalLink, ListChecks,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { formatBatchTime } from '../../utils/formatTime';
import CourseImage from '../../components/CourseImage';

// ─── Theme tokens ──────────────────────────────────────────────────────
const BRAND = '#E63946';
const BRAND_SOFT = '#FFE4E6';
const TEXT = '#111827';
const TEXT_MUTED = '#6B7280';
const TEXT_LIGHT = '#9CA3AF';
const SURFACE = '#FFFFFF';
const BG = '#F4F4F8';
const BORDER = '#E5E7EB';
const GREEN = '#10B981';

const ASSET_HOST = (apiClient.defaults.baseURL || '').replace(/\/api\/?$/, '');
function resolveAssetUrl(src) {
  if (!src) return null;
  if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) return src;
  if (src.startsWith('/uploads/')) return ASSET_HOST + src;
  return src;
}

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
// Delegate to the shared 12-hour formatter — batch/course timings
// now read as "6:00 AM" instead of "06:00" here as well as everywhere
// else the student can view a schedule.
const fmtTime = formatBatchTime;
function fmtDuration(seconds) {
  if (!seconds) return null;
  const s = Number(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
function parseCurriculum(c) {
  if (!c) return [];
  if (Array.isArray(c)) return c;
  try {
    const parsed = JSON.parse(c);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(c).split('\n').map((s) => s.trim()).filter(Boolean);
  }
}

export default function EnrolledCourseScreen({ route, navigation }) {
  const { enrollmentId } = route?.params || {};
  const [enrollment, setEnrollment] = useState(null);
  const [course, setCourse] = useState(null);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!enrollmentId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      // Find the enrollment in the my-enrollments list. We don't have a
      // dedicated single-enrollment endpoint, but the list is short so
      // this is fine.
      const enrolls = await apiClient.get('/enrollments/my').catch(() => ({ data: { enrollments: [] } }));
      const found = (enrolls.data?.enrollments || []).find((e) => e.id === enrollmentId);
      setEnrollment(found || null);

      if (found?.course_id) {
        const c = await apiClient.get(`/courses/${found.course_id}`).catch(() => ({ data: { course: null } }));
        setCourse(c.data?.course || null);
      }

      const v = await apiClient.get('/students/my-videos').catch(() => ({ data: { videos: [] } }));
      const allVideos = v.data?.videos || [];
      // Filter to this batch only
      setVideos(allVideos.filter((video) => video.batch_id === found?.batch_id));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [enrollmentId]);

  useEffect(() => { load(); }, [load]);

  const curriculum = useMemo(() => parseCurriculum(course?.curriculum), [course?.curriculum]);

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={BRAND} />
      </View>
    );
  }

  if (!enrollment) {
    return (
      <View style={[styles.screen, styles.center, { padding: 24 }]}>
        <Text style={styles.emptyText}>Enrollment not found.</Text>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={[styles.btn, styles.btnGhost, { marginTop: 12 }]}
        >
          <Text style={styles.btnGhostText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const banner = resolveAssetUrl(course?.image_url || enrollment.course_image_url);
  const courseName = course?.name || enrollment.course_name || 'Course';
  const paid = enrollment.payment_status === 'paid';

  // Access gate — if the enrolment isn't paid, refuse to show the
  // course content. Render a locked-state card that routes the
  // student to the payment screen. Belt-and-braces: the Enrolled
  // Programs list already hides non-paid rows, so this only ever
  // fires on a stale deep link or an in-flight state change.
  if (!paid) {
    const amount = Number(enrollment.payment_amount) || Number(enrollment.course_price) || 0;
    return (
      <View style={[styles.screen, styles.center, { padding: 24 }]}>
        <BookOpen size={44} color={BRAND} strokeWidth={2} />
        <Text style={[styles.emptyText, { marginTop: 12, fontWeight: '800' }]}>
          Payment required to unlock
        </Text>
        <Text style={[styles.emptyText, { marginTop: 4, textAlign: 'center' }]}>
          Complete the Razorpay payment to activate {courseName} and access lessons.
        </Text>
        <TouchableOpacity
          onPress={() => {
            const payload = {
              enrollment: { id: enrollment.id, payment_amount: amount },
              batch: {
                id:              enrollment.batch_id,
                name:            enrollment.batch_name,
                course_id:       enrollment.course_id,
                course_name:     enrollment.course_name,
                course_price:    enrollment.course_price,
                institution_name:enrollment.institution_name,
                days_of_week:    enrollment.days_of_week,
                start_time:      enrollment.start_time,
                end_time:        enrollment.end_time,
              },
              course: {
                id:               enrollment.course_id,
                name:             enrollment.course_name,
                price:            enrollment.course_price,
                institution_name: enrollment.institution_name,
              },
              amount,
            };
            try { navigation.replace('EnrollmentPayment', payload); }
            catch (_) {
              try { navigation.navigate('EnrollmentPayment', payload); } catch (_) {}
            }
          }}
          style={[styles.btn, styles.btnPrimary, { marginTop: 20, paddingHorizontal: 24 }]}
        >
          <Text style={styles.btnPrimaryText}>Pay Now · ₹{amount.toLocaleString('en-IN')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={[styles.btn, styles.btnGhost, { marginTop: 8 }]}
        >
          <Text style={styles.btnGhostText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={BRAND}
          />
        }
      >
        {/* ───── Hero banner ───── */}
        <View style={styles.hero}>
          <CourseImage
            uri={course?.image_url || enrollment.course_image_url}
            width="100%"
            height={220}
            radius={0}
            fit="contain"
            icon="course"
          />
          <View style={styles.heroOverlay} />
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            activeOpacity={0.85}
          >
            <ArrowLeft size={20} color="#fff" strokeWidth={2.4} />
          </TouchableOpacity>

          <View style={styles.heroBottom}>
            {paid ? (
              <View style={styles.paidBadge}>
                <CheckCircle2 size={11} color="#fff" strokeWidth={2.6} />
                <Text style={styles.paidBadgeText}>PAID</Text>
              </View>
            ) : null}
            <Text style={styles.heroTitle} numberOfLines={2}>{courseName}</Text>
            {enrollment.institution_name ? (
              <View style={styles.heroMetaRow}>
                <Building2 size={11} color="rgba(255,255,255,0.85)" strokeWidth={2.2} />
                <Text style={styles.heroMetaText} numberOfLines={1}>{enrollment.institution_name}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* ───── Description ───── */}
        {course?.description ? (
          <Section title="About this course" icon={BookOpen}>
            <Text style={styles.body}>{course.description}</Text>
          </Section>
        ) : null}

        {/* ───── Curriculum ───── */}
        {curriculum.length > 0 ? (
          <Section title="Curriculum" icon={ListChecks}>
            <View style={{ gap: 8 }}>
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
          </Section>
        ) : null}

        {/* ───── Schedule ───── */}
        <Section title="Class Schedule" icon={Calendar}>
          <View style={styles.kvGrid}>
            <KV label="Batch" value={enrollment.batch_name} />
            <KV label="Days"  value={enrollment.days_of_week} />
            <KV
              label="Time"
              value={
                enrollment.start_time
                  ? `${fmtTime(enrollment.start_time)}${enrollment.end_time ? ' – ' + fmtTime(enrollment.end_time) : ''}`
                  : null
              }
            />
            <KV label="Mode" value={enrollment.mode ? enrollment.mode.charAt(0).toUpperCase() + enrollment.mode.slice(1) : null} />
            <KV label="Trainer" value={enrollment.trainer_name} />
          </View>
        </Section>

        {/* ───── Payment Receipt ───── */}
        <Section title="Payment Receipt" icon={Receipt}>
          <View style={styles.receiptCard}>
            <View style={styles.receiptTopRow}>
              <View>
                <Text style={styles.receiptLabel}>AMOUNT PAID</Text>
                <Text style={styles.receiptAmount}>
                  {fmtINR(enrollment.payment_amount || enrollment.course_price)}
                </Text>
              </View>
              <View style={[styles.receiptStatus, paid && styles.receiptStatusPaid]}>
                <Text style={[styles.receiptStatusText, paid && { color: '#fff' }]}>
                  {paid ? 'PAID' : (enrollment.payment_status || 'pending').toUpperCase()}
                </Text>
              </View>
            </View>

            <View style={styles.receiptDivider} />

            <ReceiptKV label="Reference"
              value={enrollment.payment_reference || '—'} mono />
            <ReceiptKV label="Paid on"
              value={fmtDate(enrollment.paid_at)} />
            <ReceiptKV label="Enrolled on"
              value={fmtDate(enrollment.enrolled_at)} />
          </View>
        </Section>

        {/* ───── Recorded Videos ───── */}
        <Section
          title="Recorded Videos"
          icon={PlayCircle}
          subtitle={videos.length > 0 ? `${videos.length} video${videos.length === 1 ? '' : 's'}` : null}
        >
          {videos.length === 0 ? (
            <Text style={styles.placeholderText}>
              Your trainer hasn't shared any videos for this batch yet. Check back later.
            </Text>
          ) : (
            <View style={{ gap: 10 }}>
              {videos.map((v) => (
                <VideoRow
                  key={v.id}
                  video={v}
                  onPress={() => {
                    if (v.video_url) {
                      Linking.openURL(v.video_url).catch(() =>
                        Alert.alert('Cannot open video', 'Please check the link or contact support.'),
                      );
                    }
                  }}
                />
              ))}
            </View>
          )}
        </Section>
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
          <Icon size={14} color={BRAND} strokeWidth={2.4} />
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

function KV({ label, value }) {
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={styles.kvValue} numberOfLines={2}>{value || '—'}</Text>
    </View>
  );
}

function ReceiptKV({ label, value, mono }) {
  return (
    <View style={styles.receiptRow}>
      <Text style={styles.receiptRowLabel}>{label}</Text>
      <Text style={[styles.receiptRowValue, mono && { fontFamily: 'monospace' }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function VideoRow({ video, onPress }) {
  const thumb = resolveAssetUrl(video.thumbnail_url || video.course_image);
  const duration = fmtDuration(video.duration_seconds);

  return (
    <TouchableOpacity
      style={styles.videoRow}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.videoThumbWrap}>
        {thumb ? (
          <Image source={{ uri: thumb }} style={styles.videoThumb} />
        ) : (
          <View style={[styles.videoThumb, styles.videoThumbFallback]} />
        )}
        <View style={styles.playOverlay}>
          <PlayCircle size={26} color="#fff" strokeWidth={2.2} />
        </View>
      </View>

      <View style={styles.videoBody}>
        <Text style={styles.videoTitle} numberOfLines={2}>{video.title}</Text>
        {video.description ? (
          <Text style={styles.videoDesc} numberOfLines={2}>{video.description}</Text>
        ) : null}
        <View style={styles.videoMetaRow}>
          {duration ? (
            <Text style={styles.videoMetaText}>
              <Clock size={9} color={TEXT_LIGHT} /> {duration}
            </Text>
          ) : null}
          {video.uploaded_by_name ? (
            <Text style={styles.videoMetaText}>· {video.uploaded_by_name}</Text>
          ) : null}
        </View>
      </View>

      <ExternalLink size={14} color={TEXT_LIGHT} strokeWidth={2.2} />
    </TouchableOpacity>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  center: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 14, color: TEXT_MUTED, textAlign: 'center' },

  // Hero
  hero: { position: 'relative' },
  heroImage: { width: '100%', height: 220 },
  heroFallback: {
    backgroundColor: BRAND,
    alignItems: 'center', justifyContent: 'center',
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  backBtn: {
    position: 'absolute',
    top: 44, left: 16,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroBottom: {
    position: 'absolute',
    bottom: 16, left: 16, right: 16,
  },
  paidBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: GREEN,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 8,
  },
  paidBadgeText: { fontSize: 9, color: '#fff', fontWeight: '900', letterSpacing: 0.6 },
  heroTitle: { fontSize: 22, color: '#fff', fontWeight: '800', lineHeight: 28 },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  heroMetaText: { fontSize: 12, color: 'rgba(255,255,255,0.9)', fontWeight: '700' },

  // Section
  section: { marginTop: 20 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionIcon: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: { fontSize: 15, color: TEXT, fontWeight: '800' },
  sectionSub: { fontSize: 11, color: TEXT_MUTED, marginTop: 1, fontWeight: '700' },
  sectionBody: {
    marginHorizontal: 16,
    backgroundColor: SURFACE,
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },

  body: { fontSize: 13, color: TEXT, lineHeight: 20 },
  placeholderText: { fontSize: 12, color: TEXT_MUTED, fontStyle: 'italic', lineHeight: 17 },

  // KV grid (schedule)
  kvGrid: { gap: 10 },
  kvRow: { flexDirection: 'row', alignItems: 'center' },
  kvLabel: { width: 100, fontSize: 11, color: TEXT_MUTED, fontWeight: '800', letterSpacing: 0.4 },
  kvValue: { flex: 1, fontSize: 13, color: TEXT, fontWeight: '700' },

  // Curriculum
  curriculumRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  curriculumDot: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  curriculumDotText: { fontSize: 10, color: BRAND, fontWeight: '800' },
  curriculumText: { flex: 1, fontSize: 13, color: TEXT, lineHeight: 19 },

  // Receipt
  receiptCard: {
    backgroundColor: BG,
    borderRadius: 12,
    padding: 14,
  },
  receiptTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  receiptLabel: { fontSize: 10, color: TEXT_MUTED, fontWeight: '800', letterSpacing: 0.6 },
  receiptAmount: { fontSize: 26, color: TEXT, fontWeight: '900', marginTop: 2 },
  receiptStatus: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: BORDER,
  },
  receiptStatusPaid: { backgroundColor: GREEN },
  receiptStatusText: { fontSize: 10, color: TEXT_MUTED, fontWeight: '900', letterSpacing: 0.6 },
  receiptDivider: { height: 1, backgroundColor: BORDER, marginVertical: 12 },
  receiptRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 4,
  },
  receiptRowLabel: { fontSize: 11, color: TEXT_MUTED, fontWeight: '700', letterSpacing: 0.3 },
  receiptRowValue: { fontSize: 12, color: TEXT, fontWeight: '700', maxWidth: 200, textAlign: 'right' },

  // Video row
  videoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 10,
    backgroundColor: BG,
    borderRadius: 12,
  },
  videoThumbWrap: { position: 'relative' },
  videoThumb: { width: 80, height: 60, borderRadius: 8, backgroundColor: '#1F2937' },
  videoThumbFallback: { backgroundColor: '#1F2937' },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 8,
  },
  videoBody: { flex: 1, gap: 2 },
  videoTitle: { fontSize: 13, color: TEXT, fontWeight: '800' },
  videoDesc: { fontSize: 11, color: TEXT_MUTED, fontWeight: '600' },
  videoMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  videoMetaText: { fontSize: 10, color: TEXT_LIGHT, fontWeight: '700' },

  // Buttons
  btn: {
    paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: 10,
  },
  btnGhost: { backgroundColor: BG },
  btnGhostText: { fontSize: 13, color: TEXT_MUTED, fontWeight: '700' },
  btnPrimary: {
    backgroundColor: BRAND,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6,
  },
  btnPrimaryText: { fontSize: 13, color: '#fff', fontWeight: '800' },
});
