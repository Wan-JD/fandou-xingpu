import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createPasswordFields, normalizeEmail } from "../src/session.ts";

const email = normalizeEmail(process.env.ADMIN_EMAIL ?? "");
const password = process.env.ADMIN_PASSWORD ?? "";
const name = (process.env.ADMIN_NAME ?? "").trim();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 100 || !name || name.length > 100) {
  console.error("Set ADMIN_EMAIL, ADMIN_PASSWORD (8-100 chars), and ADMIN_NAME.");
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
-- Inserts only when no administrator exists and this email is unused.
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;
INSERT INTO people (
  id, name, nickname, mentor_id, cohort_id, relation_scope, bio,
  is_featured, status, destination, role, joined_at, tags_json
)
SELECT ${sqlValue(personId)}, ${sqlValue(name)}, NULL, NULL, NULL, 'cohort_guest',
  '', 0, 'active', NULL, '管理员', date('now'), '[]'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')
  AND NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = ${sqlValue(email)});
INSERT INTO users (
  id, person_id, role, status, email, display_name,
  password_salt, password_hash, is_local_demo
)
SELECT ${sqlValue(accountId)}, ${sqlValue(personId)}, 'admin', 'active', ${sqlValue(email)},
  ${sqlValue(name)}, ${sqlValue(credentials.passwordSalt)}, ${sqlValue(credentials.passwordHash)}, 0
WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')
  AND NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = ${sqlValue(email)})
  AND EXISTS (SELECT 1 FROM people WHERE id = ${sqlValue(personId)});
COMMIT;
`;

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(output, sql, { encoding: "utf8", mode: 0o600, flag: "w" });
console.log(`Production admin SQL written to ${output}`);
console.log("Review it, execute it once against the intended new production database, then delete it.");
