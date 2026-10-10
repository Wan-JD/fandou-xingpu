import { Hono } from "hono";
import { createPasswordFields, normalizeEmail } from "./session.ts";
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
  status: "active" | "archived";
  destination: string | null;
  mentor_id: string | null;
  mentor_name: string | null;
  relation_scope: "lineage" | "cohort_guest";
  nickname: string | null;
  bio: string;
  role: string;
  is_featured: number;
  featured_note: string | null;
  tags_json: string;
  version: number;
  account_id: string | null;
  email: string | null;
  account_role: "member" | "admin" | null;
  account_status: "active" | "disabled" | null;
};

const destinations = new Set(["big_tech", "postgraduate_985", "postgraduate_211", "startup", "further_study", "other"]);
const personStatuses = new Set(["active", "archived"]);
const relationScopes = new Set(["lineage", "cohort_guest"]);

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

async function mentorProblem(db: D1Database, personId: string, mentorId: string | null, relationScope: "lineage" | "cohort_guest") {
  if (relationScope === "cohort_guest" && mentorId) return "SCOPE_MENTOR_CONFLICT";
  if (!mentorId) return null;
  if (mentorId === personId) return "MENTOR_SELF";
  const mentor = await db.prepare("SELECT id, relation_scope FROM people WHERE id = ?").bind(mentorId).first<{ id: string; relation_scope: string }>();
  if (!mentor) return "MENTOR_NOT_FOUND";
  if (relationScope === "lineage" && mentor.relation_scope !== "lineage") return "MENTOR_NOT_LINEAGE";
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
  if (code === "SCOPE_MENTOR_CONFLICT") return error(409, code, "同届成员不能设置师傅");
  if (code === "MENTOR_NOT_LINEAGE") return error(409, code, "谱系人物只能选择谱系中的师傅");
  if (code === "HAS_LINEAGE_STUDENTS") return error(409, code, "仍有谱系徒弟，不能改为同届成员");
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
    SELECT p.id, p.name, p.nickname, p.bio, p.role, p.is_featured, p.featured_note, p.tags_json,
      p.cohort_id, c.label AS cohort_label, p.status, p.destination,
      p.mentor_id, mentor.name AS mentor_name, p.relation_scope, p.version,
      u.id AS account_id, u.email, u.role AS account_role, u.status AS account_status
    FROM people p
    LEFT JOIN cohorts c ON c.id = p.cohort_id
    LEFT JOIN people mentor ON mentor.id = p.mentor_id
    LEFT JOIN users u ON u.person_id = p.id
    ORDER BY c.sort_order, COALESCE(c.year, 9999), p.name, p.id
  `).all<MemberRow>();
  return c.json({ data: rows.results, meta: { total: rows.results.length } });
});

adminApi.post("/members", async (c) => {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const name = text(body?.name);
  const cohortId = nullableId(body?.cohortId);
  const mentorId = nullableId(body?.mentorId);
  const status = typeof body?.status === "string" && personStatuses.has(body.status) ? body.status : "active";
  const destination = body?.destination === null || body?.destination === "" ? null
    : typeof body?.destination === "string" && destinations.has(body.destination) ? body.destination : undefined;
  const relationScope = typeof body?.relationScope === "string" && relationScopes.has(body.relationScope)
    ? body.relationScope
    : mentorId ? "lineage" : "cohort_guest";
  if (!name || destination === undefined) return error(400, "VALIDATION_ERROR", "请检查姓名和去向");
  if (cohortId && !await c.env.DB!.prepare("SELECT id FROM cohorts WHERE id = ?").bind(cohortId).first()) {
    return error(404, "COHORT_NOT_FOUND", "指定届次不存在");
  }
  const id = `person-${crypto.randomUUID()}`;
  const relationError = await mentorProblem(c.env.DB!, id, mentorId, relationScope as "lineage" | "cohort_guest");
  if (relationError) return mentorError(relationError);
  const actor = c.get("adminUser");
  try {
    await c.env.DB!.batch([
      c.env.DB!.prepare(`
        INSERT INTO people (
          id, name, nickname, mentor_id, cohort_id, relation_scope, bio,
          is_featured, status, destination, role, joined_at, tags_json
        ) VALUES (?, ?, NULL, ?, ?, ?, '', 0, ?, ?, '星谱成员', date('now'), '[]')
      `).bind(id, name, mentorId, cohortId, relationScope, status, destination),
      audit(c.env.DB!, actor.id, "member.create", "person", id, { name, cohortId, mentorId, status, destination, relationScope }),
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
  if ("nickname" in body) {
    const nickname = body.nickname === null || body.nickname === "" ? null : text(body.nickname);
    if (body.nickname !== null && body.nickname !== "" && !nickname) return error(400, "VALIDATION_ERROR", "昵称不能超过 100 字");
    assignments.push("nickname = ?"); values.push(nickname); details.nickname = nickname;
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
  if ("cohortId" in body) {
    const cohortId = nullableId(body.cohortId);
    if (body.cohortId !== null && body.cohortId !== "" && !cohortId) return error(400, "VALIDATION_ERROR", "届次编号无效");
    if (cohortId && !await c.env.DB!.prepare("SELECT id FROM cohorts WHERE id = ?").bind(cohortId).first()) {
      return error(404, "COHORT_NOT_FOUND", "指定届次不存在");
    }
    assignments.push("cohort_id = ?"); values.push(cohortId); details.cohortId = cohortId;
  }
  if ("status" in body) {
    if (typeof body.status !== "string" || !personStatuses.has(body.status)) return error(400, "VALIDATION_ERROR", "人物状态无效");
    assignments.push("status = ?"); values.push(body.status); details.status = body.status;
  }
  if ("destination" in body) {
    const destination = body.destination === null || body.destination === "" ? null
      : typeof body.destination === "string" && destinations.has(body.destination) ? body.destination : undefined;
    if (destination === undefined) return error(400, "VALIDATION_ERROR", "去向无效");
    assignments.push("destination = ?"); values.push(destination); details.destination = destination;
  }
  if ("relationScope" in body) {
    if (typeof body.relationScope !== "string" || !relationScopes.has(body.relationScope)) return error(400, "VALIDATION_ERROR", "归属无效");
    assignments.push("relation_scope = ?"); values.push(body.relationScope); details.relationScope = body.relationScope;
  }
  if ("mentorId" in body) {
    const mentorId = nullableId(body.mentorId);
    if (body.mentorId !== null && body.mentorId !== "" && !mentorId) return error(400, "VALIDATION_ERROR", "师傅编号无效");
    assignments.push("mentor_id = ?"); values.push(mentorId); details.mentorId = mentorId;
  }
  if (!assignments.length) return error(400, "NO_CHANGES", "没有可保存的修改");
  const resultingMentorId = "mentorId" in body ? nullableId(body.mentorId) : existing.mentor_id;
  const resultingScope = "relationScope" in body ? body.relationScope as "lineage" | "cohort_guest" : existing.relation_scope;
  const relationError = await mentorProblem(c.env.DB!, personId, resultingMentorId, resultingScope);
  if (relationError) return mentorError(relationError);
  if (resultingScope === "cohort_guest") {
    const child = await c.env.DB!.prepare("SELECT id FROM people WHERE mentor_id = ? AND relation_scope = 'lineage' LIMIT 1").bind(personId).first();
    if (child) return mentorError("HAS_LINEAGE_STUDENTS");
  }
  assignments.push("version = version + 1", "updated_at = datetime('now')");
  const actor = c.get("adminUser");
  try {
    const result = await c.env.DB!.prepare(`UPDATE people SET ${assignments.join(", ")} WHERE id = ? AND version = ?`)
      .bind(...values, personId, expectedVersion).run();
    if ((result.meta.changes ?? 0) === 0) return error(409, "VERSION_CONFLICT", "资料已被其他管理员更新，请刷新后重试");
    await audit(c.env.DB!, actor.id, "member.update", "person", personId, { ...details, fromVersion: expectedVersion }).run();
  } catch (cause) {
    const code = String(cause).match(/MENTOR_(SELF|NOT_FOUND|NOT_LINEAGE|CYCLE)|SCOPE_MENTOR_CONFLICT|HAS_LINEAGE_STUDENTS/)?.[0];
    if (code) return mentorError(code);
    throw cause;
  }
  return c.json({ data: { id: personId } });
});

adminApi.get("/cohorts", async (c) => {
  const rows = await c.env.DB!.prepare(`
    SELECT c.id, c.label, c.year, c.sort_order, c.description, COUNT(p.id) AS member_count
    FROM cohorts c LEFT JOIN people p ON p.cohort_id = c.id
    GROUP BY c.id ORDER BY COALESCE(c.year, 9999), c.sort_order, c.id
  `).all();
  return c.json({ data: rows.results, meta: { total: rows.results.length } });
});

adminApi.post("/cohorts", async (c) => {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const label = text(body?.label);
  const year = body?.year === null || body?.year === "" ? null : Number(body?.year);
  const sortOrder = Number(body?.sortOrder ?? year ?? 0);
  const description = typeof body?.description === "string" ? body.description.trim().slice(0, 1000) : "";
  if (!label || (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2200)) || !Number.isInteger(sortOrder)) {
    return error(400, "VALIDATION_ERROR", "请检查届次名称、年份和排序");
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
  if (!await c.env.DB!.prepare("SELECT id FROM cohorts WHERE id = ?").bind(id).first()) return error(404, "COHORT_NOT_FOUND", "届次不存在");
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return error(400, "VALIDATION_ERROR", "请求内容无效");
  const assignments: string[] = [];
  const values: unknown[] = [];
  const details: Record<string, unknown> = {};
  if ("label" in body) { const value = text(body.label); if (!value) return error(400, "VALIDATION_ERROR", "届次名称无效"); assignments.push("label = ?"); values.push(value); details.label = value; }
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
  if (!cohort) return error(404, "COHORT_NOT_FOUND", "届次不存在");
  const member = await c.env.DB!.prepare("SELECT id FROM people WHERE cohort_id = ? LIMIT 1").bind(id).first();
  if (member) return error(409, "COHORT_NOT_EMPTY", "请先调整该届次成员");
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
    c.env.DB!.prepare("UPDATE users SET password_salt = ?, password_hash = ?, updated_at = datetime('now') WHERE id = ?")
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
  const password = typeof body?.password === "string" ? body.password : "";
  const role = body?.role === "admin" ? "admin" : "member";
  if (!personId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 100) {
    return error(400, "VALIDATION_ERROR", "请检查人物、邮箱和密码");
  }
  const person = await c.env.DB!.prepare("SELECT id, name FROM people WHERE id = ?").bind(personId).first<{ id: string; name: string }>();
  if (!person) return error(404, "PERSON_NOT_FOUND", "人物不存在");
  if (await c.env.DB!.prepare("SELECT id FROM users WHERE person_id = ? OR lower(email) = ?").bind(personId, email).first()) {
    return error(409, "ACCOUNT_EXISTS", "人物或邮箱已经绑定账号");
  }
  const id = `account-${crypto.randomUUID()}`;
  const credentials = await createPasswordFields(password);
  const actor = c.get("adminUser");
  await c.env.DB!.batch([
    c.env.DB!.prepare(`
      INSERT INTO users (id, person_id, role, status, email, display_name, password_salt, password_hash)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?)
    `).bind(id, personId, role, email, person.name, credentials.passwordSalt, credentials.passwordHash),
    audit(c.env.DB!, actor.id, "account.create", "user", id, { personId, email, role }),
  ]);
  return c.json({ data: { id } }, 201);
});
