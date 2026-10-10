-- 管理后台：审计、邀请撤销、本地账号标记与谱系环保护。

ALTER TABLE invitations ADD COLUMN revoked_at TEXT;
ALTER TABLE invitations ADD COLUMN revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN is_local_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_local_demo IN (0, 1));

CREATE INDEX invitations_status_idx ON invitations(revoked_at, accepted_at, expires_at);

CREATE TABLE admin_audit_logs (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX admin_audit_logs_created_idx ON admin_audit_logs(created_at DESC, id DESC);
CREATE INDEX admin_audit_logs_actor_idx ON admin_audit_logs(actor_user_id, created_at DESC);

CREATE TRIGGER people_mentor_guard_insert
BEFORE INSERT ON people
BEGIN
  SELECT CASE
    WHEN NEW.relation_scope = 'cohort_guest' AND NEW.mentor_id IS NOT NULL THEN RAISE(ABORT, 'SCOPE_MENTOR_CONFLICT')
    WHEN NEW.mentor_id IS NOT NULL AND NEW.mentor_id = NEW.id THEN RAISE(ABORT, 'MENTOR_SELF')
    WHEN NEW.mentor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.mentor_id) THEN RAISE(ABORT, 'MENTOR_NOT_FOUND')
    WHEN NEW.mentor_id IS NOT NULL AND NEW.relation_scope = 'lineage' AND EXISTS (
      SELECT 1 FROM people WHERE id = NEW.mentor_id AND relation_scope <> 'lineage'
    ) THEN RAISE(ABORT, 'MENTOR_NOT_LINEAGE')
  END;
END;

CREATE TRIGGER people_mentor_guard_update
BEFORE UPDATE OF mentor_id, relation_scope ON people
BEGIN
  SELECT CASE
    WHEN NEW.relation_scope = 'cohort_guest' AND NEW.mentor_id IS NOT NULL THEN RAISE(ABORT, 'SCOPE_MENTOR_CONFLICT')
    WHEN NEW.mentor_id IS NOT NULL AND NEW.mentor_id = NEW.id THEN RAISE(ABORT, 'MENTOR_SELF')
    WHEN NEW.mentor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.mentor_id) THEN RAISE(ABORT, 'MENTOR_NOT_FOUND')
    WHEN NEW.mentor_id IS NOT NULL AND NEW.relation_scope = 'lineage' AND EXISTS (
      SELECT 1 FROM people WHERE id = NEW.mentor_id AND relation_scope <> 'lineage'
    ) THEN RAISE(ABORT, 'MENTOR_NOT_LINEAGE')
    WHEN NEW.relation_scope = 'cohort_guest' AND EXISTS (
      SELECT 1 FROM people WHERE mentor_id = NEW.id AND relation_scope = 'lineage'
    ) THEN RAISE(ABORT, 'HAS_LINEAGE_STUDENTS')
    WHEN NEW.mentor_id IS NOT NULL AND EXISTS (
      WITH RECURSIVE ancestors(id) AS (
        SELECT NEW.mentor_id
        UNION
        SELECT p.mentor_id
        FROM people p
        JOIN ancestors a ON p.id = a.id
        WHERE p.mentor_id IS NOT NULL
      )
      SELECT 1 FROM ancestors WHERE id = NEW.id
    ) THEN RAISE(ABORT, 'MENTOR_CYCLE')
  END;
END;
