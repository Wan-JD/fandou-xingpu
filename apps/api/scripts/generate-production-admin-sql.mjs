import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createPasswordFields, normalizeEmail } from "../src/session.ts";

const requiredEmail = "wanjundi0512@163.com";
const email = normalizeEmail(process.env.ADMIN_EMAIL ?? requiredEmail);
const password = process.env.ADMIN_PASSWORD ?? "";
const name = (process.env.ADMIN_NAME ?? "wan jundi").trim();
if (email !== requiredEmail || password.length < 8 || password.length > 100 || !name || name.length > 100) {
  console.error(`Set ADMIN_EMAIL=${requiredEmail}, ADMIN_PASSWORD (8-100 chars), and ADMIN_NAME.`);
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const outputDirectory = path.join(root, "secrets");
const output = path.join(outputDirectory, "bootstrap-production-admin.sql");
const suffix = createHash("sha256").update(email).digest("hex").slice(0, 16);
const personId = `production-admin-person-${suffix}`;
const accountId = `production-admin-account-${suffix}`;
const credentials = await createPasswordFields(password);
const sqlValue = (value) => `'${String(value).replaceAll("'", "''")}'`;

const sql = `-- Generated locally. Contains password-derived credentials; do not commit.
-- Enforces exactly one active administrator: ${requiredEmail}.
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;
-- Rotate all administrator sessions before changing roles or credentials.
DELETE FROM auth_sessions
WHERE user_id IN (SELECT id FROM users WHERE role = 'admin' OR lower(COALESCE(email, '')) = ${sqlValue(email)});

-- Disable every pre-existing administrator before promoting the target account.
UPDATE users SET role = 'member', status = 'disabled', updated_at = datetime('now')
WHERE role = 'admin' AND lower(COALESCE(email, '')) <> ${sqlValue(email)};

INSERT INTO people (
  id, name, nickname, mentor_id, cohort_id, relation_scope, bio,
  is_featured, status, destination, role, joined_at, tags_json
)
SELECT ${sqlValue(personId)}, ${sqlValue(name)}, NULL, NULL, NULL, 'cohort_guest',
  '', 0, 'active', NULL, '管理员', date('now'), '[]'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = ${sqlValue(email)});

-- Repair a legacy target account that has no linked person record.
INSERT INTO people (
  id, name, nickname, mentor_id, cohort_id, relation_scope, bio,
  is_featured, status, destination, role, joined_at, tags_json
)
SELECT ${sqlValue(personId)}, ${sqlValue(name)}, NULL, NULL, NULL, 'cohort_guest',
  '', 0, 'active', NULL, '管理员', date('now'), '[]'
WHERE EXISTS (SELECT 1 FROM users WHERE lower(email) = ${sqlValue(email)} AND person_id IS NULL)
  AND NOT EXISTS (SELECT 1 FROM people WHERE id = ${sqlValue(personId)});

UPDATE users SET person_id = ${sqlValue(personId)}
WHERE lower(email) = ${sqlValue(email)} AND person_id IS NULL;

UPDATE people SET name = ${sqlValue(name)}, role = '管理员', status = 'active', updated_at = datetime('now')
WHERE id = (SELECT person_id FROM users WHERE lower(email) = ${sqlValue(email)} LIMIT 1);

INSERT INTO users (
  id, person_id, role, status, email, display_name,
  password_salt, password_hash
)
SELECT ${sqlValue(accountId)}, ${sqlValue(personId)}, 'admin', 'active', ${sqlValue(email)},
  ${sqlValue(name)}, ${sqlValue(credentials.passwordSalt)}, ${sqlValue(credentials.passwordHash)}
WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = ${sqlValue(email)})
  AND EXISTS (SELECT 1 FROM people WHERE id = ${sqlValue(personId)});

UPDATE users SET role = 'admin', status = 'active', display_name = ${sqlValue(name)},
  password_salt = ${sqlValue(credentials.passwordSalt)}, password_hash = ${sqlValue(credentials.passwordHash)},
  updated_at = datetime('now')
WHERE lower(email) = ${sqlValue(email)};

COMMIT;
`;

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(output, sql, { encoding: "utf8", mode: 0o600, flag: "w" });
console.log(`Production admin SQL written to ${output}`);
console.log("Review it, execute it once against the intended new production database, then delete it.");
