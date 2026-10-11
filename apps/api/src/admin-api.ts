import { Hono } from "hono";
import { createPasswordFields, normalizeEmail, normalizePhone } from "./session.ts";
import { persistence } from "./persistence.ts";
import type { Env } from "./types.ts";

type AdminVariables = {
  adminUser: { id: string; personId: string; displayName: string };
};

type MemberRow = {
  id: string;
  name: string;
  cohort_id: string | null;
  cohort_label: string | null;
  cohort_year: number | null;
  status: "active" | "archived";
  member_type: "formal" | "probationary";
  destination: string | null;
  mentor_id: string | null;
  mentor_name: string | null;
  relation_scope: "lineage" | "cohort_guest";
  bio: string;
  role: string;
  is_featured: number;
  featured_note: string | null;
  tags_json: string;
  version: number;
  account_id: string | null;
  email: string | null;
  phone: string | null;
  account_role: "member" | "admin" | null;
  account_status: "active" | "disabled" | null;
};

type AccountRow = {
  id: string;
  role: "member" | "admin";
  status: "active" | "disabled";
  person_id: string | null;
};

const destinations = new Set(["big_tech", "postgraduate_985", "postgraduate_211", "startup", "further_study", "other"]);
const personStatuses = new Set(["active", "archived"]);

const error = (status: 400 | 401 | 403 | 404 | 409 | 503, code: string, message: string) =>
  new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const text = (value: unknown, max = 100) => typeof value === "string" && value.trim() && value.trim().length <= max
  ? value.trim()
  : null;

const nullableId = (value: unknown) => value === null || value === "" ? null : text(value, 160);

