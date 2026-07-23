// src/screens/staff/StaffStudentDetailScreen.js
//
// Step 5 of the Staff module - detailed student profile.
//
// Layout:
//   1. Hero - red gradient header with back button, big circular avatar,
//      name, gender + age, batch chip, belt category badge.
//   2. Stat strip - three pill cards (Attendance %, Sessions, Performance).
//   3. Recent attendance - mini bar chart of the last 14 sessions colored
//      per status.
//   4. Contact card - email, emergency contact icon (tap to call/email).
//   (Parent details card removed — managed via parent login flow.)
//   6. Belt progression - horizontal timeline with current belt highlighted.
//   7. Leave history - placeholder until /api/leave-requests lands.
//   8. Notes - inline editable section (saved to local state for now).
//
// Data:
//   Receives `student` and `batchId` via route params from StaffStudentsScreen.
//   GET /api/attendance/batch/:id  - records, filtered client-side to this
//                                    student for the chart + counters.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, Linking, TextInput, Image, Alert,
} from 'react-native';
import resolveAssetUrl from '../../utils/assetUrl';
import {
  ArrowLeft, Phone, Mail, Award, TrendingUp, TrendingDown, Minus,
  Calendar, Users, ClipboardList, FileText, Pencil,
  Plane, Clock, X as XIcon, Check, BookOpen, CalendarDays, Star,
} from 'lucide-react-native';

import apiClient from '../../api/client';
import { palette, spacing, radius, shadows, type } from '../../theme';
import { confirm } from '../../components/ConfirmDialog';
import { useFocusEffect } from '@react-navigation/native';

const BELTS = [
  { key: 'white',  label: 'White',  bg: '#FFFFFF', fg: '#111827', border: '#E5E7EB' },
  { key: 'yellow', label: 'Yellow', bg: '#FEF3C7', fg: '#92400E', border: '#F59E0B' },
  { key: 'orange', label: 'Orange', bg: '#FFEDD5', fg: '#9A3412', border: '#F97316' },
  { key: 'green',  label: 'Green',  bg: '#DCFCE7', fg: '#166534', border: '#22C55E' },
  { key: 'blue',   label: 'Blue',   bg: '#DBEAFE', fg: '#1E40AF', border: '#3B82F6' },
  { key: 'gray',   label: 'Gray',   bg: '#F3F4F6', fg: '#374151', border: '#9CA3AF' },
  { key: 'brown',  label: 'Brown',  bg: '#FAEDD5', fg: '#7C2D12', border: '#A16207' },
  { key: 'black',  label: 'Black',  bg: '#1F2937', fg: '#FFFFFF', border: '#0F172A' },
];

// Same alias table the list screen uses — British "grey" → American
// "gray", "New student" / "None" → no belt, etc. Keeping the mapping
// duplicated here (rather than importing) so the detail screen stays
// self-contained; if the list needs to change spellings later, both
// files stay in sync via a copy-paste review.
const BELT_ALIASES = {
  white: 'white', yellow: 'yellow', orange: 'orange', green: 'green',
  blue:  'blue',  gray: 'gray',    grey:   'gray',    brown: 'brown',
  black: 'black',
  none: 'none', 'new': 'none', beginner: 'none',
};

// Resolve a belt-name string ("Grey Belt", "Blue I", "Brown III",
// "New student", or a custom "Other" label) into an index into the
// BELTS array. Returns null when the value maps to "no belt yet",
// so the header renders no badge instead of lying about a belt the
// student hasn't earned. Custom "Other" labels return null too —
// the current display shows just the plain name via a separate
// path where needed.
function beltIndexFromName(name) {
  if (!name) return null;
  let key = String(name).trim().toLowerCase().replace(/\s+belt$/i, '').trim();
  const firstWord = key.split(/\s+/)[0];
  if (!firstWord || firstWord === 'new' || firstWord === 'none') return null;
  const canonical = BELT_ALIASES[firstWord];
  if (!canonical || canonical === 'none') return null;
  const idx = BELTS.findIndex((b) => b.key === canonical);
  return idx >= 0 ? idx : null;
}

// Age from date_of_birth ("YYYY-MM-DD"). Falls back to null when the
// student's DOB isn't on file — the hero then shows just the gender
// without a fake "· 16 yrs" line.
function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 150 ? age : null;
}

const STATUS_META = {
  present: { color: palette.green.vivid,  bg: palette.green.soft,  label: 'Present', icon: Check  },
  absent:  { color: palette.rose.vivid,   bg: palette.rose.soft,   label: 'Absent',  icon: XIcon  },
  late:    { color: palette.orange.vivid, bg: palette.orange.soft, label: 'Late',    icon: Clock  },
  leave:   { color: palette.blue.vivid,   bg: palette.blue.soft,   label: 'Leave',   icon: Plane  },
};

function perfFor(pct) {
  if (pct >= 85) return { icon: TrendingUp,   color: palette.green.vivid,  bg: palette.green.soft,  label: 'Rising' };
  if (pct >= 65) return { icon: Minus,        color: palette.orange.vivid, bg: palette.orange.soft, label: 'Steady' };
  return            { icon: TrendingDown, color: palette.rose.vivid,   bg: palette.rose.soft,   label: 'At risk' };
}

function isoDate(d) { return d.toISOString().split('T')[0]; }

