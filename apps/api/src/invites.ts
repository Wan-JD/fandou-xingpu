import { Hono } from "hono";
import { persistence, type PersistentInvite } from "./persistence.ts";
import type { Env } from "./types";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InviteRecord = {
  token: string;
  mentorId: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedBy: { id: string; name: string; nickname: string | null } | null;
  accepting: boolean;
};

// These pure helpers support contract tests only. HTTP routes below always use D1.
const invites = new Map<string, InviteRecord>();

export function createInviteRecord(mentorId: string, options: { now?: number; ttlMs?: number; token?: string } = {}) {
  const now = options.now ?? Date.now();
  const record: InviteRecord = {
    token: options.token ?? crypto.randomUUID(),
    mentorId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + (options.ttlMs ?? DEFAULT_TTL_MS)).toISOString(),
    acceptedAt: null,
    acceptedBy: null,
    accepting: false,
  };
  invites.set(record.token, record);
  return record;
}

export function inspectInvite(token: string, now = Date.now()) {
  const record = invites.get(token);
  if (!record) return { state: "missing" as const, record: null };
  if (Date.parse(record.expiresAt) <= now) return { state: "expired" as const, record };
  if (record.acceptedAt) return { state: "accepted" as const, record };
  return { state: "pending" as const, record };
}

export function acceptInviteRecord(token: string, profile: { id?: string; name: string; nickname: string | null }, now = Date.now()) {
  const result = inspectInvite(token, now);
  if (result.state !== "pending") return result;
  result.record.acceptedAt = new Date(now).toISOString();
  result.record.acceptedBy = {
    id: profile.id ?? `invited-${token.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`,
    ...profile,
  };
  return { state: "accepted-now" as const, record: result.record };
}

export function resetInviteStore() {
  invites.clear();
}

const apiError = (status: 400 | 401 | 404 | 409 | 410 | 503, code: string, message: string) =>
  new Response(JSON.stringify({ error: { code, message } }), { status, headers: { "Content-Type": "application/json" } });

const publicPersistentInvite = (record: PersistentInvite, mentor: Record<string, unknown> | null) => ({
  token: record.token,
  status: record.acceptedAt ? "accepted" : "pending",
  createdAt: record.createdAt,
  expiresAt: record.expiresAt,
  acceptedAt: record.acceptedAt,
  mentor: mentor ? {
    id: mentor.id,
    name: mentor.name,
    nickname: mentor.nickname ?? null,
    avatarUrl: mentor.avatarUrl ?? null,
    cohort: mentor.cohort ?? null,
    relationScope: mentor.relationScope,
    isFeatured: mentor.isFeatured,
    status: mentor.status,
    destination: mentor.destination ?? null,
  } : null,
});

export const inviteApi = new Hono<{ Bindings: Env }>();

inviteApi.post("/", async (c) => {
  if (!c.env?.DB) return apiError(503, "DATABASE_UNAVAILABLE", "Authentication database is not configured");
  const store = persistence(c.env.DB);
  const session = await store.session(c.req.header("Authorization"));
  if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in before creating an invitation");
  const mentorId = session.user.personId;
  const mentor = await store.personDetail(mentorId);
  if (!mentor) return apiError(404, "MENTOR_NOT_FOUND", "Mentor not found");
  if (mentor.relationScope !== "lineage") return apiError(409, "MENTOR_NOT_LINEAGE", "Only lineage members can invite students");
  const record = await store.createInvite(mentorId, session.user.id);
  return c.json({ data: publicPersistentInvite(record, mentor) }, 201);
});

inviteApi.get("/:token", async (c) => {
  if (!c.env?.DB) return apiError(503, "DATABASE_UNAVAILABLE", "Authentication database is not configured");
  const store = persistence(c.env.DB);
  const result = await store.inspectInvite(c.req.param("token"));
  if (result.state === "missing") return apiError(404, "INVITE_NOT_FOUND", "Invitation not found");
  if (result.state === "expired") return apiError(410, "INVITE_EXPIRED", "Invitation has expired");
  const mentor = await store.personDetail(result.record.mentorId);
  return c.json({ data: publicPersistentInvite(result.record, mentor) });
});

inviteApi.post("/:token/accept", async (c) => {
  const body = await c.req.json().catch(() => null) as { name?: unknown; nickname?: unknown; email?: unknown; password?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const nickname = typeof body?.nickname === "string" && body.nickname.trim() ? body.nickname.trim() : null;
  const email = typeof body?.email === "string" ? body.email.trim().toLocaleLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!name || name.length > 100 || (nickname?.length ?? 0) > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 6 || password.length > 100) {
    return apiError(400, "INVALID_REGISTRATION", "A valid name is required");
  }
  if (!c.env?.DB) return apiError(503, "DATABASE_UNAVAILABLE", "Authentication database is not configured");
  const store = persistence(c.env.DB);
  const result = await store.acceptInvite(c.req.param("token"), { name, nickname, email, password });
  if (result.state === "missing") return apiError(404, "INVITE_NOT_FOUND", "Invitation not found");
  if (result.state === "expired") return apiError(410, "INVITE_EXPIRED", "Invitation has expired");
  if (result.state === "accepted") return apiError(409, "INVITE_ALREADY_ACCEPTED", "Invitation has already been accepted");
  if (result.state === "email-conflict") return apiError(409, "EMAIL_ALREADY_REGISTERED", "Email is already registered");
  if (result.state !== "accepted-now" || !result.record || !result.session) return apiError(409, "INVITE_ALREADY_ACCEPTED", "Invitation has already been accepted");
  const mentor = await store.personDetail(result.record.mentorId);
  return c.json({ data: {
    status: "accepted",
    acceptedAt: result.record.acceptedAt,
    member: result.record.acceptedBy,
    mentor,
    relationship: { mentorId: result.record.mentorId, studentId: result.record.acceptedBy!.id },
    session: result.session,
  } }, 201);
});
