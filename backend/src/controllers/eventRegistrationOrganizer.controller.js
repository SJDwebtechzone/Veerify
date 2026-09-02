// src/controllers/eventRegistrationOrganizer.controller.js
//
// MODULE 4: Organizer Registration Management.
//
// Every endpoint here is gated on "the caller's institution is the
// organizer of this event". Participating institutions and
// students never see the full roster — for them, only Module 2's
// eligible-list view exposes any registration data (their own
// students, own institution).
//
// Endpoints (mounted under /api by the routes file):
//   GET   /events/:eventId/registrations/summary
//   GET   /events/:eventId/registrations/institutions
//   GET   /events/:eventId/registrations              ?institution_id=&status=&q=&limit=&offset=
//   GET   /events/:eventId/registrations/:regId
//   PATCH /events/:eventId/registrations/:regId/status  body { status }

const pool = require('../config/db');

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

// Whitelist of registration statuses the organizer can flip a
// registration to. Kept small so a bad client payload can never
// sneak an unknown value in.
const ORGANIZER_STATUSES = new Set(['registered', 'cancelled']);

// Load the event AND check the caller is its organizer. Returns
// the event row on success, otherwise sends the response and
// returns null so the caller can bail.
async function loadAsOrganizer(req, res, eventId) {
  const evt = await pool.query(
    `SELECT id, title, institution_id, event_type, approval_status,
            registration_enabled, registration_closing_date, event_date
       FROM mobile_events WHERE id = $1`,
    [eventId],
  );
  if (evt.rowCount === 0) {
    res.status(404).json({ message: 'Event not found.' });
    return null;
  }
  const u = await pool.query(
    `SELECT institution_id FROM users WHERE id = $1`,
    [req.user.id],
  );
  const callerInst = u.rows[0]?.institution_id || null;
  if (!callerInst || Number(callerInst) !== Number(evt.rows[0].institution_id)) {
    res.status(403).json({
      message: 'Only the organizing institution can access this event\'s registrations.',
    });
    return null;
  }
  return evt.rows[0];
}

// Softer variant used by the list endpoint. Any signed-in
// institution admin can call this and see either:
//   • every registration (when they ARE the organizing institution)
//   • only their OWN institution's registrations (when they aren't)
// Returns { event, scopeInstitutionId } where scopeInstitutionId is
// non-null for participating institutions — the caller MUST fold
// it into the SQL WHERE clause to enforce the per-institution scope.
async function loadForListingScope(req, res, eventId) {
  const evt = await pool.query(
    `SELECT id, title, institution_id, event_type, approval_status,
            registration_enabled, registration_closing_date, event_date
       FROM mobile_events WHERE id = $1`,
    [eventId],
  );
  if (evt.rowCount === 0) {
    res.status(404).json({ message: 'Event not found.' });
    return null;
  }
  const u = await pool.query(
    `SELECT institution_id FROM users WHERE id = $1`,
    [req.user.id],
  );
  const callerInst = u.rows[0]?.institution_id || null;
  if (!callerInst) {
    res.status(403).json({ message: 'No institution linked to this admin.' });
    return null;
  }
  const isOrganizer = Number(callerInst) === Number(evt.rows[0].institution_id);
  return {
    event: evt.rows[0],
    // Null → caller is organizer, no per-institution scope. Non-null
    // → caller is a participating institution and can see only
    // registrations tied to that institution_id.
    scopeInstitutionId: isOrganizer ? null : callerInst,
  };
}

/**
 * GET /events/:eventId/registrations/summary
 *
 * Aggregate counts for the top-of-list summary card:
 *   • total registered students
 *   • number of distinct participating institutions
 *   • counts per registration status (registered / cancelled / ...)
 */
