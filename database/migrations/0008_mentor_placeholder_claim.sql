-- 师傅代建徒弟节点与一次性认领凭据。
-- 凭据只保存 SHA-256 哈希，明文只在创建响应中返回一次。

ALTER TABLE people ADD COLUMN member_type TEXT NOT NULL DEFAULT 'formal'
  CHECK (member_type IN ('formal', 'probationary'));

UPDATE cohorts SET label = replace(label, '届', '级'), description = replace(description, '届', '级')
  WHERE instr(label, '届') > 0 OR instr(description, '届') > 0;

CREATE TABLE person_claims (
  token_hash TEXT PRIMARY KEY NOT NULL,
  person_id TEXT NOT NULL UNIQUE REFERENCES people(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  claimed_at TEXT,
  claimed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX person_claims_creator_idx ON person_claims(created_by_user_id, created_at DESC);
CREATE INDEX person_claims_status_idx ON person_claims(claimed_at, expires_at);
