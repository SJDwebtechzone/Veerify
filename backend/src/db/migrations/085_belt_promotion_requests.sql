-- 085_belt_promotion_requests.sql
--
-- Belt Promotion Approval workflow (trainer → institution).
--
-- Product rule: trainers can REQUEST a belt promotion for a student
-- they teach, but they cannot promote directly — only the institution
-- admin can approve. Approval mints a certificate and updates the
-- student's belt_category. This table tracks the request lifecycle so
-- the two sides of the workflow (trainer's Home / View Students /
-- Curriculum Progress → Promote Belt, and institution's
-- More / Certificates → Belt Promotion Requests) share a single
-- source of truth.
--
-- Status transitions:
--   pending   — trainer submitted, awaiting institution decision
--   approved  — institution issued certificate + updated belt_category
--   declined  — institution returned with remarks; trainer can revise
--               and submit a fresh request
--
-- Duplicate-request guard: partial unique index on student_id where
-- status = 'pending' means a student can have AT MOST ONE open
-- request at a time. A second POST while one is pending returns 409
-- and the trainer sees "A promotion for this student is already
-- awaiting institution approval."

BEGIN;

CREATE TABLE IF NOT EXISTS belt_promotion_requests (
  id               SERIAL PRIMARY KEY,
  student_id       INTEGER NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
  trainer_id       INTEGER NOT NULL REFERENCES users(id)        ON DELETE SET NULL,
  institution_id   INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,

  -- Belt strings — free text so an academy running a non-standard
  -- belt system (Dan grades, coloured stripes, "Assistant
  -- Instructor") can capture whatever label they use. Mirrors the
  -- shape used by student_profiles.belt_category.
  current_belt     VARCHAR(80),
  requested_belt   VARCHAR(80) NOT NULL,

  trainer_remarks  TEXT,

  -- Snapshot of the student's attendance at the moment of submission
  -- (total / present / absent / late / leave / percent). Institution
  -- reviews the numbers as-of the request, not the moving average.
  attendance_summary JSONB NOT NULL DEFAULT '{}'::jsonb,

  status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'declined')),

  -- Set on 'declined' when the admin uses the Notify Trainer flow
  -- so the trainer sees WHY it came back.
  institution_remarks TEXT,

  -- Populated on 'approved' — the certificates row that was minted
  -- for this promotion. Lets the student's Belts & Certs screen
  -- deep-link straight to the artifact.
  certificate_id   INTEGER REFERENCES certificates(id) ON DELETE SET NULL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ,
  resolved_by      INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Hot read — institution's "Pending Promotions" list scans by
-- institution + status ordered by newest. Sub-branch admins scope
-- through the batch join server-side, so an institution-wide index
-- covers both roles.
CREATE INDEX IF NOT EXISTS idx_belt_promo_requests_inst_status
  ON belt_promotion_requests (institution_id, status, created_at DESC);

-- Trainer's "My submitted requests" list.
CREATE INDEX IF NOT EXISTS idx_belt_promo_requests_trainer
  ON belt_promotion_requests (trainer_id, created_at DESC);

-- Duplicate-pending guard. A student can only have ONE open request
-- at a time; the second POST returns 409. Once the current request
-- lands as approved / declined the trainer can submit again.
CREATE UNIQUE INDEX IF NOT EXISTS uq_belt_promo_requests_open_per_student
  ON belt_promotion_requests (student_id)
  WHERE status = 'pending';

-- ── Audit trail ────────────────────────────────────────────────
-- Every state change (submit / notify-trainer / approve / decline)
-- writes one row here so the promotion history stays complete even
-- when the request itself is deleted (unlikely — but the audit
-- outlives the request).
CREATE TABLE IF NOT EXISTS belt_promotion_request_events (
  id           SERIAL PRIMARY KEY,
  request_id   INTEGER NOT NULL REFERENCES belt_promotion_requests(id) ON DELETE CASCADE,
  actor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_role   VARCHAR(20),
  event        VARCHAR(30) NOT NULL,   -- 'submitted' | 'notify_trainer' | 'approved' | 'declined'
  remarks      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_belt_promo_events_request
  ON belt_promotion_request_events (request_id, created_at);

COMMIT;
