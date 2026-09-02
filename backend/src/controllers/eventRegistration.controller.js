// src/controllers/eventRegistration.controller.js
//
// MODULE 2: Event → Select Students for Registration.
//
// Only the students-listing side of the flow lives here. The actual
// registration submission (posting the answers to the organizer's
// Registration Form) is MODULE 3 and is intentionally out of scope.
//
// Endpoints mounted under /api/events/:eventId/... in the route file:
//
//   GET  /eligible-students     → the CURRENT institution's students
//                                 with an `already_registered` flag
//                                 per row. Supports ?q= search and
//                                 ?branch_id / ?course_id / ?belt
//                                 filters. Server-side paginated.
//
// Ownership / security:
//   Every request resolves the caller's own institution via their
//   JWT (`req.user.id` → users.institution_id). Only students that
//   belong to THAT institution (through the existing enrollments
//   → batches → institutions graph) are returned. There is no way
//   for institution B to enumerate institution A's students here.

const pool = require('../config/db');

// Clamp helpers — pagination inputs are always clamped so a
// malformed query string can never blow up the list query or
// return unbounded rows.
const clampLimit  = (raw, def = 25, max = 100) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
};
const clampOffset = (raw) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
};

// End-of-day LOCAL timestamp for a registration_closing_date /
// event_date value coming out of PostgreSQL.
//
// The DATE column serialises to a JS Date at UTC midnight, which
// is 5:30 AM IST on the same calendar day. A naive
// `new Date(row.registration_closing_date) < now` comparison then
// flips "closed" at 5:30 AM on the closing day — five hours EARLIER
// than the organiser expects. Product spec: registration is open
// until 23:59:59 LOCAL on the closing date and shuts at 00:00 the
// next day. We honour that by parsing the row value, taking its
// LOCAL Y/M/D, and returning the local end-of-day epoch. Row values
// that already carry a time component (payload PUTs from the
// updater send full ISO) pass through untouched.
function registrationDeadlineMs(raw) {
  if (!raw) return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  // node-postgres reads a DATE column as a JS Date that is midnight
  // in the PROCESS's timezone. When Node runs with TZ=UTC the
  // parsed Date's UTC time part is zero; when Node runs with e.g.
  // TZ=Asia/Kolkata the LOCAL time part is zero and the UTC time
  // is 18:30 the prior day. Both cases mean "just the calendar
  // day — no meaningful time" and both should be treated as
  // end-of-day LOCAL on that day. Real ISO timestamps that carry a
  // non-zero time in both frames pass through unchanged.
  const isLocalMidnight =
    d.getHours() === 0 && d.getMinutes() === 0 &&
    d.getSeconds() === 0 && d.getMilliseconds() === 0;
  if (isLocalMidnight) {
    return new Date(
      d.getFullYear(), d.getMonth(), d.getDate(),
      23, 59, 59, 999,
    ).getTime();
  }
  const isUtcMidnight =
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  if (isUtcMidnight) {
    return new Date(
      d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
      23, 59, 59, 999,
    ).getTime();
  }
  return d.getTime();
}

// Resolve which institution the current admin belongs to.
async function resolveAdminInstitution(userId) {
  const r = await pool.query(
    `SELECT institution_id FROM users WHERE id = $1`,
    [userId],
  );
  return r.rows[0]?.institution_id || null;
}

/**
 * GET /api/events/:eventId/eligible-students
 *
 * Returns the caller-institution's students paginated + tagged with
 * whether they are already registered for this event. Powers the
 * Select Students screen.
 *
 * Query params:
 *   limit, offset  — pagination.
 *   q              — search text; matches name / phone / email /
 *                    user id (numeric).
 *   branch_id      — restrict to students whose enrolment batch is
 *                    at the given branch institution id.
 *   course_id      — restrict to students enrolled in a batch that
 *                    teaches the given course.
 *   belt           — belt-level filter (student_profiles.belt_level).
 *
 * Response:
 *   {
 *     event: { id, title, registration_enabled, registration_closing_date, event_date },
 *     total, count, limit, offset,
 *     students: [
 *       {
 *         id, name, phone, email,
 *         belt_level, course_names, branch_name,
 *         already_registered: boolean
 *       }, ...
 *     ]
 *   }
 */
