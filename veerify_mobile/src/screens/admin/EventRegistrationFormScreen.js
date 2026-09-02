// src/screens/admin/EventRegistrationFormScreen.js
//
// MODULE 3: dynamic Registration Form for the students selected in
// MODULE 2. Fetches the organizer's field configuration + auto-
// populates student-profile values, lets the operator fill / edit
// custom fields, uploads any files, and posts the batch via a
// single `/events/:id/register` call.
//
// Route params (from SelectStudentsForEventScreen):
//   eventId     (number, required)
//   studentIds  (number[], required)
//   eventTitle  (string, optional)

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, SafeAreaView, Alert, Switch, Modal,
} from 'react-native';
import {
  ChevronLeft, Check, ChevronDown, Upload, CheckCircle2, XCircle,
} from 'lucide-react-native';
import { launchImageLibrary } from 'react-native-image-picker';

import apiClient from '../../api/client';
// Shared declaration text — kept in one place so the builder preview
// and the submit screen read byte-identical wording.
import { DECLARATION_TEXT } from '../../components/RegistrationFormBuilder';
// Avatar renders the student's existing profile photo (or an
// initials fallback), and resolveAssetUrl normalises legacy
// hostname-prefixed uploads. Used to display the participant's
// profile image at the top of their registration card.
import Avatar from '../../components/Avatar';
import resolveAssetUrl from '../../utils/assetUrl';

const BRAND       = '#E63946';
const BRAND_SOFT  = '#FFE4E6';
const TEXT        = '#111827';
const TEXT_MUTED  = '#6B7280';
const SURFACE     = '#FFFFFF';
const BG          = '#F1F6FB';
const BORDER      = '#E5E7EB';
const GREEN       = '#10B981';

const ENUM_TYPES = new Set(['dropdown', 'radio', 'checkbox']);

