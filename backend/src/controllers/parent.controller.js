const pool = require('../config/db');

// ============================================
// PARENT-SIDE: Link, view, manage children
// ============================================

// LINK a child to parent (parent searches by phone or email)
// Creates a PENDING request — child must approve before parent can see data
exports.linkChild = async (req, res) => {
  try {
    const { phone, email } = req.body;
    const parentId = req.user.id;

    if (!phone && !email) {
      return res.status(400).json({ message: 'Phone or email is required' });
    }

    // Find the child user
    let query, params;
    if (phone) {
      query = 'SELECT id, name, email, phone, role FROM users WHERE phone = $1';
      params = [phone];
    } else {
      query = 'SELECT id, name, email, phone, role FROM users WHERE email = $1';
      params = [email];
    }

    const userResult = await pool.query(query, params);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ 
        message: 'No student found with this phone/email. Make sure they have registered first.' 
      });
    }

    const child = userResult.rows[0];

    // Verify the user is a student
    if (child.role !== 'student') {
      return res.status(400).json({ 
        message: `This user is registered as ${child.role}, not a student. Only students can be linked.` 
      });
    }

    // Prevent self-linking
    if (child.id === parentId) {
      return res.status(400).json({ message: 'You cannot link to yourself' });
    }

    // Check if there's an existing active or pending link
    const existing = await pool.query(
      `SELECT id, status FROM parent_child_links 
       WHERE parent_id = $1 AND child_id = $2 AND status IN ('active', 'pending')`,
      [parentId, child.id]
    );

    if (existing.rows.length > 0) {
      const existingStatus = existing.rows[0].status;
      if (existingStatus === 'active') {
        return res.status(409).json({ message: 'You are already linked to this child' });
      } else {
        return res.status(409).json({ 
          message: 'A request is already pending. Wait for the child to approve.' 
        });
      }
    }

    // Check if there's a previously rejected link — allow re-request
    const rejected = await pool.query(
      `SELECT id FROM parent_child_links 
       WHERE parent_id = $1 AND child_id = $2 AND status = 'rejected'`,
      [parentId, child.id]
    );

    let linkResult;
    if (rejected.rows.length > 0) {
      // Re-activate the rejected link as pending
      linkResult = await pool.query(
        `UPDATE parent_child_links 
         SET status = 'pending', linked_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [rejected.rows[0].id]
      );
    } else {
      // Create new pending link
      linkResult = await pool.query(
        `INSERT INTO parent_child_links (parent_id, child_id, status)
         VALUES ($1, $2, 'pending')
         RETURNING *`,
        [parentId, child.id]
      );
    }

    res.status(201).json({
      message: `Request sent to ${child.name}. They'll see your request when they log in and can approve or decline.`,
      link: linkResult.rows[0],
      child: {
        id: child.id,
        name: child.name,
        email: child.email,
        phone: child.phone
      }
    });
  } catch (err) {
    console.error('Link child error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET all my linked children (active AND pending — pending shown first)
exports.getMyChildren = async (req, res) => {
  try {
    const parentId = req.user.id;

    const result = await pool.query(
      `SELECT 
        pcl.id AS link_id,
        pcl.relationship,
        pcl.status,
        pcl.linked_at,
        u.id AS child_id,
        u.name AS child_name,
        u.email AS child_email,
        u.phone AS child_phone,
        u.institution_id,
        i.name AS institution_name
       FROM parent_child_links pcl
       JOIN users u ON pcl.child_id = u.id
       LEFT JOIN institutions i ON u.institution_id = i.id
       WHERE pcl.parent_id = $1 AND pcl.status IN ('active', 'pending')
       ORDER BY 
         CASE pcl.status WHEN 'pending' THEN 1 WHEN 'active' THEN 2 END,
         pcl.linked_at DESC`,
      [parentId]
    );

    res.json({
      count: result.rows.length,
      children: result.rows
    });
  } catch (err) {
    console.error('Get children error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// UNLINK a child (remove link entirely)
exports.unlinkChild = async (req, res) => {
  try {
    const { childId } = req.params;
    const parentId = req.user.id;

    const result = await pool.query(
      'DELETE FROM parent_child_links WHERE parent_id = $1 AND child_id = $2 RETURNING id',
      [parentId, childId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Link not found' });
    }

    res.json({ message: 'Child unlinked successfully' });
  } catch (err) {
    console.error('Unlink child error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Helper: verify parent has ACTIVE access to this child (not pending)
const verifyParentAccess = async (parentId, childId) => {
  const result = await pool.query(
    `SELECT id FROM parent_child_links 
     WHERE parent_id = $1 AND child_id = $2 AND status = 'active'`,
    [parentId, childId]
  );
  return result.rows.length > 0;
};

// GET child's enrollments (parent view — only after approval)
exports.getChildEnrollments = async (req, res) => {
  try {
    const { childId } = req.params;
    const parentId = req.user.id;

    const hasAccess = await verifyParentAccess(parentId, childId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'You are not linked to this student' });
    }

    const result = await pool.query(
      `SELECT e.*, 
              b.name AS batch_name, b.days_of_week, b.start_time, b.end_time, b.mode,
              c.name AS course_name, c.price AS course_price,
              i.name AS institution_name, i.city AS institution_city,
              u.name AS trainer_name
       FROM enrollments e
       JOIN batches b ON e.batch_id = b.id
       JOIN courses c ON b.course_id = c.id
       JOIN institutions i ON e.institution_id = i.id
       LEFT JOIN trainers t ON b.trainer_id = t.id
       LEFT JOIN users u ON t.user_id = u.id
       WHERE e.student_id = $1
       ORDER BY e.enrolled_at DESC`,
      [childId]
    );

    res.json({ count: result.rows.length, enrollments: result.rows });
  } catch (err) {
    console.error('Get child enrollments error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET child's attendance (with summary stats)
exports.getChildAttendance = async (req, res) => {
  try {
    const { childId } = req.params;
    const parentId = req.user.id;

    const hasAccess = await verifyParentAccess(parentId, childId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'You are not linked to this student' });
    }

    const result = await pool.query(
      `SELECT a.*, b.name AS batch_name, c.name AS course_name
       FROM attendance a
       JOIN batches b ON a.batch_id = b.id
       JOIN courses c ON b.course_id = c.id
       WHERE a.student_id = $1
       ORDER BY a.date DESC`,
      [childId]
    );

    const total = result.rows.length;
    const present = result.rows.filter(r => r.status === 'present').length;
    const absent = result.rows.filter(r => r.status === 'absent').length;
    const late = result.rows.filter(r => r.status === 'late').length;
    const percentage = total > 0 ? Math.round((present / total) * 100) : 0;

    res.json({
      summary: { total, present, absent, late, percentage },
      attendance: result.rows
    });
  } catch (err) {
    console.error('Get child attendance error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET child's payment history (with summary)
exports.getChildPayments = async (req, res) => {
  try {
    const { childId } = req.params;
    const parentId = req.user.id;

    const hasAccess = await verifyParentAccess(parentId, childId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'You are not linked to this student' });
    }

    const result = await pool.query(
      `SELECT e.id, e.payment_status, e.enrolled_at,
              c.name AS course_name, c.price AS amount,
              b.name AS batch_name,
              i.name AS institution_name
       FROM enrollments e
       JOIN batches b ON e.batch_id = b.id
       JOIN courses c ON b.course_id = c.id
       JOIN institutions i ON e.institution_id = i.id
       WHERE e.student_id = $1
       ORDER BY e.enrolled_at DESC`,
      [childId]
    );

    const total = result.rows.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    const paid = result.rows
      .filter(p => p.payment_status === 'paid')
      .reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    const pending = total - paid;

    res.json({
      summary: { total, paid, pending },
      payments: result.rows
    });
  } catch (err) {
    console.error('Get child payments error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET child summary (combined dashboard data)
exports.getChildSummary = async (req, res) => {
  try {
    const { childId } = req.params;
    const parentId = req.user.id;

    const hasAccess = await verifyParentAccess(parentId, childId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'You are not linked to this student' });
    }

    const userResult = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, i.name AS institution_name
       FROM users u
       LEFT JOIN institutions i ON u.institution_id = i.id
       WHERE u.id = $1`,
      [childId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Child not found' });
    }

    const enrollmentsCount = await pool.query(
      'SELECT COUNT(*) FROM enrollments WHERE student_id = $1',
      [childId]
    );

    const attendanceStats = await pool.query(
      `SELECT 
        COUNT(*) AS total,
        COUNT(CASE WHEN status = 'present' THEN 1 END) AS present
       FROM attendance WHERE student_id = $1`,
      [childId]
    );

    const total = parseInt(attendanceStats.rows[0].total) || 0;
    const present = parseInt(attendanceStats.rows[0].present) || 0;
    const attendancePercent = total > 0 ? Math.round((present / total) * 100) : 0;

    res.json({
      child: userResult.rows[0],
      stats: {
        enrollments: parseInt(enrollmentsCount.rows[0].count),
        attendancePercent,
        totalClasses: total,
        attended: present
      }
    });
  } catch (err) {
    console.error('Get child summary error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ============================================
// STUDENT-SIDE: Approve/Reject parent requests
// ============================================

// GET pending parent link requests (student sees who wants to link to them)
exports.getMyPendingRequests = async (req, res) => {
  try {
    const studentId = req.user.id;

    const result = await pool.query(
      `SELECT 
        pcl.id AS link_id,
        pcl.relationship,
        pcl.linked_at,
        u.id AS parent_id,
        u.name AS parent_name,
        u.email AS parent_email,
        u.phone AS parent_phone
       FROM parent_child_links pcl
       JOIN users u ON pcl.parent_id = u.id
       WHERE pcl.child_id = $1 AND pcl.status = 'pending'
       ORDER BY pcl.linked_at DESC`,
      [studentId]
    );

    res.json({
      count: result.rows.length,
      requests: result.rows
    });
  } catch (err) {
    console.error('Get pending requests error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// APPROVE a parent link request
exports.approveParent = async (req, res) => {
  try {
    const { linkId } = req.params;
    const studentId = req.user.id;

    const check = await pool.query(
      `SELECT id, parent_id FROM parent_child_links 
       WHERE id = $1 AND child_id = $2 AND status = 'pending'`,
      [linkId, studentId]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ 
        message: 'Request not found or already processed' 
      });
    }

    const result = await pool.query(
      `UPDATE parent_child_links 
       SET status = 'active'
       WHERE id = $1
       RETURNING *`,
      [linkId]
    );

    res.json({
      message: 'Parent request approved successfully',
      link: result.rows[0]
    });
  } catch (err) {
    console.error('Approve parent error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// REJECT a parent link request
exports.rejectParent = async (req, res) => {
  try {
    const { linkId } = req.params;
    const studentId = req.user.id;

    const check = await pool.query(
      `SELECT id FROM parent_child_links 
       WHERE id = $1 AND child_id = $2 AND status = 'pending'`,
      [linkId, studentId]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ 
        message: 'Request not found or already processed' 
      });
    }

    const result = await pool.query(
      `UPDATE parent_child_links 
       SET status = 'rejected'
       WHERE id = $1
       RETURNING *`,
      [linkId]
    );

    res.json({
      message: 'Parent request rejected',
      link: result.rows[0]
    });
  } catch (err) {
    console.error('Reject parent error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};