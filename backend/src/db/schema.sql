-- ============================================
-- VEERIFY DATABASE SCHEMA
-- Complete schema including Parent Module
-- Run this on a fresh database to set up everything
-- ============================================

-- 1. USERS table (all login accounts — supports 5 roles now)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    phone VARCHAR(20),
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'trainer', 'student', 'parent', 'super_admin')),
    institution_id INTEGER,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. INSTITUTIONS table (each academy)
CREATE TABLE IF NOT EXISTS institutions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    address TEXT,
    city VARCHAR(80),
    pincode VARCHAR(10),
    phone VARCHAR(20),
    email VARCHAR(150),
    logo_url VARCHAR(500),
    owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    institution_type VARCHAR(50),
website_url VARCHAR(500),
registration_number VARCHAR(100),
master_name VARCHAR(100),
plan_id INTEGER REFERENCES subscription_plans(id),
onboarding_status VARCHAR(30) DEFAULT 'registered',
rejection_reason TEXT,
approved_by INTEGER,
approved_at TIMESTAMP,
subscription_start TIMESTAMP,
subscription_end TIMESTAMP,
);

-- Add foreign key from users to institutions (only if not already added)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_users_institution'
    ) THEN
        ALTER TABLE users 
        ADD CONSTRAINT fk_users_institution 
        FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 3. TRAINERS table (trainer profile)
CREATE TABLE IF NOT EXISTS trainers (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    specialization VARCHAR(100),
    belt_level VARCHAR(50),
    experience_years INTEGER DEFAULT 0,
    bio TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. COURSES table
CREATE TABLE IF NOT EXISTS courses (
    id SERIAL PRIMARY KEY,
    institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    duration_months INTEGER DEFAULT 1,
    price DECIMAL(10, 2) DEFAULT 0,
    category VARCHAR(80),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. BATCHES table (scheduled classes)
CREATE TABLE IF NOT EXISTS batches (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    trainer_id INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    days_of_week VARCHAR(50),
    start_time TIME,
    end_time TIME,
    capacity INTEGER DEFAULT 20,
    mode VARCHAR(20) DEFAULT 'offline' CHECK (mode IN ('online', 'offline', 'hybrid')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. ENROLLMENTS table (student joins batch)
CREATE TABLE IF NOT EXISTS enrollments (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed')),
    UNIQUE(student_id, batch_id)
);

-- 7. ATTENDANCE table
CREATE TABLE IF NOT EXISTS attendance (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'present' CHECK (status IN ('present', 'absent', 'late')),
    marked_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_id, batch_id, date)
);

-- ============================================
-- 8. PARENT-CHILD RELATIONSHIPS (Phase 2 - Parent Module)
-- ============================================
CREATE TABLE IF NOT EXISTS parent_child_links (
    id SERIAL PRIMARY KEY,
    parent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    child_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    relationship VARCHAR(20) DEFAULT 'parent',
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('pending', 'active', 'rejected')),
    linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(parent_id, child_id)
);

-- ============================================
-- INDEXES (for query performance)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_institution ON users(institution_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE INDEX IF NOT EXISTS idx_courses_institution ON courses(institution_id);
CREATE INDEX IF NOT EXISTS idx_batches_institution ON batches(institution_id);
CREATE INDEX IF NOT EXISTS idx_batches_course ON batches(course_id);
CREATE INDEX IF NOT EXISTS idx_batches_trainer ON batches(trainer_id);

CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_batch ON enrollments(batch_id);

CREATE INDEX IF NOT EXISTS idx_attendance_batch_date ON attendance(batch_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);

CREATE INDEX IF NOT EXISTS idx_parent_child_parent ON parent_child_links(parent_id);
CREATE INDEX IF NOT EXISTS idx_parent_child_child ON parent_child_links(child_id);



-- ============================================
-- 9. SUBSCRIPTION PLANS
-- ============================================
CREATE TABLE IF NOT EXISTS subscription_plans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  billing_cycle VARCHAR(20) DEFAULT 'monthly',
  max_branches INTEGER DEFAULT 1,
  max_students INTEGER DEFAULT 25,
  max_trainers INTEGER DEFAULT 2,
  features JSONB NOT NULL,
  is_popular BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);