// Compute the student's age (in whole years) from a DOB string.
// Accepts either 'YYYY-MM-DD' or a full ISO timestamp and returns
// null when the value can't be parsed. Used to gate skill-level
// age eligibility at submit time.
function ageFromDob(dob) {
  if (!dob) return null;
  const s = String(dob).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dobDate = new Date(y, mo, d);
  if (Number.isNaN(dobDate.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dobDate.getFullYear();
  const beforeBirthday =
    now.getMonth() < mo ||
    (now.getMonth() === mo && now.getDate() < d);
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
}

export default function EventRegistrationFormScreen({ route, navigation }) {
  const eventId    = route?.params?.eventId;
  const eventTitle = route?.params?.eventTitle || 'Event';
  const studentIds = useMemo(
    () => (Array.isArray(route?.params?.studentIds) ? route.params.studentIds : []),
    [route?.params?.studentIds],
  );

  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [fields, setFields]   = useState([]);
  const [students, setStudents] = useState([]); // profile snapshots
  // Skills options for the "Skills" default field. Sourced from the
  // event's Categories & Skills configuration (surfaced by the
  // registration-form GET as `skills_options`). Used as the
  // fallback dropdown when a student's own snapshot doesn't carry
  // a skill value.
  const [eventSkills, setEventSkills] = useState([]);
  // Full categories tree straight from the event's registration-form
  // endpoint. Powers the Category → Skill → Division cascade at the
  // top of every student card. Shape (per category):
  //   { name, gender?, skills: [{ name, age_from, age_to, divisions:[{name}] }] }
  // Nothing is hard-coded — we render only what the organiser saved.
  const [eventCategories, setEventCategories] = useState([]);
  // Per-student selection of Category / Skill / Division. Kept as
  // { [studentId]: { categoryIdx, skillIdx, divisionName } } so each
  // student in the batch can be entered under a different bucket.
  // Indices point back into eventCategories so validation on submit
  // is a cheap length check.
  const [selections, setSelections] = useState({});
  // answers[studentId][fieldId] = string OR array (checkbox) OR
  //   { url, name, type, size } for file fields.
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null); // { created, skipped }
  // Mandatory declaration checkbox — always rendered below every
  // form. Submit stays disabled until this flips true. Reset on
  // navigation away (component unmount handles it naturally).
  const [declarationAccepted, setDeclarationAccepted] = useState(false);

  // ── DOB → age → per-skill eligibility (derived) ─────────────
  // Single source of truth for the DOB field's inline age display
  // AND the submit-button gate. Recomputed automatically whenever
  // the DOB input changes, the selected combos change, or the
  // event's categories load. Nothing is hard-coded — every check
  // reads the event's own age_from / age_to per skill.
  const ageInfoByStudent = useMemo(() => {
    const out = {};
    const dobField = fields.find((f) =>
      f.sourceType === 'student' && f.sourceKey === 'dob',
    );
    students.forEach((s) => {
      const dobRaw = dobField ? answers[s.id]?.[dobField.id] : s.dob;
      const age = ageFromDob(dobRaw);
      const sel = selections[s.id] || {};
      const cat = eventCategories[sel.categoryIdx] || null;
      const catSkills = Array.isArray(cat?.skills) ? cat.skills : [];
      const combos = Array.isArray(sel.combos) ? sel.combos : [];
      const mismatches = [];
      if (age != null && cat && combos.length > 0) {
        combos.forEach((c) => {
          const sk = catSkills[c.skillIdx];
          if (!sk) return;
          const from = sk.age_from;
          const to   = sk.age_to;
          if ((from != null && age < from) || (to != null && age > to)) {
            const range = from != null && to != null
              ? `${from}–${to}` : from != null ? `${from}+` : `up to ${to}`;
            mismatches.push({ skillName: sk.name, range });
          }
        });
      }
      out[s.id] = {
        age,
        mismatches,
        hasProblem: mismatches.length > 0,
        // Field will only render its own error UI when age is
        // known — a blank DOB doesn't count as a mismatch here
        // (the "required" gate handles that separately).
      };
    });
    return out;
  }, [students, fields, answers, selections, eventCategories]);
  const anyAgeMismatch = Object.values(ageInfoByStudent).some((i) => i.hasProblem);

  // ── Multi-event participation ────────────────────────────────
  // Mandatory choice: single-event registration (current event
  // only, unchanged behaviour) or multi-event registration where
  // the participant can pick additional eligible events from the
  // academy's live list.
  //
  //   participationMode      — null | 'single' | 'multiple'
  //   availableEvents        — every future event under this
  //                            institution EXCLUDING the current
  //                            one (loaded from /institutions/me/events)
  //   selectedExtraEventIds  — Set of event ids the participant
  //                            picked when mode === 'multiple'
  //   eventsLoading          — spinner state for the pick list
  //   eventsError            — surfaces a fetch failure so the
  //                            checklist doesn't look silently empty
  // Defaults to 'single' so the previously-mandatory participation
  // question can be hidden from the top of the form without leaving
  // submit blocked. Operator can still be flipped to 'multiple' from
  // elsewhere in the flow; hidden for now per product decision to
  // simplify the top of the registration form.
  const [participationMode,     setParticipationMode]     = useState('single');
  const [availableEvents,       setAvailableEvents]       = useState([]);
  const [selectedExtraEventIds, setSelectedExtraEventIds] = useState([]);
  const [eventsLoading,         setEventsLoading]         = useState(false);
  const [eventsError,           setEventsError]           = useState('');

  // ── Fetch form config + student snapshots ─────────────────
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [formRes, studRes] = await Promise.all([
        apiClient.get(`/events/${eventId}/registration-form`),
        apiClient.get(`/events/${eventId}/students-profile?ids=${studentIds.join(',')}`),
      ]);
      const rawFields = Array.isArray(formRes.data?.fields) ? formRes.data.fields : [];
      const snaps     = Array.isArray(studRes.data?.students) ? studRes.data.students : [];
      // Skills catalog for the fallback dropdown on the "Skills"
      // default field. Preferred source is `skills_options`
      // (pre-flattened by the backend); fallback derives from the
      // raw `categories` block so older backends still work.
      const skillsFromApi = Array.isArray(formRes.data?.skills_options)
        ? formRes.data.skills_options
        : (Array.isArray(formRes.data?.categories)
            ? Array.from(new Set(
                formRes.data.categories.flatMap((c) => (c?.skills || [])
                  .map((s) => String(s?.name || '').trim())
                  .filter(Boolean),
                ),
              ))
            : []);
      setEventSkills(skillsFromApi);
      // Keep the full categories tree so the top-of-card cascade
      // can drive Category → Skill → Division from the same source
      // of truth as skills_options above.
      const cats = Array.isArray(formRes.data?.categories)
        ? formRes.data.categories
        : [];
      setEventCategories(cats);
      setFields(rawFields);
      setStudents(snaps);

      // Seed default selection for each student — first category,
      // "No" for multi-mode, one skill combo pointing at the
      // category's first skill with no division picked. Guards
      // keep every index in bounds even when the organiser saved
      // zero categories.
      if (cats.length > 0) {
        const seed = {};
        snaps.forEach((s) => {
          const cIdx = 0;
          const skills = Array.isArray(cats[cIdx]?.skills) ? cats[cIdx].skills : [];
          const sIdx = skills.length > 0 ? 0 : -1;
          seed[s.id] = {
            categoryIdx: cIdx,
            // 'no' | 'yes' — Yes lets the student register into
            // multiple Skill+Division combinations from THIS event.
            // The question is offered only when the picked category
            // actually has multiple skills or a skill with multiple
            // divisions (see canOfferMulti in the picker).
            multi:  'no',
            combos: [{ skillIdx: sIdx, divisionName: '' }],
          };
        });
        setSelections(seed);
      }

      // Auto-populate student-source fields from the snapshot.
      // ISO-timestamp values (e.g. student_profiles.date_of_birth
      // comes back as `2020-07-28T18:30:00.000Z`) are trimmed to
      // just the YYYY-MM-DD portion so the date field shows a
      // clean value instead of the raw stamp.
      const isoDate = (v) => {
        if (v == null) return v;
        const s = String(v);
        // Matches full ISO timestamps that start with a date.
        const m = s.match(/^\d{4}-\d{2}-\d{2}/);
        return m ? m[0] : s;
      };
      const initial = {};
      snaps.forEach((s) => {
        initial[s.id] = {};
        rawFields.forEach((f) => {
          if (f.sourceType === 'student' && f.sourceKey && s[f.sourceKey] != null) {
            const raw = s[f.sourceKey];
            // For date fields (or any auto-populated ISO string),
            // strip the time portion so the input reads cleanly.
            initial[s.id][f.id] = (f.sourceKey === 'dob' || f.type === 'date')
              ? isoDate(raw)
              : String(raw);
          }
        });
      });
      setAnswers(initial);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load registration form.');
    } finally {
      setLoading(false);
    }
  }, [eventId, studentIds]);

  useEffect(() => { load(); }, [load]);

  // ── Load eligible-for-registration events (once) ──────────────
  // Populates the checklist under the "Multiple Events" option. The
  // list comes from the same /institutions/me/events endpoint the
  // Home tab uses, so no new data source is introduced — this is
  // the single source of truth for the institution's own events.
  //
  // Filters:
  //   • drop the CURRENT event (already being registered for)
  //   • drop past events (event_date strictly before today)
  //   • keep everything else regardless of publish/approval state so
  //     an admin registering on a just-created event can still add
  //     other in-flight events to the batch
  useEffect(() => {
    let cancelled = false;
    setEventsLoading(true);
    setEventsError('');
    apiClient
      .get('/institutions/me/events')
      .then((r) => {
        if (cancelled) return;
        const all = Array.isArray(r.data?.events) ? r.data.events : [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const eligible = all.filter((e) => {
          if (Number(e.id) === Number(eventId)) return false;
          if (e.event_date) {
            const d = new Date(e.event_date);
            if (!Number.isNaN(d.getTime()) && d < today) return false;
          }
          return true;
        });
        setAvailableEvents(eligible);
      })
      .catch((err) => {
        if (cancelled) return;
        setEventsError(err?.response?.data?.message || err?.message || 'Could not load available events.');
      })
      .finally(() => { if (!cancelled) setEventsLoading(false); });
    return () => { cancelled = true; };
  }, [eventId]);

  const toggleExtraEvent = (id) => {
    setSelectedExtraEventIds((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
  };

  const setAnswer = (studentId, fieldId, value) => {
    setAnswers((prev) => ({
      ...prev,
      [studentId]: { ...(prev[studentId] || {}), [fieldId]: value },
    }));
  };

  const toggleCheckbox = (studentId, fieldId, optValue) => {
    setAnswers((prev) => {
      const cur = prev[studentId] || {};
      const arr = Array.isArray(cur[fieldId]) ? [...cur[fieldId]] : [];
      const idx = arr.indexOf(optValue);
      if (idx >= 0) arr.splice(idx, 1); else arr.push(optValue);
      return { ...prev, [studentId]: { ...cur, [fieldId]: arr } };
    });
  };

  // File upload → reuse the existing /uploads endpoint used by
  // event images. Stores { url, name, type, size } as the answer.
  const pickFile = async (studentId, fieldId) => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'mixed', quality: 0.85, selectionLimit: 1,
      });
      if (result.didCancel) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;
      const fd = new FormData();
      fd.append('file', {
        uri: asset.uri,
        type: asset.type || 'application/octet-stream',
        name: asset.fileName || 'upload',
      });
      const up = await apiClient.post('/uploads', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const url = up.data?.url || up.data?.file_url || up.data?.path;
      if (!url) throw new Error('Upload did not return a URL.');
      setAnswer(studentId, fieldId, {
        url, name: asset.fileName || 'upload',
        type: asset.type, size: asset.fileSize,
      });
    } catch (err) {
      Alert.alert('Upload failed', err.response?.data?.message || err.message || 'Please try again.');
    }
  };

  // ── Client-side required-field guard ───────────────────────
  const isEmpty = (v) => {
    if (v === null || v === undefined) return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') return !v.url;
    return String(v).trim() === '';
  };
  const firstMissing = () => {
    for (const s of students) {
      for (const f of fields) {
        if (f.required && isEmpty(answers[s.id]?.[f.id])) {
          return { student: s, field: f };
        }
      }
    }
    return null;
  };

  const submit = async () => {
    // Participation-mode gate — mandatory. Must be answered before
    // any other validation runs so the participant sees the reason
    // for the block right at the top of the form.
    if (!participationMode) {
      Alert.alert(
        'Participation mode required',
        'Please answer "Are you going to participate in single or multiple events?" before submitting.',
      );
      return;
    }
    if (participationMode === 'multiple' && selectedExtraEventIds.length === 0) {
      Alert.alert(
        'Pick additional events',
        'You chose "Multiple Events" — please tick at least one additional event, or switch to "Single Event".',
      );
      return;
    }
    // Declaration gate — mandatory. Blocks submit until the
    // participant/institution ticks the checkbox rendered at the
    // bottom of the form. Matches the copy shown in the builder
    // preview so both sides tell the same story.
    if (!declarationAccepted) {
      Alert.alert(
        'Declaration required',
        'Please read and accept the declaration at the bottom of the form before submitting.',
      );
      return;
    }
    const miss = firstMissing();
    if (miss) {
      Alert.alert(
        'Missing information',
        `${miss.student.name}: "${miss.field.label}" is required.`,
      );
      return;
    }

    // ── Category / Skill / Division gate ─────────────────────────
    // Only enforced when the event actually has categories saved.
    // For every student we verify:
    //   • categoryIdx points to a real category on the event,
    //   • every combo the participant picked (one when multi='no',
    //     one-or-many when 'yes') has a real skill index,
    //   • when the skill has divisions configured, one of THIS
    //     skill's divisions is picked,
    //   • no combo is duplicated (same skill+division twice),
    //   • the student's age (derived from dob when available) falls
    //     inside the skill's configured age range. Missing dob or
    //     missing age bounds skip the age check silently.
    if (eventCategories.length > 0) {
      for (const s of students) {
        const sel = selections[s.id] || {};
        const cat = eventCategories[sel.categoryIdx];
        if (!cat) {
          Alert.alert('Category required', `${s.name}: please pick a category at the top of the card.`);
          return;
        }
        const skills = Array.isArray(cat.skills) ? cat.skills : [];
        const combos = Array.isArray(sel.combos) && sel.combos.length ? sel.combos : [];
        if (combos.length === 0) {
          Alert.alert('Skill required', `${s.name}: please pick at least one skill.`);
          return;
        }
        const seen = new Set();
        const studentAge = ageFromDob(s.dob);
        for (const c of combos) {
          const sk = skills[c.skillIdx];
          if (!sk) {
            Alert.alert('Skill required', `${s.name}: please pick a valid skill for every combination.`);
            return;
          }
          const divisions = Array.isArray(sk.divisions) ? sk.divisions : [];
          if (divisions.length > 0) {
            const validDiv = divisions.some((d) => (d?.name || '') === c.divisionName);
            if (!validDiv) {
              Alert.alert(
                'Division required',
                `${s.name}: please pick a division for ${sk.name || 'the selected skill'}.`,
              );
              return;
            }
          }
          const dedupeKey = `${c.skillIdx}::${c.divisionName || ''}`;
          if (seen.has(dedupeKey)) {
            Alert.alert(
              'Duplicate combination',
              `${s.name}: ${sk.name}${c.divisionName ? ` · ${c.divisionName}` : ''} is picked more than once. Remove the duplicate before submitting.`,
            );
            return;
          }
          seen.add(dedupeKey);
          if (studentAge != null) {
            const from = sk.age_from;
            const to   = sk.age_to;
            if ((from != null && studentAge < from) || (to != null && studentAge > to)) {
              const range = from != null && to != null
                ? `${from}–${to}`
                : from != null ? `${from}+` : `up to ${to}`;
              Alert.alert(
                'Age eligibility',
                `${s.name} (age ${studentAge}) is outside the ${range} age range configured for ${sk.name}. Pick a different skill or category.`,
              );
              return;
            }
          }
        }
      }
    }

    setSubmitting(true);
    try {
      // Full event scope for this submission — always contains the
      // current event id, plus any extras when the participant chose
      // "Multiple Events". Sent on the top-level payload for logging
      // and also used to fan out the POST below.
      const eventScope = participationMode === 'multiple'
        ? Array.from(new Set([Number(eventId), ...selectedExtraEventIds.map(Number)]))
        : [Number(eventId)];

      const payload = {
        // Explicit acknowledgement carried on the top-level payload
        // so the backend can log/store it against the batch. Backend
        // may absorb or ignore this field — the client-side gate is
        // authoritative for the user experience.
        declaration_accepted: true,
        declaration_accepted_at: new Date().toISOString(),
        // Multi-event participation metadata. Backend may consume or
        // ignore these; the client-side fan-out below handles the
        // extra registrations either way.
        participation_mode: participationMode,        // 'single' | 'multiple'
        event_ids: eventScope,                        // includes the current event
        registrations: students.map((s) => {
          // Category + every Skill/Division combination the operator
          // picked at the top of this student's card. Resolved back
          // to full objects so the backend receives human-readable
          // names alongside the structural indices — either can be
          // persisted or ignored depending on downstream consumption.
          // `selections` (plural, list) carries every combo when the
          // participant answered Yes to "multiple"; `selection`
          // (singular) is kept for backwards compatibility with any
          // older consumer that only reads a single combination.
          const sel = selections[s.id] || {};
          const cat = eventCategories[sel.categoryIdx] || null;
          const catSkills = Array.isArray(cat?.skills) ? cat.skills : [];
          const combos = Array.isArray(sel.combos) ? sel.combos : [];
          const resolveCombo = (c) => {
            const sk = catSkills[c.skillIdx] || null;
            return {
              skill_index: c.skillIdx,
              skill_name:  sk?.name || null,
              age_from:    sk?.age_from ?? null,
              age_to:      sk?.age_to ?? null,
              division:    c.divisionName || null,
            };
          };
          const selectionList = cat ? combos.map(resolveCombo) : [];
          const selection = cat && selectionList.length > 0 ? {
            category_index: sel.categoryIdx,
            category_name:  cat.name || null,
            gender:         cat.gender || null,
            // Mirror the first combo for backwards compat.
            ...selectionList[0],
          } : null;
          return {
            student_id: s.id,
            // Non-breaking: older backends drop unknown keys silently.
            selection,
            selections: cat ? {
              category_index:      sel.categoryIdx,
              category_name:       cat.name || null,
              gender:              cat.gender || null,
              participate_multiple: sel.multi === 'yes',
              combinations:        selectionList,
            } : null,
            answers: fields.map((f) => {
              const v = answers[s.id]?.[f.id];
              if (ENUM_TYPES.has(f.type) && f.type === 'checkbox') {
                return { field_id: f.id, value: null, value_json: Array.isArray(v) ? v : [] };
              }
              if (f.type === 'file') {
                return { field_id: f.id, value: v?.url || null, value_json: v || null };
              }
              return { field_id: f.id, value: v ?? null, value_json: null };
            }).filter((a) => a.value !== null || (a.value_json && (Array.isArray(a.value_json) ? a.value_json.length : true))),
          };
        }),
      };
      // Primary submission — the event the operator started from.
      // Must succeed; a failure here rolls the whole flow back with
      // the existing error dialog. Extras are fan-out best-effort.
      const r = await apiClient.post(`/events/${eventId}/register`, payload);
      let extraCreated = [];
      let extraSkipped = [];
      const extraFailures = [];

      if (participationMode === 'multiple' && selectedExtraEventIds.length > 0) {
        // POST the same payload to every additional event the
        // participant ticked. Best-effort: each event's own
        // registration-form config validates fields independently,
        // so a per-event failure is captured and surfaced without
        // aborting the successful submissions.
        await Promise.all(selectedExtraEventIds.map(async (extraId) => {
          try {
            const rr = await apiClient.post(`/events/${extraId}/register`, payload);
            extraCreated = extraCreated.concat(rr.data?.created || []);
            extraSkipped = extraSkipped.concat(rr.data?.skipped || []);
          } catch (extraErr) {
            const label = (availableEvents.find((e) => Number(e.id) === Number(extraId))?.title) || `Event ${extraId}`;
            extraFailures.push(`${label}: ${extraErr?.response?.data?.message || extraErr.message || 'failed'}`);
          }
        }));
      }

      setDone({
        created:       [...(r.data?.created || []), ...extraCreated],
        skipped:       [...(r.data?.skipped || []), ...extraSkipped],
        extraFailures,
        eventCount:    (participationMode === 'multiple' ? selectedExtraEventIds.length + 1 : 1),
      });
    } catch (err) {
      const data = err.response?.data;
      if (data?.errors && Array.isArray(data.errors)) {
        const bits = data.errors.slice(0, 3).map((e) =>
          `Student ${e.student_id}: ${(e.missing_labels || []).join(', ')}`,
        ).join('\n');
        Alert.alert('Missing required fields', bits);
      } else {
        Alert.alert('Registration failed', data?.message || err.message || 'Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <Header title="Registration Form" subtitle={eventTitle} navigation={navigation} />
        <View style={styles.center}><ActivityIndicator color={BRAND} /></View>
      </SafeAreaView>
    );
  }
  if (error) {
    return (
      <SafeAreaView style={styles.screen}>
        <Header title="Registration Form" subtitle={eventTitle} navigation={navigation} />
        <View style={styles.center}>
          <Text style={styles.err}>{error}</Text>
          <TouchableOpacity style={styles.primary} onPress={load}>
            <Text style={styles.primaryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }
  // Success is presented as an in-page Modal overlay rather than a
  // full-screen replacement. The form stays mounted underneath so
  // the "Continue Registration" button can hop the operator back to
  // Select Students without a re-mount race, and so a slow network
  // never leaves the operator staring at an empty confirmation
  // screen. Rendered near the bottom of the return tree below.
  if (fields.length === 0) {
    return (
      <SafeAreaView style={styles.screen}>
        <Header title="Registration Form" subtitle={eventTitle} navigation={navigation} />
        <View style={styles.center}>
          <Text style={styles.err}>The organizer hasn't set up a Registration Form for this event.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <Header title="Registration Form" subtitle={eventTitle} navigation={navigation} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {/* ── Mandatory participation-mode question ────────────────
            HIDDEN per product decision — the Category → Skill →
            Age → Division cascade + the in-cascade "Are you going
            to participate in multiple events?" question inside each
            student card already handle multi-skill participation
            for the CURRENT event, so the top-of-form question
            became redundant noise. Kept in the tree behind a
            constant flag so it can be re-enabled without a rewrite.
            When SHOW_PARTICIPATION_MODE flips true, the block
            renders exactly as before. */}
        {false && (
        <View style={styles.modeCard}>
          <View style={styles.modeLabelRow}>
            <Text style={styles.modeLabel}>
              Are you going to participate in single or multiple events?
            </Text>
            <Text style={styles.req}>Required</Text>
          </View>
          <View style={styles.modeSegRow}>
            <ModePill
              label="Single Event"
              active={participationMode === 'single'}
              onPress={() => setParticipationMode('single')}
            />
            <ModePill
              label="Multiple Events"
              active={participationMode === 'multiple'}
              onPress={() => setParticipationMode('multiple')}
            />
          </View>

          {/* Current event pill — always shown so the participant
              sees they're registering for this one regardless of
              mode. */}
          <View style={styles.currentEventPill}>
            <CheckCircle2 size={13} color={GREEN} strokeWidth={2.6} />
            <Text style={styles.currentEventPillText} numberOfLines={1}>
              Registering for: {eventTitle}
            </Text>
          </View>

          {participationMode === 'multiple' ? (
            <View style={styles.extraEventsWrap}>
              <Text style={styles.extraEventsHint}>
                Pick the additional eligible events the participant should also register for.
              </Text>
              {eventsLoading ? (
                <View style={styles.extraEventsCenter}>
                  <ActivityIndicator size="small" color={BRAND} />
                  <Text style={styles.extraEventsCenterText}>Loading events…</Text>
                </View>
              ) : eventsError ? (
                <Text style={styles.extraEventsError}>{eventsError}</Text>
              ) : availableEvents.length === 0 ? (
                <View style={styles.extraEventsEmpty}>
                  <Text style={styles.extraEventsEmptyText}>
                    No other eligible events right now. Switch back to "Single Event" to submit.
                  </Text>
                </View>
              ) : (
                <View>
                  {availableEvents.map((e) => {
                    const on = selectedExtraEventIds.includes(e.id);
                    return (
                      <TouchableOpacity
                        key={e.id}
                        onPress={() => toggleExtraEvent(e.id)}
                        activeOpacity={0.85}
                        style={[styles.extraEventRow, on && styles.extraEventRowOn]}
                      >
                        <View style={[styles.extraEventBox, on && styles.extraEventBoxOn]}>
                          {on ? <Check size={12} color="#fff" strokeWidth={3} /> : null}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.extraEventTitle} numberOfLines={1}>{e.title}</Text>
                          <Text style={styles.extraEventMeta} numberOfLines={1}>
                            {[
                              e.event_date ? new Date(e.event_date).toLocaleDateString() : null,
                              e.location,
                            ].filter(Boolean).join(' • ') || 'No date set'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          ) : null}
        </View>
        )}

        {students.map((s) => (
          <View key={s.id} style={styles.studentCard}>
            {/* ── Category → Skill → Age → Division cascade ────────
                Rendered at the top of every student card so the
                organiser picks the eligibility bucket BEFORE filling
                in the student's details. All values are sourced from
                the event's saved Categories & Skills (fetched with
                the registration-form endpoint) — nothing is
                hard-coded and the skills list is scoped to the
                selected category only. */}
            {eventCategories.length > 0 ? (
              <CategorySkillPicker
                categories={eventCategories}
                value={selections[s.id] || { categoryIdx: 0, skillIdx: 0, divisionName: '' }}
                onChange={(next) =>
                  setSelections((prev) => ({ ...prev, [s.id]: next }))
                }
              />
            ) : null}

            {/* Header — real profile photo at the top (uses the
                student's saved photo_url via the shared Avatar
                component; falls back to initials when none), name
                directly beneath, and the enrolment meta line
                (course • branch) as the third line. Keeps a
                consistent identity strip across every student card. */}
            <View style={styles.studentIdentity}>
              <Avatar
                uri={s.photo_url}
                name={s.name}
                size={72}
                tone="purple"
              />
              <Text style={styles.studentName}>{s.name}</Text>
              {(s.course || s.branch) ? (
                <Text style={styles.studentMeta}>
                  {[s.course, s.branch].filter(Boolean).join(' • ')}
                </Text>
              ) : null}
            </View>
            <View style={{ height: 4 }} />
            {fields
              // Skip the "Student Photo" default field — the participant
              // form already shows the student's real profile photo at
              // the top of the card, so a raw URL text input for
              // photo_url would be redundant and confusing.
              .filter((f) => !(
                f.sourceType === 'student' && f.sourceKey === 'photo_url'
              ))
              .map((f) => (
                <FieldRow
                  key={f.id}
                  field={f}
                  value={answers[s.id]?.[f.id]}
                  onChange={(v) => setAnswer(s.id, f.id, v)}
                  onCheckboxToggle={(v) => toggleCheckbox(s.id, f.id, v)}
                  onPickFile={() => pickFile(s.id, f.id)}
                  // Fallback dropdown options for the "Skills" default
                  // field when the student's own snapshot is empty.
                  eventSkills={eventSkills}
                  // Age-eligibility side-channel — only meaningful on
                  // the DOB field. Ignored by every other field type.
                  dobAgeInfo={ageInfoByStudent[s.id]}
                />
              ))}
          </View>
        ))}

        {/* Mandatory Declaration — auto-appended to every event form.
            The whole card is tappable so the checkbox toggles even
            when the participant taps the text. Submit stays disabled
            until this flips true. */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => setDeclarationAccepted((v) => !v)}
          style={[styles.declarationCard, declarationAccepted && styles.declarationCardOn]}
        >
          <View style={styles.declarationRow}>
            <View style={[styles.declCheckbox, declarationAccepted && styles.declCheckboxOn]}>
              {declarationAccepted ? <Check size={14} color="#fff" strokeWidth={3} /> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.declarationTitle}>Declaration *</Text>
              <Text style={styles.declarationBody}>{DECLARATION_TEXT}</Text>
            </View>
          </View>
        </TouchableOpacity>

        <View style={{ height: 100 }} />
      </ScrollView>
      <View style={styles.footer}>
        <TouchableOpacity
          disabled={submitting || !declarationAccepted || anyAgeMismatch}
          style={[
            styles.primary,
            (submitting || !declarationAccepted || anyAgeMismatch) && { opacity: 0.5 },
          ]}
          onPress={submit}
        >
          <Text style={styles.primaryText}>
            {submitting
              ? 'Submitting…'
              : anyAgeMismatch
                ? 'Fix age mismatch to submit'
                : !declarationAccepted
                  ? 'Accept declaration to submit'
                  : `Submit Registration${students.length > 1 ? 's' : ''}`}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Success overlay ─────────────────────────────────────
          Rendered as an in-page Modal so the form stays mounted
          underneath. Fires after a successful submit; the operator
          can hop back to the Events list, or start another
          registration for the same event without waiting for a
          screen re-mount. */}
      <Modal
        visible={!!done}
        transparent
        animationType="fade"
        onRequestClose={() => { /* modal is intentionally sticky */ }}
      >
        <View style={styles.doneBackdrop}>
          <View style={styles.doneSheet}>
            <View style={styles.doneIconWrap}>
              <CheckCircle2 size={44} color={GREEN} strokeWidth={2.4} />
            </View>
            <Text style={styles.doneHeadline}>Registration Submitted Successfully</Text>
            {done ? (
              <Text style={styles.doneMeta}>
                {done.created.length} student{done.created.length === 1 ? '' : 's'} registered
                {done.eventCount && done.eventCount > 1
                  ? ` across ${done.eventCount} events`
                  : ''}
                {'.'}
                {done.skipped.length > 0
                  ? ` ${done.skipped.length} skipped (already registered).`
                  : ''}
              </Text>
            ) : null}
            {done?.extraFailures && done.extraFailures.length > 0 ? (
              <Text style={[styles.doneMeta, { color: '#B91C1C' }]}>
                {done.extraFailures.length} event
                {done.extraFailures.length === 1 ? '' : 's'} could not be registered:
                {'\n'}{done.extraFailures.slice(0, 3).join('\n')}
              </Text>
            ) : null}

            {/* Two-action tray. Back to Events pops all the way to
                the Events list; Continue Registration pushes back
                into the Select Students screen for THIS event so
                the operator can add another student. */}
            <View style={styles.doneActionsRow}>
              <TouchableOpacity
                onPress={() => {
                  setDone(null);
                  // popToTop reliably returns to whichever list
                  // opened the flow (Events list under More, or
                  // Home) without needing to know the route name.
                  navigation.popToTop();
                }}
                activeOpacity={0.85}
                style={[styles.doneActionBtn, styles.doneActionSecondary]}
              >
                <Text style={styles.doneActionSecondaryText}>Back to Events</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setDone(null);
                  // Replace the current form screen with a fresh
                  // SelectStudentsForEvent so a subsequent submit
                  // doesn't stack on top of this one.
                  navigation.replace('SelectStudentsForEvent', {
                    eventId,
                    eventTitle,
                  });
                }}
                activeOpacity={0.85}
                style={[styles.doneActionBtn, styles.doneActionPrimary]}
              >
                <Text style={styles.doneActionPrimaryText}>Continue Registration</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ModePill — segmented-button used by the mandatory participation-
// mode question. Two of these sit side-by-side ("Single Event" and
// "Multiple Events"); tapping one flips `participationMode` in the
// parent, which drives whether the extra-events checklist unfolds.
function ModePill({ label, active, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.modeSegBtn, active && styles.modeSegBtnActive]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Text style={[styles.modeSegBtnText, active && styles.modeSegBtnTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// SkillsDropdown — modal-backed picker used as the fallback for the
// Category → Skill → Age → Division cascade rendered at the top of
// every student card. Everything on offer comes from the event's
// saved Categories & Skills block (see load()'s eventCategories
// state). Nothing is hard-coded and the skill list is scoped to
// the selected category — the academy's full skill catalogue is
// never shown here.
function CategorySkillPicker({ categories, value, onChange }) {
  // Picker state — a small tuple identifies which sheet is open:
  // 'category' | { kind: 'skill'|'division', comboIdx } | null.
  const [pickerOpen, setPickerOpen] = useState(null);
  const cat = categories[value.categoryIdx] || null;
  const catSkills = Array.isArray(cat?.skills) ? cat.skills : [];
  const combos = Array.isArray(value.combos) && value.combos.length
    ? value.combos
    : [{ skillIdx: catSkills.length > 0 ? 0 : -1, divisionName: '' }];
  // Yes/No question is offered only when the picked category has
  // more than one distinct Skill+Division combination.
  const totalCombos = catSkills.reduce((acc, s) => (
    acc + Math.max(1, (Array.isArray(s?.divisions) ? s.divisions.length : 0))
  ), 0);
  const canOfferMulti = totalCombos > 1;
  return renderCategorySkillPicker({
    categories, catSkills, cat, combos, canOfferMulti,
    value, onChange, pickerOpen, setPickerOpen,
  });
}

// Rendering logic split out to keep the picker component itself
// short. Nothing here is stateful — pure UI wired to the parent's
// value/onChange contract.
function renderCategorySkillPicker({
  categories, catSkills, cat, combos, canOfferMulti,
  value, onChange, pickerOpen, setPickerOpen,
}) {
  const ageLabelFor = (sk) => {
    if (!sk) return '—';
    const from = sk.age_from;
    const to   = sk.age_to;
    if (from != null && to != null) return `${from} – ${to} years`;
    if (from != null)               return `${from}+ years`;
    if (to   != null)               return `Up to ${to} years`;
    return 'Any age';
  };
  const onPickCategory = (idx) => {
    const nextCat    = categories[idx];
    const nextSkills = Array.isArray(nextCat?.skills) ? nextCat.skills : [];
    onChange({
      categoryIdx: idx,
      multi:  'no',
      combos: [{ skillIdx: nextSkills.length > 0 ? 0 : -1, divisionName: '' }],
    });
    setPickerOpen(null);
  };
  const setMulti = (mode) => {
    if (mode === 'no') {
      onChange({ ...value, multi: 'no', combos: combos.slice(0, 1) });
    } else {
      onChange({ ...value, multi: 'yes' });
    }
  };
  const patchCombo = (i, patch) => {
    const next = combos.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    onChange({ ...value, combos: next });
  };
  const onPickSkill = (i, sIdx) => {
    // Reset division when swapping skill — divisions belong to a
    // specific skill and stale names would fail the submit gate.
    patchCombo(i, { skillIdx: sIdx, divisionName: '' });
    setPickerOpen(null);
  };
  const onPickDivision = (i, name) => {
    patchCombo(i, { divisionName: name });
    setPickerOpen(null);
  };
  const addCombo = () => {
    // Seed the new row with the first (skill, division) that hasn't
    // been picked yet so the operator doesn't immediately trip the
    // duplicate gate. Falls back to (first skill, '') when every
    // combination is already picked — the submit check will still
    // surface a clear duplicate message.
    const taken = new Set(combos.map((c) => `${c.skillIdx}::${c.divisionName || ''}`));
    let seed = { skillIdx: 0, divisionName: '' };
    outer: for (let sIdx = 0; sIdx < catSkills.length; sIdx += 1) {
      const divs = Array.isArray(catSkills[sIdx]?.divisions) ? catSkills[sIdx].divisions : [];
      if (divs.length === 0) {
        if (!taken.has(`${sIdx}::`)) { seed = { skillIdx: sIdx, divisionName: '' }; break outer; }
      } else {
        for (const d of divs) {
          const nm = d?.name || '';
          if (!taken.has(`${sIdx}::${nm}`)) { seed = { skillIdx: sIdx, divisionName: nm }; break outer; }
        }
      }
    }
    onChange({ ...value, combos: [...combos, seed] });
  };
  const removeCombo = (i) => {
    if (combos.length <= 1) return;
    onChange({ ...value, combos: combos.filter((_, idx) => idx !== i) });
  };

  return (
    <View style={styles.cascadeCard}>
      <Text style={styles.cascadeTitle}>Event Category</Text>

      {/* Category dropdown */}
      <Text style={styles.cascadeLabel}>Category Name</Text>
      <CascadeTrigger
        value={cat?.name || ''}
        placeholder="Select a category"
        onPress={() => setPickerOpen('category')}
      />

      {/* First combo — always visible. Category → Skill → Age → Division
          for the primary entry, no matter what the multi answer is. */}
      {combos.slice(0, 1).map((c, i) => {
        const sk = catSkills[c.skillIdx] || null;
        const divisions = Array.isArray(sk?.divisions) ? sk.divisions : [];
        return (
          <View key={`primary-${i}`}>
            <Text style={styles.cascadeLabel}>Skill</Text>
            <CascadeTrigger
              value={sk?.name || ''}
              placeholder={catSkills.length ? 'Select a skill' : 'No skills for this category'}
              disabled={catSkills.length === 0}
              onPress={() => setPickerOpen({ kind: 'skill', comboIdx: i })}
            />
            <Text style={styles.cascadeLabel}>Age</Text>
            <View style={[styles.input, styles.cascadeReadonly]}>
              <Text style={styles.cascadeReadonlyText}>{ageLabelFor(sk)}</Text>
            </View>
            {divisions.length > 0 ? (
              <>
                <Text style={styles.cascadeLabel}>Division</Text>
                <CascadeTrigger
                  value={c.divisionName || ''}
                  placeholder="Select a division"
                  onPress={() => setPickerOpen({ kind: 'division', comboIdx: i })}
                />
              </>
            ) : null}
          </View>
        );
      })}

      {/* Yes/No question — moved to sit BELOW the Division row so
          the operator finishes the primary Category → Skill → Age →
          Division flow before deciding whether to add more.
          Offered only when the picked category actually has more
          than one distinct Skill+Division combination available. */}
      {canOfferMulti ? (
        <>
          <Text style={[styles.cascadeLabel, { marginTop: 12 }]}>
            Are you going to participate in multiple events?
          </Text>
          <View style={styles.multiRow}>
            <MultiPill label="No"  active={value.multi !== 'yes'} onPress={() => setMulti('no')} />
            <MultiPill label="Yes" active={value.multi === 'yes'} onPress={() => setMulti('yes')} />
          </View>
        </>
      ) : null}

      {/* Additional combos (index 1+). Only render when Yes and the
          question was actually offered — 'yes' without canOfferMulti
          can't happen, but the guard is cheap. */}
      {value.multi === 'yes' ? (
        <>
          {combos.slice(1).map((c, idx) => {
            const i = idx + 1;
            const sk = catSkills[c.skillIdx] || null;
            const divisions = Array.isArray(sk?.divisions) ? sk.divisions : [];
            return (
              <View key={`extra-${i}`} style={styles.comboBlock}>
                <View style={styles.comboHead}>
                  <Text style={styles.cascadeLabel}>{`Skill ${i + 1}`}</Text>
                  {combos.length > 1 ? (
                    <TouchableOpacity
                      onPress={() => removeCombo(i)}
                      hitSlop={8}
                      style={styles.comboRemove}
                    >
                      <Text style={styles.comboRemoveText}>Remove</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <CascadeTrigger
                  value={sk?.name || ''}
                  placeholder={catSkills.length ? 'Select a skill' : 'No skills for this category'}
                  disabled={catSkills.length === 0}
                  onPress={() => setPickerOpen({ kind: 'skill', comboIdx: i })}
                />
                <Text style={styles.cascadeLabel}>Age</Text>
                <View style={[styles.input, styles.cascadeReadonly]}>
                  <Text style={styles.cascadeReadonlyText}>{ageLabelFor(sk)}</Text>
                </View>
                {divisions.length > 0 ? (
                  <>
                    <Text style={styles.cascadeLabel}>Division</Text>
                    <CascadeTrigger
                      value={c.divisionName || ''}
                      placeholder="Select a division"
                      onPress={() => setPickerOpen({ kind: 'division', comboIdx: i })}
                    />
                  </>
                ) : null}
              </View>
            );
          })}
          <TouchableOpacity
            onPress={addCombo}
            activeOpacity={0.85}
            style={styles.addComboBtn}
          >
            <Text style={styles.addComboBtnText}>+ Add another Skill / Division</Text>
          </TouchableOpacity>
        </>
      ) : null}

      {/* Sheets — Category picker + per-combo Skill / Division. */}
      <Sheet
        visible={pickerOpen === 'category'}
        title="Select Category"
        options={categories.map((c, i) => ({
          key: String(i), label: c?.name || `Category ${i + 1}`, active: i === value.categoryIdx,
          onPress: () => onPickCategory(i),
        }))}
        onClose={() => setPickerOpen(null)}
      />
      {pickerOpen && pickerOpen.kind === 'skill' ? (
        <Sheet
          visible
          title="Select Skill"
          options={catSkills.map((x, i) => ({
            key: String(i), label: x?.name || `Skill ${i + 1}`,
            active: i === combos[pickerOpen.comboIdx]?.skillIdx,
            onPress: () => onPickSkill(pickerOpen.comboIdx, i),
          }))}
          onClose={() => setPickerOpen(null)}
        />
      ) : null}
      {pickerOpen && pickerOpen.kind === 'division' ? (() => {
        const cur = combos[pickerOpen.comboIdx] || {};
        const skHere = catSkills[cur.skillIdx] || null;
        const divs = Array.isArray(skHere?.divisions) ? skHere.divisions : [];
        return (
          <Sheet
            visible
            title="Select Division"
            options={divs.map((d, i) => ({
              key: String(i), label: d?.name || '',
              active: (d?.name || '') === cur.divisionName,
              onPress: () => onPickDivision(pickerOpen.comboIdx, d?.name || ''),
            }))}
            onClose={() => setPickerOpen(null)}
          />
        );
      })() : null}
    </View>
  );
}

// Yes/No pill for the "multiple events" question. Same visual
// language as the existing participation-mode segmented buttons.
function MultiPill({ label, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.multiPill, active && styles.multiPillActive]}
    >
      <Text style={[styles.multiPillText, active && styles.multiPillTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// Small trigger button used by all three cascade dropdowns.
function CascadeTrigger({ value, placeholder, onPress, disabled }) {
  return (
    <TouchableOpacity
      onPress={disabled ? undefined : onPress}
      activeOpacity={disabled ? 1 : 0.85}
      style={[styles.input, styles.cascadeTrigger, disabled && { opacity: 0.55 }]}
    >
      <Text
        style={[
          styles.cascadeTriggerText,
          !value && { color: '#9CA3AF', fontWeight: '500' },
        ]}
        numberOfLines={1}
      >
        {value || placeholder}
      </Text>
      <ChevronDown size={14} color={TEXT_MUTED} strokeWidth={2.4} />
    </TouchableOpacity>
  );
}

// Reusable modal-backed picker. Shared by all cascade dropdowns and
// visually consistent with the existing SkillsDropdown sheet.
function Sheet({ visible, title, options, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.skillsBackdrop} activeOpacity={1} onPress={onClose}>
        <View style={styles.skillsSheet}>
          <View style={styles.skillsSheetHead}>
            <Text style={styles.skillsSheetTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <XCircle size={18} color={TEXT_MUTED} />
            </TouchableOpacity>
          </View>
          <ScrollView>
            {options.length === 0 ? (
              <Text style={{ padding: 16, color: TEXT_MUTED, fontSize: 13 }}>
                Nothing to pick here.
              </Text>
            ) : options.map((o) => (
              <TouchableOpacity
                key={o.key}
                onPress={o.onPress}
                style={[styles.skillsItem, o.active && styles.skillsItemActive]}
                activeOpacity={0.85}
              >
                <Text style={[styles.skillsItemText, o.active && styles.skillsItemTextActive]}>
                  {o.label}
                </Text>
                {o.active ? <Check size={14} color={BRAND} strokeWidth={2.6} /> : null}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// "Skills" default field on the Registration Form. Options come from
// the event's Categories & Skills configuration (never hardcoded).
function SkillsDropdown({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const hasOptions = (options || []).length > 0;
  return (
    <>
      <TouchableOpacity
        onPress={() => hasOptions && setOpen(true)}
        activeOpacity={hasOptions ? 0.85 : 1}
        style={[
          styles.input,
          styles.skillsTrigger,
          !hasOptions && { opacity: 0.55 },
        ]}
      >
        <Text
          style={[
            styles.skillsTriggerText,
            !value && { color: '#9CA3AF', fontWeight: '500' },
          ]}
          numberOfLines={1}
        >
          {value || (hasOptions ? 'Select a skill' : 'No skills available')}
        </Text>
        <ChevronDown size={14} color={TEXT_MUTED} strokeWidth={2.4} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          style={styles.skillsBackdrop}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <View style={styles.skillsSheet}>
            <View style={styles.skillsSheetHead}>
              <Text style={styles.skillsSheetTitle}>Select Skill</Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={8}>
                <XCircle size={18} color={TEXT_MUTED} />
              </TouchableOpacity>
            </View>
            <ScrollView>
              {(options || []).map((opt) => {
                const active = String(opt) === String(value);
                return (
                  <TouchableOpacity
                    key={String(opt)}
                    onPress={() => { onChange(opt); setOpen(false); }}
                    style={[styles.skillsItem, active && styles.skillsItemActive]}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.skillsItemText, active && styles.skillsItemTextActive]}>
                      {opt}
                    </Text>
                    {active ? <Check size={14} color={BRAND} strokeWidth={2.6} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

function Header({ title, subtitle, navigation }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
        <ChevronLeft size={20} color={TEXT} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
      </View>
    </View>
  );
}

function FieldRow({ field, value, onChange, onCheckboxToggle, onPickFile, eventSkills, dobAgeInfo }) {
  const label = (
    <View style={styles.fieldLabelRow}>
      <Text style={styles.fieldLabel}>{field.label}</Text>
      {field.required ? <Text style={styles.req}>Required</Text> : null}
    </View>
  );

  // ── DOB default field — special-case with live age eligibility ──
  // The parent passes a `dobAgeInfo` blob whose `age` reflects the
  // current DOB (auto-populated on load, editable here). If the age
  // falls outside any picked skill's configured age range we flip
  // the input into an error state and render an explanatory line
  // beneath it. The parent's memo simultaneously flips
  // `anyAgeMismatch`, which blocks the submit button.
  if (field.sourceType === 'student' && field.sourceKey === 'dob') {
    const info = dobAgeInfo || { age: null, mismatches: [], hasProblem: false };
    const showAge = info.age != null;
    return (
      <View style={styles.fieldWrap}>
        <View style={styles.fieldLabelRow}>
          <Text style={styles.fieldLabel}>{field.label}</Text>
          {field.required ? <Text style={styles.req}>Required</Text> : null}
          {showAge ? (
            <Text style={[
              styles.dobAgePill,
              info.hasProblem && styles.dobAgePillError,
            ]}>
              {`Age ${info.age}`}
            </Text>
          ) : null}
        </View>
        <TextInput
          style={[
            styles.input,
            info.hasProblem && styles.inputError,
          ]}
          value={value != null ? String(value) : ''}
          onChangeText={onChange}
          keyboardType="default"
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#9CA3AF"
        />
        {info.hasProblem ? (
          <Text style={styles.dobErrorText}>
            Student age does not match the event age criteria
            {info.mismatches.length
              ? ` (${info.mismatches.map((m) => `${m.skillName}: ${m.range}`).join(' · ')})`
              : ''}.
          </Text>
        ) : null}
      </View>
    );
  }

  // ── Skills default field — special-case ──────────────────────
  // When the field is the student "skills" default:
  //   • If the student's snapshot carried a value, render it as an
  //     editable text row (same behaviour as every other student-
  //     source field) so the operator can adjust if needed.
  //   • If it's empty, render a dropdown sourced from THIS event's
  //     Categories & Skills configuration (`eventSkills`). No
  //     hardcoded catalog — the organiser's picks are the single
  //     source of truth for that event.
  if (field.sourceType === 'student' && field.sourceKey === 'skills' && !value) {
    return (
      <View style={styles.fieldWrap}>
        {label}
        <SkillsDropdown
          value={value}
          options={eventSkills || []}
          onChange={onChange}
        />
        {(eventSkills || []).length === 0 ? (
          <Text style={styles.skillsFallbackHint}>
            No skills configured for this event yet. Add them in Event Creation → Categories & Skills.
          </Text>
        ) : null}
      </View>
    );
  }

  // ── Aadhaar Number default field — special-case ──────────────
  // Rendered as a numeric input capped at 12 digits. onChange
  // strips any non-digit character so paste/typing autocorrect
  // can't sneak in spaces or dashes, and a subtle hint below
  // shows the current length so the organiser can see when they
  // have a valid 12-digit value. The invariant "exactly 12 digits
  // when non-empty" is preserved end-to-end because the payload
  // is the raw string the user typed here.
  if (field.sourceType === 'student' && field.sourceKey === 'aadhaar_number') {
    const digits = value != null ? String(value).replace(/\D/g, '').slice(0, 12) : '';
    const valid  = digits.length === 12;
    return (
      <View style={styles.fieldWrap}>
        {label}
        <TextInput
          style={styles.input}
          value={digits}
          onChangeText={(v) => onChange(v.replace(/\D/g, '').slice(0, 12))}
          keyboardType="number-pad"
          maxLength={12}
          placeholder="12-digit Aadhaar number"
          placeholderTextColor="#9CA3AF"
        />
        {digits.length > 0 && !valid ? (
          <Text style={styles.skillsFallbackHint}>
            {`Enter a valid 12-digit Aadhaar number (${digits.length}/12).`}
          </Text>
        ) : null}
      </View>
    );
  }

  // student-reference rows: render as read-only input with the
  // auto-populated value editable (organizer may need to fix a
  // missing DOB, etc).
  const t = field.type === 'student' ? 'text' : field.type;

  if (t === 'text' || t === 'number' || t === 'date') {
    return (
      <View style={styles.fieldWrap}>
        {label}
        <TextInput
          style={styles.input}
          value={value != null ? String(value) : ''}
          onChangeText={onChange}
          keyboardType={t === 'number' ? 'numeric' : 'default'}
          placeholder={t === 'date' ? 'YYYY-MM-DD' : ''}
          placeholderTextColor="#9CA3AF"
        />
      </View>
    );
  }
  if (t === 'textarea') {
    return (
      <View style={styles.fieldWrap}>
        {label}
        <TextInput
          style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
          value={value != null ? String(value) : ''}
          onChangeText={onChange}
          multiline
          placeholderTextColor="#9CA3AF"
        />
      </View>
    );
  }
  if (t === 'dropdown' || t === 'radio') {
    const opts = Array.isArray(field.options) ? field.options : [];
    return (
      <View style={styles.fieldWrap}>
        {label}
        <View style={styles.optsCol}>
          {opts.map((o) => {
            const on = value === o.value;
            return (
              <TouchableOpacity
                key={o.value}
                style={[styles.optRow, on && styles.optRowOn]}
                onPress={() => onChange(o.value)}
                activeOpacity={0.8}
              >
                <View style={[styles.radio, on && styles.radioOn]}>
                  {on ? <View style={styles.radioDot} /> : null}
                </View>
                <Text style={styles.optLabel}>{o.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  }
  if (t === 'checkbox') {
    const opts = Array.isArray(field.options) ? field.options : [];
    const arr = Array.isArray(value) ? value : [];
    return (
      <View style={styles.fieldWrap}>
        {label}
        <View style={styles.optsCol}>
          {opts.map((o) => {
            const on = arr.includes(o.value);
            return (
              <TouchableOpacity
                key={o.value}
                style={[styles.optRow, on && styles.optRowOn]}
                onPress={() => onCheckboxToggle(o.value)}
                activeOpacity={0.8}
              >
                <View style={[styles.checkbox, on && styles.checkboxOn]}>
                  {on ? <Check size={12} color="#fff" strokeWidth={3} /> : null}
                </View>
                <Text style={styles.optLabel}>{o.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  }
  if (t === 'file') {
    const has = value && typeof value === 'object' && value.url;
    return (
      <View style={styles.fieldWrap}>
        {label}
        <TouchableOpacity style={styles.fileBtn} onPress={onPickFile} activeOpacity={0.85}>
          <Upload size={14} color={BRAND} />
          <Text style={styles.fileBtnText}>
            {has ? (value.name || 'File attached') : 'Choose file'}
          </Text>
        </TouchableOpacity>
        {has ? (
          <View style={styles.fileChip}>
            <CheckCircle2 size={12} color={GREEN} />
            <Text style={styles.fileChipText} numberOfLines={1}>{value.name || value.url}</Text>
          </View>
        ) : null}
      </View>
    );
  }
  // Fallback — treat as text.
  return (
    <View style={styles.fieldWrap}>
      {label}
      <TextInput
        style={styles.input}
        value={value != null ? String(value) : ''}
        onChangeText={onChange}
        placeholderTextColor="#9CA3AF"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: SURFACE, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  backBtn: { padding: 6 },
  title:    { fontSize: 16, fontWeight: '800', color: TEXT },
  subtitle: { fontSize: 12, color: TEXT_MUTED, marginTop: 1 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  err: { color: TEXT_MUTED, fontSize: 13, textAlign: 'center' },

  body: { padding: 14 },
  studentCard: {
    backgroundColor: SURFACE, borderRadius: 14,
    borderWidth: 1, borderColor: BORDER,
    padding: 14, marginBottom: 12,
  },

  // Mandatory declaration card + checkbox — always rendered at the
  // bottom of the form, above the sticky Submit footer. Amber-tinted
  // to signal "must action" without reading as an error, then flips
  // to a soft-green surface once accepted so the participant gets
  // visual confirmation their tick registered.
  declarationCard: {
    marginTop: 4,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
    borderRadius: 14,
    padding: 14,
  },
  declarationCardOn: {
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
  },
  declarationRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
  },
  declCheckbox: {
    width: 22, height: 22, borderRadius: 5,
    borderWidth: 1.5, borderColor: '#F59E0B',
    backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
  },
  declCheckboxOn: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  declarationTitle: {
    fontSize: 13, fontWeight: '800', color: '#7C2D12',
    marginBottom: 4, letterSpacing: 0.2,
  },
  declarationBody: {
    fontSize: 12, color: '#7C2D12', fontWeight: '600', lineHeight: 17,
  },

  // ── Mandatory participation-mode question ──────────────────
  modeCard: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginBottom: 12,
  },
  modeLabelRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginBottom: 10,
  },
  modeLabel: {
    flex: 1,
    fontSize: 14, fontWeight: '800', color: TEXT, lineHeight: 20,
  },
  modeSegRow: {
    flexDirection: 'row', gap: 8,
  },
  modeSegBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5, borderColor: BORDER,
    backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },
  modeSegBtnActive: {
    borderColor: BRAND,
    backgroundColor: BRAND_SOFT,
  },
  modeSegBtnText: { fontSize: 13, fontWeight: '700', color: TEXT_MUTED },
  modeSegBtnTextActive: { color: BRAND, fontWeight: '800' },

  currentEventPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 12,
    paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#F0FDF4',
    borderWidth: 1, borderColor: '#86EFAC',
  },
  currentEventPillText: {
    flex: 1,
    fontSize: 12, fontWeight: '700', color: '#065F46',
  },

  extraEventsWrap: { marginTop: 12 },
  extraEventsHint: {
    fontSize: 12, color: TEXT_MUTED, fontWeight: '600',
    marginBottom: 8,
  },
  extraEventsCenter: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12,
  },
  extraEventsCenterText: { fontSize: 12, color: TEXT_MUTED, fontWeight: '600' },
  extraEventsError: {
    fontSize: 12, color: '#B91C1C', fontWeight: '600',
    paddingVertical: 8,
  },
  extraEventsEmpty: {
    padding: 12,
    borderWidth: 1, borderStyle: 'dashed', borderColor: BORDER,
    borderRadius: 10,
    alignItems: 'center',
  },
  extraEventsEmptyText: { fontSize: 12, color: TEXT_MUTED, textAlign: 'center' },
  extraEventRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 10, paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1, borderColor: BORDER,
    backgroundColor: SURFACE,
    marginBottom: 6,
  },
  extraEventRowOn: {
    borderColor: BRAND,
    backgroundColor: BRAND_SOFT,
  },
  extraEventBox: {
    width: 20, height: 20, borderRadius: 5,
    borderWidth: 1.5, borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },
  extraEventBoxOn: { backgroundColor: BRAND, borderColor: BRAND },
  extraEventTitle: {
    fontSize: 13, fontWeight: '800', color: TEXT,
  },
  extraEventMeta: {
    fontSize: 11, color: TEXT_MUTED, marginTop: 2, fontWeight: '600',
  },

  // ── Skills fallback dropdown ────────────────────────────────
  skillsTrigger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 8,
  },
  skillsTriggerText: { flex: 1, fontSize: 14, color: TEXT, fontWeight: '700' },
  skillsFallbackHint: {
    fontSize: 11, color: TEXT_MUTED, marginTop: 4, fontStyle: 'italic',
    lineHeight: 15,
  },
  skillsBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    alignItems: 'center', justifyContent: 'center',
    padding: 24,
  },
  skillsSheet: {
    width: '100%',
    maxWidth: 340, maxHeight: 380,
    backgroundColor: SURFACE,
    borderRadius: 14,
    overflow: 'hidden',
  },
  skillsSheetHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  skillsSheetTitle: { fontSize: 14, fontWeight: '800', color: TEXT },
  skillsItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  skillsItemActive: { backgroundColor: BRAND_SOFT },
  skillsItemText: { fontSize: 14, color: TEXT, fontWeight: '600' },
  skillsItemTextActive: { color: BRAND, fontWeight: '800' },

  // Student identity block — photo + name + meta, centered so the
  // real profile picture reads as the visual anchor of each card.
  // Category → Skill → Age → Division cascade card. Sits at the very
  // top of each student card so the organiser picks the eligibility
  // bucket BEFORE the student's identity + custom fields render.
  cascadeCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1, borderColor: BORDER,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  cascadeTitle: {
    fontSize: 12, fontWeight: '800', color: TEXT,
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginBottom: 8,
  },
  cascadeLabel: {
    fontSize: 11, fontWeight: '700', color: TEXT_MUTED,
    marginTop: 8, marginBottom: 4, letterSpacing: 0.3,
  },
  cascadeTrigger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 8,
  },
  cascadeTriggerText: {
    flex: 1,
    fontSize: 13, fontWeight: '700', color: TEXT,
  },
  cascadeReadonly: {
    backgroundColor: '#EEF2FF',
    borderColor: '#E0E7FF',
  },
  cascadeReadonlyText: {
    fontSize: 13, fontWeight: '800', color: '#4338CA',
  },
  // Yes/No segmented control for the "multiple events" question.
  multiRow: {
    flexDirection: 'row', gap: 8, marginTop: 4,
  },
  multiPill: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1, borderColor: BORDER,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  multiPillActive: {
    borderColor: BRAND,
    backgroundColor: BRAND_SOFT,
  },
  multiPillText: {
    fontSize: 12, fontWeight: '800', color: TEXT_MUTED, letterSpacing: 0.3,
  },
  multiPillTextActive: { color: BRAND },
  // Separator between two Skill+Division combos when "Yes" is picked.
  comboBlock: {
    marginTop: 12, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: BORDER,
  },
  comboHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  comboRemove: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999, backgroundColor: '#FEE2E2',
  },
  comboRemoveText: {
    fontSize: 10, fontWeight: '800', color: '#B91C1C',
    letterSpacing: 0.3, textTransform: 'uppercase',
  },
  addComboBtn: {
    marginTop: 10,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1, borderColor: BRAND_SOFT, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff',
  },
  addComboBtnText: {
    fontSize: 12, fontWeight: '800', color: BRAND, letterSpacing: 0.2,
  },

  studentIdentity: {
    alignItems: 'center',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    marginBottom: 6,
  },
  studentName: {
    fontSize: 16, fontWeight: '800', color: TEXT,
    marginTop: 10, textAlign: 'center',
  },
  studentMeta: {
    fontSize: 12, color: TEXT_MUTED, marginTop: 3, textAlign: 'center',
  },

  fieldWrap: { marginTop: 10 },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: TEXT_MUTED, flex: 1 },
  req: {
    fontSize: 10, fontWeight: '800', color: BRAND,
    backgroundColor: BRAND_SOFT, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999,
  },

  input: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: TEXT,
    backgroundColor: SURFACE,
  },
  // Input error state used by the DOB field when the computed age
  // falls outside every picked skill's configured range.
  inputError: {
    borderColor: '#DC2626',
    backgroundColor: '#FEF2F2',
  },
  // Live age chip shown inline with the DOB label. Green tint by
  // default, red tint when the age fails eligibility.
  dobAgePill: {
    fontSize: 11, fontWeight: '800',
    color: '#065F46',
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
  },
  dobAgePillError: {
    color: '#991B1B',
    backgroundColor: '#FEE2E2',
  },
  dobErrorText: {
    marginTop: 6,
    fontSize: 12, fontWeight: '700', color: '#B91C1C', lineHeight: 17,
  },

  optsCol: { gap: 6 },
  optRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: BORDER, borderRadius: 10,
    backgroundColor: SURFACE,
  },
  optRowOn: { borderColor: BRAND, backgroundColor: BRAND_SOFT + '55' },
  optLabel: { fontSize: 13, color: TEXT, flex: 1 },
  radio: {
    width: 16, height: 16, borderRadius: 8,
    borderWidth: 1.5, borderColor: '#CBD5E1',
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { borderColor: BRAND },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: BRAND },
  checkbox: {
    width: 16, height: 16, borderRadius: 4,
    borderWidth: 1.5, borderColor: '#CBD5E1',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: BRAND, borderColor: BRAND },

  fileBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderStyle: 'dashed', borderColor: BRAND,
    backgroundColor: BRAND_SOFT + '55',
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10,
    justifyContent: 'center',
  },
  fileBtnText: { color: BRAND, fontWeight: '800', fontSize: 13 },
  fileChip: {
    marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 6,
    padding: 8, borderRadius: 8, backgroundColor: '#F0FDF4',
  },
  fileChipText: { fontSize: 11, color: TEXT, flex: 1 },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: SURFACE, borderTopWidth: 1, borderTopColor: BORDER,
    padding: 12,
  },
  primary: {
    backgroundColor: BRAND, borderRadius: 999,
    paddingVertical: 14, alignItems: 'center',
  },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  doneTitle: { fontSize: 16, fontWeight: '800', color: TEXT, marginTop: 12 },
  doneMeta:  { fontSize: 12, color: TEXT_MUTED, marginTop: 6, textAlign: 'center' },

  // Success overlay — semi-opaque backdrop with a centered card.
  doneBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24,
  },
  doneSheet: {
    width: '100%', maxWidth: 380,
    backgroundColor: SURFACE,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    // shadow (iOS) + elevation (Android) so the sheet lifts off
    // the dimmed backdrop.
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  doneIconWrap: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#DCFCE7',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 8,
  },
  doneHeadline: {
    fontSize: 16, fontWeight: '800', color: TEXT,
    textAlign: 'center', marginTop: 4,
  },
  doneActionsRow: {
    flexDirection: 'row', gap: 10,
    marginTop: 18, width: '100%',
  },
  doneActionBtn: {
    flex: 1,
    paddingVertical: 12, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
  },
  doneActionSecondary: {
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: BORDER,
  },
  doneActionSecondaryText: {
    fontSize: 13, fontWeight: '800', color: TEXT, letterSpacing: 0.3,
  },
  doneActionPrimary: { backgroundColor: BRAND },
  doneActionPrimaryText: {
    fontSize: 13, fontWeight: '800', color: '#fff', letterSpacing: 0.3,
  },
});
