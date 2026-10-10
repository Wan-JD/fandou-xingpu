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
