import { Hono } from "hono";
import { personUpdateSchema, sessionLoginSchema } from "../../../packages/shared/src/schemas.ts";
import { persistence } from "./persistence.ts";
import type { Env } from "./types.ts";

export const accountApi = new Hono<{ Bindings: Env }>();

const errorResponse = (message: string, code: string, status: 400 | 401 | 403 | 404 | 409 | 429 | 503, fieldErrors?: Record<string, string[]>, headers?: Record<string, string>) =>
  new Response(JSON.stringify({ error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } }), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

accountApi.post("/session/login", async (c) => {
  const parsed = sessionLoginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return errorResponse("请填写邮箱、手机号或姓名，以及密码", "VALIDATION_ERROR", 400, parsed.error.flatten().fieldErrors as Record<string, string[]>);
  if (!c.env?.DB) return errorResponse("认证数据库未配置", "DATABASE_UNAVAILABLE", 503);
  const result = await persistence(c.env.DB).login(parsed.data.identifier ?? parsed.data.email ?? "", parsed.data.password);
  if (result.status === "rate_limited") {
    return errorResponse("尝试次数过多，请稍后再试", "LOGIN_RATE_LIMITED", 429, undefined, { "Retry-After": String(result.retryAfterSeconds) });
  }
  if (result.status === "ambiguous") return errorResponse("这个姓名对应多个账号，请改用邮箱或手机号登录", "AMBIGUOUS_NAME", 409);
  if (result.status === "invalid") return errorResponse("登录标识或密码不正确", "INVALID_CREDENTIALS", 401);
  return c.json({ data: result.session });
});

accountApi.post("/session/password", async (c) => {
  if (!c.env?.DB) return errorResponse("认证数据库未配置", "DATABASE_UNAVAILABLE", 503);
  const body = await c.req.json().catch(() => null) as { currentPassword?: unknown; newPassword?: unknown } | null;
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
  if (currentPassword.length < 6 || newPassword.length < 8 || newPassword.length > 100) {
    return errorResponse("新密码长度需为 8 到 100 位", "VALIDATION_ERROR", 400);
  }
  const result = await persistence(c.env.DB).changePassword(c.req.header("Authorization"), currentPassword, newPassword);
  if (result.state === "unauthenticated") return errorResponse("请先登录", "UNAUTHENTICATED", 401);
  if (result.state === "invalid-current-password") return errorResponse("当前密码不正确", "INVALID_CURRENT_PASSWORD", 403);
  return c.json({ data: { status: "updated", mustChangePassword: false } });
});

accountApi.post("/session/register", async (c) => {
  return errorResponse("请通过师傅发送的邀请链接加入星谱", "INVITE_REQUIRED", 403);
});

accountApi.get("/session", async (c) => {
  if (!c.env?.DB) return errorResponse("认证数据库未配置", "DATABASE_UNAVAILABLE", 503);
  const session = await persistence(c.env.DB).session(c.req.header("Authorization"));
  if (!session) return errorResponse("会话已失效", "UNAUTHENTICATED", 401);
  return c.json({ data: session });
});

accountApi.delete("/session", async (c) => {
  if (!c.env?.DB) return errorResponse("认证数据库未配置", "DATABASE_UNAVAILABLE", 503);
  await persistence(c.env.DB).deleteSession(c.req.header("Authorization"));
  return c.body(null, 204);
});

accountApi.get("/me/profile", async (c) => {
  if (!c.env?.DB) return errorResponse("认证数据库未配置", "DATABASE_UNAVAILABLE", 503);
  const store = persistence(c.env.DB);
  const session = await store.session(c.req.header("Authorization"));
  if (!session) return errorResponse("请先登录", "UNAUTHENTICATED", 401);
  const profile = await store.personDetail(session.user.personId, { userId: session.user.id, personId: session.user.personId, role: session.user.role });
  if (!profile) return errorResponse("账号尚未绑定人物档案", "PROFILE_NOT_FOUND", 404);
  return c.json({ data: profile });
});

