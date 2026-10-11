import { Hono } from "hono";
import { persistence } from "./persistence.ts";
import type { Env } from "./types.ts";

const apiError = (status: 400 | 404 | 409 | 410 | 503, code: string, message: string) =>
  new Response(JSON.stringify({ error: { code, message } }), { status, headers: { "Content-Type": "application/json" } });

const publicPerson = (person: any) => ({
  id: person.id,
  name: person.name,
  nickname: person.nickname ?? null,
  avatarUrl: person.avatarUrl ?? null,
  cohort: person.cohort ?? null,
  memberType: person.memberType,
  mentor: person.mentor ? { id: person.mentor.id, name: person.mentor.name, nickname: person.mentor.nickname ?? null, cohort: person.mentor.cohort ?? null } : null,
});

export const claimApi = new Hono<{ Bindings: Env }>();

claimApi.get("/:token", async (c) => {
  if (!c.env?.DB) return apiError(503, "DATABASE_UNAVAILABLE", "认证数据库未配置");
  const result = await persistence(c.env.DB).inspectClaim(c.req.param("token"));
  if (result.state === "missing") return apiError(404, "CLAIM_NOT_FOUND", "认领密钥不存在");
  if (result.state === "expired") return apiError(410, "CLAIM_EXPIRED", "认领密钥已经过期");
  if (result.state === "claimed") return apiError(409, "CLAIM_ALREADY_USED", "认领密钥已经使用");
  return c.json({ data: {
    status: "pending",
    expiresAt: result.claim.expiresAt,
    person: publicPerson(result.person),
  } });
});

claimApi.post("/:token/accept", async (c) => {
  const body = await c.req.json().catch(() => null) as { name?: unknown; nickname?: unknown; email?: unknown; password?: unknown } | null;
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : undefined;
  const nickname = body?.nickname === undefined ? undefined : typeof body.nickname === "string" && body.nickname.trim() ? body.nickname.trim() : null;
  const email = typeof body?.email === "string" ? body.email.trim().toLocaleLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if ((name && name.length > 100) || (nickname && nickname.length > 100) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 6 || password.length > 100) {
    return apiError(400, "INVALID_CLAIM", "请检查姓名、邮箱和密码");
  }
  if (!c.env?.DB) return apiError(503, "DATABASE_UNAVAILABLE", "认证数据库未配置");
  const result = await persistence(c.env.DB).claimPlaceholder(c.req.param("token"), { name, nickname, email, password });
  if (result.state === "missing") return apiError(404, "CLAIM_NOT_FOUND", "认领密钥不存在");
  if (result.state === "expired") return apiError(410, "CLAIM_EXPIRED", "认领密钥已经过期");
  if (result.state === "claimed") return apiError(409, "CLAIM_ALREADY_USED", "认领密钥已经使用");
  if (result.state === "email-conflict") return apiError(409, "EMAIL_ALREADY_REGISTERED", "这个邮箱已经注册或节点已经绑定账号");
  if (result.state !== "claimed-now" || !result.session || !result.person) return apiError(409, "CLAIM_ALREADY_USED", "认领密钥已经使用");
  return c.json({ data: {
    status: "claimed",
    person: publicPerson(result.person),
    session: result.session,
  } }, 201);
});

