import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPasswordFields, normalizeEmail } from "../src/session.ts";

const email = normalizeEmail(process.env.ADMIN_EMAIL ?? "");
const password = process.env.ADMIN_PASSWORD ?? "";
const name = (process.env.ADMIN_NAME ?? "").trim();

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 100 || !name || name.length > 100) {
  console.error("Set ADMIN_EMAIL, ADMIN_PASSWORD (8-100 chars), and ADMIN_NAME before bootstrapping.");
  process.exit(1);
}

const suffix = createHash("sha256").update(email).digest("hex").slice(0, 16);
const personId = `local-admin-person-${suffix}`;
const accountId = `local-admin-account-${suffix}`;
const credentials = await createPasswordFields(password);
const sqlValue = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sql = `
PRAGMA foreign_keys = ON;
INSERT INTO people (
  id, name, nickname, mentor_id, cohort_id, relation_scope, bio,
  is_featured, status, destination, role, joined_at, tags_json
) VALUES (
  ${sqlValue(personId)}, ${sqlValue(name)}, NULL, NULL, NULL, 'cohort_guest',
  '本地开发管理员账号。', 0, 'active', NULL, '本地管理员', date('now'), '[]'
) ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = datetime('now');
INSERT INTO users (
  id, person_id, role, status, email, display_name,
  password_salt, password_hash, is_local_demo
) VALUES (
  ${sqlValue(accountId)}, ${sqlValue(personId)}, 'admin', 'active', ${sqlValue(email)},
  ${sqlValue(name)}, ${sqlValue(credentials.passwordSalt)}, ${sqlValue(credentials.passwordHash)}, 1
) ON CONFLICT(id) DO UPDATE SET
  role = 'admin', status = 'active', email = excluded.email,
  display_name = excluded.display_name, password_salt = excluded.password_salt,
  password_hash = excluded.password_hash, is_local_demo = 1, updated_at = datetime('now');
`;

const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("Run this script through pnpm db:bootstrap:local.");
const apiDirectory = new URL("..", import.meta.url);
const persistenceArgs = process.env.D1_PERSIST_TO ? ["--persist-to", process.env.D1_PERSIST_TO] : [];
const migration = spawnSync(process.execPath, [pnpmCli,
  "exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "-c", "wrangler.local.toml", ...persistenceArgs,
], { cwd: apiDirectory, stdio: "inherit", shell: false });
if (migration.error) throw migration.error;
if (migration.status !== 0) process.exit(migration.status ?? 1);
const tempDirectory = mkdtempSync(path.join(tmpdir(), "fandou-admin-"));
const sqlFile = path.join(tempDirectory, "bootstrap.sql");
writeFileSync(sqlFile, sql, { encoding: "utf8", mode: 0o600 });
const result = spawnSync(process.execPath, [pnpmCli,
  "exec", "wrangler", "d1", "execute", "DB", "--local", "-c", "wrangler.local.toml", ...persistenceArgs, "--file", sqlFile,
], { cwd: apiDirectory, stdio: "inherit", shell: false });
rmSync(tempDirectory, { recursive: true, force: true });

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Local admin ready: ${email} (${personId})`);
