// src/screens/student/MyDashboard.js
//
// Personalized home tab for students who have at least one paid enrollment.
// Replaces the "browse institutions" view that HomeTabScreen used to render
// for everyone.
//
// Sections (top to bottom):
//   1. Welcome hero - brand-red panel with greeting + course count
//   2. Quick stats strip - paid courses / total enrollments / videos count
//   3. My Courses - vertical list of paid-enrolled course cards. Tap a card
//      to open EnrolledCourseScreen with payment receipt + videos.
//   4. Recorded Videos - horizontal carousel of latest videos shared by
//      trainers across all enrolled batches.
//
// Data:
//   GET /api/enrollments/my     (already exists)
//   GET /api/students/my-videos (added in this round)

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image, ActivityIndicator,
  StyleSheet, RefreshControl, Linking, Dimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Bell, BookOpen, PlayCircle, Calendar, Clock, GraduationCap, Award,
  ChevronRight, Wallet, CheckCircle2, Video, Building2, User,
  CalendarDays, Target,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const VIDEO_CARD_WIDTH = Math.round(SCREEN_WIDTH * 0.65);

// ─── Theme tokens (kept local so the screen renders without the global theme) ───
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

function fmtTime(t) {
  if (!t) return '';
  return String(t).slice(0, 5);
}

