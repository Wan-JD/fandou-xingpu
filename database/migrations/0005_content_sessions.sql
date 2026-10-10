-- 内容版本、D1 登录限流和邀请码撤销状态。

ALTER TABLE achievements ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE login_attempts (
  email TEXT PRIMARY KEY NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  blocked_until TEXT
);

-- 兑换必须在同一个 D1 batch 内满足“未接受、未撤销、未过期”。
CREATE TRIGGER invitations_accept_guard
BEFORE UPDATE OF accepted_at ON invitations
WHEN NEW.accepted_at IS NOT NULL
  AND (OLD.accepted_at IS NOT NULL OR OLD.revoked_at IS NOT NULL OR julianday(OLD.expires_at) <= julianday('now'))
BEGIN
  SELECT RAISE(ABORT, 'invite_not_pending');
END;
