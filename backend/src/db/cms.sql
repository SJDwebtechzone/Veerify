-- ============================================
-- MOBILE APP CMS TABLES
-- Run this on top of schema.sql to add CMS content tables
-- ============================================

-- Hero banners shown on mobile home carousel
CREATE TABLE IF NOT EXISTS mobile_banners (
    id SERIAL PRIMARY KEY,
    label VARCHAR(80),
    title VARCHAR(150) NOT NULL,
    subtitle VARCHAR(255),
    cta VARCHAR(80),
    image_url TEXT,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Category grid (Karate, Boxing, etc.)
CREATE TABLE IF NOT EXISTS mobile_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    image_url TEXT,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Featured / intro videos
CREATE TABLE IF NOT EXISTS mobile_videos (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    trainer VARCHAR(120),
    duration VARCHAR(10),
    video_url TEXT,
    thumbnail_url TEXT,
    is_free BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Upcoming events / tournaments / belt exams
CREATE TABLE IF NOT EXISTS mobile_events (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    location VARCHAR(200),
    event_date DATE NOT NULL,
    registration_closing_date DATE,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mobile_banners_active ON mobile_banners(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_mobile_categories_active ON mobile_categories(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_mobile_videos_active ON mobile_videos(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_mobile_events_active ON mobile_events(is_active, sort_order);
