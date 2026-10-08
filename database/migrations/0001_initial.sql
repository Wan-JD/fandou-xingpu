-- 翻斗星谱初始结构。仅定义结构，不包含任何真实成员数据。
PRAGMA foreign_keys = ON;

CREATE TABLE cohorts (
  id TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  year INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE people (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  nickname TEXT,
  mentor_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  cohort_id TEXT REFERENCES cohorts(id) ON DELETE SET NULL,
  relation_scope TEXT NOT NULL DEFAULT 'lineage' CHECK (relation_scope IN ('lineage', 'cohort_guest')),
  avatar_attachment_id TEXT,
  bio TEXT NOT NULL DEFAULT '',
  is_featured INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0, 1)),
  featured_note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (mentor_id IS NULL OR mentor_id <> id),
  CHECK (relation_scope = 'cohort_guest' OR mentor_id IS NOT NULL OR status IN ('active', 'archived'))
);

CREATE INDEX people_mentor_idx ON people(mentor_id);
CREATE INDEX people_cohort_scope_idx ON people(cohort_id, relation_scope, status);

CREATE TABLE achievements (
  id TEXT PRIMARY KEY NOT NULL,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('achievement', 'honor')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  occurred_on TEXT,
  date_precision TEXT CHECK (date_precision IS NULL OR date_precision IN ('year', 'month', 'day')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (occurred_on IS NULL OR occurred_on GLOB '[0-9][0-9][0-9][0-9]*')
);

CREATE INDEX achievements_person_date_idx ON achievements(person_id, occurred_on DESC);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY NOT NULL,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  achievement_id TEXT REFERENCES achievements(id) ON DELETE SET NULL,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  category TEXT NOT NULL CHECK (category IN ('avatar', 'resume', 'photo', 'certificate', 'other')),
  visibility TEXT NOT NULL DEFAULT 'members' CHECK (visibility IN ('members', 'private')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'deleted')),
  uploaded_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX attachments_person_idx ON attachments(person_id, status);

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  person_id TEXT UNIQUE REFERENCES people(id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
