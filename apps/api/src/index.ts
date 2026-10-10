import { cors } from "hono/cors";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { personSearchQuerySchema } from "../../../packages/shared/src/schemas.ts";
import { accountApi, getProfileMetadata } from "./account-api.ts";
import contentApi, { attachmentApi } from "./content-api.ts";
import { adminApi } from "./admin-api.ts";
import { demoCohorts, demoPeople, demoTree, findCohort, findPerson, getChildren, toSummary } from "./data.ts";
import { inviteApi } from "./invites.ts";
import { persistence } from "./persistence.ts";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", async (c, next) => cors({
  origin: c.env?.ALLOWED_ORIGIN ?? "*",
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
})(c, next));

const errorResponse = (message: string, code: string, status: 400 | 404 | 500, fieldErrors?: Record<string, string[]>) =>
  new Response(JSON.stringify({ error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const toPersonDetail = (person: ReturnType<typeof findPerson>) => {
  if (!person) return null;
  const mentor = person.mentorId ? findPerson(person.mentorId) : undefined;
  const cohort = demoCohorts.find((candidate) => candidate.name === person.generation);
  const now = new Date().toISOString();
  const metadata = getProfileMetadata(person.id);
  return {
    ...toSummary(person),
    role: person.role,
    generation: person.generation,
    joinedAt: person.joinedAt,
    tags: person.tags,
    mentor: mentor ? toSummary(mentor) : null,
    students: getChildren(person.id).map(toSummary),
    bio: person.bio,
    featuredNote: person.isFeatured ? "谱系中的重要节点" : null,
    resume: null,
    achievements: [],
    attachments: [],
    version: metadata.version,
    createdAt: `${person.joinedAt}T00:00:00.000Z`,
    updatedAt: metadata.updatedAt ?? now,
    cohort: cohort ? { id: cohort.id, label: cohort.name, year: cohort.year, sortOrder: cohort.year - 2019 } : null,
  };
};

app.get("/api/health", (c) => c.json({
  data: { ok: true, environment: c.env.API_ENV ?? "demo", timestamp: new Date().toISOString() },
  ok: true,
  environment: c.env.API_ENV ?? "demo",
  timestamp: new Date().toISOString(),
}));

app.route("/api/invites", inviteApi);
app.route("/api/admin", adminApi);
app.route("/api", accountApi);
app.route("/api/me", contentApi);
app.route("/api/attachments", attachmentApi);

app.get("/api/tree", async (c) => {
  if (c.env?.DB) {
    const tree = await persistence(c.env.DB).tree();
    return c.json({ data: tree, meta: { demo: false, total: tree.nodes.length } });
  }
  return c.json({ data: demoTree, meta: { demo: true, total: demoTree.nodes.length } });
});

// Keep this route above /api/people/:id so "search" is not interpreted as an id.
app.get("/api/people/search", async (c) => {
  const parsed = personSearchQuerySchema.safeParse({ q: c.req.query("q"), limit: c.req.query("limit") });
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>;
    return errorResponse("Invalid search parameters", "VALIDATION_ERROR", 400, fieldErrors);
  }
  if (c.env?.DB) {
    const result = await persistence(c.env.DB).searchPeople(parsed.data.q, parsed.data.limit);
    return c.json({ data: result, meta: { demo: false, total: result.total, limit: parsed.data.limit, query: parsed.data.q } });
  }
  const query = parsed.data.q.toLocaleLowerCase();
  const destinationLabels = { big_tech: "大厂", postgraduate_985: "985研", postgraduate_211: "211研", startup: "创业", further_study: "继续深造", other: "其他" } as const;
  const matches = demoPeople.filter((person) => [person.name, person.nickname ?? "", person.role, person.generation, person.status === "archived" ? "毕业" : "在读", person.destination ? destinationLabels[person.destination] : "", ...person.tags]
    .join(" ").toLocaleLowerCase().includes(query));
  const items = matches.slice(0, parsed.data.limit).map(toSummary);
  return c.json({ data: { items, total: matches.length }, meta: { demo: true, total: matches.length, limit: parsed.data.limit, query: parsed.data.q } });
});

app.get("/api/people/:id", async (c) => {
  if (c.env?.DB) {
    const viewer = await persistence(c.env.DB).session(c.req.header("Authorization"));
    const person = await persistence(c.env.DB).personDetail(c.req.param("id"), viewer ? { userId: viewer.user.id, personId: viewer.user.personId, role: viewer.user.role } : undefined);
    if (!person) return errorResponse("Person not found", "PERSON_NOT_FOUND", 404);
    return c.json({ data: person, meta: { demo: false } });
  }
  const person = findPerson(c.req.param("id"));
  if (!person) return errorResponse("Person not found", "PERSON_NOT_FOUND", 404);
  return c.json({ data: toPersonDetail(person), meta: { demo: true } });
});

app.get("/api/cohorts", async (c) => {
  if (c.env?.DB) {
    const cohorts = await persistence(c.env.DB).cohorts();
    return c.json({ data: cohorts, meta: { demo: false, total: cohorts.length } });
  }
  return c.json({ data: demoCohorts, meta: { demo: true, total: demoCohorts.length } });
});

app.get("/api/cohorts/:id", async (c) => {
  if (c.env?.DB) {
    const cohort = await persistence(c.env.DB).cohortDetail(c.req.param("id"));
    if (!cohort) return errorResponse("Cohort not found", "COHORT_NOT_FOUND", 404);
    return c.json({ data: cohort, meta: { demo: false, total: cohort.memberCount } });
  }
  const cohort = findCohort(c.req.param("id"));
  if (!cohort) return errorResponse("Cohort not found", "COHORT_NOT_FOUND", 404);
  const people = demoPeople.filter((person) => person.generation === cohort.name);
  return c.json({ data: {
    id: cohort.id,
    label: cohort.name,
    name: cohort.name,
    year: cohort.year,
    sortOrder: cohort.year - 2019,
    description: cohort.description,
    lineagePeople: people.filter((person) => person.relationScope === "lineage").map(toSummary),
    guestPeople: people.filter((person) => person.relationScope === "cohort_guest").map(toSummary),
    memberCount: people.length,
  }, meta: { demo: true, total: people.length } });
});

app.notFound((c) => errorResponse("Not found", "NOT_FOUND", 404));

app.onError((error, c) => {
  if (error instanceof HTTPException) return errorResponse(error.message || "Request failed", "HTTP_ERROR", error.status >= 500 ? 500 : 400);
  console.error("Unhandled API error", error);
  return errorResponse("Internal server error", "INTERNAL_ERROR", 500);
});

export default app;
