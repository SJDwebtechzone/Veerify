-- ============================================================================
-- 030_curriculum_progress.sql
-- ----------------------------------------------------------------------------
-- Per-student tracking of which course curriculum lessons they've completed,
-- with a completion date and the trainer who marked it.
--
-- `courses.curriculum` is still a JSONB array of `{ title, duration, is_free }`
-- objects; we identify a lesson by its zero-based index in that array. This
-- keeps the lookup O(1) without coupling progress rows to a stable lesson UUID.
-- Renaming a lesson title in the course form is safe; reordering lessons is
-- considered a curriculum-level edit and would orphan progress (admin-only,
-- low-frequency action — we can build a re-mapping tool later if needed).
-- ============================================================================

CREATE TABLE IF NOT EXISTS student_curriculum_progress (
  id              SERIAL PRIMARY KEY,
  student_id      INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  course_id       INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  lesson_index    INTEGER NOT NULL,
  completed_at    DATE    NOT NULL DEFAULT CURRENT_DATE,
  completed_by    INTEGER          REFERENCES users(id)   ON DELETE SET NULL,
  notes           TEXT,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW(),
  -- one row per (student, course, lesson)
  CONSTRAINT student_curriculum_progress_unique
    UNIQUE (student_id, course_id, lesson_index)
);

-- Fast lookup: "all progress for this student in this course" — the main
-- query the mobile checklist screen runs on every open.
CREATE INDEX IF NOT EXISTS idx_scp_student_course
  ON student_curriculum_progress (student_id, course_id);

-- Reverse lookup: "who completed lesson N in this course" — useful for
-- future analytics on most-popular / hardest lessons.
CREATE INDEX IF NOT EXISTS idx_scp_course_lesson
  ON student_curriculum_progress (course_id, lesson_index);