export default function StaffStudentDetailScreen({ navigation, route }) {
  const params = route?.params || {};
  const studentId = params.studentId;
  const batchId = params.batchId;
  // The list passes a snapshot on navigate — but it can drift from
  // the DB (admin edits a profile, payment webhook fires, etc.). We
  // keep the snapshot for the initial paint but replace it with a
  // freshly-fetched row from the server on mount + every focus.
  const passedStudentInitial = params.student || null;
  const [studentRow, setStudentRow] = useState(passedStudentInitial);
  const [enrollmentRows, setEnrollmentRows] = useState(() =>
    passedStudentInitial ? [passedStudentInitial] : [],
  );
  const [attendanceSummary, setAttendanceSummary] = useState({
    present: 0, absent: 0, late: 0, leave: 0, total_marked: 0, percentage: null,
  });
  // `passedStudent` still exists downstream; keep the reference so the
  // huge existing render tree that reads `passedStudent.*` doesn't need
  // per-line surgery. It always points at the freshest data available.
  const passedStudent = studentRow;

  const [records, setRecords] = useState([]);    // attendance for this student
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');        // local-only for now
  const [editingNotes, setEditingNotes] = useState(false);

  // ── Curriculum progress ──
  // `lessons` is the JSONB array stored on the course (title/duration/is_free).
  // `progressByIdx` maps lesson_index -> { completed_at, completed_by_name }.
  // `pickerForIdx` (number | null) opens the inline date picker for the
  // lesson the trainer just tapped, so they can pick when the work
  // actually happened rather than always defaulting to today.
  const [lessons, setLessons] = useState([]);
  const [progressByIdx, setProgressByIdx] = useState({});
  const [pickerForIdx, setPickerForIdx] = useState(null);
  const [savingIdx, setSavingIdx] = useState(null);

  const courseId = passedStudent?.course_id || null;
  const courseName = passedStudent?.course_name || null;

  // ── Fresh detail fetch ──
  // Pulls the full detail row for THIS student from the trainer
  // endpoint. Runs on mount AND on every focus (useFocusEffect
  // below) so a switch back from the list — or from EditStudent, or
  // from an admin action that changed the row — always renders the
  // latest DB truth.
  //
  // The endpoint 403s if the trainer doesn't teach this student,
  // which is the guarantee that "only students assigned to the
  // logged-in trainer" ever land here.
  const loadFreshDetail = useCallback(async () => {
    if (!studentId) return;
    try {
      const res = await apiClient.get(`/enrollments/trainer/student/${studentId}`);
      const data = res.data || {};
      const s = data.student || {};
      const enrolments = Array.isArray(data.enrollments) ? data.enrollments : [];
      // Prefer the first enrolment as the "primary" for the header
      // if the caller didn't pass a batch — but keep all of them for
      // the enrolment strip below.
      const primary = enrolments.find((e) => Number(e.batch_id) === Number(batchId))
        || enrolments[0]
        || null;

      // Flatten into the shape the existing render tree expects
      // (passedStudent.* reads scattered through the file).
      const merged = {
        // Keep the previous snapshot as a floor so a slow network
        // doesn't blank existing UI mid-render.
        ...(studentRow || {}),
        student_id:              s.student_id,
        student_name:            s.display_name || s.student_name,
        student_email:           s.student_email,
        student_phone:           s.student_phone,
        student_photo_url:       s.photo_url,
        student_gender:          s.gender,
        student_date_of_birth:   s.date_of_birth,
        student_address:         s.address,
        father_name:             s.father_name,
        mother_name:             s.mother_name,
        contact_number:          s.contact_number,
        emergency_contact:       s.emergency_contact,
        blood_group:             s.blood_group,
        belt_category:           s.belt_category,
        health_notes:            s.health_notes,
        // Enrolment/course/batch/institution — comes from the primary row.
        course_id:               primary?.course_id ?? studentRow?.course_id ?? null,
        course_name:             primary?.course_name ?? studentRow?.course_name ?? null,
        course_category:         primary?.course_category ?? studentRow?.course_category ?? null,
        course_billing_cycle:    primary?.course_billing_cycle ?? null,
        course_price:            primary?.course_price ?? null,
        batch_id:                primary?.batch_id ?? studentRow?.batch_id ?? batchId ?? null,
        batch_name:              primary?.batch_name ?? studentRow?.batch_name ?? null,
        days_of_week:            primary?.days_of_week ?? studentRow?.days_of_week ?? null,
        start_time:              primary?.start_time ?? studentRow?.start_time ?? null,
        end_time:                primary?.end_time ?? studentRow?.end_time ?? null,
        batch_branch_name:       primary?.institution_name ?? studentRow?.batch_branch_name ?? null,
        // Payment fields — refreshed so a webhook that just fired
        // shows up without a full re-navigate.
        enrollment_id:           primary?.enrollment_id ?? studentRow?.enrollment_id ?? null,
        payment_status:          primary?.payment_status ?? studentRow?.payment_status ?? null,
        payment_amount:          primary?.payment_amount ?? studentRow?.payment_amount ?? null,
        payment_mode:            primary?.payment_mode ?? studentRow?.payment_mode ?? null,
        paid_at:                 primary?.paid_at ?? studentRow?.paid_at ?? null,
        payment_reference:       primary?.payment_reference ?? studentRow?.payment_reference ?? null,
      };
      setStudentRow(merged);
      setEnrollmentRows(enrolments);
      if (data.attendance) setAttendanceSummary(data.attendance);
    } catch (err) {
      // 403 → trainer doesn't teach this student. Kick back to list
      // with a friendly note instead of silently showing stale data.
      if (err?.response?.status === 403) {
        confirm({
          title:       'Not in your roster',
          message:     'This student is not enrolled in any of your batches.',
          variant:     'warning',
          confirmText: 'Back',
          hideCancel:  true,
          onConfirm:   () => { try { navigation.goBack(); } catch (_) {} },
        });
      }
      // Otherwise stay on the snapshot silently. Attendance load
      // below still runs.
      // eslint-disable-next-line no-console
      console.log('[StudentDetail] fresh fetch failed:',
        err?.response?.status, err?.response?.data?.message || err?.message);
    }
  }, [studentId, batchId, studentRow, navigation]);

  // ── Pull attendance for this batch and filter client-side ──
  const load = useCallback(async () => {
    if (!batchId || !studentId) { setLoading(false); return; }
    try {
      const res = await apiClient.get(`/attendance/batch/${batchId}`).catch(() => ({ data: { attendance: [] } }));
      const mine = (res.data?.attendance || []).filter((r) => Number(r.student_id) === Number(studentId));
      // newest first by date
      mine.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      setRecords(mine);
    } finally {
      setLoading(false);
    }
  }, [batchId, studentId]);
  useEffect(() => { load(); loadFreshDetail(); }, [load, loadFreshDetail]);
  // Re-fetch on focus so a return from Edit / Payment / Attendance
  // immediately re-renders with the latest DB truth. No stale
  // "up-to-date info" complaints.
  useFocusEffect(useCallback(() => {
    load();
    loadFreshDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, batchId]));

  // Pull the course's curriculum + this student's existing ticks. Re-runs
  // whenever the trainer drills into a new student so saved state is in
  // sync with the backend.
  const loadCurriculum = useCallback(async () => {
    if (!studentId || !courseId) return;
    try {
      const res = await apiClient.get(
        `/curriculum-progress?student_id=${studentId}&course_id=${courseId}`,
      );
      setLessons(Array.isArray(res.data?.lessons) ? res.data.lessons : []);
      const map = {};
      (res.data?.progress || []).forEach((p) => {
        map[p.lesson_index] = p;
      });
      setProgressByIdx(map);
    } catch (err) {
      console.log('[StudentDetail] curriculum load failed:', err?.response?.data || err?.message);
    }
  }, [studentId, courseId]);
  useEffect(() => { loadCurriculum(); }, [loadCurriculum]);

  // Toggle a lesson. If already completed → DELETE. Otherwise → upsert
  // with the picked date (or today as the fallback when no date picker
  // was opened).
  //
  // Course-completion handoff: when the tick brings the total number of
  // completed lessons up to the full length of the curriculum, we pop
  // the "Course completed. Proceed to Belt Test?" dialog. On Yes we
  // POST to /course-completions which places a row on the trainer's
  // Completed Students queue.
  const toggleLesson = async (idx, dateOverride) => {
    if (!studentId || !courseId) return;
    const current = progressByIdx[idx];
    setSavingIdx(idx);
    try {
      if (current && !dateOverride) {
        await apiClient.delete('/curriculum-progress', {
          data: { student_id: studentId, course_id: courseId, lesson_index: idx },
        });
        setProgressByIdx((prev) => {
          const { [idx]: _drop, ...rest } = prev;
          return rest;
        });
      } else {
        const res = await apiClient.post('/curriculum-progress', {
          student_id:   studentId,
          course_id:    courseId,
          lesson_index: idx,
          completed_at: dateOverride || new Date().toISOString().slice(0, 10),
        });
        const updated = {
          ...progressByIdx,
          [idx]: res.data?.progress || {
            lesson_index: idx,
            completed_at: dateOverride || isoDate(new Date()),
          },
        };
        setProgressByIdx(updated);

        // Did that tick complete the whole curriculum? Fire the
        // handoff dialog exactly once — 260 ms delay so the row's
        // spinner UI settles before the modal slides in (avoids the
        // Android Modal-during-transition swallow bug).
        const isFullyDone =
          lessons.length > 0 &&
          Object.keys(updated).length >= lessons.length;
        if (isFullyDone) {
          setTimeout(() => promptBeltTest(), 260);
        }
      }
    } catch (err) {
      console.log('[StudentDetail] toggle failed:', err?.response?.data || err?.message);
    } finally {
      setSavingIdx(null);
      setPickerForIdx(null);
    }
  };

  // Show the branded "Course completed. Proceed to Belt Test?" dialog
  // and, on Yes, register the completion on the backend. The row lands
  // on Trainer Login → Quick Actions → Completed Students.
  const promptBeltTest = () => {
    confirm({
      title:       'Course completed 🎉',
      message:     'Every lesson in the curriculum is now marked. Proceed to Belt Test?',
      variant:     'success',
      confirmText: 'Yes',
      cancelText:  'No',
      onConfirm: () => {
        (async () => {
          try {
            await apiClient.post('/course-completions', {
              student_id: studentId,
              course_id:  courseId,
              batch_id:   batchId || null,
            });
            setTimeout(() => {
              confirm({
                title:       'Moved to Completed Students',
                message:     'You can now record the belt-test remarks from Quick Actions → Completed Students.',
                variant:     'success',
                confirmText: 'Open now',
                cancelText:  'Later',
                onConfirm:   () => navigation.navigate('StaffCompletedStudents'),
              });
            }, 260);
          } catch (err) {
            const msg = err?.response?.data?.message ||
                        'Could not mark the course complete. Please try again.';
            setTimeout(() => {
              confirm({
                title: 'Something went wrong',
                message: msg,
                variant: 'warning',
                confirmText: 'OK',
                hideCancel: true,
              });
            }, 260);
          }
        })();
      },
    });
  };

  // ── Derive everything from records + passed student ──
  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, leave: 0 };
    records.forEach((r) => { if (c[r.status] !== undefined) c[r.status]++; });
    return c;
  }, [records]);

  const totalSessions = records.length;
  const pct = totalSessions ? Math.round((counts.present / totalSessions) * 100) : null;
  const perf = perfFor(pct ?? 0);
  const PerfIcon = perf.icon;

  const recentSessions = records.slice(0, 14).reverse(); // for left-to-right chart

  // Belt — for now the belt journey isn't wired here yet, so if we don't
  // know the student's real belt we hide the "current belt" header pill
  // entirely (previously we invented a belt from the id and it was
  // misleading — the student appeared to have a Yellow Belt they hadn't
  // actually earned).
  // Prefer the student_profiles.belt_category the admin set (via the
  // enrolment form). Fall back to any older `current_belt_name`
  // signal in case the row came from a different endpoint shape.
  const beltName = passedStudent?.belt_category
    || passedStudent?.current_belt_name
    || null;
  const beltIdx = beltIndexFromName(beltName);
  const currentBelt = beltIdx !== null ? BELTS[beltIdx] : null;

  const name = passedStudent?.student_name || passedStudent?.name || 'Student';
  const email = passedStudent?.student_email || passedStudent?.email || null;
  const phone = passedStudent?.student_phone || passedStudent?.phone || null;
  // Prefer real gender / DOB from the trainer roster endpoint; fall back
  // to hiding those fields when the profile hasn't been captured yet.
  const gender = passedStudent?.student_gender || null;
  const age    = ageFromDob(passedStudent?.student_date_of_birth);
  const batchName  = passedStudent?.batch_name || null;
  // `courseName` is already declared at the top of the component (used by
  // the curriculum-progress loader). Reuse it here — declaring it again
  // shadows the earlier `const` and errors at parse time.
  const branchName = passedStudent?.batch_branch_name || null;
  const photoUrl = passedStudent?.student_photo_url
    ? resolveAssetUrl(passedStudent.student_photo_url)
    : null;

  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  // ── Actions ──
  // Dial the student's phone if we have one; fall back to their email.
  // The old behavior was mailto-only which felt broken from a screen
  // whose emergency-contact row shows a Phone icon.
  const callStudent = () => {
    if (phone) {
      const cleaned = String(phone).replace(/[^0-9+]/g, '');
      if (cleaned) {
        Linking.openURL(`tel:${cleaned}`).catch(() =>
          Alert.alert('Could not place call', 'Your device did not accept the dialer link.'),
        );
        return;
      }
    }
    if (email) {
      Linking.openURL(`mailto:${email}`).catch(() => {});
      return;
    }
    Alert.alert('No contact on file', 'No phone or email saved for this student yet.');
  };

  // ── Render ──
  return (
    <View style={styles.screen}>
      {/* Hero header */}
      <View style={styles.hero}>
        <View style={styles.heroTopRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.heroIconBtn}>
            <ArrowLeft size={20} color="#fff" strokeWidth={2.4} />
          </TouchableOpacity>
          <Text style={styles.heroTitle}>Student Profile</Text>
          <View style={{ width: 36 }} />
        </View>

        <View style={styles.heroBody}>
          <View style={styles.heroAvatar}>
            {photoUrl ? (
              <Image
                source={{ uri: photoUrl }}
                style={styles.heroAvatarImg}
                resizeMode="cover"
              />
            ) : (
              <Text style={styles.heroAvatarText}>{initials}</Text>
            )}
          </View>
          <Text style={styles.heroName} numberOfLines={1}>{name}</Text>

          {/* Meta row — only render each chunk when we actually have the
              data. This replaces the old "Male · 28 yrs · Batch 1" line
              that was mostly derived from the student's id. */}
          {(gender || age !== null || batchName) ? (
            <View style={styles.heroMetaRow}>
              {(gender || age !== null) ? (
                <>
                  <Users size={12} color="rgba(255,255,255,0.85)" strokeWidth={2.4} />
                  <Text style={styles.heroMetaText}>
                    {[gender, age !== null ? `${age} yrs` : null].filter(Boolean).join(' · ')}
                  </Text>
                </>
              ) : null}
              {(gender || age !== null) && batchName ? <View style={styles.heroDot} /> : null}
              {batchName ? (
                <>
                  <Calendar size={12} color="rgba(255,255,255,0.85)" strokeWidth={2.4} />
                  <Text style={styles.heroMetaText} numberOfLines={1}>{batchName}</Text>
                </>
              ) : null}
            </View>
          ) : null}

          {/* Course + branch chip line — shows what the student is
              studying and where. Only renders when we actually know. */}
          {(courseName || branchName) ? (
            <Text style={styles.heroSubline} numberOfLines={1}>
              {[courseName, branchName].filter(Boolean).join(' · ')}
            </Text>
          ) : null}

          {/* Belt pill — only when we know the real current belt. We
              used to invent one from the id, which lied about what the
              student had actually been promoted to. */}
          {currentBelt ? (
            <View style={[styles.heroBelt, { backgroundColor: currentBelt.bg, borderColor: currentBelt.border }]}>
              <Award size={11} color={currentBelt.fg} strokeWidth={2.4} />
              <Text style={[styles.heroBeltText, { color: currentBelt.fg }]}>{currentBelt.label} Belt</Text>
            </View>
          ) : null}
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        showsVerticalScrollIndicator={false}
      >
        {/* Stat strip */}
        <View style={styles.statStrip}>
          <StatPill
            icon={Award}
            label="Attendance"
            value={pct === null ? '-' : `${pct}%`}
            accent={palette.green}
          />
          <StatPill
            icon={Calendar}
            label="Sessions"
            value={totalSessions}
            accent={palette.blue}
          />
          <StatPill
            icon={PerfIcon}
            label="Trend"
            value={perf.label}
            accent={{ soft: perf.bg, vivid: perf.color, on: perf.color }}
          />
        </View>

        {/* Recent attendance chart */}
        <Card title="Recent attendance" icon={ClipboardList}>
          {loading ? (
            <ActivityIndicator color={palette.purple.vivid} />
          ) : recentSessions.length === 0 ? (
            <View style={styles.emptyInline}>
              <View style={styles.emptyInlineIcon}>
                <ClipboardList size={16} color={palette.textLight} strokeWidth={2.2} />
              </View>
              <Text style={styles.emptyInlineTitle}>No attendance yet</Text>
              <Text style={styles.emptyInlineSub}>
                Once you mark this batch, the last 14 sessions show up here.
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.chartRow}>
                {recentSessions.map((r, i) => {
                  const meta = STATUS_META[r.status] || STATUS_META.present;
                  const height = r.status === 'present' ? 36 : r.status === 'late' ? 26 : r.status === 'leave' ? 22 : 14;
                  return (
                    <View key={i} style={styles.chartBarWrap}>
                      <View style={[styles.chartBar, { height, backgroundColor: meta.color }]} />
                    </View>
                  );
                })}
              </View>
              {/* Legend with counts */}
              <View style={styles.legendRow}>
                <LegendItem label="Present" value={counts.present} status="present" />
                <LegendItem label="Late"    value={counts.late}    status="late"    />
                <LegendItem label="Leave"   value={counts.leave}   status="leave"   />
                <LegendItem label="Absent"  value={counts.absent}  status="absent"  />
              </View>
            </>
          )}
        </Card>

        {/* Contact card */}
        <Card title="Contact" icon={Phone}>
          {/* Phone — shown first because it's the trainer's fastest
              way to actually reach the student. Falls back to an
              unobtrusive "Not provided" when the profile is empty. */}
          <ContactRow
            icon={Phone}
            label="Phone"
            value={phone || 'Not provided'}
            muted={!phone}
            onPress={phone ? callStudent : null}
            ctaLabel={phone ? 'Call' : null}
          />
          <View style={styles.divider} />
          <ContactRow
            icon={Mail}
            label="Email"
            value={email || 'Not provided'}
            muted={!email}
            onPress={email ? () => Linking.openURL(`mailto:${email}`).catch(() => {}) : null}
            ctaLabel={email ? 'Email' : null}
          />
        </Card>

        {/* Parent details card intentionally removed for the trainer
            view — the placeholder added noise without giving the trainer
            anything actionable. Parent linkage is managed via the parent
            login flow, not from here. */}

        {/* Belt progression timeline. When we haven't recorded the
            student's current belt yet, we mark them at "White" (the
            starting belt) so the timeline still communicates the path
            ahead without pretending they've already been promoted. */}
        <Card title="Belt progression" icon={Award}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.md, paddingRight: spacing.md }}
          >
            {BELTS.map((b, i) => {
              const anchor  = beltIdx !== null ? beltIdx : 0;
              const reached = i <= anchor;
              const current = i === anchor;
              const next    = i === anchor + 1;
              return (
                <View key={b.key} style={styles.beltStep}>
                  <View
                    style={[
                      styles.beltCircle,
                      {
                        backgroundColor: reached ? b.bg : palette.borderSoft + '55',
                        borderColor: reached ? b.border : palette.borderSoft,
                      },
                      current && { transform: [{ scale: 1.12 }] },
                    ]}
                  >
                    {reached ? (
                      <Award size={14} color={b.fg} strokeWidth={2.4} />
                    ) : (
                      <View style={styles.beltStepDot} />
                    )}
                  </View>
                  <Text
                    style={[
                      styles.beltStepLabel,
                      !reached && { color: palette.textLight },
                      current  && { color: palette.text, fontWeight: '800' },
                      next     && { color: palette.purple.vivid, fontWeight: '700' },
                    ]}
                  >
                    {b.label}
                  </Text>
                  {current ? <Text style={styles.beltStepPill}>Current</Text> : null}
                  {next    ? <Text style={[styles.beltStepPill, { color: palette.purple.on, backgroundColor: palette.purple.soft }]}>Next</Text> : null}
                </View>
              );
            })}
          </ScrollView>
        </Card>

        {/* Leave history (placeholder) */}
        <Card title="Leave history" icon={Plane}>
          {counts.leave === 0 ? (
            <View style={styles.emptyInline}>
              <View style={styles.emptyInlineIcon}>
                <Plane size={16} color={palette.textLight} strokeWidth={2.2} />
              </View>
              <Text style={styles.emptyInlineTitle}>No sanctioned leave</Text>
              <Text style={styles.emptyInlineSub}>
                Approved leave from the Leave Requests screen will land here.
              </Text>
            </View>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {records.filter((r) => r.status === 'leave').slice(0, 5).map((r, i) => (
                <View key={i} style={styles.leaveRow}>
                  <View style={styles.leaveDot} />
                  <Text style={styles.leaveDate}>{r.date?.slice?.(0, 10) || String(r.date)}</Text>
                  <Text style={styles.leaveLabel}>Marked as leave</Text>
                </View>
              ))}
              {counts.leave > 5 ? (
                <Text style={styles.placeholderText}>+ {counts.leave - 5} more</Text>
              ) : null}
            </View>
          )}
        </Card>

        {/* Curriculum progress — checklist of every lesson on the
            student's enrolled course. Each row is tappable to mark /
            unmark, and the "Pick date" pill opens an inline date picker
            so the trainer can attribute the work to the right day. */}
        <Card
          title="Curriculum progress"
          icon={BookOpen}
          right={
            lessons.length > 0 ? (
              <View style={styles.cardActionBtn}>
                <Text style={styles.cardActionText}>
                  {Object.keys(progressByIdx).length}/{lessons.length}
                </Text>
              </View>
            ) : null
          }
        >
          {!courseId ? (
            <Text style={styles.placeholderText}>
              Curriculum is tied to the student's course. We couldn't
              read the course id from this profile — open them again
              from the Students tab to refresh.
            </Text>
          ) : lessons.length === 0 ? (
            <Text style={styles.placeholderText}>
              {courseName ? `"${courseName}" has no lessons yet. ` : ''}
              Add lessons to the course curriculum and they'll appear
              here as a checklist.
            </Text>
          ) : (
            <View>
              <Text style={[styles.placeholderText, { marginBottom: spacing.sm }]}>
                {courseName || 'Course'} · tap a lesson to mark it done; tap "Pick date" to set a different completion date.
              </Text>
              {lessons.map((lesson, idx) => {
                const done    = !!progressByIdx[idx];
                const saving  = savingIdx === idx;
                const pickOpen = pickerForIdx === idx;
                const dateStr = progressByIdx[idx]?.completed_at?.slice?.(0, 10) || null;
                // Student-side feedback (rating + remarks + when they
                // last updated). Shown below the lesson meta row when
                // the student has submitted any feedback.
                const sRating  = Number(progressByIdx[idx]?.student_rating)  || 0;
                const sRemarks = (progressByIdx[idx]?.student_remarks || '').toString().trim();
                const sUpdated = progressByIdx[idx]?.student_remarked_at || null;
                const hasFeedback = sRating > 0 || sRemarks.length > 0;
                return (
                  <View key={idx} style={styles.lessonRow}>
                    <TouchableOpacity
                      style={[styles.lessonCheckbox, done && styles.lessonCheckboxOn]}
                      onPress={() => toggleLesson(idx)}
                      disabled={saving}
                      activeOpacity={0.8}
                    >
                      {done ? <Check size={14} color="#fff" strokeWidth={3} /> : null}
                    </TouchableOpacity>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.lessonTitle,
                          done && { textDecorationLine: 'line-through', color: palette.textMuted },
                        ]}
                        numberOfLines={2}
                      >
                        {lesson.title || `Lesson ${idx + 1}`}
                      </Text>
                      <View style={styles.lessonMetaRow}>
                        {lesson.duration ? (
                          <View style={styles.lessonDurChip}>
                            <Clock size={10} color={palette.textMuted} strokeWidth={2.4} />
                            <Text style={styles.lessonDurText}>{lesson.duration}</Text>
                          </View>
                        ) : null}
                        {done && dateStr ? (
                          <View style={styles.lessonDoneChip}>
                            <CalendarDays size={10} color={palette.green.vivid} strokeWidth={2.4} />
                            <Text style={styles.lessonDoneText}>
                              {new Date(dateStr).toLocaleDateString(undefined, {
                                day: 'numeric', month: 'short', year: 'numeric',
                              })}
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      {/* Student-submitted feedback (rating + remarks + the
                          timestamp of their last update). Read-only on the
                          trainer side — the trainer can't edit it, only
                          see what the student wrote. */}
                      {hasFeedback ? (
                        <View style={styles.feedbackStrip}>
                          {sRating > 0 ? (
                            <View style={styles.feedbackStarsRow}>
                              {[1, 2, 3, 4, 5].map((n) => (
                                <Star
                                  key={n}
                                  size={12}
                                  color={n <= sRating ? '#F59E0B' : '#E5E7EB'}
                                  fill={n <= sRating ? '#F59E0B' : 'transparent'}
                                  strokeWidth={2.2}
                                />
                              ))}
                              {sUpdated ? (
                                <Text style={styles.feedbackUpdatedText}>
                                  · Updated {new Date(sUpdated).toLocaleDateString(undefined, {
                                    day: 'numeric', month: 'short', year: 'numeric',
                                  })}
                                </Text>
                              ) : null}
                            </View>
                          ) : null}
                          {sRemarks ? (
                            <Text style={styles.feedbackRemarkText} numberOfLines={3}>
                              “{sRemarks}”
                            </Text>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                    <TouchableOpacity
                      style={styles.lessonDateBtn}
                      onPress={() => setPickerForIdx(pickOpen ? null : idx)}
                      activeOpacity={0.8}
                    >
                      <CalendarDays size={12} color={palette.purple.vivid} strokeWidth={2.4} />
                      <Text style={styles.lessonDateBtnText}>Pick date</Text>
                    </TouchableOpacity>

                    {/* Inline date picker — last 30 days as quick-pick
                        chips. Keeps things native-feeling without
                        pulling in a DateTimePicker dependency. */}
                    {pickOpen ? (
                      <View style={styles.lessonDatePanel}>
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={{ gap: 6, paddingHorizontal: 4 }}
                        >
                          {Array.from({ length: 14 }).map((_, dOff) => {
                            const d = new Date();
                            d.setDate(d.getDate() - dOff);
                            const iso = isoDate(d);
                            const isSel = dateStr === iso;
                            return (
                              <TouchableOpacity
                                key={iso}
                                style={[styles.lessonDateChip, isSel && styles.lessonDateChipOn]}
                                onPress={() => toggleLesson(idx, iso)}
                                disabled={saving}
                                activeOpacity={0.85}
                              >
                                <Text style={[styles.lessonDateChipDay, isSel && { color: '#fff' }]}>
                                  {d.toLocaleDateString(undefined, { weekday: 'short' })}
                                </Text>
                                <Text style={[styles.lessonDateChipDate, isSel && { color: '#fff' }]}>
                                  {d.getDate()} {d.toLocaleDateString(undefined, { month: 'short' })}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </Card>

        {/* Notes */}
        <Card
          title="Notes"
          icon={FileText}
          right={
            <TouchableOpacity
              onPress={() => setEditingNotes((v) => !v)}
              style={styles.cardActionBtn}
              activeOpacity={0.8}
            >
              <Pencil size={12} color={palette.purple.vivid} strokeWidth={2.4} />
              <Text style={styles.cardActionText}>{editingNotes ? 'Done' : 'Edit'}</Text>
            </TouchableOpacity>
          }
        >
          {editingNotes ? (
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Add a note about this student..."
              placeholderTextColor={palette.textLight}
              multiline
              style={styles.notesInput}
            />
          ) : notes ? (
            <Text style={styles.notesText}>{notes}</Text>
          ) : (
            <Text style={styles.placeholderText}>
              No notes yet. Tap "Edit" to write something.
            </Text>
          )}
        </Card>
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

function StatPill({ icon: Icon, label, value, accent }) {
  // Matches the trainer StaffProfile stat strip — left-aligned pill
  // with a small tinted icon in the top-left, the value in the dark
  // brand color, and the label underneath.
  return (
    <View style={styles.statPill}>
      <View style={[styles.statPillIcon, { backgroundColor: accent.soft }]}>
        <Icon size={14} color={accent.vivid} strokeWidth={2.4} />
      </View>
      <Text style={styles.statPillValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.statPillLabel}>{label}</Text>
    </View>
  );
}

function Card({ title, icon: Icon, right, children }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          {Icon ? (
            <View style={styles.cardHeaderIcon}>
              <Icon size={12} color={palette.purple.vivid} strokeWidth={2.4} />
            </View>
          ) : null}
          <Text style={styles.cardTitle}>{title}</Text>
        </View>
        {right || null}
      </View>
      <View style={styles.cardBody}>{children}</View>
    </View>
  );
}

function ContactRow({ icon: Icon, label, value, muted, onPress, ctaLabel }) {
  const Body = (
    <View style={styles.contactRow}>
      <View style={styles.contactIcon}>
        <Icon size={14} color={palette.purple.vivid} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.contactLabel}>{label}</Text>
        <Text style={[styles.contactValue, muted && { color: palette.textMuted }]} numberOfLines={1}>{value}</Text>
      </View>
      {onPress && ctaLabel ? (
        <View style={styles.contactCta}>
          <Text style={styles.contactCtaText}>{ctaLabel}</Text>
        </View>
      ) : null}
    </View>
  );
  if (!onPress) return Body;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      {Body}
    </TouchableOpacity>
  );
}

function LegendItem({ label, value, status }) {
  const meta = STATUS_META[status];
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: meta.color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
      <Text style={styles.legendValue}>{value}</Text>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },

  // Hero — normal padding, pills no longer overlap so the red card
  // ends cleanly and every pill icon stays fully visible.
  hero: {
    backgroundColor: palette.purple.vivid,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl + 4,
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroIconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  heroTitle: { ...type.h2, color: '#fff', fontWeight: '700' },
  heroBody: { alignItems: 'center', marginTop: spacing.lg },
  heroAvatar: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.4)',
    marginBottom: spacing.md,
  },
  heroAvatarText: { color: palette.purple.vivid, fontSize: 28, fontWeight: '800' },
  // Photo variant of the avatar — same round crop as the initials slot,
  // uses object-cover so square photos land nicely.
  heroAvatarImg: {
    width: '100%', height: '100%', borderRadius: 999,
  },
  // Small course/branch line under the meta row.
  heroSubline: {
    ...type.caption,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600',
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  heroName: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  heroMetaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  heroMetaText: { ...type.caption, color: 'rgba(255,255,255,0.85)', fontWeight: '700' },
  heroDot: {
    width: 3, height: 3, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.5)',
    marginHorizontal: 4,
  },
  heroBelt: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginTop: spacing.md,
  },
  heroBeltText: { ...type.caption, fontWeight: '800' },

  // Stat strip — sits fully below the red hero with a small breathing
  // gap so the pill icons never touch the hero's rounded bottom edge.
  // We keep the trainer-profile pill styling (left-aligned icon + value
  // + label) but remove the negative overlap that was clipping icons.
  statStrip: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.md,
  },
  // Trainer-profile match: left-aligned pill, tinted round icon at
  // the top-left, big dark value below it, muted uppercase label.
  statPill: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  statPillIcon: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  statPillValue: {
    ...type.h1,
    color: palette.text,
    fontSize: 18,
  },
  statPillLabel: {
    ...type.micro,
    color: palette.textMuted,
    fontWeight: '700',
  },

  // Card
  card: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    ...shadows.card,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardHeaderIcon: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { ...type.bodyBold, color: palette.text, fontSize: 13 },
  cardBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },

  cardActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.purple.soft,
  },
  cardActionText: { ...type.micro, color: palette.purple.on, fontWeight: '800' },

  placeholderText: { ...type.caption, color: palette.textMuted, fontStyle: 'italic' },
  // Inline empty state — used inside cards ("Recent attendance", "Leave
  // history") when there's nothing to render. Small round icon + short
  // title + subtitle so the card doesn't just say "italics text".
  emptyInline: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: 6,
  },
  emptyInlineIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: palette.borderSoft + '99',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  emptyInlineTitle: {
    ...type.bodyBold,
    color: palette.text,
    fontSize: 13,
  },
  emptyInlineSub: {
    ...type.micro,
    color: palette.textMuted,
    textAlign: 'center',
    fontWeight: '600',
    lineHeight: 14,
    paddingHorizontal: spacing.md,
  },

  // Curriculum checklist
  lessonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.borderSoft,
    flexWrap: 'wrap',
  },
  lessonCheckbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: palette.border,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
    backgroundColor: '#fff',
  },
  lessonCheckboxOn: { backgroundColor: '#E63946', borderColor: '#E63946' },
  lessonTitle: { ...type.body, color: palette.text, fontWeight: '700' },
  lessonMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  lessonDurChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    backgroundColor: palette.borderSoft,
    borderRadius: 999,
  },
  lessonDurText: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  lessonDoneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    backgroundColor: palette.green.soft,
    borderRadius: 999,
  },
  lessonDoneText: { ...type.micro, color: palette.green.vivid, fontWeight: '800' },

  lessonDateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: palette.purple.soft,
    borderRadius: 999,
    marginTop: 2,
  },
  lessonDateBtnText: { ...type.micro, color: palette.purple.vivid, fontWeight: '800' },

  lessonDatePanel: {
    width: '100%',
    marginTop: 8,
    paddingVertical: 4,
  },
  lessonDateChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: palette.borderSoft,
    alignItems: 'center',
    minWidth: 56,
  },
  lessonDateChipOn: { backgroundColor: '#E63946' },
  lessonDateChipDay: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  lessonDateChipDate: { fontSize: 12, fontWeight: '800', color: palette.text, marginTop: 2 },

  // Student feedback (rating + remarks) strip — read-only on the
  // trainer's lesson row. Sits under the lesson meta row.
  feedbackStrip: {
    marginTop: 6,
    backgroundColor: '#FFFBF0',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    gap: 3,
  },
  feedbackStarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  feedbackUpdatedText: {
    marginLeft: 6,
    fontSize: 10,
    color: palette.textMuted,
    fontWeight: '600',
  },
  feedbackRemarkText: {
    fontSize: 11,
    color: '#92400E',
    fontStyle: 'italic',
    lineHeight: 15,
  },

  // Chart
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    height: 40,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  chartBarWrap: { flex: 1, alignItems: 'center' },
  chartBar: { width: '100%', borderRadius: 3 },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  legendValue: { ...type.micro, color: palette.text, fontWeight: '800' },

  // Contact
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  contactIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: palette.purple.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  contactLabel: { ...type.micro, color: palette.textMuted, fontWeight: '700' },
  contactValue: { ...type.bodyBold, color: palette.text, marginTop: 1 },
  contactCta: {
    paddingHorizontal: spacing.sm, paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.purple.soft,
  },
  contactCtaText: { ...type.micro, color: palette.purple.on, fontWeight: '800' },
  divider: { height: 1, backgroundColor: palette.borderSoft, marginVertical: spacing.xs },

  // Belt timeline
  beltStep: { width: 84, alignItems: 'center' },
  beltCircle: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  beltStepNum: { ...type.bodyBold, color: palette.textMuted, fontSize: 13 },
  // Small dim dot for un-earned belts — replaces the previous "3, 4"
  // numbering which read like a placeholder rather than a timeline.
  beltStepDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: palette.borderSoft,
  },
  beltStepLabel: {
    ...type.caption, color: palette.textMuted, marginTop: 6,
    fontWeight: '700', textAlign: 'center',
  },
  beltStepPill: {
    ...type.micro, fontWeight: '800',
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: palette.green.soft,
    color: palette.green.on,
    marginTop: 4,
    overflow: 'hidden',
  },

  // Leave history
  leaveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  leaveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.blue.vivid },
  leaveDate: { ...type.bodyBold, color: palette.text, minWidth: 80 },
  leaveLabel: { ...type.caption, color: palette.textMuted },

  // Notes
  notesInput: {
    minHeight: 80,
    ...type.body,
    color: palette.text,
    backgroundColor: palette.bg,
    borderRadius: radius.md,
    padding: spacing.sm,
    textAlignVertical: 'top',
  },
  notesText: { ...type.body, color: palette.text, lineHeight: 22 },
});
