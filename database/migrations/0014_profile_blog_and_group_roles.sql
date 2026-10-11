-- 个人主页（博客）、组内职务与徒弟账号激活状态。
-- 全部为增量结构，旧版 Worker 在迁移后仍可正常读写。

-- 去向收敛为大厂 / 985研 / 211研 / 其他；创业与继续深造并入“其他”。
UPDATE people SET destination = 'other', updated_at = datetime('now')
  WHERE destination IN ('startup', 'further_study');

-- 组长、副组长是组内职务，与毕业去向相互独立。
ALTER TABLE people ADD COLUMN group_role TEXT
  CHECK (group_role IS NULL OR group_role IN ('leader', 'vice_leader'));

-- 主页签名与封面星云主题。
ALTER TABLE people ADD COLUMN motto TEXT;
ALTER TABLE people ADD COLUMN cover_theme TEXT;

-- 本人第一次设置自己的密码（修改初始密码或认领节点）后记录激活时间。
-- 师傅只能为从未激活的代建账号重新生成初始密码。
ALTER TABLE users ADD COLUMN activated_at TEXT;
UPDATE users SET activated_at = COALESCE(updated_at, created_at) WHERE must_change_password = 0;

-- 只在个人主页展示的动态。
CREATE TABLE posts (
  id TEXT PRIMARY KEY NOT NULL,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  title TEXT,
  content TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'members')),
  is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX posts_person_feed_idx ON posts(person_id, is_pinned DESC, created_at DESC);

CREATE TABLE post_likes (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX post_likes_user_idx ON post_likes(user_id);

-- 动态配图沿用 attachments 表与 R2 存储，通过 post_id 归属到具体动态。
ALTER TABLE attachments ADD COLUMN post_id TEXT REFERENCES posts(id) ON DELETE SET NULL;
CREATE INDEX attachments_post_idx ON attachments(post_id, status);