exports.getSummary = async (req, res) => {
  try {
    const eventId = Number(req.params.eventId);
    if (!Number.isFinite(eventId)) {
      return res.status(400).json({ message: 'Invalid event id.' });
    }
    const evt = await loadAsOrganizer(req, res, eventId);
    if (!evt) return;

    const [totalsRes, byStatusRes] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int                          AS total,
                COUNT(DISTINCT institution_id)::int    AS institutions
           FROM event_registrations
          WHERE event_id = $1`,
        [eventId],
      ),
      pool.query(
        `SELECT status, COUNT(*)::int AS n
           FROM event_registrations
          WHERE event_id = $1
          GROUP BY status`,
        [eventId],
      ),
    ]);

    const byStatus = {};
    byStatusRes.rows.forEach((r) => { byStatus[r.status] = r.n; });

    res.json({
      event: { id: evt.id, title: evt.title, event_date: evt.event_date },
      total:         totalsRes.rows[0]?.total || 0,
      institutions:  totalsRes.rows[0]?.institutions || 0,
      by_status:     byStatus,
      // Convenience for the summary strip.
      registered:    byStatus.registered || 0,
      cancelled:     byStatus.cancelled  || 0,
    });
  } catch (err) {
    console.error('getSummary error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

/**
 * GET /events/:eventId/registrations/institutions
 *
 * List of participating institutions with a per-institution count.
 * Powers the institution filter/segmented control on the list.
 */
exports.listInstitutions = async (req, res) => {
  try {
    const eventId = Number(req.params.eventId);
    if (!Number.isFinite(eventId)) {
      return res.status(400).json({ message: 'Invalid event id.' });
    }
    const evt = await loadAsOrganizer(req, res, eventId);
    if (!evt) return;

    const r = await pool.query(
      `SELECT i.id, i.name, i.logo_url, COUNT(er.id)::int AS student_count
         FROM event_registrations er
         JOIN institutions i ON i.id = er.institution_id
        WHERE er.event_id = $1
        GROUP BY i.id, i.name, i.logo_url
        ORDER BY student_count DESC, i.name ASC`,
      [eventId],
    );
    res.json({ institutions: r.rows });
  } catch (err) {
    console.error('listInstitutions error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

/**
 * GET /events/:eventId/registrations
 *
 * Paginated registration list. Supports:
 *   • ?institution_id — restrict to one participating institution
 *   • ?status         — restrict to one status (registered/cancelled/…)
 *   • ?q              — search student name / institution name
 *   • ?limit, ?offset — standard pagination
 */
exports.listRegistrations = async (req, res) => {
  try {
    const eventId = Number(req.params.eventId);
    if (!Number.isFinite(eventId)) {
      return res.status(400).json({ message: 'Invalid event id.' });
    }
    // Softer scope: organizers see all registrations, participating
    // institutions see only their own students. scopeInstitutionId
    // is non-null in the latter case and gets folded into WHERE
    // below to enforce ownership at the DB level.
    const scope = await loadForListingScope(req, res, eventId);
    if (!scope) return;
    const evt = scope.event;

    const limit  = clampLimit(req.query.limit);
    const offset = clampOffset(req.query.offset);
    const q      = String(req.query.q || '').trim();
    // Organizers may filter by any institution; participants are
    // silently pinned to their own institution regardless of what
    // they pass in the query string.
    const inst   = scope.scopeInstitutionId != null
      ? Number(scope.scopeInstitutionId)
      : (req.query.institution_id ? Number(req.query.institution_id) : null);
    const status = String(req.query.status || '').trim();

    const params = [eventId];
    const where  = [`er.event_id = $1`];
    if (inst)   { params.push(inst);   where.push(`er.institution_id = $${params.length}`); }
    if (status) { params.push(status); where.push(`er.status = $${params.length}`); }
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      where.push(
        `(LOWER(u.name) LIKE $${params.length}
          OR LOWER(i.name) LIKE $${params.length})`,
      );
    }
    const whereClause = `WHERE ${where.join(' AND ')}`;

    const totalRes = await pool.query(
      `SELECT COUNT(*)::int AS total
         FROM event_registrations er
         JOIN users u ON u.id = er.student_id
         JOIN institutions i ON i.id = er.institution_id
         ${whereClause}`,
      params,
    );

    params.push(limit);  const limitIdx  = params.length;
    params.push(offset); const offsetIdx = params.length;

    const rows = await pool.query(
      `SELECT
         er.id, er.status, er.created_at, er.updated_at,
         u.id           AS student_id,
         u.name         AS student_name,
         u.phone        AS student_phone,
         u.email        AS student_email,
         sp.date_of_birth AS student_dob,
         sp.gender      AS student_gender,
         i.id           AS institution_id,
         i.name         AS institution_name,
         i.logo_url     AS institution_logo
       FROM event_registrations er
       JOIN users u         ON u.id = er.student_id
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       JOIN institutions i  ON i.id = er.institution_id
       ${whereClause}
       ORDER BY er.created_at DESC, er.id DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    // Opt-in include of every registered answer per row. Powers the
    // "Registered Students" table view where every default + custom
    // field the organiser configured must appear as its own column.
    // Kept behind a query flag so the existing summary list stays
    // small and fast — old callers see the same shape they always
    // did.
    let answersByReg = {};
    if (String(req.query.include || '').includes('answers') && rows.rows.length > 0) {
      const regIds = rows.rows.map((r) => r.id);
      const ansRes = await pool.query(
        `SELECT registration_id,
                field_id, field_key, field_label, field_type,
                value_text, value_json
           FROM event_registration_answers
          WHERE registration_id = ANY($1::int[])
          ORDER BY id ASC`,
        [regIds],
      );
      ansRes.rows.forEach((a) => {
        if (!answersByReg[a.registration_id]) answersByReg[a.registration_id] = [];
        answersByReg[a.registration_id].push({
          fieldId:   a.field_id,
          fieldKey:  a.field_key,
          label:     a.field_label,
          type:      a.field_type,
          value:     a.value_text,
          valueJson: a.value_json,
        });
      });
    }

    // Attach answers only when requested — otherwise the row shape
    // is byte-identical to the pre-existing response.
    const registrations = rows.rows.map((r) => (
      answersByReg[r.id]
        ? { ...r, answers: answersByReg[r.id] }
        : r
    ));

    res.json({
      total:  totalRes.rows[0]?.total || 0,
      count:  rows.rows.length,
      limit,
      offset,
      event: { id: evt.id, title: evt.title },
      registrations,
    });
  } catch (err) {
    console.error('listRegistrations error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

/**
 * GET /events/:eventId/registrations/:regId
 *
 * Full detail of one registration — student + institution + every
 * organizer-defined answer, dynamically returned via
 * event_registration_answers (no hard-coded field list).
 */
exports.getRegistrationDetail = async (req, res) => {
  try {
    const eventId = Number(req.params.eventId);
    const regId   = Number(req.params.regId);
    if (!Number.isFinite(eventId) || !Number.isFinite(regId)) {
      return res.status(400).json({ message: 'Invalid id.' });
    }
    const evt = await loadAsOrganizer(req, res, eventId);
    if (!evt) return;

    const r = await pool.query(
      `SELECT
         er.id, er.status, er.created_at, er.updated_at,
         u.id AS student_id, u.name AS student_name,
         u.phone AS student_phone, u.email AS student_email,
         sp.date_of_birth AS student_dob, sp.gender AS student_gender,
         sp.address       AS student_address,
         i.id AS institution_id, i.name AS institution_name,
         i.logo_url AS institution_logo,
         subm.name AS submitted_by_name, subm.email AS submitted_by_email
       FROM event_registrations er
       JOIN users u         ON u.id = er.student_id
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       JOIN institutions i  ON i.id = er.institution_id
       LEFT JOIN users subm ON subm.id = er.submitted_by
      WHERE er.event_id = $1 AND er.id = $2`,
      [eventId, regId],
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ message: 'Registration not found.' });
    }
    const ans = await pool.query(
      `SELECT id, field_id, field_key, field_label, field_type,
              value_text, value_json, created_at
         FROM event_registration_answers
        WHERE registration_id = $1
        ORDER BY id ASC`,
      [regId],
    );

    res.json({
      event: { id: evt.id, title: evt.title, event_date: evt.event_date },
      registration: r.rows[0],
      answers: ans.rows.map((a) => ({
        id:          a.id,
        fieldId:     a.field_id,
        fieldKey:    a.field_key,
        label:       a.field_label,
        type:        a.field_type,
        value:       a.value_text,
        valueJson:   a.value_json,
      })),
    });
  } catch (err) {
    console.error('getRegistrationDetail error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

/**
 * PATCH /events/:eventId/registrations/:regId/status
 * body: { status: 'registered' | 'cancelled' }
 *
 * Organizer marks a registration as cancelled (or restores it to
 * registered). This is the minimum status vocabulary the spec asks
 * for; extending the set only means adding to ORGANIZER_STATUSES.
 */
exports.updateStatus = async (req, res) => {
  try {
    const eventId = Number(req.params.eventId);
    const regId   = Number(req.params.regId);
    if (!Number.isFinite(eventId) || !Number.isFinite(regId)) {
      return res.status(400).json({ message: 'Invalid id.' });
    }
    const status = String(req.body?.status || '').trim().toLowerCase();
    if (!ORGANIZER_STATUSES.has(status)) {
      return res.status(400).json({
        message: `Status must be one of: ${Array.from(ORGANIZER_STATUSES).join(', ')}`,
      });
    }
    const evt = await loadAsOrganizer(req, res, eventId);
    if (!evt) return;

    const upd = await pool.query(
      `UPDATE event_registrations
          SET status = $3, updated_at = NOW()
        WHERE event_id = $1 AND id = $2
        RETURNING id, status`,
      [eventId, regId, status],
    );
    if (upd.rowCount === 0) {
      return res.status(404).json({ message: 'Registration not found.' });
    }
    res.json({ ok: true, id: upd.rows[0].id, status: upd.rows[0].status });
  } catch (err) {
    console.error('updateStatus error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

/**
 * GET /events/:eventId/registrations/export.xlsx
 *
 * Builds a single institution-wise workbook for the whole event:
 *   • First sheet ("Summary")      — one row per institution with
 *                                    its registered student count,
 *                                    plus a total row at the bottom.
 *   • Then one sheet per institution containing every registered
 *     student from that institution with all default + custom
 *     registration form answers, branch name, and event details.
 *
 * Auth mirrors listRegistrations:
 *   • Organiser → sees every institution's rows / sheet.
 *   • Participating institution → sees only their own students
 *     (Summary shows just that institution + total).
 *
 * Auth token can be passed via the standard Authorization header
 * OR as `?token=<jwt>` so Linking.openURL from the mobile client
 * downloads the file without hand-crafting headers.
 */
exports.exportRegistrationsXlsx = async (req, res) => {
  try {
    const eventId = Number(req.params.eventId);
    if (!Number.isFinite(eventId)) {
      return res.status(400).json({ message: 'Invalid event id.' });
    }

    // Reuse the softer scope resolver so the export inherits the
    // same institution-scoping rules as the on-screen list view.
    const scope = await loadForListingScope(req, res, eventId);
    if (!scope) return;
    const evt = scope.event;
    const scopeInstitutionId = scope.scopeInstitutionId;

    // Pull every registration for this event (subject to the
    // per-caller scope). LEFT JOINs surface branch name from the
    // most recent enrolment so the workbook can carry that column.
    // No pagination — one workbook = the whole roster.
    const params = [eventId];
    let where = `er.event_id = $1`;
    if (scopeInstitutionId != null) {
      params.push(Number(scopeInstitutionId));
      where += ` AND er.institution_id = $${params.length}`;
    }
    const rows = await pool.query(
      `SELECT
         er.id, er.status, er.created_at, er.updated_at,
         u.id AS student_id, u.name AS student_name,
         u.phone AS student_phone, u.email AS student_email,
         sp.date_of_birth AS student_dob,
         sp.gender        AS student_gender,
         sp.address       AS student_address,
         i.id AS institution_id, i.name AS institution_name,
         -- Most-recent branch label the student is enrolled at
         -- within this institution's academy group. Falls back to
         -- 'Main Institution' when the batch has no branch_id.
         (
           SELECT COALESCE(br.name, 'Main Institution')
             FROM enrollments en
             JOIN batches b ON b.id = en.batch_id
             LEFT JOIN institutions br ON br.id = b.branch_id
            WHERE en.student_id = u.id
              AND b.institution_id IN (
                SELECT id FROM institutions
                 WHERE id = i.id OR parent_institution_id = i.id
              )
            ORDER BY b.created_at DESC NULLS LAST
            LIMIT 1
         ) AS branch_name
       FROM event_registrations er
       JOIN users u        ON u.id = er.student_id
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       JOIN institutions i ON i.id = er.institution_id
       WHERE ${where}
       ORDER BY i.name ASC, u.name ASC, er.id ASC`,
      params,
    );

    // Load every answer for every fetched registration in one hop.
    let answersByReg = {};
    if (rows.rows.length > 0) {
      const regIds = rows.rows.map((r) => r.id);
      const ansRes = await pool.query(
        `SELECT registration_id,
                field_id, field_key, field_label, field_type,
                value_text, value_json
           FROM event_registration_answers
          WHERE registration_id = ANY($1::int[])
          ORDER BY id ASC`,
        [regIds],
      );
      ansRes.rows.forEach((a) => {
        if (!answersByReg[a.registration_id]) answersByReg[a.registration_id] = [];
        answersByReg[a.registration_id].push(a);
      });
    }

    // Coerce a raw answer value (text OR nested value_json shapes
    // used by checkbox arrays and file-upload blobs) into a plain
    // cell-safe string.
    const coerce = (a) => {
      if (a?.value_text != null && String(a.value_text).length > 0) return String(a.value_text);
      const v = a?.value_json;
      if (v == null) return '';
      if (Array.isArray(v)) return v.join(', ');
      if (typeof v === 'object') return v.name || v.label || v.url || JSON.stringify(v);
      return String(v);
    };

    // Compute a student's whole-years age from DOB.
    const ageFromDob = (dob) => {
      if (!dob) return '';
      const d = new Date(dob);
      if (Number.isNaN(d.getTime())) return '';
      const today = new Date();
      let age = today.getFullYear() - d.getFullYear();
      const before =
        today.getMonth() < d.getMonth() ||
        (today.getMonth() === d.getMonth() && today.getDate() < d.getDate());
      if (before) age -= 1;
      return age >= 0 ? age : '';
    };

    // ── Assemble columns per institution ─────────────────────────
    // Fixed leading columns first, then every unique answer label
    // that appears for that institution's rows (in first-seen
    // order). Institution-scoped column set means each sheet only
    // has columns that actually matter for that institution.
    const SYSTEM_COLS = [
      'Registration ID',
      'Student Name', 'Student ID', 'Phone', 'Email',
      'Gender', 'DOB', 'Age', 'Address',
      'Branch',
      'Event', 'Event Date',
      'Status', 'Registered On',
    ];

    // Bucket rows by institution id.
    const buckets = new Map(); // Map<institutionId, { name, rows }>
    for (const r of rows.rows) {
      const key = r.institution_id;
      if (!buckets.has(key)) {
        buckets.set(key, {
          id:   r.institution_id,
          name: r.institution_name || `Institution #${r.institution_id}`,
          rows: [],
        });
      }
      buckets.get(key).rows.push(r);
    }

    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator  = 'Veerify';
    workbook.created  = new Date();
    workbook.modified = new Date();

    // ── Summary sheet ────────────────────────────────────────────
    const summary = workbook.addWorksheet('Summary');
    summary.columns = [
      { header: '#',                     key: 'idx',   width: 6  },
      { header: 'Institution',           key: 'inst',  width: 40 },
      { header: 'Registered Students',   key: 'count', width: 22 },
    ];
    summary.getRow(1).font = { bold: true };
    let running = 0;
    let idx = 1;
    for (const b of buckets.values()) {
      summary.addRow({ idx: idx++, inst: b.name, count: b.rows.length });
      running += b.rows.length;
    }
    // Total row — bold + a top border to separate it from the list.
    const totalRow = summary.addRow({ idx: '', inst: 'TOTAL', count: running });
    totalRow.font = { bold: true };
    totalRow.getCell('inst').border  = { top: { style: 'thin' } };
    totalRow.getCell('count').border = { top: { style: 'thin' } };

    // ── Per-institution sheets ──────────────────────────────────
    // Excel sheet names cap at 31 chars, and disallow: []:*?/\.
    const sanitizeSheetName = (raw) => {
      const cleaned = String(raw || 'Institution').replace(/[\\/:*?"'\[\]]/g, ' ').trim();
      return (cleaned || 'Institution').slice(0, 31);
    };
    const usedNames = new Set(['Summary']);
    const nextSheetName = (base) => {
      let name = sanitizeSheetName(base);
      if (!usedNames.has(name)) { usedNames.add(name); return name; }
      // Suffix -2, -3, … until unique.
      let i = 2;
      while (usedNames.has(sanitizeSheetName(`${base} (${i})`))) i += 1;
      const finalName = sanitizeSheetName(`${base} (${i})`);
      usedNames.add(finalName);
      return finalName;
    };

    for (const b of buckets.values()) {
      // Derive the dynamic column labels for THIS institution.
      const seen = new Set();
      const answerLabels = [];
      b.rows.forEach((r) => {
        (answersByReg[r.id] || []).forEach((a) => {
          const lbl = String(a?.field_label || '').trim();
          if (!lbl) return;
          const key = lbl.toLowerCase();
          if (seen.has(key)) return;
          seen.add(key);
          answerLabels.push(lbl);
        });
      });

      const cols = [...SYSTEM_COLS, ...answerLabels];
      const sheet = workbook.addWorksheet(nextSheetName(b.name));
      sheet.columns = cols.map((c) => ({ header: c, key: c, width: Math.min(40, Math.max(14, c.length + 4)) }));
      sheet.getRow(1).font = { bold: true };

      // Build one row per registration.
      const eventDateStr = evt.event_date ? new Date(evt.event_date).toISOString().slice(0, 10) : '';
      b.rows.forEach((r) => {
        const byLabelLower = {};
        (answersByReg[r.id] || []).forEach((a) => {
          if (a?.field_label) byLabelLower[String(a.field_label).toLowerCase()] = a;
        });
        const dobStr = r.student_dob ? String(r.student_dob).slice(0, 10) : '';
        const row = {
          'Registration ID': r.id,
          'Student Name':    r.student_name || '',
          'Student ID':      r.student_id,
          'Phone':           r.student_phone || '',
          'Email':           r.student_email || '',
          'Gender':          r.student_gender || '',
          'DOB':             dobStr,
          'Age':             ageFromDob(dobStr),
          'Address':         r.student_address || '',
          'Branch':          r.branch_name || '',
          'Event':           evt.title || '',
          'Event Date':      eventDateStr,
          'Status':          r.status || '',
          'Registered On':   r.created_at ? new Date(r.created_at).toISOString().slice(0, 19).replace('T', ' ') : '',
        };
        answerLabels.forEach((lbl) => {
          const a = byLabelLower[lbl.toLowerCase()];
          row[lbl] = a ? coerce(a) : '';
        });
        sheet.addRow(row);
      });
    }

    // Empty-workbook edge case: no institutions → still return a
    // valid xlsx with only the Summary sheet + a "no data" note.
    if (buckets.size === 0) {
      summary.addRow({ idx: '', inst: 'No registrations yet.', count: '' });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const safeTitle = String(evt.title || 'Event').replace(/[\\/:*?"'\[\]]/g, ' ').trim().slice(0, 60) || 'Event';
    const filename  = `${safeTitle}-registrations.xlsx`;

    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',
      `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(Buffer.from(buffer));
  } catch (err) {
    console.error('exportRegistrationsXlsx error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
