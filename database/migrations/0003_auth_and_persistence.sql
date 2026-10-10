-- 本地 D1 持久化：账号凭据、会话、邀请和公开档案字段。
-- 仅包含虚构演示成员，不包含真实账号、令牌或凭据。

ALTER TABLE people ADD COLUMN role TEXT NOT NULL DEFAULT '星谱成员';
ALTER TABLE people ADD COLUMN joined_at TEXT;
ALTER TABLE people ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN invite_token_hash TEXT;

CREATE UNIQUE INDEX users_email_unique_idx
  ON users(lower(email))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX users_invite_token_unique_idx
  ON users(invite_token_hash)
  WHERE invite_token_hash IS NOT NULL;

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(expires_at);

CREATE TABLE invitations (
  token_hash TEXT PRIMARY KEY NOT NULL,
  mentor_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX invitations_mentor_idx ON invitations(mentor_id);
CREATE INDEX invitations_expiry_idx ON invitations(expires_at);

INSERT OR IGNORE INTO cohorts (id, label, year, sort_order, description) VALUES
  ('cohort-2019', '2019届', 2019, 0, '谱系起点的虚构届次。'),
  ('cohort-2021', '2021届', 2021, 1, '承接第一段师徒关系的虚构届次。'),
  ('cohort-2023', '2023届', 2023, 2, '在同一届中继续分化的虚构届次。'),
  ('cohort-2024', '2024届', 2024, 3, '当前演示谱系的最新届次。');

INSERT OR IGNORE INTO people (
  id, name, nickname, mentor_id, cohort_id, relation_scope, bio,
  is_featured, status, destination, role, joined_at, tags_json
) VALUES
  ('demo-person-001', '林砚', '砚叔', NULL, 'cohort-2019', 'lineage', '从一张白纸开始，记录每一次认真连接。', 1, 'archived', 'startup', '发起人 / 产品顾问', '2019-06-18', '["产品","社区"]'),
  ('demo-person-002', '周予安', NULL, 'demo-person-001', 'cohort-2021', 'lineage', '喜欢把复杂的问题拆成可以一起走的路。', 0, 'archived', 'big_tech', '全栈开发者', '2021-03-22', '["工程","开源"]'),
  ('demo-person-003', '许棠', NULL, 'demo-person-001', 'cohort-2021', 'lineage', '在资料、田野和人之间，寻找能被传下去的东西。', 0, 'archived', 'postgraduate_985', '研究与内容', '2021-04-08', '["研究","写作"]'),
  ('demo-person-004', '苏禾', NULL, 'demo-person-002', 'cohort-2023', 'lineage', '让每一个重要的瞬间都被好好看见。', 0, 'archived', 'postgraduate_211', '交互设计师', '2023-09-01', '["设计","体验"]'),
  ('demo-person-005', '陈放', NULL, 'demo-person-002', 'cohort-2023', 'lineage', '把看不见的结构，整理成可被理解的秩序。', 0, 'archived', 'other', '数据工程师', '2023-10-12', '["数据","工具"]'),
  ('demo-person-006', '唐宁', NULL, 'demo-person-003', 'cohort-2024', 'lineage', '在真实世界里验证每一个好想法。', 0, 'active', 'further_study', '社会创新实践者', '2024-03-16', '["公益","组织"]');