function fmtDuration(seconds) {
  if (!seconds) return null;
  const s = Number(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function MyDashboard({ navigation }) {
  const { user } = useAuth();
  const [enrollments, setEnrollments] = useState([]);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Profile photo + display name for the hero avatar. We pull this in
  // parallel with the rest of the dashboard so the avatar paints with
  // the first paint instead of swapping in late.
  const [me, setMe] = useState(null);

  // Per-course progress lookup, keyed by course_id. Each entry shape:
  //   { lessons: [...all curriculum lessons], completed: [...only the
  //     ones with a row in student_curriculum_progress] }
  // We only render the `completed` slice on the home screen — the user
  // wants the dashboard to surface what the student has finished, not
  // the open todo list.
  const [progressByCourse, setProgressByCourse] = useState({});

  const load = useCallback(async () => {
    try {
      const [enrRes, vidRes, meRes] = await Promise.all([
        apiClient.get('/enrollments/my').catch(() => ({ data: { enrollments: [] } })),
        apiClient.get('/students/my-videos').catch(() => ({ data: { videos: [] } })),
        apiClient.get('/students/me').catch(() => ({ data: { student: null } })),
      ]);
      const enrs = enrRes.data?.enrollments || [];
      setEnrollments(enrs);
      setVideos(vidRes.data?.videos || []);
      setMe(meRes.data?.student || null);

      // Fan out one curriculum-progress fetch per unique paid course.
      // Errors fall through silently (e.g. a course with no curriculum
      // yet) — the section just won't render that course's tile.
      const paid = enrs.filter((e) => e.payment_status === 'paid' && e.course_id);
      const uniqCourseIds = [...new Set(paid.map((e) => e.course_id))];
      const progRes = await Promise.all(
        uniqCourseIds.map((cid) =>
          apiClient
            .get(`/curriculum-progress?student_id=${user?.id}&course_id=${cid}`)
            .then((r) => ({ cid, data: r.data }))
            .catch(() => ({ cid, data: null })),
        ),
      );
      const map = {};
      progRes.forEach(({ cid, data }) => {
        if (!data) return;
        const lessons = Array.isArray(data.lessons) ? data.lessons : [];
        const progress = Array.isArray(data.progress) ? data.progress : [];
        // Build the "only completed" slice — lessons that have a
        // matching progress row, hydrated with the completion date.
        const completedByIdx = {};
        progress.forEach((p) => { completedByIdx[p.lesson_index] = p; });
        const completed = lessons
          .map((lesson, idx) => completedByIdx[idx] ? { ...lesson, idx, ...completedByIdx[idx] } : null)
          .filter(Boolean);
        map[cid] = { lessons, completed };
      });
      setProgressByCourse(map);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  // ── Derived ──
  const paidEnrollments = useMemo(
    () => enrollments.filter((e) => e.payment_status === 'paid'),
    [enrollments],
  );

  const stats = useMemo(() => ({
    courses: paidEnrollments.length,
    totalEnrollments: enrollments.length,
    videos: videos.length,
  }), [paidEnrollments.length, enrollments.length, videos.length]);

  const firstName = (user?.name || 'Student').split(' ')[0];
  const fullName  = me?.profile_full_name || me?.name || user?.name || 'Student';
  const photoUrl  = resolveAssetUrl(me?.photo_url);
  const initials  = (fullName || '?')
    .split(' ').map((w) => w[0]).filter(Boolean)
    .slice(0, 2).join('').toUpperCase() || '?';

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
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
          <View style={styles.heroTopRow}>
            <View style={styles.heroAvatar}>
              {photoUrl ? (
                <Image source={{ uri: photoUrl }} style={styles.heroAvatarImg} />
              ) : (
                <Text style={styles.heroAvatarInit}>{initials}</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroEyebrow}>WELCOME BACK</Text>
              <Text style={styles.heroName} numberOfLines={1}>{fullName}</Text>
            </View>
            <TouchableOpacity
              style={styles.bellBtn}
              onPress={() => navigation.navigate('StaffNotifications')}
              activeOpacity={0.85}
            >
              <Bell size={18} color="#fff" strokeWidth={2.4} />
            </TouchableOpacity>
          </View>

          <View style={styles.heroSummary}>
            <Text style={styles.heroSummaryText}>
              You're enrolled in {stats.courses} course{stats.courses === 1 ? '' : 's'}
              {stats.videos > 0 ? ` · ${stats.videos} new video${stats.videos === 1 ? '' : 's'}` : ''}
            </Text>
          </View>
        </View>

        {/* ───── Stat strip ───── */}
        <View style={styles.statStrip}>
          <Stat
            icon={BookOpen}
            label="Courses"
            value={stats.courses}
            accent={BRAND}
          />
          <Stat
            icon={Video}
            label="Videos"
            value={stats.videos}
            accent={GREEN}
          />
          <Stat
            icon={CheckCircle2}
            label="Paid"
            value={paidEnrollments.length}
            accent="#3B82F6"
          />
        </View>

        {/* ───── My Courses ───── */}
        <SectionHeader title="My Courses" subtitle="Tap any to see details" />

        {loading && paidEnrollments.length === 0 ? (
          <ActivityIndicator color={BRAND} style={{ marginVertical: 24 }} />
        ) : paidEnrollments.length === 0 ? (
          <View style={styles.emptyInline}>
            <BookOpen size={20} color={TEXT_LIGHT} strokeWidth={2} />
            <Text style={styles.emptyInlineText}>
              No paid courses yet. Complete payment to access full course content.
            </Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 16, gap: 12 }}>
            {paidEnrollments.map((e) => (
              <CourseCard
                key={e.id}
                enrollment={e}
                onPress={() => navigation.navigate('EnrolledCourse', { enrollmentId: e.id })}
              />
            ))}
          </View>
        )}

        {/* ───── Course Progress ─────
            For each paid enrollment whose course has any completed
            lessons, render a card listing only the completed items
            along with their dates and an overall progress %. */}
        {(() => {
          const cards = paidEnrollments
            .map((e) => {
              const p = progressByCourse[e.course_id];
              if (!p || p.completed.length === 0) return null;
              return { enrollment: e, progress: p };
            })
            .filter(Boolean);

          if (cards.length === 0) return null;
          return (
            <>
              <SectionHeader
                title="Course Progress"
                subtitle="Lessons your trainer has marked as completed"
              />
              <View style={{ paddingHorizontal: 16, gap: 12 }}>
                {cards.map(({ enrollment, progress }) => (
                  <CourseProgressCard
                    key={`prog-${enrollment.id}`}
                    enrollment={enrollment}
                    progress={progress}
                    onPress={() => navigation.navigate('EnrolledCourse', { enrollmentId: enrollment.id })}
                  />
                ))}
              </View>
            </>
          );
        })()}

        {/* ───── Recorded Videos ───── */}
        <SectionHeader title="Recorded Videos" subtitle="Shared by your trainers" />

        {videos.length === 0 ? (
          <View style={styles.emptyInline}>
            <Video size={20} color={TEXT_LIGHT} strokeWidth={2} />
            <Text style={styles.emptyInlineText}>
              Your trainer hasn't shared any videos yet. Check back later.
            </Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          >
            {videos.slice(0, 8).map((v) => (
              <VideoCard
                key={v.id}
                video={v}
                onPress={() => {
                  if (v.video_url) Linking.openURL(v.video_url).catch(() => {});
                }}
              />
            ))}
          </ScrollView>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────
function SectionHeader({ title, subtitle }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

function Stat({ icon: Icon, label, value, accent }) {
  return (
    <View style={styles.statTile}>
      <View style={[styles.statIconWrap, { backgroundColor: `${accent}15` }]}>
        <Icon size={16} color={accent} strokeWidth={2.4} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function CourseCard({ enrollment, onPress }) {
  const banner = resolveAssetUrl(enrollment.course_image_url || enrollment.image_url);
  const courseName = enrollment.course_name || 'Course';
  const batchName = enrollment.batch_name || '';
  const days = enrollment.days_of_week || '';
  const time = enrollment.start_time ? `${fmtTime(enrollment.start_time)}${enrollment.end_time ? ' - ' + fmtTime(enrollment.end_time) : ''}` : '';
  const trainer = enrollment.trainer_name || '';
  const institution = enrollment.institution_name || '';

  return (
    <TouchableOpacity
      style={styles.courseCard}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.courseBannerWrap}>
        {banner ? (
          <Image source={{ uri: banner }} style={styles.courseBanner} />
        ) : (
          <View style={[styles.courseBanner, styles.courseBannerFallback]}>
            <BookOpen size={28} color={BRAND} strokeWidth={2} />
          </View>
        )}
        <View style={styles.paidBadge}>
          <CheckCircle2 size={11} color="#fff" strokeWidth={2.6} />
          <Text style={styles.paidBadgeText}>PAID</Text>
        </View>
      </View>

      <View style={styles.courseBody}>
        <Text style={styles.courseName} numberOfLines={2}>{courseName}</Text>
        {institution ? (
          <View style={styles.metaRow}>
            <Building2 size={11} color={TEXT_MUTED} strokeWidth={2.2} />
            <Text style={styles.metaText} numberOfLines={1}>{institution}</Text>
          </View>
        ) : null}
        {batchName ? (
          <View style={styles.metaRow}>
            <GraduationCap size={11} color={TEXT_MUTED} strokeWidth={2.2} />
            <Text style={styles.metaText} numberOfLines={1}>{batchName}</Text>
          </View>
        ) : null}
        {(days || time) ? (
          <View style={styles.metaRow}>
            <Calendar size={11} color={TEXT_MUTED} strokeWidth={2.2} />
            <Text style={styles.metaText} numberOfLines={1}>
              {days}{days && time ? ' · ' : ''}{time}
            </Text>
          </View>
        ) : null}
        {trainer ? (
          <View style={styles.metaRow}>
            <User size={11} color={TEXT_MUTED} strokeWidth={2.2} />
            <Text style={styles.metaText} numberOfLines={1}>{trainer}</Text>
          </View>
        ) : null}
      </View>

      <ChevronRight size={16} color={TEXT_LIGHT} strokeWidth={2.2} style={{ alignSelf: 'center', marginRight: 12 }} />
    </TouchableOpacity>
  );
}

// Compact card listing only the lessons the trainer has ticked off for
// this student in this course. Shows a percentage ring + the dated
// list. Tapping opens the EnrolledCourseScreen for full course detail.
function CourseProgressCard({ enrollment, progress, onPress }) {
  const total = progress.lessons.length;
  const done  = progress.completed.length;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

  const fmt = (iso) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        day: 'numeric', month: 'short', year: 'numeric',
      });
    } catch { return ''; }
  };

  return (
    <TouchableOpacity
      style={styles.progressCard}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.progressHeader}>
        <View style={styles.progressIconWrap}>
          <Target size={16} color={BRAND} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.progressCourse} numberOfLines={1}>
            {enrollment.course_name || 'Course'}
          </Text>
          <Text style={styles.progressSummary}>
            {done} of {total} completed
          </Text>
        </View>
        <View style={styles.progressPctPill}>
          <Text style={styles.progressPctText}>{pct}%</Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={styles.progressBarTrack}>
        <View style={[styles.progressBarFill, { width: `${pct}%` }]} />
      </View>

      {/* Completed lesson list — chronological by completion date */}
      <View style={styles.progressList}>
        {progress.completed
          .slice()
          .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))
          .slice(0, 5)
          .map((lesson) => (
            <View key={`lesson-${lesson.idx}`} style={styles.progressItem}>
              <View style={styles.progressCheck}>
                <CheckCircle2 size={12} color={GREEN} strokeWidth={2.6} />
              </View>
              <Text style={styles.progressItemTitle} numberOfLines={1}>
                {lesson.title || `Lesson ${lesson.idx + 1}`}
              </Text>
              <View style={styles.progressDateChip}>
                <CalendarDays size={9} color={TEXT_MUTED} strokeWidth={2.4} />
                <Text style={styles.progressDateText}>{fmt(lesson.completed_at)}</Text>
              </View>
            </View>
          ))}
        {progress.completed.length > 5 ? (
          <Text style={styles.progressMore}>
            + {progress.completed.length - 5} more completed
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

function VideoCard({ video, onPress }) {
  const thumb = resolveAssetUrl(video.thumbnail_url || video.course_image);
  const duration = fmtDuration(video.duration_seconds);
  return (
    <TouchableOpacity
      style={styles.videoCard}
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
          <View style={styles.playCircle}>
            <PlayCircle size={32} color="#fff" strokeWidth={2.2} />
          </View>
        </View>
        {duration ? (
          <View style={styles.durationBadge}>
            <Clock size={9} color="#fff" strokeWidth={2.4} />
            <Text style={styles.durationText}>{duration}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.videoBody}>
        <Text style={styles.videoTitle} numberOfLines={2}>{video.title}</Text>
        <Text style={styles.videoCourse} numberOfLines={1}>{video.course_name}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  // Hero
  hero: {
    backgroundColor: BRAND,
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 24,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroEyebrow: { fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: '800', letterSpacing: 1.6 },
  heroName: { fontSize: 20, color: '#fff', fontWeight: '800', marginTop: 2 },

  // Circular avatar in the hero — shows the uploaded student photo when
  // present, otherwise renders the student's initials on a translucent
  // white circle that reads cleanly against the red hero background.
  heroAvatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)',
    overflow: 'hidden',
  },
  heroAvatarImg: { width: '100%', height: '100%' },
  heroAvatarInit: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 0.5 },

  bellBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroSummary: { marginTop: 14 },
  heroSummaryText: { fontSize: 13, color: 'rgba(255,255,255,0.95)', fontWeight: '600' },

  // Stat strip - floats over the hero/body boundary
  statStrip: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: -16,
    gap: 8,
  },
  statTile: {
    flex: 1,
    backgroundColor: SURFACE,
    borderRadius: 12,
    padding: 12,
    alignItems: 'flex-start',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  statIconWrap: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 6,
  },
  statValue: { fontSize: 18, fontWeight: '800', color: TEXT },
  statLabel: { fontSize: 10, color: TEXT_MUTED, fontWeight: '700', letterSpacing: 0.4, marginTop: 1 },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 24,
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 16, color: TEXT, fontWeight: '800' },
  sectionSub: { fontSize: 11, color: TEXT_MUTED, marginTop: 2, fontWeight: '600' },

  // Course card
  courseCard: {
    flexDirection: 'row',
    backgroundColor: SURFACE,
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  courseBannerWrap: { position: 'relative' },
  courseBanner: { width: 90, height: 110 },
  courseBannerFallback: {
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  paidBadge: {
    position: 'absolute', top: 6, left: 6,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: GREEN,
    paddingHorizontal: 6, paddingVertical: 3,
    borderRadius: 999,
  },
  paidBadgeText: { fontSize: 9, color: '#fff', fontWeight: '900', letterSpacing: 0.5 },

  courseBody: { flex: 1, padding: 12, gap: 4 },
  courseName: { fontSize: 14, fontWeight: '800', color: TEXT },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 11, color: TEXT_MUTED, fontWeight: '600', flex: 1 },

  // Video card
  videoCard: {
    width: VIDEO_CARD_WIDTH,
    backgroundColor: SURFACE,
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  videoThumbWrap: { position: 'relative' },
  videoThumb: {
    width: '100%',
    height: 130,
    backgroundColor: '#000',
  },
  videoThumbFallback: { backgroundColor: '#1F2937' },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  playCircle: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
  },
  durationBadge: {
    position: 'absolute', bottom: 6, right: 6,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 6, paddingVertical: 3,
    borderRadius: 999,
  },
  durationText: { fontSize: 9, color: '#fff', fontWeight: '800', letterSpacing: 0.3 },
  videoBody: { padding: 10, gap: 2 },
  videoTitle: { fontSize: 13, fontWeight: '800', color: TEXT },
  videoCourse: { fontSize: 11, color: TEXT_MUTED, fontWeight: '600' },

  // Course Progress card
  progressCard: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  progressIconWrap: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  progressCourse: { fontSize: 14, color: TEXT, fontWeight: '800', letterSpacing: -0.2 },
  progressSummary: { fontSize: 11, color: TEXT_MUTED, marginTop: 2, fontWeight: '600' },
  progressPctPill: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: GREEN,
  },
  progressPctText: { fontSize: 11, color: '#fff', fontWeight: '800' },

  progressBarTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: BG,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: GREEN,
    borderRadius: 999,
  },

  progressList: { gap: 8 },
  progressItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressCheck: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#D1FAE5',
    alignItems: 'center', justifyContent: 'center',
  },
  progressItemTitle: {
    flex: 1,
    fontSize: 12,
    color: TEXT,
    fontWeight: '700',
  },
  progressDateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    backgroundColor: BG,
    borderRadius: 999,
  },
  progressDateText: { fontSize: 10, color: TEXT_MUTED, fontWeight: '700' },
  progressMore: {
    fontSize: 11,
    color: TEXT_MUTED,
    fontWeight: '700',
    marginTop: 2,
    paddingLeft: 26,
  },

  // Empty inline
  emptyInline: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16,
    padding: 14,
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1, borderColor: BORDER,
  },
  emptyInlineText: { flex: 1, fontSize: 12, color: TEXT_MUTED, fontWeight: '600', lineHeight: 17 },
});
