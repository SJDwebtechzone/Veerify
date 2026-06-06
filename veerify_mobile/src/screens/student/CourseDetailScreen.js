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
  StatusBar, Dimensions,
} from 'react-native';
import {
  ArrowLeft, Share2, Heart, Star, Users, Clock, Globe,
  PlayCircle, Lock, ChevronRight, CheckCircle2, GraduationCap,
  Award, Calendar, MapPin,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { palette, spacing, radius, shadows, type } from '../../theme';
import YouTubeThumbPlayer from '../../components/YouTubeThumbPlayer';

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

  const isGuest = !user;
  const isPaid = false; // Phase 2

  const load = useCallback(async () => {
    try {
      const [progRes, batchRes] = await Promise.all([
        apiClient.get(`/courses/${courseId}`).catch(() => ({ data: { course: null } })),
        apiClient.get(`/batches/course/${courseId}`).catch(() => ({ data: { batches: [] } })),
      ]);
      setProgram(progRes.data.course || progRes.data.program || null);
      setBatches(batchRes.data.batches || []);
    } catch (err) {
      console.log('[ProgramDetail] load error:', err?.message);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => { load(); }, [load]);

  const triggerPaywall = (action) => {
    if (isGuest) {
      Alert.alert(
        'Login to Continue Learning',
        `Sign in to ${action.toLowerCase()} and unlock your training.`,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Login', onPress: () => navigation.getParent()?.navigate('Login') },
        ],
      );
      return true;
    }
    if (!isPaid) {
      Alert.alert(
        'Subscribe to Unlock Premium Access',
        `${action} requires an active subscription. Pick a plan from your Profile.`,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'View Plans', onPress: () => navigation.navigate('Profile') },
        ],
      );
      return true;
    }
    return false;
  };

  const handleEnroll = () => {
    // Guests must log in first — the enrollment form is per-user.
    if (isGuest) {
      Alert.alert(
        'Login to Continue Learning',
        'Sign in to enroll in this program.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Login', onPress: () => navigation.getParent()?.navigate('Login') },
        ],
      );
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

    // Multiple batches — pop a chooser. Alert.alert supports up to 3 buttons
    // on Android (plus Cancel), so we cap at 3; if you ever need more, swap
    // this for a real bottom-sheet.
    const top = availableBatches.slice(0, 3);
    Alert.alert(
      'Pick a batch',
      'Which batch would you like to enroll in?',
      [
        { text: 'Cancel', style: 'cancel' },
        ...top.map((b) => ({
          text: `${b.name}${b.start_time ? ' · ' + b.start_time.slice(0, 5) : ''}`,
          onPress: () => navigation.navigate('EnrollmentForm', {
            batch: { ...b, course_price: program.price },
            course: courseSummary,
          }),
        })),
      ],
      { cancelable: true },
    );
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
    try {
      const link = `https://veerify.app/programs/${courseId}`;
      await Share.share({
        message: `Check out "${program?.title || 'this program'}" on Veerify: ${link}`,
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
          {bannerImg ? (
            <Image source={{ uri: bannerImg }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.purple.vivid }]} />
          )}
          <View style={styles.heroOverlay} />
          <View style={styles.heroTopBar}>
            <RoundIconBtn icon={ArrowLeft} onPress={() => navigation.goBack()} />
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
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Intro Video</Text>
          <YouTubeThumbPlayer
            url={program.intro_video_url}
            fallbackImage={bannerImg}
          />
        </View>

        {/* ── Trainer ──────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Trainer</Text>
          <TouchableOpacity
            onPress={() => Alert.alert('Trainer profile', 'Full trainer profile lands next.')}
            activeOpacity={0.85}
            style={styles.trainerCard}
          >
            {trainerAvatar ? (
              <Image source={{ uri: trainerAvatar }} style={styles.trainerAvatar} />
            ) : (
              <View style={[styles.trainerAvatar, { backgroundColor: palette.purple.vivid, alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={styles.trainerInitial}>
                  {(program.trainer_name || program.trainer || 'V').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
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
        {!isPaid ? (
          <View style={{ paddingHorizontal: spacing.xl, marginTop: spacing.lg }}>
            <View style={styles.premiumBanner}>
              <Lock size={20} color="#fff" strokeWidth={2.4} />
              <View style={{ flex: 1 }}>
                <Text style={styles.premiumTitle}>Unlock the full program</Text>
                <Text style={styles.premiumBody}>
                  Subscribe to watch all lessons, join live classes, and earn a certificate.
                </Text>
              </View>
            </View>
          </View>
        ) : null}
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
});
