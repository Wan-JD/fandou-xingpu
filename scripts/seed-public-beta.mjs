import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPasswordFields } from "../apps/api/src/session.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = path.join(root, "apps", "api");
const backupDirectory = path.join(root, "backups");
const accessFile = path.join(backupDirectory, "public-beta-access.json");
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("Run this script through pnpm db:seed:public-beta.");
if (process.env.CLOUDFLARE_API_TOKEN || process.argv.includes("--remote")) {
  throw new Error("This seed is local-only and refuses remote Cloudflare credentials/options.");
}

const sqlValue = (value) => value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const cohortSizes = new Map([[2022, 10], [2023, 10], [2024, 10], [2025, 24], [2026, 10]]);
const tracks = ["产品", "设计", "前端", "后端", "数据", "算法", "运营", "增长"];
const destinations = ["big_tech", "postgraduate_985", "postgraduate_211", "other", null];
const people = [];

for (const [year, size] of cohortSizes) {
  for (let index = 1; index <= size; index += 1) {
    const serial = String(index).padStart(2, "0");
    const id = `public-beta-${year}-${serial}`;
    const previousSize = cohortSizes.get(year - 1) ?? 0;
    const mentorIndex = previousSize ? ((index - 1) % previousSize) + 1 : null;
    const mentorId = year === 2022
      ? (index === 1 ? null : "public-beta-2022-01")
      : `public-beta-${year - 1}-${String(mentorIndex).padStart(2, "0")}`;
    const groupRole = index === 1 ? "leader" : index === 2 ? "vice_leader" : null;
    const month = ((index * 2 + year) % 12) + 1;
    const day = ((index * 5) % 27) + 1;
    people.push({
      id, year, index, mentorId, groupRole,
      name: `【公测】${year}级${serial}号`,
      birthday: `${2000 + (year - 2022)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      joinedAt: `${year}-${index % 3 === 0 ? "03" : "09"}-01`,
      status: year === 2022 ? "archived" : "active",
      memberType: index % 5 === 0 ? "probationary" : "formal",
      destination: destinations[(index - 1) % destinations.length],
      track: tracks[(index - 1) % tracks.length],
    });
  }
}

const accountSpecs = [
  { personId: "public-beta-2024-01", email: "public-beta-2024-leader@example.test", label: "2024级组长" },
  { personId: "public-beta-2025-01", email: "public-beta-2025-leader@example.test", label: "2025级组长" },
  { personId: "public-beta-2026-03", email: "public-beta-2026-member@example.test", label: "2026级成员" },
];
const savedAccess = existsSync(accessFile) ? JSON.parse(readFileSync(accessFile, "utf8")) : null;
const savedPasswords = new Map((savedAccess?.accounts ?? []).map((account) => [account.email, account.password]));
const accounts = [];
for (const spec of accountSpecs) {
  const password = savedPasswords.get(spec.email) ?? `Beta-${randomBytes(12).toString("base64url")}!`;
  const credentials = await createPasswordFields(password);
  accounts.push({ ...spec, id: `public-beta-account-${spec.personId.slice(-7)}`, password, ...credentials });
}

const personSql = people.map((person) => `
INSERT OR IGNORE INTO people (
  id, name, nickname, mentor_id, cohort_id, cohort_year, relation_scope, avatar_attachment_id,
  bio, is_featured, featured_note, status, member_type, destination, group_role, role,
  joined_at, birthday, tags_json, motto, cover_theme
) VALUES (
  ${sqlValue(person.id)}, ${sqlValue(person.name)}, NULL, ${sqlValue(person.mentorId)}, NULL, ${person.year}, 'lineage', NULL,
  ${sqlValue(`本地公测节点，用于验证多人星谱、权限与内容展示。方向：${person.track}。`)}, ${person.groupRole === "leader" ? 1 : 0},
  ${sqlValue(person.groupRole ? `${person.year}级${person.groupRole === "leader" ? "组长" : "副组长"}` : null)},
  ${sqlValue(person.status)}, ${sqlValue(person.memberType)}, ${sqlValue(person.destination)}, ${sqlValue(person.groupRole)},
  ${sqlValue(`${person.track}方向`)}, ${sqlValue(person.joinedAt)}, ${sqlValue(person.birthday)},
  ${sqlValue(JSON.stringify(["公测数据", person.track, `${person.year}级`]))}, ${sqlValue("认真记录，也认真生长。")},
  ${sqlValue(["nebula", "aurora", "dawn", "abyss"][person.index % 4])}
);`).join("\n");

const accountSql = accounts.map((account) => `
INSERT OR IGNORE INTO users (
  id, person_id, role, status, email, phone, display_name, password_salt, password_hash,
  must_change_password, activated_at
) VALUES (
  ${sqlValue(account.id)}, ${sqlValue(account.personId)}, 'member', 'active', ${sqlValue(account.email)}, NULL,
  ${sqlValue(people.find((person) => person.id === account.personId)?.name)}, ${sqlValue(account.passwordSalt)},
  ${sqlValue(account.passwordHash)}, 0, datetime('now')
);`).join("\n");

const sql = `
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;
${personSql}
${accountSql}
INSERT OR IGNORE INTO posts (id, person_id, kind, title, content, visibility, is_pinned)
VALUES (
  'public-beta-post-markdown', 'public-beta-2024-01', 'experience', '【公测】Markdown 经验样例',
  '# 公测经验分享\n\n这条内容用于验证 **Markdown**、列表和代码块。\n\n- 先观察\n- 再记录\n- 最后复盘\n\n\`\`\`ts\nconst season = "autumn";\n\`\`\`',
  'public', 1
);
INSERT OR IGNORE INTO posts (id, person_id, kind, title, content, visibility, is_pinned)
VALUES (
  'public-beta-post-note', 'public-beta-2025-01', 'note', NULL,
  '【公测】这是一条随手记，用于验证普通文字、卡片高度和多届成员主页。', 'public', 0
);
COMMIT;
`;

const persistenceArgs = process.env.D1_PERSIST_TO ? ["--persist-to", path.resolve(process.env.D1_PERSIST_TO)] : [];
const wrangler = (args, options = {}) => spawnSync(process.execPath, [pnpmCli, "exec", "wrangler", ...args], {
  cwd: apiRoot, stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit", encoding: options.capture ? "utf8" : undefined, shell: false,
});

const migration = wrangler(["d1", "migrations", "apply", "DB", "--local", "-c", "wrangler.local.toml", ...persistenceArgs]);
if (migration.error) throw migration.error;
if (migration.status !== 0) process.exit(migration.status ?? 1);

if (!savedAccess) {
  const existing = wrangler(["d1", "execute", "DB", "--local", "-c", "wrangler.local.toml", ...persistenceArgs, "--command", "SELECT COUNT(*) AS count FROM users WHERE id LIKE 'public-beta-account-%'", "--json"], { capture: true });
  if (existing.error) throw existing.error;
  if (existing.status !== 0) process.exit(existing.status ?? 1);
  const payload = JSON.parse(existing.stdout || "[]");
  const count = Number(payload?.[0]?.results?.[0]?.count ?? 0);
  if (count > 0) {
    throw new Error("Public-beta accounts already exist but backups/public-beta-access.json is missing. Existing passwords were preserved; restore the ignored access file or explicitly remove only those test accounts before reseeding.");
  }
}

const tempDirectory = mkdtempSync(path.join(tmpdir(), "fandou-public-beta-"));
const sqlFile = path.join(tempDirectory, "seed.sql");
writeFileSync(sqlFile, sql, { encoding: "utf8", mode: 0o600 });
const result = wrangler(["d1", "execute", "DB", "--local", "-c", "wrangler.local.toml", ...persistenceArgs, "--file", sqlFile]);
rmSync(tempDirectory, { recursive: true, force: true });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

mkdirSync(backupDirectory, { recursive: true });
if (!savedAccess) writeFileSync(accessFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), accounts: accounts.map(({ personId, email, label, password }) => ({ personId, email, label, password })) }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(`Seeded ${people.length} local public-beta people (${[...cohortSizes].map(([year, size]) => `${year}:${size}`).join(", ")}).`);
console.log(savedAccess ? `Existing local test credentials preserved in ${accessFile}` : `Local test credentials written to ${accessFile}`);