accountApi.patch("/me/profile", async (c) => {
  if (!c.env?.DB) return errorResponse("认证数据库未配置", "DATABASE_UNAVAILABLE", 503);
  const store = persistence(c.env.DB);
  const session = await store.session(c.req.header("Authorization"));
  if (!session) return errorResponse("请先登录", "UNAUTHENTICATED", 401);
  const parsed = personUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return errorResponse("请检查资料内容", "VALIDATION_ERROR", 400, parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const existing = await store.personDetail(session.user.personId);
  if (!existing) return errorResponse("账号尚未绑定人物档案", "PROFILE_NOT_FOUND", 404);
  const updated = await store.updateProfile(session.user.personId, parsed.data);
  if (!updated) return errorResponse("资料已更新，请刷新后重试", "VERSION_CONFLICT", 409);
  const profile = await store.personDetail(session.user.personId, { userId: session.user.id, personId: session.user.personId, role: session.user.role });
  return c.json({ data: profile ?? updated });
});

accountApi.post("/me/placeholder-students", async (c) => {
  if (!c.env?.DB) return errorResponse("认证数据库未配置", "DATABASE_UNAVAILABLE", 503);
  const store = persistence(c.env.DB);
  const session = await store.session(c.req.header("Authorization"));
  if (!session) return errorResponse("请先登录", "UNAUTHENTICATED", 401);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const loginIdentifier = typeof body?.loginIdentifier === "string" ? body.loginIdentifier.trim() : "";
  const cohortYear = body?.cohortYear === null || body?.cohortYear === undefined || body?.cohortYear === "" ? null : Number(body.cohortYear);
  const memberType = body?.memberType === "formal" ? "formal" : body?.memberType === "probationary" || body?.memberType === undefined ? "probationary" : null;
  const joinedAt = body?.joinedAt === null || body?.joinedAt === undefined || body?.joinedAt === "" ? null : typeof body.joinedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.joinedAt) ? body.joinedAt : null;
  if (!name || name.length > 100 || loginIdentifier.length > 254 || !memberType || (body?.joinedAt && !joinedAt) || (cohortYear !== null && (!Number.isInteger(cohortYear) || cohortYear < 1900 || cohortYear > 2200))) {
    return errorResponse("请检查待认领节点资料", "VALIDATION_ERROR", 400);
  }
  const result = await store.createPlaceholder(
    session.user.personId,
    session.user.id,
    { name, loginIdentifier: loginIdentifier || null, cohortYear, memberType, joinedAt },
    Date.now(),
    session.user.role === "admin",
  );
  if (result.state === "mentor-not-found") return errorResponse("师傅档案不存在", "MENTOR_NOT_FOUND", 404);
  if (result.state === "mentor-not-lineage") return errorResponse("只有谱系成员可以代建徒弟节点", "MENTOR_NOT_LINEAGE", 409);
  if (result.state === "invalid-identifier") return errorResponse("登录标识请填写有效邮箱或手机号", "INVALID_IDENTIFIER", 400);
  if (result.state === "identifier-conflict") return errorResponse("这个邮箱或手机号已经被使用", "IDENTIFIER_ALREADY_REGISTERED", 409);
  return c.json({ data: {
    person: result.person,
    account: result.account,
    claimToken: result.token,
    claimPath: `/claim?token=${encodeURIComponent(result.token)}`,
    expiresAt: result.expiresAt,
    loginIdentifier: result.account.identifier,
    temporaryPassword: result.account.temporaryPassword,
  } }, 201);
});

accountApi.get("/me/placeholder-students", async (c) => {
  if (!c.env?.DB) return errorResponse("认证数据库未配置", "DATABASE_UNAVAILABLE", 503);
  const store = persistence(c.env.DB);
  const session = await store.session(c.req.header("Authorization"));
  if (!session) return errorResponse("请先登录", "UNAUTHENTICATED", 401);
  const items = await store.listPlaceholders(session.user.personId);
  return c.json({ data: items, meta: { total: items.length } });
});

