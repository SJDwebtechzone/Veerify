const pool = require('../config/db');

const getAdminInstitutionId = async (userId) => {
  const result = await pool.query(
    'SELECT institution_id FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0]?.institution_id;
};

// Resolve the caller's academy group root. Sub-branch admins are
// pinned to their own institution_id (they can only create batches at
// their own branch); main-branch admins can pick from every branch
// under the same root.
const getAcademyGroup = async (userId) => {
  const u = await pool.query(
    `SELECT u.institution_id, i.parent_institution_id
       FROM users u
       LEFT JOIN institutions i ON i.id = u.institution_id
      WHERE u.id = $1`,
    [userId],
  );
  const row = u.rows[0];
  if (!row?.institution_id) return null;
  const rootId = row.parent_institution_id || row.institution_id;
  return {
    rootId,
    callerInstId: row.institution_id,
    isSubBranchAdmin: !!row.parent_institution_id,
  };
};

// CREATE batch
//
// Accepts an optional `branch_id` that pins the batch to a specific
// sub-branch. Rules:
//   • NULL / omitted → batch is at the main institution (default)
//   • non-null       → must be a sub-branch under the caller's group
//                      (parent_institution_id = caller's root).
//   • Sub-branch admins can only assign to their own branch (backend
//     ignores any branch_id they send that isn't their own).
exports.createBatch = async (req, res) => {
  try {
    const { course_id, trainer_id, name, days_of_week, start_time, end_time, capacity, mode, branch_id } = req.body;
    const adminId = req.user.id;

    if (!course_id || !name) {
      return res.status(400).json({ message: 'course_id and name are required' });
    }

    const group = await getAcademyGroup(adminId);
    if (!group?.callerInstId) {
      return res.status(400).json({ message: 'You must create an institution first' });
    }
    const institutionId = group.callerInstId;

    // Verify the course belongs to this institution
    const courseCheck = await pool.query(
      'SELECT institution_id FROM courses WHERE id = $1',
      [course_id]
    );

    if (courseCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Course not found' });
    }

    if (courseCheck.rows[0].institution_id !== institutionId) {
      return res.status(403).json({ message: 'Course does not belong to your institution' });
    }

    // If trainer_id provided, verify trainer is in this institution
    if (trainer_id) {
      const trainerCheck = await pool.query(
        'SELECT institution_id FROM trainers WHERE id = $1',
        [trainer_id]
      );
      if (trainerCheck.rows.length === 0 || trainerCheck.rows[0].institution_id !== institutionId) {
        return res.status(403).json({ message: 'Trainer does not belong to your institution' });
      }
    }

    // Resolve + validate branch_id.
    //   - Sub-branch admin: force branch_id to their own institution_id.
    //   - Main-branch admin: null / undefined / falsy → NULL (main).
    //                        Any non-null → must be a real sub-branch
    //                        under the caller's root.
    let branchId = null;
    if (group.isSubBranchAdmin) {
      branchId = institutionId;
    } else if (branch_id != null && branch_id !== '') {
      const asInt = parseInt(branch_id, 10);
      if (!Number.isFinite(asInt)) {
        return res.status(400).json({ field: 'branch_id', message: 'Invalid branch_id.' });
      }
      // NULL sentinels ("0" / their own root id) → main institution.
      if (asInt === 0 || asInt === group.rootId) {
        branchId = null;
      } else {
        const b = await pool.query(
          `SELECT id FROM institutions
            WHERE id = $1
              AND parent_institution_id = $2
              AND deleted_at IS NULL`,
          [asInt, group.rootId],
        );
        if (b.rows.length === 0) {
          return res.status(403).json({ field: 'branch_id', message: 'Branch does not belong to your academy.' });
        }
        branchId = asInt;
      }
    }

    const result = await pool.query(
      `INSERT INTO batches (course_id, institution_id, trainer_id, name, days_of_week, start_time, end_time, capacity, mode, branch_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [course_id, institutionId, trainer_id, name, days_of_week, start_time, end_time, capacity || 20, mode || 'offline', branchId]
    );

    res.status(201).json({
      message: 'Batch created successfully',
      batch: result.rows[0]
    });
  } catch (err) {
    console.error('Create batch error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET my institution's batches
//
// Main-branch admin: sees every batch in the academy group (main +
// every sub-branch). Sub-branch admin: sees only their own branch's
// batches. Optional ?branch_id=X filter (main admin only) narrows to
// a specific branch; ?branch_id=main narrows to just the main institution.
exports.getMyBatches = async (req, res) => {
  try {
    const group = await getAcademyGroup(req.user.id);
    if (!group?.callerInstId) {
      return res.status(400).json({ message: 'No institution linked' });
    }

    const params = [group.rootId];
    // Base clause — scope to the caller's whole academy tree. Batches
    // created by a sub-branch admin store batch.institution_id = the
    // sub-branch's id, while main-admin batches store the root's id,
    // so we accept either the root or any of its children.
    let where = `(b.institution_id = $1
                  OR b.institution_id IN (
                    SELECT id FROM institutions
                     WHERE parent_institution_id = $1
                  ))`;
    // Sub-branch admin: pin to their own branch. Ignore any query filter.
    if (group.isSubBranchAdmin) {
      params.push(group.callerInstId);
      where += ` AND b.branch_id = $${params.length}`;
    } else {
      // Main-institution admin — by default they see only batches hosted
      // at the main institution (branch_id IS NULL). They can OPT IN to
      // viewing a specific sub-branch's batches with ?branch_id=<n>, or
      // see everything across the group with ?branch_id=all. This keeps
      // the "student visibility" rule intact: main login = main students
      // only, unless they explicitly pull a branch's roster.
      const raw = req.query.branch_id != null
        ? String(req.query.branch_id).toLowerCase()
        : '';
      if (raw === 'all') {
        // No branch filter — every batch in the group.
      } else if (raw === '' || raw === 'main' || raw === 'null' || raw === '0') {
        where += ` AND b.branch_id IS NULL`;
      } else {
        const asInt = parseInt(raw, 10);
        if (Number.isFinite(asInt)) {
          params.push(asInt);
          where += ` AND b.branch_id = $${params.length}`;
        } else {
          where += ` AND b.branch_id IS NULL`;
        }
      }
    }

    const result = await pool.query(
      `SELECT b.*, c.name AS course_name, u.name AS trainer_name,
              -- Branch label: sub-branch name for pinned batches,
              -- 'Main Institution' for batches with branch_id IS NULL.
              COALESCE(bi.name, 'Main Institution') AS branch_name,
              (bi.parent_institution_id IS NOT NULL) AS is_sub_branch
       FROM batches b
       JOIN courses c ON b.course_id = c.id
       LEFT JOIN trainers t ON b.trainer_id = t.id
       LEFT JOIN users u ON t.user_id = u.id
       LEFT JOIN institutions bi ON bi.id = b.branch_id
       WHERE ${where}
       ORDER BY b.created_at DESC`,
      params
    );

    res.json({ count: result.rows.length, batches: result.rows });
  } catch (err) {
    console.error('Get batches error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET batches by course (public)
//
// Guest users get every batch for the course. Authenticated users are
// scoped to their assigned institution/branch:
//   • student at main institution     → batches with branch_id IS NULL
//   • student at a specific sub-branch → batches with branch_id = theirs
// The scope is a soft filter — we always include NULL-branch batches so
// a student at a branch still sees any "whole-academy" batch the main
// institution ran.
exports.getBatchesByCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const params = [id];
    let branchFilter = '';

    // When we can identify the caller, narrow batches to their branch.
    if (req.user?.id) {
      const uRow = await pool.query(
        `SELECT u.institution_id, i.parent_institution_id
           FROM users u
           LEFT JOIN institutions i ON i.id = u.institution_id
          WHERE u.id = $1`,
        [req.user.id],
      );
      const row = uRow.rows[0];
      if (row?.institution_id) {
        if (row.parent_institution_id) {
          // Sub-branch student — their branch or the whole-academy pool.
          params.push(row.institution_id);
          branchFilter = ` AND (b.branch_id = $${params.length} OR b.branch_id IS NULL)`;
        } else {
          // Main-institution student — only whole-academy batches.
          branchFilter = ` AND b.branch_id IS NULL`;
        }
      }
    }

    const result = await pool.query(
      `SELECT b.*, c.name AS course_name, u.name AS trainer_name,
              COALESCE(bi.name, 'Main Institution') AS branch_name,
              (SELECT COUNT(*) FROM enrollments e WHERE e.batch_id = b.id) AS enrolled_count
       FROM batches b
       JOIN courses c ON b.course_id = c.id
       LEFT JOIN trainers t ON b.trainer_id = t.id
       LEFT JOIN users u ON t.user_id = u.id
       LEFT JOIN institutions bi ON bi.id = b.branch_id
       WHERE b.course_id = $1${branchFilter}
       ORDER BY b.created_at DESC`,
      params
    );

    res.json({ count: result.rows.length, batches: result.rows });
  } catch (err) {
    console.error('Get batches by course error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET single batch (public)
exports.getBatchById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT b.*, c.name AS course_name, c.price AS course_price,
              u.name AS trainer_name, i.name AS institution_name,
              COALESCE(bi.name, 'Main Institution') AS branch_name,
              (SELECT COUNT(*) FROM enrollments e WHERE e.batch_id = b.id) AS enrolled_count
       FROM batches b
       JOIN courses c ON b.course_id = c.id
       JOIN institutions i ON b.institution_id = i.id
       LEFT JOIN institutions bi ON bi.id = b.branch_id
       LEFT JOIN trainers t ON b.trainer_id = t.id
       LEFT JOIN users u ON t.user_id = u.id
       WHERE b.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Batch not found' });
    }

    res.json({ batch: result.rows[0] });
  } catch (err) {
    console.error('Get batch error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// UPDATE batch
exports.updateBatch = async (req, res) => {
  try {
    const { id } = req.params;
    const { trainer_id, name, days_of_week, start_time, end_time, capacity, mode } = req.body;

    // Same branch-scoped ownership check as deleteBatch. Old code
    // compared batch.institution_id to users.institution_id directly,
    // which broke for main admins whose users.institution_id = root
    // and sub-branch batches whose institution_id = sub-branch id.
    const group = await getAcademyGroup(req.user.id);
    if (!group?.rootId) {
      return res.status(403).json({ message: 'No institution linked' });
    }

    const check = await pool.query(
      'SELECT institution_id, branch_id FROM batches WHERE id = $1',
      [id],
    );
    if (check.rows.length === 0) return res.status(404).json({ message: 'Batch not found' });
    const batch = check.rows[0];

    const treeCheck = await pool.query(
      `SELECT 1 FROM institutions
        WHERE id = $1
          AND (id = $2 OR parent_institution_id = $2)
        LIMIT 1`,
      [batch.institution_id, group.rootId],
    );
    if (treeCheck.rows.length === 0) {
      return res.status(403).json({ message: 'Not your batch' });
    }
    if (group.isSubBranchAdmin && batch.branch_id !== group.callerInstId) {
      return res.status(403).json({ message: 'This batch is not at your branch' });
    }

    const result = await pool.query(
      `UPDATE batches SET
         trainer_id = COALESCE($1, trainer_id),
         name = COALESCE($2, name),
         days_of_week = COALESCE($3, days_of_week),
         start_time = COALESCE($4, start_time),
         end_time = COALESCE($5, end_time),
         capacity = COALESCE($6, capacity),
         mode = COALESCE($7, mode)
       WHERE id = $8 RETURNING *`,
      [trainer_id, name, days_of_week, start_time, end_time, capacity, mode, id]
    );

    res.json({ message: 'Batch updated', batch: result.rows[0] });
  } catch (err) {
    console.error('Update batch error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// DELETE batch
exports.deleteBatch = async (req, res) => {
  try {
    const { id } = req.params;

    // Resolve the caller's academy group so we can validate ownership
    // by ROOT + branch rather than a naive institution_id equality.
    // Sub-branch admins have users.institution_id = their sub-branch,
    // but batches created by the MAIN admin store institution_id = root.
    // The old equality check silently denied delete for both directions:
    //   • main admin trying to delete a sub-branch batch
    //   • sub-branch admin trying to delete a main-institution batch (correctly rejected)
    //   • sub-branch admin trying to delete a batch whose institution_id
    //     was stamped as root instead of their branch id.
    const group = await getAcademyGroup(req.user.id);
    if (!group?.rootId) {
      return res.status(403).json({ message: 'No institution linked' });
    }

    const check = await pool.query(
      'SELECT institution_id, branch_id FROM batches WHERE id = $1',
      [id],
    );
    if (check.rows.length === 0) return res.status(404).json({ message: 'Batch not found' });
    const batch = check.rows[0];

    // Batch must belong to the caller's academy tree — either the root
    // institution or any of its sub-branches.
    const treeCheck = await pool.query(
      `SELECT 1 FROM institutions
        WHERE id = $1
          AND (id = $2 OR parent_institution_id = $2)
        LIMIT 1`,
      [batch.institution_id, group.rootId],
    );
    if (treeCheck.rows.length === 0) {
      return res.status(403).json({ message: 'Not your batch' });
    }

    // Sub-branch admins can only delete batches hosted at their own
    // branch (branch_id = their institution). Main admins can delete
    // either main-institution batches (branch_id IS NULL) or any of
    // their sub-branches' batches.
    if (group.isSubBranchAdmin) {
      if (batch.branch_id !== group.callerInstId) {
        return res.status(403).json({ message: 'This batch is not at your branch' });
      }
    }

    await pool.query('DELETE FROM batches WHERE id = $1', [id]);
    res.json({ message: 'Batch deleted successfully' });
  } catch (err) {
    console.error('Delete batch error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET batches assigned to a trainer (trainer logs in)
exports.getMyTrainerBatches = async (req, res) => {
  try {
    const userId = req.user.id;
    const branchInstId = parseInt(req.query.institution_id, 10);

    // Find the trainer's record AND home institution.
    const trainerResult = await pool.query(
      `SELECT t.id, u.institution_id
         FROM trainers t
         JOIN users u ON u.id = t.user_id
        WHERE t.user_id = $1`,
      [userId],
    );
    if (trainerResult.rows.length === 0) {
      return res.status(404).json({ message: 'Trainer profile not found' });
    }
    const trainerId       = trainerResult.rows[0].id;
    const homeInstitution = trainerResult.rows[0].institution_id;

    // Branch-switching: when the client passes institution_id, return ALL
    // active batches at that branch (the trainer acts as a "visiting"
    // trainer there). We only honor branches inside the same parent
    // group as the trainer's home institution — i.e. either the home
    // itself, the parent main-branch, or any sibling sub-branch sharing
    // the same parent_institution_id. Anything outside that group is
    // refused.
    if (Number.isInteger(branchInstId) && branchInstId !== homeInstitution) {
      const group = await pool.query(
        `SELECT id, parent_institution_id FROM institutions WHERE id = $1`,
        [branchInstId],
      );
      if (group.rows.length === 0) {
        return res.status(404).json({ message: 'Branch not found' });
      }
      const homeGroup = await pool.query(
        `SELECT id, parent_institution_id FROM institutions WHERE id = $1`,
        [homeInstitution],
      );
      const home = homeGroup.rows[0] || {};
      // Resolve the root of each branch (the main-branch institution).
      const rootOf = (row) => row?.parent_institution_id || row?.id || null;
      const targetRoot = rootOf(group.rows[0]);
      const homeRoot   = rootOf(home);
      if (!targetRoot || !homeRoot || targetRoot !== homeRoot) {
        return res.status(403).json({
          message: 'You can only switch to branches under the same main institution.',
        });
      }

      // Cross-branch listing — filter by SKILL ↔ CATEGORY match. The
      // trainer's specialization (comma-separated disciplines, e.g.
      // "Karate, Yoga") is matched case-insensitively against the
      // course.category of every batch at the target branch. We return
      // only the batches whose course category is one the trainer can
      // actually teach. Students in those batches are then visible /
      // markable in the trainer's app.
      //
      // If the trainer has no specialization filled in, we fall back to
      // every batch at the target branch (so the screen doesn't go
      // empty silently). The mobile flags `cross_branch=true` so the
      // UI can hint "Showing batches that match your skills".
      const specRes = await pool.query(
        `SELECT specialization FROM trainers WHERE id = $1`,
        [trainerId],
      );
      const rawSpec = (specRes.rows[0]?.specialization || '').toString();
      const trainerSkills = rawSpec
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      let result;
      if (trainerSkills.length > 0) {
        result = await pool.query(
          `SELECT b.*, c.name AS course_name, c.category AS course_category,
                  (SELECT COUNT(*) FROM enrollments e WHERE e.batch_id = b.id) AS enrolled_count
             FROM batches b
             JOIN courses c ON b.course_id = c.id
            WHERE b.institution_id = $1
              AND LOWER(c.category) = ANY ($2)
            ORDER BY b.created_at DESC`,
          [branchInstId, trainerSkills],
        );
      } else {
        result = await pool.query(
          `SELECT b.*, c.name AS course_name, c.category AS course_category,
                  (SELECT COUNT(*) FROM enrollments e WHERE e.batch_id = b.id) AS enrolled_count
             FROM batches b
             JOIN courses c ON b.course_id = c.id
            WHERE b.institution_id = $1
            ORDER BY b.created_at DESC`,
          [branchInstId],
        );
      }

      return res.json({
        count:           result.rows.length,
        batches:         result.rows,
        viewing_branch:  branchInstId,
        cross_branch:    true,
        trainer_skills:  trainerSkills,
        filtered_by_skills: trainerSkills.length > 0,
      });
    }

    // Default — trainer's own assigned batches in their home institution.
    const result = await pool.query(
      `SELECT b.*, c.name AS course_name,
              (SELECT COUNT(*) FROM enrollments e WHERE e.batch_id = b.id) AS enrolled_count
       FROM batches b
       JOIN courses c ON b.course_id = c.id
       WHERE b.trainer_id = $1
       ORDER BY b.created_at DESC`,
      [trainerId]
    );

    res.json({
      count:          result.rows.length,
      batches:        result.rows,
      viewing_branch: homeInstitution,
      cross_branch:   false,
    });
  } catch (err) {
    console.error('Get trainer batches error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};