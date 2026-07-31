// src/screens/student/CourseDetailScreen.js
//
// Program detail screen (file kept as CourseDetailScreen for route compat
// with the existing navigator; the UI uses "Program" terminology).
//
// Layout:
//   1. Hero banner (image, gradient overlay, back + share buttons)
//   2. Title block (title, trainer, price, quick stats)
//   3. Quick info bar (duration / level / language)
//   4. Trainer card
//   5. About this program (description)
//   6. Intro video preview (lock overlay for guests / free users)
//   7. Curriculum (list of lessons / modules)
//   8. Available batches (horizontal cards, link to Batches tab)
//   9. Sticky bottom Enroll bar
//
// Guest taps premium → "Login to Continue Learning"
// Free user taps premium → "Subscribe to Unlock Premium Access"
// Paid user → real navigation (Phase 2)

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  StyleSheet, ActivityIndicator, Alert, Share, Linking,
  StatusBar, Dimensions, Modal,
} from 'react-native';
import {
  ArrowLeft, Share2, Heart, Star, Users, Clock, Globe,
  PlayCircle, Lock, ChevronRight, CheckCircle2, GraduationCap,
  Award, Calendar, MapPin, X, User,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { palette, spacing, radius, shadows, type } from '../../theme';
import CourseImage from '../../components/CourseImage';
import Avatar from '../../components/Avatar';
import YouTubeThumbPlayer from '../../components/YouTubeThumbPlayer';
import { confirm } from '../../components/ConfirmDialog';
import { formatBatchTimeRange } from '../../utils/formatTime';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ASSET_HOST = (apiClient.defaults.baseURL || '').replace(/\/api\/?$/, '');
function resolveAssetUrl(src) {
  if (!src) return null;
  if (src.startsWith('data:')) return src;
  if (src.startsWith('/uploads/')) return ASSET_HOST + src;
  if (src.includes('://localhost:') || src.includes('://127.0.0.1:')) {
    return src.replace(/:\/\/(localhost|127\.0\.0\.1)(?=[:\/])/, '://10.0.2.2');
  }
  return src;
}

// Placeholder curriculum if the program row doesn't have one yet.
const FALLBACK_LESSONS = [
  { id: 'l1', title: 'Introduction & warm-up routines', duration: '12 min', free: true },
  { id: 'l2', title: 'Basic stances and footwork', duration: '24 min', free: false },
  { id: 'l3', title: 'Punching techniques — drills',  duration: '30 min', free: false },
  { id: 'l4', title: 'Kicking fundamentals',          duration: '28 min', free: false },
  { id: 'l5', title: 'Sparring basics',               duration: '35 min', free: false },
];

export default function CourseDetailScreen({ navigation, route }) {
  const { courseId } = route.params || {};
  const { user } = useAuth();
  const [program, setProgram] = useState(null);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  // Batch picker modal — surfaced instead of the native Alert.alert
  // when the course has more than one available batch. Renders each
  // batch as a full card (days, time, trainer, capacity) so the
  // student can compare before choosing.
  const [batchPickerOpen, setBatchPickerOpen] = useState(false);
  const [batchPickerList, setBatchPickerList] = useState([]);

  const isGuest = !user;
  const isPaid = false; // Phase 2

  // Enrolment check for THIS course. Drives the intro-video paywall:
  //   • guest      → 60s preview, then "Login to continue…" dialog
  //   • unenrolled → 60s preview, then "Purchase this course…" dialog
  //   • enrolled   → uncapped full playback
  // Only counts payment_status='paid' rows so a pending-payment
  // enrolment doesn't accidentally grant full video access before the
  // Razorpay webhook confirms.
  const [isEnrolledInCourse, setIsEnrolledInCourse] = useState(false);
  const viewerMode = isGuest
    ? 'guest'
    : (isEnrolledInCourse ? 'enrolled' : 'unenrolled');

  const load = useCallback(async () => {
    try {
      const [progRes, batchRes, enrRes] = await Promise.all([
        apiClient.get(`/courses/${courseId}`).catch(() => ({ data: { course: null } })),
        apiClient.get(`/batches/course/${courseId}`).catch(() => ({ data: { batches: [] } })),
        // Enrolments are only meaningful when signed in. For guests we
        // skip the call entirely so we don't bark 401s at the client.
        user
          ? apiClient.get('/enrollments/my').catch(() => ({ data: { enrollments: [] } }))
          : Promise.resolve({ data: { enrollments: [] } }),
      ]);
      setProgram(progRes.data.course || progRes.data.program || null);
      setBatches(batchRes.data.batches || []);
      const myRows = enrRes.data?.enrollments || [];
      setIsEnrolledInCourse(
        myRows.some((e) =>
          Number(e.course_id) === Number(courseId)
          && e.payment_status === 'paid',
        ),
      );
    } catch (err) {
      console.log('[ProgramDetail] load error:', err?.message);
    } finally {
      setLoading(false);
    }
  }, [courseId, user]);

  useEffect(() => { load(); }, [load]);

  // Guest stack mounts Login as a sibling of CourseDetail under a single
  // Stack.Navigator (no parent navigator above it), so getParent() returned
  // undefined and the original `.navigate('Login')` chain silently no-op'd.
  // Navigate directly, with a defensive try/catch so we never silently fail.
  const goToLogin = () => {
    try { navigation.navigate('Login'); return; } catch { /* fall through */ }
    try { navigation.getParent()?.navigate('Login'); } catch {}
  };

  const triggerPaywall = (action) => {
    if (isGuest) {
      confirm({
        title: 'Login to Continue Learning',
        message: `Sign in to ${action.toLowerCase()} and unlock your training.`,
        variant: 'destructive',
        confirmText: 'Login',
        cancelText: 'Not now',
        onConfirm: goToLogin,
      });
      return true;
    }
    if (!isPaid) {
      confirm({
        title: 'Subscribe to Unlock Premium Access',
        message: `${action} requires an active subscription. Pick a plan from your Profile.`,
        variant: 'warning',
        confirmText: 'View Plans',
        cancelText: 'Not now',
        onConfirm: () => navigation.navigate('Profile'),
      });
      return true;
    }
    return false;
  };

  const handleEnroll = () => {
    // Guests must log in first — the enrollment form is per-user.
    if (isGuest) {
      confirm({
        title: 'Login to Continue Learning',
        message: 'Sign in to enroll in this program.',
        variant: 'destructive',
        confirmText: 'Login',
        cancelText: 'Not now',
        onConfirm: goToLogin,
      });
      return;
    }

    // The enrollment table is keyed on batch_id (each enrollment ties a
    // student to one specific batch). So before opening the form we need
    // to know which batch the student is enrolling into.
    const availableBatches = batches.filter(
      (b) => Number(b.enrolled_count || 0) < Number(b.capacity || 0),
    );
    const allBatches = batches;

    if (allBatches.length === 0) {
      Alert.alert(
        'No batches yet',
        'This program does not have any batches available. Please check back soon.',
      );
      return;
    }

    if (availableBatches.length === 0) {
      Alert.alert(
        'All batches are full',
        'Every batch for this program is at capacity. Please check back soon.',
      );
      return;
    }

    const courseSummary = {
      id:               program.id,
      name:             program.name,
      price:            program.price,
      institution_name: program.institution_name,
    };

    // Single batch? Skip the picker.
    if (availableBatches.length === 1) {
      navigation.navigate('EnrollmentForm', {
        batch: { ...availableBatches[0], course_price: program.price },
        course: courseSummary,
      });
      return;
    }

    // Multiple batches — open the custom bottom-sheet picker instead
    // of the two-line native Alert. Handles as many batches as the
    // course has, each rendered as a full card so the student can see
    // days / time / trainer / capacity side-by-side.
    setBatchPickerList(availableBatches);
    setBatchPickerOpen(true);
  };

  // Selected a batch from the picker → close it and hand off to the
  // enrollment form with the same payload the single-batch branch uses.
  const pickBatch = (b) => {
    setBatchPickerOpen(false);
    const courseSummary = {
      id:               program.id,
      name:             program.name,
      price:            program.price,
      institution_name: program.institution_name,
    };
    navigation.navigate('EnrollmentForm', {
      batch: { ...b, course_price: program.price },
      course: courseSummary,
    });
  };

  // Open the intro video URL externally (browser / YouTube app / VLC for .mp4).
  // We DON'T use react-native-webview/video for inline playback — those need a
  // native rebuild and we're not adding that dependency right now.
  //
  // Self-healing: trim, normalise the scheme. Surface the actual failure to
  // the user instead of silently swallowing it so we can debug what went wrong.
  const handleWatchIntro = async () => {
    const raw = (program?.intro_video_url || '').trim();
    if (!raw) {
      Alert.alert('Coming soon', 'The intro video for this program is not yet available.');
      return;
    }

    // Add https:// if user pasted "youtube.com/..." without a scheme.
    let url = raw;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      url = 'https://' + url;
    }

    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert('Cannot open video', `No app on this device can open this link.\n\n${url}`);
        return;
      }
      await Linking.openURL(url);
    } catch (err) {
      Alert.alert('Could not open video', err?.message || `Tried to open: ${url}`);
    }
  };

  const handleLesson = (lesson) => {
    if (lesson.free) {
      Alert.alert('Free preview', `${lesson.title} would open here. Full player lands in Phase 3.`);
      return;
    }
    triggerPaywall('Watch this lesson');
  };

  const handleShare = async () => {
    if (!program) return;
    try {
      const link = `https://veerifyapp.com/programs/${courseId}`;
      const courseName = program.title || program.name || 'this program';
      const instName = program.institution_name || 'Veerify';
      const desc = program.description ? `\n\n${program.description.substring(0, 120).trim()}...` : '';
      
      const message = `Check out "${courseName}" by ${instName}!${desc}\n\nView program: ${link}`;
      
      await Share.share({
        message: message,
        title: courseName,
        url: link, // Primarily used by iOS
      });
    } catch (err) { /* user cancelled */ }
  };

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={palette.purple.vivid} />
      </View>
    );
  }

  if (!program) {
    return (
      <View style={[styles.screen, styles.center, { padding: spacing.xxl }]}>
        <GraduationCap size={42} color={palette.textLight} strokeWidth={2} />
        <Text style={styles.emptyTitle}>Program not found</Text>
        <Text style={styles.emptyBody}>
          This program may have been removed. Try browsing the catalog instead.
        </Text>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          activeOpacity={0.85}
          style={styles.ctaButton}
        >
          <Text style={styles.ctaText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const bannerImg = resolveAssetUrl(program.image_url || program.thumbnail_url || program.banner_url);
  const trainerAvatar = resolveAssetUrl(program.trainer_image || program.trainer_avatar);
  // Curriculum comes from the new courses.curriculum JSONB column. Each entry
  // is { title, duration, is_free }. We also accept the older `lessons` shape
  // and fall back to the placeholder set only when the admin hasn't published
  // any curriculum yet — that way the section never looks broken on day-one
  // courses but stays accurate once the admin fills it in.
  const lessons = (Array.isArray(program.curriculum) && program.curriculum.length > 0)
    ? program.curriculum.map((l, i) => ({
        id:       `c${i}`,
        title:    l.title || l.name || `Lesson ${i + 1}`,
        duration: l.duration || '',
        free:     l.is_free === true || l.free === true,
      }))
    : (Array.isArray(program.lessons) && program.lessons.length > 0
      ? program.lessons
      : FALLBACK_LESSONS);

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* ── Hero ─────────────────────────────────────────── */}
        <View style={styles.hero}>
          {/* Course cover — contain-fit so the entire poster is
              visible inside the hero band, matching the admin course
              detail. Neutral bg fills any letterboxing so tall
              portrait or wide banner uploads both read as intentional. */}
          <CourseImage
            uri={program.image_url || program.thumbnail_url || program.banner_url}
            width="100%"
            height={HERO_HEIGHT}
            radius={0}
            fit="contain"
            icon="course"
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroOverlay} />
          <View style={styles.heroTopBar}>
            <RoundIconBtn icon={ArrowLeft} onPress={() => {
              if (navigation.canGoBack()) {
                navigation.goBack();
              } else {
                navigation.navigate('Home');
              }
            }} />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <RoundIconBtn icon={Heart} onPress={() => Alert.alert('Saved', 'Wishlist coming soon.')} />
              <RoundIconBtn icon={Share2} onPress={handleShare} />
            </View>
          </View>
        </View>

        {/* ── Title block ──────────────────────────────────── */}
        <View style={styles.titleBlock}>
          {program.category ? (
            <View style={styles.categoryPill}>
              <Text style={styles.categoryPillText}>{program.category}</Text>
            </View>
          ) : null}
          <Text style={styles.title}>{program.title || program.name}</Text>
          <Text style={styles.subtitle}>
            by {program.trainer_name || program.trainer || 'Veerify Trainer'}
          </Text>

          <View style={styles.quickInfo}>
            <QuickInfo icon={Star}  label={(program.rating || '4.8') + ' rating'} accent={palette.orange} />
            <QuickInfo icon={Users} label={(program.students_count || program.enrolled || '120') + ' students'} accent={palette.blue} />
            {program.duration ? (
              <QuickInfo icon={Clock} label={program.duration} accent={palette.green} />
            ) : null}
            {program.level ? (
              <QuickInfo icon={Award} label={program.level} accent={palette.pink} />
            ) : null}
            {program.language ? (
              <QuickInfo icon={Globe} label={program.language} accent={palette.teal} />
            ) : null}
          </View>
        </View>

        {/* ── Intro video ──────────────────────────────────── */}
        {/* Playback stays IN-APP for every viewer. The player caps at
            60 seconds for guests + non-enrolled viewers and shows the
            correct upsell dialog (Login vs Buy Now) when the quota is
            reached. Only enrolled students (payment_status='paid' on
            this course) get uncapped playback. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Intro Video</Text>
          <YouTubeThumbPlayer
            url={program.intro_video_url}
            fallbackImage={bannerImg}
            viewerMode={viewerMode}
            onLoginPress={goToLogin}
            onBuyPress={handleEnroll}
          />
        </View>

        {/* ── Trainer ──────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Trainer</Text>
          <TouchableOpacity
            // Open the public trainer profile — only navigation. If the
            // course row doesn't have a trainer_id linked (legacy rows
            // still on free-text trainer_name), we short-circuit with
            // the app's branded confirm dialog instead of the OS Alert
            // so the copy sits alongside the rest of the app's tone.
            onPress={() => {
              const tid = program?.trainer_id;
              if (!tid) {
                confirm({
                  title:       'Trainer profile unavailable',
                  message:
                    'This trainer hasn\'t been linked to a profile yet. ' +
                    'The academy admin needs to select them from the trainer list on the course.',
                  variant:     'warning',
                  confirmText: 'Got it',
                  hideCancel:  true,
                });
                return;
              }
              navigation.navigate('PublicTrainerProfile', {
                trainerId:   tid,
                trainerName: program?.trainer_name || program?.trainer,
              });
            }}
            activeOpacity={0.85}
            style={styles.trainerCard}
          >
            <Avatar
              uri={program.trainer_image || program.trainer_avatar}
              name={program.trainer_name || program.trainer || 'Veerify Trainer'}
              size={56}
              tone="purple"
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.trainerName}>
                {program.trainer_name || program.trainer || 'Veerify Trainer'}
              </Text>
              <Text style={styles.trainerRole}>
                {program.trainer_role || program.trainer_bio || 'Master Instructor'}
              </Text>
              <View style={styles.trainerMeta}>
                <Star size={11} color={palette.orange.vivid} strokeWidth={2.4} />
                <Text style={styles.trainerMetaText}>4.9 · 12 programs · 8 yrs experience</Text>
              </View>
            </View>
            <ChevronRight size={16} color={palette.textLight} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        {/* ── About ────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About this program</Text>
          <Text style={styles.body}>
            {program.description || 'No description yet. The trainer will add details soon.'}
          </Text>
        </View>

        {/* ── Curriculum ───────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Curriculum</Text>
            <Text style={styles.lessonCount}>{lessons.length} lessons</Text>
          </View>
          <View style={styles.lessonList}>
            {lessons.map((lesson, i) => (
              <LessonRow
                key={lesson.id || i}
                index={i}
                lesson={lesson}
                locked={!isPaid && !lesson.free}
                onPress={() => handleLesson(lesson)}
              />
            ))}
          </View>
        </View>

        {/* ── Available batches ────────────────────────────── */}
        {batches.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Available batches</Text>
              <TouchableOpacity onPress={() => navigation.navigate('Batches')} style={styles.linkRow}>
                <Text style={styles.linkText}>See all</Text>
                <ChevronRight size={13} color={palette.purple.vivid} strokeWidth={2.4} />
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.md }}
            >
              {batches.slice(0, 5).map((b, i) => (
                <BatchTeaserCard
                  key={b.id || i}
                  batch={b}
                  onPress={() => navigation.navigate('Batches')}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* ── Premium banner ───────────────────────────────── */}
        {/* Removed. Guests must NOT see the "Unlock Premium Access"
            prompt on the course detail page — the spec says they can
            only browse public course info (name, description, duration,
            fee, syllabus preview, trainer). Signed-in free users still
            hit the "Subscribe to Unlock Premium Access" modal from
            handleEnroll if they tap the Enroll bar without a plan, so
            no CTA is lost. */}
      </ScrollView>

      {/* ── Sticky bottom Enroll bar ─────────────────────── */}
      <View style={styles.stickyBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.stickyPriceLabel}>Price</Text>
          <Text style={styles.stickyPrice}>
            {program.price
              ? `₹${parseInt(program.price).toLocaleString('en-IN')}/mo`
              : 'Free preview'}
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleEnroll}
          activeOpacity={0.85}
          style={styles.enrollBtn}
        >
          <CheckCircle2 size={16} color="#fff" strokeWidth={2.6} />
          <Text style={styles.enrollBtnText}>{isPaid ? 'Continue' : 'Enroll now'}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Batch picker (custom bottom sheet) ───────────────────────
          Replaces the old native Alert.alert with a proper card list.
          Each batch shows days, time, trainer, and seats-remaining so
          the student can compare before picking. Slides up from the
          bottom with a translucent scrim behind so the parent scroll
          stays visible. */}
      <Modal
        visible={batchPickerOpen}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setBatchPickerOpen(false)}
      >
        <TouchableOpacity
          style={styles.pickerBackdrop}
          activeOpacity={1}
          onPress={() => setBatchPickerOpen(false)}
        />
        <View style={styles.pickerSheet}>
          <View style={styles.pickerHandle} />
          <View style={styles.pickerHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.pickerTitle}>Pick a batch</Text>
              <Text style={styles.pickerSub}>
                Choose the batch you'd like to enroll in.
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setBatchPickerOpen(false)}
              style={styles.pickerClose}
              activeOpacity={0.85}
            >
              <X size={18} color={palette.text} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={{ maxHeight: 420 }}
            contentContainerStyle={{ padding: spacing.lg, paddingTop: 0 }}
            showsVerticalScrollIndicator={false}
          >
            {batchPickerList.map((b) => {
              const cap = Number(b.capacity || 0);
              const used = Number(b.enrolled_count || 0);
              const left = Math.max(cap - used, 0);
              const nearlyFull = cap > 0 && left / cap <= 0.15;
              const time =
                formatBatchTimeRange(b.start_time, b.end_time) ||
                b.time || '';
              const days = b.days || b.days_of_week || '';
              return (
                <TouchableOpacity
                  key={b.id}
                  style={styles.pickerCard}
                  onPress={() => pickBatch(b)}
                  activeOpacity={0.9}
                >
                  <View style={styles.pickerCardHead}>
                    <Text style={styles.pickerCardTitle} numberOfLines={1}>
                      {b.name || `Batch ${b.id}`}
                    </Text>
                    {cap > 0 ? (
                      <View style={[
                        styles.pickerSeatsPill,
                        nearlyFull && styles.pickerSeatsPillLow,
                      ]}>
                        <Text style={[
                          styles.pickerSeatsPillText,
                          nearlyFull && styles.pickerSeatsPillTextLow,
                        ]}>
                          {left === 0 ? 'Full' : `${left} left`}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.pickerMetaGrid}>
                    {days ? (
                      <View style={styles.pickerMetaRow}>
                        <Calendar size={12} color={palette.textMuted} strokeWidth={2.2} />
                        <Text style={styles.pickerMetaText} numberOfLines={1}>{days}</Text>
                      </View>
                    ) : null}
                    {time ? (
                      <View style={styles.pickerMetaRow}>
                        <Clock size={12} color={palette.textMuted} strokeWidth={2.2} />
                        <Text style={styles.pickerMetaText}>{time}</Text>
                      </View>
                    ) : null}
                    {b.trainer_name ? (
                      <View style={styles.pickerMetaRow}>
                        <User size={12} color={palette.textMuted} strokeWidth={2.2} />
                        <Text style={styles.pickerMetaText} numberOfLines={1}>
                          {b.trainer_name}
                        </Text>
                      </View>
                    ) : null}
                    {cap > 0 ? (
                      <View style={styles.pickerMetaRow}>
                        <Users size={12} color={palette.textMuted} strokeWidth={2.2} />
                        <Text style={styles.pickerMetaText}>{used}/{cap} enrolled</Text>
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.pickerCardCta}>
                    <Text style={styles.pickerCardCtaText}>Select this batch</Text>
                    <ChevronRight size={16} color={palette.purple.vivid} strokeWidth={2.4} />
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function RoundIconBtn({ icon: Icon, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.roundBtn}>
      <Icon size={18} color="#fff" strokeWidth={2.4} />
    </TouchableOpacity>
  );
}

function QuickInfo({ icon: Icon, label, accent }) {
  return (
    <View style={[styles.quickPill, { backgroundColor: accent.soft }]}>
      <Icon size={11} color={accent.vivid} strokeWidth={2.4} />
      <Text style={[styles.quickPillText, { color: accent.on }]}>{label}</Text>
    </View>
  );
}

function LessonRow({ index, lesson, locked, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={styles.lessonRow}
    >
      <View style={styles.lessonNum}>
        <Text style={styles.lessonNumText}>{String(index + 1).padStart(2, '0')}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.lessonTitle} numberOfLines={1}>{lesson.title}</Text>
        <View style={styles.lessonMeta}>
          <Clock size={11} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.lessonMetaText}>{lesson.duration}</Text>
          {lesson.free ? (
            <View style={styles.freePill}><Text style={styles.freePillText}>FREE</Text></View>
          ) : null}
        </View>
      </View>
      {locked
        ? <Lock size={16} color={palette.textLight} strokeWidth={2.2} />
        : <PlayCircle size={20} color={palette.purple.vivid} strokeWidth={2.2} />}
    </TouchableOpacity>
  );
}

function BatchTeaserCard({ batch, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.batchCard}>
      <Text style={styles.batchName} numberOfLines={1}>
        {batch.name || batch.batch_name || `Batch ${batch.id}`}
      </Text>
      {batch.trainer_name || batch.trainer ? (
        <Text style={styles.batchTrainer} numberOfLines={1}>
          {batch.trainer_name || batch.trainer}
        </Text>
      ) : null}
      <View style={styles.batchMetaRow}>
        <Calendar size={11} color={palette.textMuted} strokeWidth={2.2} />
        <Text style={styles.batchMeta} numberOfLines={1}>
          {batch.days || batch.days_of_week || 'Schedule TBD'}
        </Text>
      </View>
      {batch.mode ? (
        <View style={styles.batchMetaRow}>
          <MapPin size={11} color={palette.textMuted} strokeWidth={2.2} />
          <Text style={styles.batchMeta}>{batch.mode}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const HERO_HEIGHT = 240;
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  // Hero
  hero: { height: HERO_HEIGHT, position: 'relative' },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.35)' },
  heroTopBar: {
    position: 'absolute', top: spacing.xxl, left: spacing.xl, right: spacing.xl,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  roundBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },

  // Title block
  titleBlock: {
    marginTop: -24,
    backgroundColor: palette.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  categoryPill: {
    alignSelf: 'flex-start',
    backgroundColor: palette.purple.soft,
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.pill,
    marginBottom: spacing.sm,
  },
  categoryPillText: { ...type.micro, color: palette.purple.on, fontWeight: '700' },
  title: { ...type.display, fontSize: 24, color: palette.text },
  subtitle: { ...type.body, color: palette.textMuted, marginTop: 4 },
  quickInfo: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    marginTop: spacing.md,
  },
  quickPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
  },
  quickPillText: { fontSize: 11, fontWeight: '700' },

  // Section
  section: { paddingHorizontal: spacing.xl, marginTop: spacing.xl },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { ...type.h2, color: palette.text, marginBottom: spacing.md },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: spacing.md },
  linkText: { ...type.caption, color: palette.purple.vivid, fontWeight: '700' },
  body: { ...type.body, color: palette.text, lineHeight: 22 },
  lessonCount: { ...type.caption, color: palette.textMuted, marginBottom: spacing.md },

  // Intro
  introCard: {
    height: 160, borderRadius: radius.lg,
    overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.purple.soft,
  },
  introOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.45)' },
  playBubble: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  introHint: {
    position: 'absolute', bottom: spacing.md,
    color: '#fff', fontSize: 12, fontWeight: '700',
  },

  // Trainer
  trainerCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: palette.surface,
    padding: spacing.md,
    borderRadius: radius.lg,
    ...shadows.card,
  },
  trainerAvatar: { width: 56, height: 56, borderRadius: 28 },
  trainerInitial: { color: '#fff', fontSize: 22, fontWeight: '800' },
  trainerName: { ...type.h3, color: palette.text },
  trainerRole: { ...type.caption, color: palette.textMuted, marginTop: 2 },
  trainerMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  trainerMetaText: { ...type.caption, color: palette.textMuted },

  // Lessons
  lessonList: { backgroundColor: palette.surface, borderRadius: radius.lg, ...shadows.card },
  lessonRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1, borderBottomColor: palette.borderSoft,
  },
  lessonNum: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  lessonNumText: { ...type.micro, color: palette.purple.on, fontWeight: '800' },
  lessonTitle: { ...type.bodyBold, color: palette.text, fontSize: 13 },
  lessonMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  lessonMetaText: { ...type.caption, color: palette.textMuted },
  freePill: {
    backgroundColor: palette.green.soft,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: radius.pill,
  },
  freePillText: { fontSize: 9, fontWeight: '800', color: palette.green.on, letterSpacing: 0.5 },

  // Batches
  batchCard: {
    width: 200,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 4,
    ...shadows.card,
  },
  batchName: { ...type.bodyBold, color: palette.text, fontSize: 14 },
  batchTrainer: { ...type.caption, color: palette.textMuted },
  batchMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  batchMeta: { ...type.caption, color: palette.textMuted, flex: 1 },

  // Premium banner
  premiumBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: palette.purple.vivid,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.raised,
  },
  premiumTitle: { ...type.h3, color: '#fff', fontSize: 15 },
  premiumBody: { ...type.caption, color: 'rgba(255,255,255,0.85)', marginTop: 2 },

  // Sticky bottom bar
  stickyBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: palette.surface,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopWidth: 1, borderTopColor: palette.borderSoft,
    ...shadows.raised,
  },
  stickyPriceLabel: { ...type.micro, color: palette.textMuted, letterSpacing: 0.5 },
  stickyPrice: { ...type.h2, color: palette.text, fontSize: 18 },
  enrollBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: palette.purple.vivid,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    borderRadius: radius.pill,
    ...shadows.raised,
  },
  enrollBtnText: { ...type.bodyBold, color: '#fff' },

  // Empty
  emptyTitle: { ...type.h1, color: palette.text, marginTop: spacing.md },
  emptyBody: { ...type.body, color: palette.textMuted, textAlign: 'center', marginTop: spacing.sm, maxWidth: 300 },
  ctaButton: {
    backgroundColor: palette.purple.vivid,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    borderRadius: radius.pill,
    marginTop: spacing.xl,
  },
  ctaText: { ...type.bodyBold, color: '#fff' },

  // ── Batch picker bottom sheet ────────────────────────────────────
  pickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,10,40,0.55)',
  },
  pickerSheet: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    backgroundColor: palette.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: spacing.xl,
    ...shadows.raised,
  },
  pickerHandle: {
    alignSelf: 'center',
    width: 44, height: 4,
    borderRadius: 2,
    backgroundColor: palette.borderSoft,
    marginTop: 10,
    marginBottom: 8,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  pickerTitle: { ...type.h1, color: palette.text, fontSize: 20 },
  pickerSub:   { ...type.caption, color: palette.textMuted, marginTop: 2 },
  pickerClose: {
    width: 34, height: 34,
    borderRadius: 17,
    backgroundColor: palette.bg,
    alignItems: 'center', justifyContent: 'center',
  },

  pickerCard: {
    backgroundColor: palette.bg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  pickerCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  pickerCardTitle: { ...type.bodyBold, color: palette.text, flex: 1, fontSize: 15 },

  pickerSeatsPill: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: palette.green.soft,
  },
  pickerSeatsPillText: {
    ...type.micro,
    color: palette.green.on,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  pickerSeatsPillLow: { backgroundColor: palette.orange.soft },
  pickerSeatsPillTextLow: { color: palette.orange.on },

  pickerMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    rowGap: 6,
    marginBottom: spacing.sm,
  },
  pickerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: palette.surface,
    paddingHorizontal: 8, paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.borderSoft,
  },
  pickerMetaText: {
    ...type.caption,
    color: palette.textMuted,
    fontWeight: '600',
    maxWidth: 160,
  },

  pickerCardCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
    paddingTop: spacing.sm,
  },
  pickerCardCtaText: {
    ...type.caption,
    color: palette.purple.vivid,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