accountApi.patch("/me/placeholder-students/:personId", async (c) => {
  if (!c.env?.DB) return errorResponse("认证数据库未配置", "DATABASE_UNAVAILABLE", 503);
  const store = persistence(c.env.DB);
  const session = await store.session(c.req.header("Authorization"));
  if (!session) return errorResponse("请先登录", "UNAUTHENTICATED", 401);
  const personId = c.req.param("personId");
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const version = Number(body?.version);
  const name = body?.name === undefined ? undefined : typeof body.name === "string" ? body.name.trim() : "";
  const hasCohortYear = Object.prototype.hasOwnProperty.call(body ?? {}, "cohortYear");
  const cohortYear = !hasCohortYear || body?.cohortYear === null || body?.cohortYear === "" ? null : Number(body?.cohortYear);
  const memberType = body?.memberType === undefined ? undefined : body.memberType === "formal" || body.memberType === "probationary" ? body.memberType : null;
  const hasGroupRole = Object.prototype.hasOwnProperty.call(body ?? {}, "groupRole");
  const groupRole = !hasGroupRole || body?.groupRole === null || body?.groupRole === "" ? null : body?.groupRole === "leader" || body?.groupRole === "vice_leader" ? body.groupRole : undefined;
  const status = body?.status === undefined ? undefined : body.status === "active" || body.status === "archived" ? body.status : null;
  if (!Number.isInteger(version) || version < 1 || (name !== undefined && (!name || name.length > 100)) || (cohortYear !== null && (!Number.isInteger(cohortYear) || cohortYear < 1900 || cohortYear > 2200)) || memberType === null || groupRole === undefined || status === null) {
    return errorResponse("请检查徒弟资料", "VALIDATION_ERROR", 400);
  }
  const updated = await store.updateMentoredStudent(session.user.personId, personId, {
    version,
    name,
    ...(hasCohortYear ? { cohortYear } : {}),
    ...(memberType !== undefined ? { memberType } : {}),
    ...(hasGroupRole ? { groupRole: groupRole as "leader" | "vice_leader" | null } : {}),
    ...(status !== undefined ? { status } : {}),
  });
  if (!updated) return errorResponse("徒弟不存在、不是你的徒弟，或资料已更新", "VERSION_CONFLICT", 409);
  return c.json({ data: updated });
});

accountApi.post("/me/placeholder-students/:personId/claim", async (c) => {
  if (!c.env?.DB) return errorResponse("认证数据库未配置", "DATABASE_UNAVAILABLE", 503);
  const store = persistence(c.env.DB);
  const session = await store.session(c.req.header("Authorization"));
  if (!session) return errorResponse("请先登录", "UNAUTHENTICATED", 401);
  const result = await store.rotatePlaceholderClaim(session.user.personId, c.req.param("personId"));
  if (result.state === "not-found") return errorResponse("待认领节点不存在", "PLACEHOLDER_NOT_FOUND", 404);
  if (result.state === "claimed") return errorResponse("节点已经认领，不能重新生成链接", "CLAIM_ALREADY_USED", 409);
  return c.json({ data: { claimToken: result.token, claimPath: `/claim?token=${encodeURIComponent(result.token)}`, expiresAt: result.expiresAt } });
});

accountApi.get("/me/students", async (c) => {
  if (!c.env?.DB) return errorResponse("认证数据库未配置", "DATABASE_UNAVAILABLE", 503);
  const store = persistence(c.env.DB);
  const session = await store.session(c.req.header("Authorization"));
  if (!session) return errorResponse("请先登录", "UNAUTHENTICATED", 401);
  const [students, invites] = await Promise.all([store.listStudents(session.user.personId), store.listMentorInvites(session.user.personId)]);
  return c.json({ data: { students, invites }, meta: { total: students.length } });
});

accountApi.post("/me/students/:personId/reset-password", async (c) => {
  if (!c.env?.DB) return errorResponse("认证数据库未配置", "DATABASE_UNAVAILABLE", 503);
  const store = persistence(c.env.DB);
  const session = await store.session(c.req.header("Authorization"));
  if (!session) return errorResponse("请先登录", "UNAUTHENTICATED", 401);
  const result = await store.resetStudentInitialPassword(session.user.personId, c.req.param("personId"));
  if (result.state !== "reset") return errorResponse("只能为尚未激活的直系徒弟账号重新生成初始密码", "RESET_NOT_ALLOWED", 409);
  return c.json({ data: result.account });
});

accountApi.delete("/me/invites/:id", async (c) => {
  if (!c.env?.DB) return errorResponse("认证数据库未配置", "DATABASE_UNAVAILABLE", 503);
  const store = persistence(c.env.DB);
  const session = await store.session(c.req.header("Authorization"));
  if (!session) return errorResponse("请先登录", "UNAUTHENTICATED", 401);
  if (!await store.revokeMentorInvite(session.user.personId, c.req.param("id"), session.user.id)) return errorResponse("邀请不存在、已使用或已撤销", "INVITE_NOT_PENDING", 409);
  return c.body(null, 204);
});
