import { cors } from "hono/cors";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { personSearchQuerySchema } from "../../../packages/shared/src/schemas.ts";
import { accountApi } from "./account-api.ts";
import contentApi, { attachmentApi } from "./content-api.ts";
import { adminApi } from "./admin-api.ts";
import { inviteApi } from "./invites.ts";
import { persistence } from "./persistence.ts";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", async (c, next) => cors({
  origin: c.env?.ALLOWED_ORIGIN ?? "*",
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
})(c, next));

const errorResponse = (message: string, code: string, status: 400 | 404 | 500 | 503, fieldErrors?: Record<string, string[]>) =>
  new Response(JSON.stringify({ error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

app.get("/api/health", (c) => c.json({
  data: { ok: true, environment: c.env.API_ENV ?? "production", timestamp: new Date().toISOString() },
  ok: true,
  environment: c.env.API_ENV ?? "production",
  timestamp: new Date().toISOString(),
}));

app.route("/api/invites", inviteApi);
app.route("/api/admin", adminApi);
app.route("/api", accountApi);
app.route("/api/me", contentApi);
app.route("/api/attachments", attachmentApi);

app.get("/api/tree", async (c) => {
  if (!c.env?.DB) return errorResponse("内容数据库未配置", "DATABASE_UNAVAILABLE", 503);
  const tree = await persistence(c.env.DB).tree();
  return c.json({ data: tree, meta: { total: tree.nodes.length } });
});

// Keep this route above /api/people/:id so "search" is not interpreted as an id.
app.get("/api/people/search", async (c) => {
  const parsed = personSearchQuerySchema.safeParse({ q: c.req.query("q"), limit: c.req.query("limit") });
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>;
    return errorResponse("Invalid search parameters", "VALIDATION_ERROR", 400, fieldErrors);
  }
  if (!c.env?.DB) return errorResponse("内容数据库未配置", "DATABASE_UNAVAILABLE", 503);
  const result = await persistence(c.env.DB).searchPeople(parsed.data.q, parsed.data.limit);
  return c.json({ data: result, meta: { total: result.total, limit: parsed.data.limit, query: parsed.data.q } });
});

app.get("/api/people/:id", async (c) => {
  if (!c.env?.DB) return errorResponse("内容数据库未配置", "DATABASE_UNAVAILABLE", 503);
  const viewer = await persistence(c.env.DB).session(c.req.header("Authorization"));
  const person = await persistence(c.env.DB).personDetail(c.req.param("id"), viewer ? { userId: viewer.user.id, personId: viewer.user.personId, role: viewer.user.role } : undefined);
  if (!person) return errorResponse("Person not found", "PERSON_NOT_FOUND", 404);
  return c.json({ data: person });
});

app.get("/api/cohorts", async (c) => {
  if (!c.env?.DB) return errorResponse("内容数据库未配置", "DATABASE_UNAVAILABLE", 503);
  const cohorts = await persistence(c.env.DB).cohorts();
  return c.json({ data: cohorts, meta: { total: cohorts.length } });
});

app.get("/api/cohorts/:id", async (c) => {
  if (!c.env?.DB) return errorResponse("内容数据库未配置", "DATABASE_UNAVAILABLE", 503);
  const cohort = await persistence(c.env.DB).cohortDetail(c.req.param("id"));
  if (!cohort) return errorResponse("Cohort not found", "COHORT_NOT_FOUND", 404);
  return c.json({ data: cohort, meta: { total: cohort.memberCount } });
});

app.notFound((c) => errorResponse("Not found", "NOT_FOUND", 404));

app.onError((error, c) => {
  if (error instanceof HTTPException) return errorResponse(error.message || "Request failed", "HTTP_ERROR", error.status >= 500 ? 500 : 400);
  console.error("Unhandled API error", error);
  return errorResponse("Internal server error", "INTERNAL_ERROR", 500);
});

export default app;
