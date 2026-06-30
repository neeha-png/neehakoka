-- 0003_fix_submissions.sql — Corrects the submissions table schema.
-- The original 0001_init.sql created id as INTEGER AUTOINCREMENT which conflicts
-- with the UUID strings that /api/contact and /api/submit insert as primary keys.
-- This migration drops the broken table and recreates it with id TEXT PRIMARY KEY.

-- Drop the incorrectly typed table from migration 0001
DROP TABLE IF EXISTS submissions;

-- Recreate with the correct TEXT primary key to accept UUID values
CREATE TABLE submissions (
    id         TEXT     PRIMARY KEY,           -- UUID string, e.g. '550e8400-e29b-41d4-a716-...'
    name       TEXT     NOT NULL,
    email      TEXT     NOT NULL,
    message    TEXT     NOT NULL,
    status     TEXT     NOT NULL DEFAULT 'pending',  -- Moderation state for admin panel
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
