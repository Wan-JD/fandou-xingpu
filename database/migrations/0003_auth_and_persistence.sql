-- D1 持久化：账号凭据、会话、邀请和人物资料字段。
-- 不写入任何预置账号或人物；管理员由显式 bootstrap 脚本写入。

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
