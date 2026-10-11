-- Additional account identifiers and the forced password rotation flag.
-- Phone numbers are stored in normalized form (digits, with an optional leading +).
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1));

CREATE UNIQUE INDEX users_phone_unique_idx
  ON users(phone)
  WHERE phone IS NOT NULL;
