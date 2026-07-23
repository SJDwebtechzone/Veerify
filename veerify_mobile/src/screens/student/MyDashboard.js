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
  StyleSheet, RefreshControl, Linking, Dimensions, Modal, TextInput,
  KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Bell, BookOpen, PlayCircle, Calendar, Clock, GraduationCap, Award,
  ChevronRight, Wallet, CheckCircle2, Video, Building2, User,
  CalendarDays, Target, Star, MessageSquare, X as XIcon,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { useAuth } from '../../context/AuthContext';
// Shared resolver — strips embedded localhost / 10.0.2.2 hosts from
// legacy DB rows so old uploads still render on any client.
import resolveAssetUrl from '../../utils/assetUrl';
import { formatBatchTime } from '../../utils/formatTime';
import { useBellScrollHandler } from '../../components/bellScrollBus';

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

function fmtINR(n) {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString('en-IN')}`;
}

// Delegate to the shared 12-hour formatter so batch/course timings
// read as "6:00 AM" instead of "06:00" everywhere on the student side.
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

  // Inline feedback modal — when set, opens StudentFeedbackModal with the
  // current rating / remarks pre-filled. Cleared on save / cancel.
  const [feedbackTarget, setFeedbackTarget] = useState(null);
  // Upcoming institution events — published by the academy admin via
  // /institutions/me/events. Same source the trainer dashboard uses.
  const [events, setEvents] = useState([]);

  const load = useCallback(async () => {
    try {
      const [enrRes, vidRes, meRes, eventsRes] = await Promise.all([
        apiClient.get('/enrollments/my').catch(() => ({ data: { enrollments: [] } })),
        apiClient.get('/students/my-videos').catch(() => ({ data: { videos: [] } })),
        apiClient.get('/students/me').catch(() => ({ data: { student: null } })),
        apiClient.get('/institutions/me/events').catch(() => ({ data: { events: [] } })),
      ]);
      const enrs = enrRes.data?.enrollments || [];
      setEnrollments(enrs);
      setVideos(vidRes.data?.videos || []);
      setMe(meRes.data?.student || null);
      setEvents(eventsRes.data?.events || []);

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

  const bellScroll = useBellScrollHandler();

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        onScroll={bellScroll}
        scrollEventThrottle={16}
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
            {/* Inline bell removed — GlobalNotificationBell renders
                globally now so it stays visible across every screen. */}
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
                    onRate={(lesson) => setFeedbackTarget({
                      courseId:    enrollment.course_id,
                      courseName:  enrollment.course_name,
                      lessonIndex: lesson.idx,
                      lessonTitle: lesson.title || `Lesson ${lesson.idx + 1}`,
                      rating:      lesson.student_rating || 0,
                      remarks:     lesson.student_remarks || '',
                    })}
                    onPress={() => navigation.navigate('EnrolledCourse', { enrollmentId: enrollment.id })}
                  />
                ))}
              </View>
            </>
          );
        })()}

        {/* ───── Upcoming Events ─────
            Institution events published by the academy admin via the
            More tab → Events tile. Renders nothing when the list is
            empty so the section doesn't take up dead space. */}
        {events.length > 0 ? (
          <>
            <SectionHeader title="Upcoming Events" subtitle="From your academy" />
            <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
              {events.slice(0, 5).map((ev) => (
                <EventRow
                  key={ev.id}
                  event={ev}
                  onPress={() => navigation.navigate('EventDetail', { event: ev })}
                />
              ))}
            </View>
          </>
        ) : null}

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

      {/* Student feedback (rating + remarks) modal. Renders only when a
          lesson has been tapped from the Course Progress card. */}
      {feedbackTarget ? (
        <StudentFeedbackModal
          target={feedbackTarget}
          onClose={() => setFeedbackTarget(null)}
          onSaved={() => { setFeedbackTarget(null); load(); }}
        />
      ) : null}
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

// Compact event card — same shape used on the trainer dashboard, kept
// inline here so MyDashboard stays self-contained. Tap to open the
// shared EventDetail screen.
function EventRow({ event, onPress }) {
  const d = event.event_date ? new Date(event.event_date) : null;
  const day = d ? String(d.getDate()).padStart(2, '0') : '--';
  const mon = d ? d.toLocaleString('en-US', { month: 'short' }).toUpperCase() : '---';
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        padding: 12, marginBottom: 8,
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        borderWidth: 1, borderColor: '#E5E7EB',
      }}
    >
      <View
        style={{
          width: 48, height: 56, borderRadius: 10,
          backgroundColor: '#FFE4E6',
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: '900', color: '#E63946' }}>{day}</Text>
        <Text style={{ fontSize: 9, fontWeight: '800', color: '#E63946', letterSpacing: 0.5 }}>{mon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '800', color: '#111827' }} numberOfLines={1}>
          {event.title}
        </Text>
        {event.subtitle ? (
          <Text style={{ fontSize: 12, color: '#6B7280', marginTop: 2, fontWeight: '600' }} numberOfLines={1}>
            {event.subtitle}
          </Text>
        ) : null}
        {event.location ? (
          <Text style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }} numberOfLines={1}>
            📍 {event.location}
          </Text>
        ) : null}
      </View>
      {/* Fee / Paid chip — mirrors HomeTab + staff dashboard so a
          student sees pay status at a glance without opening detail. */}
      {event.payment_required && !event.has_paid ? (
        <View style={{
          paddingHorizontal: 8, paddingVertical: 3,
          borderRadius: 999, backgroundColor: '#10B98122',
        }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: '#10B981' }}>
            ₹{Number(event.payment_amount || 0).toLocaleString('en-IN')}
          </Text>
        </View>
      ) : event.payment_required && event.has_paid ? (
        <View style={{
          paddingHorizontal: 8, paddingVertical: 3,
          borderRadius: 999, backgroundColor: '#10B98122',
        }}>
          <Text style={{ fontSize: 10, fontWeight: '800', color: '#10B981', letterSpacing: 0.4 }}>
            PAID
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
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
      {/* Banner sits on top as a wide hero image. The PAID badge moves
          to the top-right so it doesn't overlap with the title below. */}
      <View style={styles.courseBannerWrap}>
        {banner ? (
          <Image source={{ uri: banner }} style={styles.courseBanner} />
        ) : (
          <View style={[styles.courseBanner, styles.courseBannerFallback]}>
            <BookOpen size={36} color={BRAND} strokeWidth={2} />
          </View>
        )}
        <View style={styles.paidBadge}>
          <CheckCircle2 size={11} color="#fff" strokeWidth={2.6} />
          <Text style={styles.paidBadgeText}>PAID</Text>
        </View>
      </View>

      {/* Content stacked below the banner */}
      <View style={styles.courseBody}>
        <Text style={styles.courseName} numberOfLines={2}>{courseName}</Text>
        {institution ? (
          <View style={styles.metaRow}>
            <Building2 size={12} color={TEXT_MUTED} strokeWidth={2.2} />
            <Text style={styles.metaText} numberOfLines={1}>{institution}</Text>
          </View>
        ) : null}
        {batchName ? (
          <View style={styles.metaRow}>
            <GraduationCap size={12} color={TEXT_MUTED} strokeWidth={2.2} />
            <Text style={styles.metaText} numberOfLines={1}>{batchName}</Text>
          </View>
        ) : null}
        {(days || time) ? (
          <View style={styles.metaRow}>
            <Calendar size={12} color={TEXT_MUTED} strokeWidth={2.2} />
            <Text style={styles.metaText} numberOfLines={1}>
              {days}{days && time ? ' · ' : ''}{time}
            </Text>
          </View>
        ) : null}
        {trainer ? (
          <View style={styles.metaRow}>
            <User size={12} color={TEXT_MUTED} strokeWidth={2.2} />
            <Text style={styles.metaText} numberOfLines={1}>{trainer}</Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

// Compact card listing only the lessons the trainer has ticked off for
// this student in this course. Shows a percentage ring + the dated
// list. Tapping opens the EnrolledCourseScreen for full course detail.
function CourseProgressCard({ enrollment, progress, onPress, onRate }) {
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
            <View key={`lesson-${lesson.idx}`} style={styles.progressLessonWrap}>
              <View style={styles.progressItem}>
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

              {/* Student rating + remarks summary — shown when the student
                  has already submitted feedback. The whole row is tappable
                  to update it. */}
              {(lesson.student_rating || lesson.student_remarks) ? (
                <TouchableOpacity
                  style={styles.feedbackSummary}
                  onPress={() => onRate && onRate(lesson)}
                  activeOpacity={0.85}
                >
                  <View style={styles.feedbackStarsRow}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star
                        key={n}
                        size={11}
                        color={n <= (lesson.student_rating || 0) ? '#F59E0B' : '#E5E7EB'}
                        fill={n <= (lesson.student_rating || 0) ? '#F59E0B' : 'transparent'}
                        strokeWidth={2.2}
                      />
                    ))}
                    <Text style={styles.feedbackUpdatedText}>
                      · Updated {fmt(lesson.student_remarked_at)}
                    </Text>
                  </View>
                  {lesson.student_remarks ? (
                    <Text style={styles.feedbackRemarkText} numberOfLines={2}>
                      “{lesson.student_remarks}”
                    </Text>
                  ) : null}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.feedbackCta}
                  onPress={() => onRate && onRate(lesson)}
                  activeOpacity={0.85}
                >
                  <Star size={11} color={BRAND} strokeWidth={2.4} />
                  <Text style={styles.feedbackCtaText}>Rate &amp; add remarks</Text>
                </TouchableOpacity>
              )}
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

// StudentFeedbackModal — bottom-sheet style overlay with a 5-star picker
// and a free-text remarks input. Posts to POST /api/curriculum-progress/
// feedback and calls onSaved on success so the parent can refetch.
function StudentFeedbackModal({ target, onClose, onSaved }) {
  const [rating, setRating] = useState(target?.rating || 0);
  const [remarks, setRemarks] = useState(target?.remarks || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!rating && !remarks.trim()) {
      Alert.alert('Add feedback', 'Please pick a rating or write a remark before saving.');
      return;
    }
    setSaving(true);
    try {
      await apiClient.post('/curriculum-progress/feedback', {
        course_id:    target.courseId,
        lesson_index: target.lessonIndex,
        rating:       rating || null,
        remarks:      remarks.trim() || null,
      });
      onSaved && onSaved();
    } catch (err) {
      Alert.alert(
        'Save failed',
        err?.response?.data?.message || err?.message || 'Could not save your feedback.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.feedbackBackdrop}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.feedbackSheet}>
          <View style={styles.feedbackHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.feedbackEyebrow}>{target.courseName || 'Course'}</Text>
              <Text style={styles.feedbackTitle} numberOfLines={2}>
                {target.lessonTitle}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.feedbackClose}>
              <XIcon size={16} color={TEXT_MUTED} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>

          <Text style={styles.feedbackLabel}>Your rating</Text>
          <View style={styles.feedbackPickerRow}>
            {[1, 2, 3, 4, 5].map((n) => (
              <TouchableOpacity
                key={n}
                onPress={() => setRating(n === rating ? 0 : n)}
                activeOpacity={0.7}
                style={styles.feedbackStarBtn}
              >
                <Star
                  size={28}
                  color={n <= rating ? '#F59E0B' : '#D1D5DB'}
                  fill={n <= rating ? '#F59E0B' : 'transparent'}
                  strokeWidth={2.2}
                />
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.feedbackLabel}>Remarks (optional)</Text>
          <View style={styles.feedbackInputWrap}>
            <MessageSquare size={14} color={TEXT_MUTED} strokeWidth={2.2} />
            <TextInput
              style={styles.feedbackInput}
              value={remarks}
              onChangeText={setRemarks}
              placeholder="What did you enjoy? What's tricky?"
              placeholderTextColor="#9CA3AF"
              multiline
              maxLength={500}
            />
          </View>
          <Text style={styles.feedbackCounter}>{remarks.length}/500</Text>

          <View style={styles.feedbackActions}>
            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.85}
              style={[styles.feedbackBtn, styles.feedbackBtnGhost]}
            >
              <Text style={styles.feedbackBtnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={save}
              disabled={saving}
              activeOpacity={0.9}
              style={[styles.feedbackBtn, styles.feedbackBtnPrimary, saving && { opacity: 0.7 }]}
            >
              <Text style={styles.feedbackBtnPrimaryText}>
                {saving ? 'Saving…' : 'Save feedback'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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

  // Course card — vertical layout: wide hero banner on top, content below.
  // (Earlier this was a row with a 90px image on the left; switched to a
  // stacked layout so the artwork has room to breathe.)
  courseCard: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
    borderWidth: 1,
    borderColor: BORDER,
  },
  courseBannerWrap: { position: 'relative' },
  courseBanner: {
    width: '100%',
    height: 160,
    backgroundColor: BRAND_SOFT,
  },
  courseBannerFallback: {
    backgroundColor: BRAND_SOFT,
    alignItems: 'center', justifyContent: 'center',
  },
  // Top-right now so it doesn't fight the title which sits below the
  // banner on its own line.
  paidBadge: {
    position: 'absolute', top: 10, right: 10,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: GREEN,
    paddingHorizontal: 9, paddingVertical: 4,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  paidBadgeText: { fontSize: 10, color: '#fff', fontWeight: '900', letterSpacing: 0.5 },

  // Content area sits beneath the banner with comfortable padding.
  courseBody: { padding: 14, gap: 6 },
  courseName: {
    fontSize: 16, fontWeight: '800', color: TEXT,
    marginBottom: 4, letterSpacing: -0.1,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12, color: TEXT_MUTED, fontWeight: '600', flex: 1 },

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
  // Small date chip — sits at the end of a completed lesson row, shows
  // when the trainer ticked the lesson off.
  progressDateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: BG,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
  },
  progressDateText: {
    fontSize: 10, color: TEXT_MUTED, fontWeight: '700',
  },

  // Empty-state inline card — icon + helper text on one row. Used when
  // a section has no rows yet (no recorded videos, no progress, etc).
  emptyInline: {
    flexDirection: 'row',
    alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginBottom: 16,
    padding: 14, borderRadius: 12,
    backgroundColor: SURFACE,
    borderWidth: 1, borderColor: BORDER,
  },
  emptyInlineText: { flex: 1, fontSize: 12, color: TEXT_MUTED, fontWeight: '600', lineHeight: 17 },

  // ── Student feedback (rating + remarks) ─────────────────────────────
  progressLessonWrap: {
    gap: 6,
  },
  feedbackSummary: {
    marginLeft: 24,
    backgroundColor: '#FFFBF0',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    gap: 4,
  },
  feedbackStarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  feedbackUpdatedText: {
    marginLeft: 6,
    fontSize: 10,
    color: TEXT_MUTED,
    fontWeight: '600',
  },
  feedbackRemarkText: {
    fontSize: 11,
    color: '#92400E',
    fontStyle: 'italic',
    lineHeight: 15,
  },
  feedbackCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 24,
    paddingVertical: 4,
  },
  feedbackCtaText: {
    fontSize: 11,
    color: BRAND,
    fontWeight: '700',
  },

  // Modal sheet
  feedbackBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'flex-end',
  },
  feedbackSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 28,
    gap: 12,
  },
  feedbackHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 4,
  },
  feedbackEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    color: TEXT_MUTED,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  feedbackTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  feedbackClose: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  feedbackLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    marginTop: 4,
  },
  feedbackPickerRow: {
    flexDirection: 'row',
    gap: 4,
  },
  feedbackStarBtn: {
    padding: 4,
  },
  feedbackInputWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F8FAFC',
  },
  feedbackInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    minHeight: 64,
    padding: 0,
    textAlignVertical: 'top',
  },
  feedbackCounter: {
    fontSize: 10,
    color: TEXT_MUTED,
    alignSelf: 'flex-end',
    marginTop: -8,
  },
  feedbackActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  feedbackBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackBtnGhost: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: BORDER,
  },
  feedbackBtnGhostText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  feedbackBtnPrimary: {
    backgroundColor: BRAND,
  },
  feedbackBtnPrimaryText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.3,
  },
});