function audit(db: D1Database, actorId: string, action: string, targetType: string, targetId: string, details: unknown = {}) {
  return db.prepare(`
    INSERT INTO admin_audit_logs (id, actor_user_id, action, target_type, target_id, details_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(`audit-${crypto.randomUUID()}`, actorId, action, targetType, targetId, JSON.stringify(details));
}

async function deletePersonAndAccount(
  env: Env,
  actor: AdminVariables["adminUser"],
  personId: string | null,
  account: AccountRow | null,
  auditAction: "person.delete" | "account.delete" = personId ? "person.delete" : "account.delete",
) {
  const db = env.DB!;
  if (account?.id === actor.id) return error(409, "CANNOT_DELETE_SELF", "不能删除自己的账号");
  if (account?.role === "admin" && account.status === "active") {
    const remaining = await db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active' AND id <> ?")
      .bind(account.id).first<{ count: number }>();
    if (Number(remaining?.count ?? 0) === 0) return error(409, "LAST_ADMIN", "不能删除最后一位管理员");
  }
  if (personId) {
    const students = await db.prepare("SELECT COUNT(*) AS count FROM people WHERE mentor_id = ?")
      .bind(personId).first<{ count: number }>();
    if (Number(students?.count ?? 0) > 0) return error(409, "PERSON_HAS_STUDENTS", "该人物仍有徒弟，请先处理师徒关系后再删除");
  }

  const attachmentRows = personId
    ? await db.prepare("SELECT object_key FROM attachments WHERE person_id = ? AND status <> 'deleted'").bind(personId).all<{ object_key: string }>()
    : { results: [] as { object_key: string }[] };
  const targetId = account?.id ?? personId!;
  const auditTargetId = auditAction === "account.delete" ? account?.id ?? personId! : personId ?? account!.id;
  await db.batch([
    db.prepare("DELETE FROM invitations WHERE created_by_user_id = ? OR mentor_id = ? OR accepted_person_id = ?")
      .bind(account?.id ?? null, personId, personId),
    ...(account ? [db.prepare("DELETE FROM users WHERE id = ?").bind(account.id)] : []),
    ...(personId ? [db.prepare("DELETE FROM people WHERE id = ?").bind(personId)] : []),
    audit(db, actor.id, auditAction, auditAction === "account.delete" ? "user" : "person", auditTargetId, {
      accountId: account?.id ?? null,
      personId,
      accountDeleted: Boolean(account),
      personDeleted: Boolean(personId),
    }),
  ]);
  if (env.FILES && attachmentRows.results.length) {
    await env.FILES.delete(attachmentRows.results.map((row) => row.object_key));
  }
  return {
    id: targetId,
    accountId: account?.id ?? null,
    personId,
    accountDeleted: Boolean(account),
    personDeleted: Boolean(personId),
  };
}

async function mentorProblem(db: D1Database, personId: string, mentorId: string | null, relationScope: "lineage" | "cohort_guest") {
  if (relationScope === "cohort_guest" && mentorId) return "SCOPE_MENTOR_CONFLICT";
  if (!mentorId) return null;
  if (mentorId === personId) return "MENTOR_SELF";
  const mentor = await db.prepare("SELECT id, relation_scope FROM people WHERE id = ?").bind(mentorId).first<{ id: string; relation_scope: string }>();
  if (!mentor) return "MENTOR_NOT_FOUND";
  if (relationScope === "lineage" && mentor.relation_scope !== "lineage") {
    const adminMentor = await db.prepare("SELECT 1 FROM users WHERE person_id = ? AND role = 'admin' AND status = 'active'")
      .bind(mentorId).first();
    if (!adminMentor) return "MENTOR_NOT_LINEAGE";
  }
  const cycle = await db.prepare(`
    WITH RECURSIVE descendants(id) AS (
      SELECT id FROM people WHERE mentor_id = ?
      UNION
      SELECT p.id FROM people p JOIN descendants d ON p.mentor_id = d.id
    )
    SELECT id FROM descendants WHERE id = ? LIMIT 1
  `).bind(personId, mentorId).first<{ id: string }>();
  return cycle ? "MENTOR_CYCLE" : null;
}

function mentorError(code: string) {
  if (code === "SCOPE_MENTOR_CONFLICT") return error(409, code, "同级成员不能设置师傅");
  if (code === "MENTOR_NOT_LINEAGE") return error(409, code, "谱系人物只能选择谱系中的师傅");
  if (code === "HAS_LINEAGE_STUDENTS") return error(409, code, "仍有谱系徒弟，不能改为同级成员");
  if (code === "MENTOR_SELF") return error(409, code, "人物不能成为自己的师傅");
  if (code === "MENTOR_NOT_FOUND") return error(404, code, "指定师傅不存在");
  return error(409, "MENTOR_CYCLE", "师徒关系会形成循环");
}

export const adminApi = new Hono<{ Bindings: Env; Variables: AdminVariables }>();

adminApi.use("/*", async (c, next) => {
  if (!c.env?.DB) return error(503, "D1_REQUIRED", "管理后台需要 D1 数据库");
  const session = await persistence(c.env.DB).session(c.req.header("Authorization"));
  if (!session) return error(401, "UNAUTHENTICATED", "请先登录");
  if (session.user.role !== "admin") return error(403, "ADMIN_REQUIRED", "需要管理员权限");
  c.set("adminUser", {
    id: session.user.id,
    personId: session.user.personId,
    displayName: session.user.displayName,
  });
  await next();
});

adminApi.get("/members", async (c) => {
  const rows = await c.env.DB!.prepare(`
    SELECT p.id, p.name, p.bio, p.role, p.is_featured, p.featured_note, p.tags_json,
      p.cohort_id, COALESCE(p.cohort_year, c.year) AS cohort_year,
      CASE WHEN COALESCE(p.cohort_year, c.year) IS NULL THEN NULL ELSE CAST(COALESCE(p.cohort_year, c.year) AS TEXT) || '级' END AS cohort_label,
      p.status, p.member_type, p.destination,
      p.mentor_id, mentor.name AS mentor_name, p.relation_scope, p.version,
      u.id AS account_id, u.email, u.phone, u.role AS account_role, u.status AS account_status
    FROM people p
    LEFT JOIN cohorts c ON c.id = p.cohort_id
    LEFT JOIN people mentor ON mentor.id = p.mentor_id
    LEFT JOIN users u ON u.person_id = p.id
    ORDER BY COALESCE(p.cohort_year, c.year, 9999), p.name, p.id
  `).all<MemberRow>();
  return c.json({ data: rows.results, meta: { total: rows.results.length } });
});

adminApi.post("/members", async (c) => {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const name = text(body?.name);
  const legacyCohortId = nullableId(body?.cohortId);
  const rawCohortYear = body?.cohortYear === null || body?.cohortYear === undefined || body?.cohortYear === "" ? null : Number(body?.cohortYear);
  const mentorId = nullableId(body?.mentorId);
  const status = typeof body?.status === "string" && personStatuses.has(body.status) ? body.status : "active";
  const memberType = body?.memberType === "probationary" ? "probationary" : "formal";
  const destination = body?.destination === null || body?.destination === "" ? null
    : typeof body?.destination === "string" && destinations.has(body.destination) ? body.destination : undefined;
  // All current people belong to the same lineage. Keep accepting the legacy
  // field from older clients, but never create a new cohort_guest record.
  const relationScope = "lineage" as const;
  const cohortYear = rawCohortYear === null && legacyCohortId
    ? (await c.env.DB!.prepare("SELECT year FROM cohorts WHERE id = ?").bind(legacyCohortId).first<{ year: number | null }>())?.year ?? null
    : rawCohortYear;
  if (!name || destination === undefined || (cohortYear !== null && (!Number.isInteger(cohortYear) || cohortYear < 1900 || cohortYear > 2200))) return error(400, "VALIDATION_ERROR", "请检查姓名、级别年份和去向");
  const id = `person-${crypto.randomUUID()}`;
  const relationError = await mentorProblem(c.env.DB!, id, mentorId, relationScope as "lineage" | "cohort_guest");
  if (relationError) return mentorError(relationError);
  const actor = c.get("adminUser");
  try {
    await c.env.DB!.batch([
      c.env.DB!.prepare(`
        INSERT INTO people (
          id, name, nickname, mentor_id, cohort_id, cohort_year, relation_scope, bio,
          is_featured, status, member_type, destination, role, joined_at, tags_json
        ) VALUES (?, ?, NULL, ?, NULL, ?, ?, '', 0, ?, ?, ?, '星谱成员', date('now'), '[]')
      `).bind(id, name, mentorId, cohortYear, relationScope, status, memberType, destination),
      audit(c.env.DB!, actor.id, "member.create", "person", id, { name, cohortYear, mentorId, status, memberType, destination, relationScope }),
    ]);
  } catch (cause) {
    const code = String(cause).match(/MENTOR_(SELF|NOT_FOUND|NOT_LINEAGE|CYCLE)|SCOPE_MENTOR_CONFLICT|HAS_LINEAGE_STUDENTS/)?.[0];
    if (code) return mentorError(code);
    throw cause;
  }
  return c.json({ data: { id } }, 201);
});

adminApi.patch("/members/:id", async (c) => {
  const personId = c.req.param("id");
  const existing = await c.env.DB!.prepare("SELECT id, mentor_id, relation_scope, version FROM people WHERE id = ?")
    .bind(personId).first<{ id: string; mentor_id: string | null; relation_scope: "lineage" | "cohort_guest"; version: number }>();
  if (!existing) return error(404, "PERSON_NOT_FOUND", "人物不存在");
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return error(400, "VALIDATION_ERROR", "请求内容无效");
  const assignments: string[] = [];
  const values: unknown[] = [];
  const details: Record<string, unknown> = {};
  const expectedVersion = Number(body.version);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return error(400, "VERSION_REQUIRED", "缺少有效的资料版本");
  if ("name" in body) {
    const name = text(body.name);
    if (!name) return error(400, "VALIDATION_ERROR", "姓名不能为空且不能超过 100 字");
    assignments.push("name = ?"); values.push(name); details.name = name;
  }
  if ("bio" in body) {
    if (typeof body.bio !== "string" || body.bio.length > 10000) return error(400, "VALIDATION_ERROR", "简介不能超过 10000 字");
    assignments.push("bio = ?"); values.push(body.bio.trim()); details.bio = body.bio.trim();
  }
  if ("role" in body) {
    const role = text(body.role, 160);
    if (!role) return error(400, "VALIDATION_ERROR", "身份说明不能为空");
    assignments.push("role = ?"); values.push(role); details.role = role;
  }
  if ("isFeatured" in body) {
    if (typeof body.isFeatured !== "boolean") return error(400, "VALIDATION_ERROR", "重点人物标记无效");
    assignments.push("is_featured = ?"); values.push(body.isFeatured ? 1 : 0); details.isFeatured = body.isFeatured;
  }
  if ("featuredNote" in body) {
    const featuredNote = body.featuredNote === null || body.featuredNote === "" ? null : text(body.featuredNote, 1000);
    if (body.featuredNote !== null && body.featuredNote !== "" && !featuredNote) return error(400, "VALIDATION_ERROR", "重点说明不能超过 1000 字");
    assignments.push("featured_note = ?"); values.push(featuredNote); details.featuredNote = featuredNote;
  }
  if ("tags" in body) {
    if (!Array.isArray(body.tags) || body.tags.length > 30 || body.tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.trim().length > 50)) {
      return error(400, "VALIDATION_ERROR", "标签格式无效");
    }
    const tags = [...new Set(body.tags.map((tag) => (tag as string).trim()))];
    assignments.push("tags_json = ?"); values.push(JSON.stringify(tags)); details.tags = tags;
  }
  if ("cohortYear" in body || "cohortId" in body) {
    const legacyCohortId = nullableId(body.cohortId);
    const rawCohortYear = body.cohortYear === null || body.cohortYear === undefined || body.cohortYear === "" ? null : Number(body.cohortYear);
    const cohortYear = rawCohortYear === null && legacyCohortId
      ? (await c.env.DB!.prepare("SELECT year FROM cohorts WHERE id = ?").bind(legacyCohortId).first<{ year: number | null }>())?.year ?? null
      : rawCohortYear;
    if (cohortYear !== null && (!Number.isInteger(cohortYear) || cohortYear < 1900 || cohortYear > 2200)) return error(400, "VALIDATION_ERROR", "级别年份无效");
    assignments.push("cohort_year = ?", "cohort_id = NULL"); values.push(cohortYear); details.cohortYear = cohortYear;
  }
  if ("status" in body) {
    if (typeof body.status !== "string" || !personStatuses.has(body.status)) return error(400, "VALIDATION_ERROR", "人物状态无效");
    assignments.push("status = ?"); values.push(body.status); details.status = body.status;
  }
  if ("memberType" in body) {
    if (body.memberType !== "formal" && body.memberType !== "probationary") return error(400, "VALIDATION_ERROR", "组员身份无效");
    assignments.push("member_type = ?"); values.push(body.memberType); details.memberType = body.memberType;
  }
  if ("destination" in body) {
    const destination = body.destination === null || body.destination === "" ? null
      : typeof body.destination === "string" && destinations.has(body.destination) ? body.destination : undefined;
    if (destination === undefined) return error(400, "VALIDATION_ERROR", "去向无效");
    assignments.push("destination = ?"); values.push(destination); details.destination = destination;
  }
  if ("relationScope" in body && body.relationScope !== "lineage" && body.relationScope !== "cohort_guest") return error(400, "VALIDATION_ERROR", "成员归属已统一为谱系");
  if ("mentorId" in body) {
    const mentorId = nullableId(body.mentorId);
    if (body.mentorId !== null && body.mentorId !== "" && !mentorId) return error(400, "VALIDATION_ERROR", "师傅编号无效");
    assignments.push("mentor_id = ?"); values.push(mentorId); details.mentorId = mentorId;
  }
  if (!assignments.length) return error(400, "NO_CHANGES", "没有可保存的修改");
  const resultingMentorId = "mentorId" in body ? nullableId(body.mentorId) : existing.mentor_id;
  const resultingScope = "lineage" as const;
  if (existing.relation_scope !== "lineage") {
    assignments.push("relation_scope = ?"); values.push("lineage"); details.relationScope = "lineage";
  }
  const relationError = await mentorProblem(c.env.DB!, personId, resultingMentorId, resultingScope);
  if (relationError) return mentorError(relationError);
  assignments.push("version = version + 1", "updated_at = datetime('now')");
  const actor = c.get("adminUser");
  try {
    const result = await c.env.DB!.prepare(`UPDATE people SET ${assignments.join(", ")} WHERE id = ? AND version = ?`)
      .bind(...values, personId, expectedVersion).run();
    if ((result.meta.changes ?? 0) === 0) return error(409, "VERSION_CONFLICT", "资料已被其他管理员更新，请刷新后重试");
    if ("name" in body) {
      const newName = text(body.name);
      await c.env.DB!.prepare("UPDATE users SET display_name = ?, updated_at = datetime('now') WHERE person_id = ?")
        .bind(newName, personId).run();
    }
    await audit(c.env.DB!, actor.id, "member.update", "person", personId, { ...details, fromVersion: expectedVersion }).run();
  } catch (cause) {
    const code = String(cause).match(/MENTOR_(SELF|NOT_FOUND|NOT_LINEAGE|CYCLE)|SCOPE_MENTOR_CONFLICT|HAS_LINEAGE_STUDENTS/)?.[0];
    if (code) return mentorError(code);
    throw cause;
  }
  return c.json({ data: { id: personId } });
});

adminApi.delete("/members/:id", async (c) => {
  const personId = c.req.param("id");
  if (!await c.env.DB!.prepare("SELECT id FROM people WHERE id = ?").bind(personId).first()) {
    return error(404, "PERSON_NOT_FOUND", "人物不存在");
  }
  const account = await c.env.DB!.prepare("SELECT id, role, status, person_id FROM users WHERE person_id = ?")
    .bind(personId).first<AccountRow>();
  const result = await deletePersonAndAccount(c.env, c.get("adminUser"), personId, account ?? null);
  if (result instanceof Response) return result;
  return c.json({ data: result });
});

adminApi.get("/cohorts", async (c) => {
  const rows = await c.env.DB!.prepare(`
    SELECT COALESCE(p.cohort_year, c.year) AS year, COUNT(p.id) AS member_count
    FROM people p LEFT JOIN cohorts c ON c.id = p.cohort_id
    WHERE COALESCE(p.cohort_year, c.year) IS NOT NULL
    GROUP BY COALESCE(p.cohort_year, c.year) ORDER BY year
  `).all<{ year: number; member_count: number }>();
  const data = rows.results.map((row) => ({ id: `cohort-${row.year}`, label: `${row.year}级`, year: row.year, sort_order: row.year - 2019, description: `${row.year}级成员。`, member_count: Number(row.member_count) }));
  return c.json({ data, meta: { total: data.length } });
});

adminApi.post("/cohorts", async (c) => {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const label = text(body?.label);
  const year = body?.year === null || body?.year === "" ? null : Number(body?.year);
  const sortOrder = Number(body?.sortOrder ?? year ?? 0);
  const description = typeof body?.description === "string" ? body.description.trim().slice(0, 1000) : "";
  if (!label || (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2200)) || !Number.isInteger(sortOrder)) {
    return error(400, "VALIDATION_ERROR", "请检查级别名称、年份和排序");
  }
  const id = `cohort-${crypto.randomUUID()}`;
  const actor = c.get("adminUser");
  await c.env.DB!.batch([
    c.env.DB!.prepare("INSERT INTO cohorts (id, label, year, sort_order, description) VALUES (?, ?, ?, ?, ?)")
      .bind(id, label, year, sortOrder, description),
    audit(c.env.DB!, actor.id, "cohort.create", "cohort", id, { label, year, sortOrder }),
  ]);
  return c.json({ data: { id } }, 201);
});

adminApi.patch("/cohorts/:id", async (c) => {
  const id = c.req.param("id");
  if (!await c.env.DB!.prepare("SELECT id FROM cohorts WHERE id = ?").bind(id).first()) return error(404, "COHORT_NOT_FOUND", "级别不存在");
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return error(400, "VALIDATION_ERROR", "请求内容无效");
  const assignments: string[] = [];
  const values: unknown[] = [];
  const details: Record<string, unknown> = {};
  if ("label" in body) { const value = text(body.label); if (!value) return error(400, "VALIDATION_ERROR", "级别名称无效"); assignments.push("label = ?"); values.push(value); details.label = value; }
  if ("year" in body) { const value = body.year === null || body.year === "" ? null : Number(body.year); if (value !== null && (!Number.isInteger(value) || value < 1900 || value > 2200)) return error(400, "VALIDATION_ERROR", "年份无效"); assignments.push("year = ?"); values.push(value); details.year = value; }
  if ("sortOrder" in body) { const value = Number(body.sortOrder); if (!Number.isInteger(value)) return error(400, "VALIDATION_ERROR", "排序无效"); assignments.push("sort_order = ?"); values.push(value); details.sortOrder = value; }
  if ("description" in body) { const value = typeof body.description === "string" ? body.description.trim().slice(0, 1000) : ""; assignments.push("description = ?"); values.push(value); details.description = value; }
  if (!assignments.length) return error(400, "NO_CHANGES", "没有可保存的修改");
  assignments.push("updated_at = datetime('now')");
  const actor = c.get("adminUser");
  await c.env.DB!.batch([
    c.env.DB!.prepare(`UPDATE cohorts SET ${assignments.join(", ")} WHERE id = ?`).bind(...values, id),
    audit(c.env.DB!, actor.id, "cohort.update", "cohort", id, details),
  ]);
  return c.json({ data: { id } });
});

adminApi.delete("/cohorts/:id", async (c) => {
  const id = c.req.param("id");
  const cohort = await c.env.DB!.prepare("SELECT id FROM cohorts WHERE id = ?").bind(id).first();
  if (!cohort) return error(404, "COHORT_NOT_FOUND", "级别不存在");
  const member = await c.env.DB!.prepare("SELECT id FROM people WHERE cohort_id = ? LIMIT 1").bind(id).first();
  if (member) return error(409, "COHORT_NOT_EMPTY", "请先调整该级别成员");
  const actor = c.get("adminUser");
  await c.env.DB!.batch([
    c.env.DB!.prepare("DELETE FROM cohorts WHERE id = ?").bind(id),
    audit(c.env.DB!, actor.id, "cohort.delete", "cohort", id),
  ]);
  return c.body(null, 204);
});

adminApi.patch("/accounts/:id/status", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null) as { status?: unknown } | null;
  const status = body?.status;
  if (status !== "active" && status !== "disabled") return error(400, "VALIDATION_ERROR", "账号状态无效");
  const account = await c.env.DB!.prepare("SELECT id, role, status FROM users WHERE id = ?")
    .bind(id).first<{ id: string; role: "member" | "admin"; status: "active" | "disabled" }>();
  if (!account) return error(404, "ACCOUNT_NOT_FOUND", "账号不存在");
  const actor = c.get("adminUser");
  if (status === "disabled" && id === actor.id) return error(409, "CANNOT_DISABLE_SELF", "不能停用自己的账号");
  if (status === "disabled" && account.role === "admin") {
    const remaining = await c.env.DB!.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active' AND id <> ?")
      .bind(id).first<{ count: number }>();
    if (Number(remaining?.count ?? 0) === 0) return error(409, "LAST_ADMIN", "不能停用最后一位管理员");
  }
  await c.env.DB!.batch([
    c.env.DB!.prepare("UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(status, id),
    ...(status === "disabled" ? [c.env.DB!.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(id)] : []),
    audit(c.env.DB!, actor.id, `account.${status}`, "user", id),
  ]);
  return c.json({ data: { id, status } });
});

// Account deletion removes the account and its person record together. A node
// with direct students is blocked so the lineage is never silently orphaned.
adminApi.delete("/accounts/:id", async (c) => {
  const id = c.req.param("id");
  const account = await c.env.DB!.prepare("SELECT id, role, status, person_id FROM users WHERE id = ?")
    .bind(id).first<AccountRow>();
  if (!account) return error(404, "ACCOUNT_NOT_FOUND", "账号不存在");
  const result = await deletePersonAndAccount(c.env, c.get("adminUser"), account.person_id, account, "account.delete");
  if (result instanceof Response) return result;
  return c.json({ data: result });
});

adminApi.patch("/accounts/:id/role", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null) as { role?: unknown } | null;
  const role = body?.role;
  if (role !== "member" && role !== "admin") return error(400, "VALIDATION_ERROR", "账号角色无效");
  const account = await c.env.DB!.prepare("SELECT id, role, status FROM users WHERE id = ?")
    .bind(id).first<{ id: string; role: "member" | "admin"; status: "active" | "disabled" }>();
  if (!account) return error(404, "ACCOUNT_NOT_FOUND", "账号不存在");
  const actor = c.get("adminUser");
  if (role === "member" && id === actor.id) return error(409, "CANNOT_DEMOTE_SELF", "不能降低自己的管理员权限");
  if (role === "member" && account.role === "admin" && account.status === "active") {
    const remaining = await c.env.DB!.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active' AND id <> ?")
      .bind(id).first<{ count: number }>();
    if (Number(remaining?.count ?? 0) === 0) return error(409, "LAST_ADMIN", "不能移除最后一位管理员");
  }
  await c.env.DB!.batch([
    c.env.DB!.prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?").bind(role, id),
    audit(c.env.DB!, actor.id, "account.role_update", "user", id, { role }),
  ]);
  return c.json({ data: { id, role } });
});

adminApi.post("/accounts/:id/reset-password", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length < 8 || password.length > 100) return error(400, "VALIDATION_ERROR", "新密码长度需为 8 到 100 位");
  if (!await c.env.DB!.prepare("SELECT id FROM users WHERE id = ?").bind(id).first()) return error(404, "ACCOUNT_NOT_FOUND", "账号不存在");
  const credentials = await createPasswordFields(password);
  const actor = c.get("adminUser");
  await c.env.DB!.batch([
    c.env.DB!.prepare("UPDATE users SET password_salt = ?, password_hash = ?, must_change_password = 1, updated_at = datetime('now') WHERE id = ?")
      .bind(credentials.passwordSalt, credentials.passwordHash, id),
    c.env.DB!.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(id),
    audit(c.env.DB!, actor.id, "account.password_reset", "user", id),
  ]);
  return c.json({ data: { id, sessionsRevoked: true } });
});

adminApi.get("/invites", async (c) => {
  const rows = await c.env.DB!.prepare(`
    SELECT i.token_hash AS id, i.mentor_id, p.name AS mentor_name, i.created_by_user_id,
      i.created_at, i.expires_at, i.accepted_at, i.accepted_person_id, i.revoked_at
    FROM invitations i JOIN people p ON p.id = i.mentor_id
    ORDER BY i.created_at DESC
  `).all();
  return c.json({ data: rows.results, meta: { total: rows.results.length } });
});

adminApi.delete("/invites/:id", async (c) => {
  const id = c.req.param("id");
  const invite = await c.env.DB!.prepare("SELECT token_hash, accepted_at, revoked_at FROM invitations WHERE token_hash = ?")
    .bind(id).first<{ token_hash: string; accepted_at: string | null; revoked_at: string | null }>();
  if (!invite) return error(404, "INVITE_NOT_FOUND", "邀请不存在");
  if (invite.accepted_at) return error(409, "INVITE_ALREADY_ACCEPTED", "已使用的邀请不能撤销");
  if (invite.revoked_at) return error(409, "INVITE_ALREADY_REVOKED", "邀请已经撤销");
  const actor = c.get("adminUser");
  await c.env.DB!.batch([
    c.env.DB!.prepare("UPDATE invitations SET revoked_at = datetime('now'), revoked_by_user_id = ?, expires_at = datetime('now') WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL")
      .bind(actor.id, id),
    audit(c.env.DB!, actor.id, "invite.revoke", "invitation", id),
  ]);
  return c.body(null, 204);
});

adminApi.get("/audit-logs", async (c) => {
  const rawLimit = Number(c.req.query("limit") ?? 100);
  const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(rawLimit, 200)) : 100;
  const rows = await c.env.DB!.prepare(`
    SELECT l.id, l.action, l.target_type, l.target_id, l.details_json, l.created_at,
      l.actor_user_id, COALESCE(u.display_name, '已删除账号') AS actor_name
    FROM admin_audit_logs l LEFT JOIN users u ON u.id = l.actor_user_id
    ORDER BY l.created_at DESC, l.id DESC LIMIT ?
  `).bind(limit).all();
  return c.json({ data: rows.results, meta: { total: rows.results.length, limit } });
});

adminApi.post("/accounts", async (c) => {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const personId = text(body?.personId, 160);
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
  const phone = typeof body?.phone === "string" && body.phone.trim() ? normalizePhone(body.phone) : null;
  const password = typeof body?.password === "string" ? body.password : "";
  const role = body?.role === "admin" ? "admin" : "member";
  if (!personId || ((!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) && !phone) || password.length < 8 || password.length > 100) {
    return error(400, "VALIDATION_ERROR", "请检查人物、邮箱或手机号和密码");
  }
  const person = await c.env.DB!.prepare("SELECT id, name FROM people WHERE id = ?").bind(personId).first<{ id: string; name: string }>();
  if (!person) return error(404, "PERSON_NOT_FOUND", "人物不存在");
  if (await c.env.DB!.prepare("SELECT id FROM users WHERE person_id = ? OR lower(email) = ? OR (? IS NOT NULL AND phone = ?)").bind(personId, email, phone, phone).first()) {
    return error(409, "ACCOUNT_EXISTS", "人物或邮箱已经绑定账号");
  }
  const id = `account-${crypto.randomUUID()}`;
  const credentials = await createPasswordFields(password);
  const actor = c.get("adminUser");
  await c.env.DB!.batch([
    c.env.DB!.prepare(`
      INSERT INTO users (id, person_id, role, status, email, phone, display_name, password_salt, password_hash, must_change_password)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, 0)
    `).bind(id, personId, role, email, phone, person.name, credentials.passwordSalt, credentials.passwordHash),
    audit(c.env.DB!, actor.id, "account.create", "user", id, { personId, email, phone, role }),
  ]);
  return c.json({ data: { id } }, 201);
});
