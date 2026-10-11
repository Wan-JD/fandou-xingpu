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
  if (!parsed.success) return errorResponse("请检查邮箱和密码", "VALIDATION_ERROR", 400, parsed.error.flatten().fieldErrors as Record<string, string[]>);
  if (!c.env?.DB) return errorResponse("认证数据库未配置", "DATABASE_UNAVAILABLE", 503);
  const result = await persistence(c.env.DB).login(parsed.data.email, parsed.data.password);
  if (result.status === "rate_limited") {
    return errorResponse("尝试次数过多，请稍后再试", "LOGIN_RATE_LIMITED", 429, undefined, { "Retry-After": String(result.retryAfterSeconds) });
  }
  if (result.status === "invalid") return errorResponse("邮箱或密码不正确", "INVALID_CREDENTIALS", 401);
  return c.json({ data: result.session });
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
  const nickname = typeof body?.nickname === "string" && body.nickname.trim() ? body.nickname.trim() : null;
  const cohortId = typeof body?.cohortId === "string" && body.cohortId.trim() ? body.cohortId.trim() : null;
  const memberType = body?.memberType === "formal" ? "formal" : body?.memberType === "probationary" || body?.memberType === undefined ? "probationary" : null;
  const joinedAt = body?.joinedAt === null || body?.joinedAt === undefined || body?.joinedAt === "" ? null : typeof body.joinedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.joinedAt) ? body.joinedAt : null;
  if (!name || name.length > 100 || (nickname?.length ?? 0) > 100 || !memberType || (body?.joinedAt && !joinedAt)) {
    return errorResponse("请检查待认领节点资料", "VALIDATION_ERROR", 400);
  }
  const result = await store.createPlaceholder(session.user.personId, session.user.id, { name, nickname, cohortId, memberType, joinedAt });
  if (result.state === "mentor-not-found") return errorResponse("师傅档案不存在", "MENTOR_NOT_FOUND", 404);
  if (result.state === "mentor-not-lineage") return errorResponse("只有谱系成员可以代建徒弟节点", "MENTOR_NOT_LINEAGE", 409);
  if (result.state === "cohort-not-found") return errorResponse("级别不存在", "COHORT_NOT_FOUND", 404);
  return c.json({ data: {
    person: result.person,
    claimToken: result.token,
    claimPath: `/claim?token=${encodeURIComponent(result.token)}`,
    expiresAt: result.expiresAt,
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