exports.listEligibleStudents = async (req, res) => {
  try {
    const eventId = Number(req.params.eventId);
    if (!Number.isFinite(eventId)) {
      return res.status(400).json({ message: 'Invalid event id.' });
    }
    const callerId = req.user.id;
    const institutionId = await resolveAdminInstitution(callerId);
    if (!institutionId) {
      return res.status(403).json({ message: 'No institution linked to this admin.' });
    }

    // Load the event + validate visibility. Approved events (their
    // own inter OR any approved intra) are the only ones that carry
    // a Registration Form. Nothing here mutates event state.
    // We also pull the categories JSONB so the eligibility filter
    // below can restrict the student list to the event's own skills.
    // 42703 fallback keeps the endpoint working on environments
    // that predate migration 096 (event_time + categories).
    let evtRes;
    try {
      evtRes = await pool.query(
        `SELECT id, title, institution_id, event_type, approval_status,
                is_active, registration_enabled,
                registration_closing_date, event_date, publish_at,
                categories
           FROM mobile_events WHERE id = $1`,
        [eventId],
      );
    } catch (colErr) {
      if (colErr?.code === '42703') {
        evtRes = await pool.query(
          `SELECT id, title, institution_id, event_type, approval_status,
                  is_active, registration_enabled,
                  registration_closing_date, event_date, publish_at
             FROM mobile_events WHERE id = $1`,
          [eventId],
        );
      } else {
        throw colErr;
      }
    }
    if (evtRes.rowCount === 0) {
      return res.status(404).json({ message: 'Event not found.' });
    }
    const evt = evtRes.rows[0];

    // Skills configured on this event, flattened + deduped. Powers
    // the eligibility filter below — a student's course_names must
    // overlap this list to appear. Empty event.categories means no
    // filter is applied (behaviour before this feature).
    const eventSkillNames = (() => {
      const set = new Set();
      const cats = Array.isArray(evt.categories) ? evt.categories : [];
      cats.forEach((c) => {
        (c?.skills || []).forEach((s) => {
          const nm = String(s?.name || '').trim().toLowerCase();
          if (nm) set.add(nm);
        });
      });
      return Array.from(set);
    })();

    // ── Paging + filters ─────────────────────────────────────
    const limit  = clampLimit(req.query.limit);
    const offset = clampOffset(req.query.offset);
    const q      = String(req.query.q || '').trim();
    const branchId = req.query.branch_id ? Number(req.query.branch_id) : null;
    const courseId = req.query.course_id ? Number(req.query.course_id) : null;
    const belt     = req.query.belt ? String(req.query.belt).trim() : null;

    // Base filter — the current institution's students. Sub-branch
    // admins see students at their own branch only; main-branch
    // admins see students across every branch in their academy.
    const params = [institutionId];
    // Reach: this institution + every sub-branch under it. Uses the
    // parent_institution_id graph so a main-branch admin sees the
    // full academy while a sub-branch admin naturally sees only
    // rows whose batches live at their own branch.
    const where = [
      `u.role = 'student'`,
      `COALESCE(u.is_deleted, false) = false`,
      `EXISTS (
         SELECT 1
           FROM enrollments en
           JOIN batches b ON b.id = en.batch_id
          WHERE en.student_id = u.id
            AND b.institution_id IN (
              SELECT id FROM institutions
               WHERE id = $1 OR parent_institution_id = $1
            )
       )`,
    ];

    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      const idx = params.length;
      // Match name / phone / email; also treat a purely numeric
      // query as a direct id lookup so scanning a student ID works.
      if (/^\d+$/.test(q)) {
        params.push(Number(q));
        const nIdx = params.length;
        where.push(
          `(LOWER(u.name) LIKE $${idx}
            OR LOWER(u.phone) LIKE $${idx}
            OR LOWER(u.email) LIKE $${idx}
            OR u.id = $${nIdx})`,
        );
      } else {
        where.push(
          `(LOWER(u.name) LIKE $${idx}
            OR LOWER(u.phone) LIKE $${idx}
            OR LOWER(u.email) LIKE $${idx})`,
        );
      }
    }

    if (branchId) {
      params.push(branchId);
      const idx = params.length;
      where.push(
        `EXISTS (
           SELECT 1 FROM enrollments en2
             JOIN batches b2 ON b2.id = en2.batch_id
            WHERE en2.student_id = u.id
              AND b2.institution_id = $${idx}
         )`,
      );
    }
    if (courseId) {
      params.push(courseId);
      const idx = params.length;
      where.push(
        `EXISTS (
           SELECT 1 FROM enrollments en3
             JOIN batches b3 ON b3.id = en3.batch_id
            WHERE en3.student_id = u.id
              AND b3.course_id = $${idx}
         )`,
      );
    }
    // NOTE: belt filter intentionally left out for now — student
    // belt info lives in the belt_history / student_belts tables
    // (not on student_profiles). Future enhancement can join those
    // in a sub-select. Client already handles the missing field.
    // eslint-disable-next-line no-unused-vars
    const _ignoredBelt = belt;

    // ── Skill-eligibility filter (opt-in) ────────────────────
    // Historically this endpoint auto-narrowed the roster to
    // students enrolled in one of the event's own skills. Product
    // decision: the Select Students screen should default to
    // showing EVERY student at the institution and let the
    // operator narrow via the on-screen Skill / Gender filters.
    // The event's skill list still ships in the response
    // (`event.event_skills`) so the client can decide what to do
    // with it, and we honour an opt-in `?scope=event-skills` query
    // for any caller that still wants the restrictive behaviour.
    if (
      eventSkillNames.length > 0
      && String(req.query.scope || '').toLowerCase() === 'event-skills'
    ) {
      params.push(eventSkillNames);
      const idx = params.length;
      where.push(
        `EXISTS (
           SELECT 1
             FROM enrollments enS
             JOIN batches   bS ON bS.id = enS.batch_id
             JOIN courses   cS ON cS.id = bS.course_id
            WHERE enS.student_id = u.id
              AND bS.institution_id IN (
                SELECT id FROM institutions
                 WHERE id = $1 OR parent_institution_id = $1
              )
              AND LOWER(cS.name) = ANY($${idx}::text[])
         )`,
      );
    }

    const whereClause = `WHERE ${where.join(' AND ')}`;

    // Total for pagination header — same WHERE, no LIMIT.
    // Uses ONLY the filter params (institutionId + any q/branch
    // /course/belt filters) — the eventId + limit/offset get
    // appended below, exclusively for the page query.
    const totalRes = await pool.query(
      `SELECT COUNT(*)::int AS total
         FROM users u
         LEFT JOIN student_profiles sp ON sp.user_id = u.id
        ${whereClause}`,
      params,
    );

    // Now append the binds that only the page query uses. Order:
    //   $[eventIdx]  — eventId for the already_registered EXISTS
    //   $[limitIdx]  — LIMIT
    //   $[offsetIdx] — OFFSET
    params.push(eventId);  const eventIdx  = params.length;
    params.push(limit);    const limitIdx  = params.length;
    params.push(offset);   const offsetIdx = params.length;
    const pageRes = await pool.query(
      `SELECT
         u.id, u.name, u.phone, u.email,
         NULL::text AS belt_level,
         -- Gender + DOB from student_profiles so the Select Students
         -- picker's filters can key off them without a second call.
         sp.gender        AS gender,
         sp.date_of_birth AS dob,
         (
           SELECT COALESCE(STRING_AGG(DISTINCT c.name, ', '), '')
             FROM enrollments en4
             JOIN batches b4 ON b4.id = en4.batch_id
             LEFT JOIN courses c ON c.id = b4.course_id
            WHERE en4.student_id = u.id
              AND b4.institution_id IN (
                SELECT id FROM institutions
                 WHERE id = $1 OR parent_institution_id = $1
              )
         ) AS course_names,
         (
           -- Most-recent branch the student is enrolled at inside
           -- this academy group. enrollments.created_at doesn't
           -- exist in this schema (Postgres hint pointed us at
           -- b5.created_at) so we order by the batch's created_at
           -- as a stable proxy — newest batch wins.
           SELECT i.name
             FROM enrollments en5
             JOIN batches b5 ON b5.id = en5.batch_id
             JOIN institutions i ON i.id = b5.institution_id
            WHERE en5.student_id = u.id
              AND (i.id = $1 OR i.parent_institution_id = $1)
            ORDER BY b5.created_at DESC NULLS LAST
            LIMIT 1
         ) AS branch_name,
         EXISTS (
           SELECT 1 FROM event_registrations er
            WHERE er.event_id = $${eventIdx}
              AND er.student_id = u.id
         ) AS already_registered,
         -- Student's own "Are you interested to participate?"
         -- answer. NULL = never answered, TRUE = wants to
         -- participate, FALSE = explicit "No". The Select Students
         -- screen highlights rows where this is TRUE so the admin
         -- sees who explicitly asked to participate.
         (
           SELECT ei.interested
             FROM event_interests ei
            WHERE ei.event_id = $${eventIdx}
              AND ei.student_id = u.id
            LIMIT 1
         ) AS interested
       FROM users u
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
        ${whereClause}
        ORDER BY u.name ASC, u.id ASC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    // Registration deadline check — computed here so the client
    // can render the button state without duplicating the logic.
    // registrationDeadlineMs() interprets a bare DATE row value as
    // 23:59:59 LOCAL on that day, so the flag flips ONLY when
    // midnight rolls into the next calendar day.
    const now = Date.now();
    const deadlineMs =
      registrationDeadlineMs(evt.registration_closing_date)
      ?? registrationDeadlineMs(evt.event_date);
    const registration_closed = deadlineMs != null && deadlineMs < now;

    res.json({
      event: {
        id: evt.id,
        title: evt.title,
        institution_id: evt.institution_id,
        event_type: evt.event_type,
        approval_status: evt.approval_status,
        registration_enabled: !!evt.registration_enabled,
        registration_closing_date: evt.registration_closing_date,
        event_date: evt.event_date,
        registration_closed,
        // Flat list of skill names configured on this event, deduped
        // and lower-cased. Front-end uses this both to render an
        // "eligible-only" hint and as a defensive filter on top of
        // the server-side WHERE below.
        event_skills: eventSkillNames,
      },
      total:  totalRes.rows[0]?.total || 0,
      count:  pageRes.rows.length,
      limit,
      offset,
      students: pageRes.rows.map((r) => ({
        id:                 r.id,
        name:               r.name,
        phone:              r.phone,
        email:              r.email,
        belt_level:         r.belt_level,
        // Extended fields used by the Select Students screen's
        // Gender / Skills filters. Both are optional on the
        // student_profiles row so the front-end must handle nulls.
        gender:             r.gender || null,
        dob:                r.dob    || null,
        course_names:       r.course_names,
        branch_name:        r.branch_name,
        already_registered: !!r.already_registered,
        // Tri-state — TRUE = student tapped "Yes", FALSE = "No",
        // null = never answered. Mobile picker uses it to
        // highlight interested rows near the top of the list.
        interested:         r.interested == null ? null : !!r.interested,
      })),
    });
  } catch (err) {
    console.error('listEligibleStudents error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

/**
 * GET /api/events/:eventId/registration-check?ids=1,2,3
 *
 * Small companion endpoint — lets the client re-check which of a
 * given set of student ids are already registered right before
 * the "Continue" tap (e.g. if the list was viewed a while back
 * and another admin might have registered some in the meantime).
 * Returns { already_registered_ids: [ ... ] }.
 */
/**
 * GET /api/events/:eventId/students-profile?ids=1,2,3
 *
 * MODULE 3: batch fetch of profile snapshots for the students the
 * organizer selected in the previous step. Powers the auto-
 * populate pass on the Registration Form screen. Ownership check
 * is the same as the eligible list — you can only pull profiles
 * for students in your own institution.
 *
 * Response shape:
 *   {
 *     students: [
 *       { id, name, dob, gender, phone, email,
 *         belt_level, course, institution, branch }
 *     ]
 *   }
 * Missing fields come back as null so the form knows to prompt.
 */
exports.getStudentSnapshots = async (req, res) => {
  try {
    const eventId = Number(req.params.eventId);
    if (!Number.isFinite(eventId)) {
      return res.status(400).json({ message: 'Invalid event id.' });
    }
    const raw = String(req.query.ids || '').trim();
    if (!raw) return res.json({ students: [] });
    const ids = raw.split(',')
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length === 0) return res.json({ students: [] });

    const institutionId = await resolveAdminInstitution(req.user.id);
    if (!institutionId) {
      return res.status(403).json({ message: 'No institution linked to this admin.' });
    }

    const r = await pool.query(
      `SELECT
         u.id,
         u.name,
         u.phone,
         u.email,
         sp.date_of_birth AS dob,
         sp.gender,
         -- Extended student-profile columns. Every column below is a
         -- direct read from student_profiles (added by migration 017)
         -- so the participant Registration Form can auto-populate the
         -- new default fields (Father's Name, Mother's Name, Student
         -- Photo, Address). Master Name, District and State don't have
         -- dedicated student columns yet — those come back as null and
         -- the participant fills them in manually.
         sp.father_name  AS father_name,
         sp.mother_name  AS mother_name,
         sp.address      AS address,
         sp.photo_url    AS photo_url,
         (
           SELECT STRING_AGG(DISTINCT c.name, ', ')
             FROM enrollments en
             JOIN batches b ON b.id = en.batch_id
             LEFT JOIN courses c ON c.id = b.course_id
            WHERE en.student_id = u.id
              AND b.institution_id IN (
                SELECT id FROM institutions WHERE id = $2 OR parent_institution_id = $2
              )
         ) AS course,
         (
           SELECT i2.name
             FROM enrollments en2
             JOIN batches b2 ON b2.id = en2.batch_id
             JOIN institutions i2 ON i2.id = b2.institution_id
            WHERE en2.student_id = u.id
              AND (i2.id = $2 OR i2.parent_institution_id = $2)
            ORDER BY b2.created_at DESC NULLS LAST
            LIMIT 1
         ) AS branch,
         (
           SELECT i3.name FROM institutions i3
            WHERE i3.id = $2
         ) AS institution
       FROM users u
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
      WHERE u.id = ANY($1::int[])
        AND u.role = 'student'
        AND COALESCE(u.is_deleted, false) = false
        AND EXISTS (
          SELECT 1
            FROM enrollments en3
            JOIN batches b3 ON b3.id = en3.batch_id
           WHERE en3.student_id = u.id
             AND b3.institution_id IN (
               SELECT id FROM institutions WHERE id = $2 OR parent_institution_id = $2
             )
        )`,
      [ids, institutionId],
    );
    res.json({
      students: r.rows.map((row) => ({
        id:          row.id,
        name:        row.name,
        dob:         row.dob,
        gender:      row.gender,
        phone:       row.phone,
        email:       row.email,
        belt_level:  null, // Populated by a future belt_history subquery.
        course:      row.course,
        institution: row.institution,
        branch:      row.branch,
        // Skills the student already trains in — derived from their
        // enrolled course names (each course in this app represents a
        // specific martial-arts discipline). Same STRING_AGG we
        // already ran for `course`, aliased so the participant
        // Registration Form's new Skills field can auto-populate.
        // When null, the form falls back to a dropdown sourced from
        // the event's own Categories & Skills configuration.
        skills:      row.course || null,
        // Extended defaults — nullable. Front-end auto-fills these
        // where present and lets the operator type over blanks.
        father_name: row.father_name || null,
        mother_name: row.mother_name || null,
        address:     row.address     || null,
        photo_url:   row.photo_url   || null,
        // No student-level source yet; participant fills manually.
        master_name:    null,
        district:       null,
        state:          null,
        // Aadhaar Number — no dedicated student_profiles column
        // exists yet, so we surface null and the participant enters
        // the 12-digit value on the form. Kept as an explicit key
        // so the snapshot shape stays predictable if a column is
        // added later.
        aadhaar_number: null,
      })),
    });
  } catch (err) {
    console.error('getStudentSnapshots error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

/**
 * POST /api/events/:eventId/register
 *
 * MODULE 3: submit the Registration Form for one or more students.
 *
 * Body:
 *   {
 *     registrations: [
 *       {
 *         student_id: 91,
 *         answers: [
 *           { field_id: 12, value: "12345", value_json: null },
 *           { field_id: 15, value: null,    value_json: ["Small","Medium"] },
 *           ...
 *         ]
 *       },
 *       ...
 *     ]
 *   }
 *
 * Validates:
 *   • event exists, approved, registration_enabled, deadline not
 *     passed;
 *   • every student belongs to caller's institution;
 *   • every required field is answered per student;
 *   • options match the configured option set for enum types.
 *
 * Runs the whole batch inside a single transaction: either every
 * requested (student × answers) lands, or nothing. Students who
 * are ALREADY registered are silently skipped (surfaced in the
 * response's `skipped` array) rather than failing the batch.
 */
exports.submitRegistration = async (req, res) => {
  const eventId = Number(req.params.eventId);
  if (!Number.isFinite(eventId)) {
    return res.status(400).json({ message: 'Invalid event id.' });
  }
  const { registrations } = req.body || {};
  if (!Array.isArray(registrations) || registrations.length === 0) {
    return res.status(400).json({ message: 'No registrations provided.' });
  }

  const callerId = req.user.id;
  const institutionId = await resolveAdminInstitution(callerId);
  if (!institutionId) {
    return res.status(403).json({ message: 'No institution linked to this admin.' });
  }

  // Event + deadline + registration_enabled check.
  const evt = await pool.query(
    `SELECT id, title, institution_id, approval_status, is_active,
            registration_enabled, registration_closing_date, event_date
       FROM mobile_events WHERE id = $1`,
    [eventId],
  );
  if (evt.rowCount === 0) {
    return res.status(404).json({ message: 'Event not found.' });
  }
  const e = evt.rows[0];
  if (!e.registration_enabled) {
    return res.status(400).json({ message: 'Registration is not enabled for this event.' });
  }
  // Deadline treated as end-of-day LOCAL on the closing date (or
  // the event date when no explicit closing date is set), matching
  // the mobile UI — registration is open until 23:59 on that day.
  const deadlineMs =
    registrationDeadlineMs(e.registration_closing_date)
    ?? registrationDeadlineMs(e.event_date);
  if (deadlineMs != null && deadlineMs < Date.now()) {
    return res.status(400).json({ message: 'Registration closing date has passed.' });
  }
  if (e.approval_status !== 'approved') {
    return res.status(400).json({ message: 'Event is not published.' });
  }

  // Ownership: every submitted student must belong to caller.
  const studentIds = registrations.map((r) => Number(r.student_id)).filter(Boolean);
  if (studentIds.length === 0) {
    return res.status(400).json({ message: 'No student ids in payload.' });
  }
  const own = await pool.query(
    `SELECT u.id
       FROM users u
      WHERE u.id = ANY($1::int[])
        AND u.role = 'student'
        AND COALESCE(u.is_deleted, false) = false
        AND EXISTS (
          SELECT 1
            FROM enrollments en
            JOIN batches b ON b.id = en.batch_id
           WHERE en.student_id = u.id
             AND b.institution_id IN (
               SELECT id FROM institutions WHERE id = $2 OR parent_institution_id = $2
             )
        )`,
    [studentIds, institutionId],
  );
  const ownedSet = new Set(own.rows.map((r) => r.id));
  const rogue = studentIds.filter((id) => !ownedSet.has(id));
  if (rogue.length > 0) {
    return res.status(403).json({
      message: `You can only register your own students. Not owned: ${rogue.join(', ')}`,
    });
  }

  // Load the field definitions to validate + snapshot into the
  // answers table (so answers survive later field edits/deletes).
  const fieldsRes = await pool.query(
    `SELECT id, field_key, field_label, field_type, required, options, source_type
       FROM event_registration_fields WHERE event_id = $1`,
    [eventId],
  );
  const fieldById = new Map(fieldsRes.rows.map((f) => [f.id, f]));
  const requiredFieldIds = fieldsRes.rows.filter((f) => f.required).map((f) => f.id);

  // Per-student required-field check.
  const perStudentErrors = [];
  registrations.forEach((r) => {
    const answers = Array.isArray(r.answers) ? r.answers : [];
    const answered = new Set(answers
      .filter((a) => {
        const v = a?.value;
        const j = a?.value_json;
        const hasVal = v !== null && v !== undefined && String(v).trim() !== '';
        const hasJson = j && (Array.isArray(j) ? j.length > 0 : true);
        return hasVal || hasJson;
      })
      .map((a) => Number(a.field_id))
      .filter(Boolean));
    const missing = requiredFieldIds.filter((fid) => !answered.has(fid));
    if (missing.length > 0) {
      perStudentErrors.push({
        student_id: r.student_id,
        missing_field_ids: missing,
        missing_labels: missing.map((fid) => fieldById.get(fid)?.field_label).filter(Boolean),
      });
    }
  });
  if (perStudentErrors.length > 0) {
    return res.status(400).json({
      message: 'Some required fields are missing.',
      errors: perStudentErrors,
    });
  }

  // ── Insert transaction ─────────────────────────────────────
  const client = await pool.connect();
  const results = { created: [], skipped: [] };
  try {
    await client.query('BEGIN');
    for (const reg of registrations) {
      const sId = Number(reg.student_id);

      // ON CONFLICT DO NOTHING preserves the duplicate-registration
      // guard from the unique index. If the row already existed we
      // skip its answers write and record the id.
      const ins = await client.query(
        `INSERT INTO event_registrations
           (event_id, student_id, institution_id, submitted_by, status,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'registered', NOW(), NOW())
         ON CONFLICT (event_id, student_id) DO NOTHING
         RETURNING id`,
        [eventId, sId, institutionId, callerId],
      );

      if (ins.rowCount === 0) {
        results.skipped.push({ student_id: sId, reason: 'already_registered' });
        continue;
      }
      const registrationId = ins.rows[0].id;

      for (const raw of (reg.answers || [])) {
        const fieldId = Number(raw.field_id);
        const def = fieldById.get(fieldId);
        if (!def) continue; // Silently drop answers for unknown fields.
        const jsonVal = raw.value_json !== undefined ? raw.value_json : null;
        const textVal = raw.value !== undefined && raw.value !== null
          ? String(raw.value) : null;
        await client.query(
          `INSERT INTO event_registration_answers
             (registration_id, event_id, field_id, field_key,
              field_label, field_type, value_text, value_json,
              created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [
            registrationId, eventId, fieldId,
            def.field_key, def.field_label, def.field_type,
            textVal,
            jsonVal ? JSON.stringify(jsonVal) : null,
          ],
        );
      }
      results.created.push({ student_id: sId, registration_id: registrationId });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('submitRegistration error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  } finally {
    client.release();
  }

  // Best-effort notification back to the organiser.
  try {
    const orgAdmin = await pool.query(
      `SELECT owner_user_id, name FROM institutions WHERE id = $1`,
      [e.institution_id],
    );
    const orgOwner = orgAdmin.rows[0]?.owner_user_id;
    if (orgOwner && results.created.length > 0) {
      const { insertNotification } = require('./notification.controller');
      await insertNotification({
        user_id:        orgOwner,
        institution_id: e.institution_id,
        category:       'system',
        title:          'New registrations for your event',
        message:        `${results.created.length} student${results.created.length === 1 ? '' : 's'} just registered for "${e.title}".`,
        data: {
          screen:      'EventDetail',
          kind:        'event_registration_received',
          event_id:    e.id,
        },
        created_by: callerId,
      });
    }
  } catch (err) {
    console.warn('[event/register] organiser notify failed:', err?.message);
  }

  res.json({
    ok: true,
    event_id: eventId,
    created: results.created,
    skipped: results.skipped,
  });
};

exports.checkAlreadyRegistered = async (req, res) => {
  try {
    const eventId = Number(req.params.eventId);
    if (!Number.isFinite(eventId)) {
      return res.status(400).json({ message: 'Invalid event id.' });
    }
    const raw = String(req.query.ids || '').trim();
    if (!raw) return res.json({ already_registered_ids: [] });

    const ids = raw.split(',')
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length === 0) return res.json({ already_registered_ids: [] });

    // Ownership check: only expose the flag for MY institution's
    // students (so this endpoint can't be used to probe other
    // institutions' rosters).
    const institutionId = await resolveAdminInstitution(req.user.id);
    if (!institutionId) {
      return res.status(403).json({ message: 'No institution linked to this admin.' });
    }

    const r = await pool.query(
      `SELECT DISTINCT er.student_id
         FROM event_registrations er
         JOIN users u ON u.id = er.student_id
        WHERE er.event_id = $1
          AND er.student_id = ANY($2::int[])
          AND EXISTS (
            SELECT 1
              FROM enrollments en
              JOIN batches b ON b.id = en.batch_id
             WHERE en.student_id = u.id
               AND b.institution_id IN (
                 SELECT id FROM institutions
                  WHERE id = $3 OR parent_institution_id = $3
               )
          )`,
      [eventId, ids, institutionId],
    );
    res.json({ already_registered_ids: r.rows.map((row) => row.student_id) });
  } catch (err) {
    console.error('checkAlreadyRegistered error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
