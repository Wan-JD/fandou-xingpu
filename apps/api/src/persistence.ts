import type { Cohort, Person, TreeNode } from "./types.ts";
import { analyzeLineage } from "./lib/lineage.ts";
import {
  SESSION_TTL_MS,
  bearerToken,
  createOpaqueToken,
  createPasswordFields,
  hashToken,
  normalizeEmail,
  verifyPassword,
  type LoginResult,
  type Session,
  type SessionUser,
} from "./session.ts";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type PersonRow = {
  id: string;
  name: string;
  nickname: string | null;
  mentor_id: string | null;
  relation_scope: "lineage" | "cohort_guest";
  bio: string;
  is_featured: number;
  status: "active" | "archived";
  destination: Person["destination"];
  version: number;
  role: string;
  joined_at: string | null;
  tags_json: string;
  created_at: string;
  updated_at: string;
  cohort_id: string | null;
  cohort_label: string | null;
  cohort_year: number | null;
  cohort_sort_order: number | null;
  cohort_description: string | null;
  avatar_attachment_id: string | null;
  contact_email: string | null;
  education: string | null;
  experience: string | null;
  skills_json: string;
  links_json: string;
};

type StoredPerson = {
  person: Person;
  cohort: Cohort | null;
  cohortSortOrder: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type AccountRow = {
  id: string;
  email: string;
  display_name: string;
  person_id: string;
  role: "member" | "admin";
  password_salt: string;
  password_hash: string;
};

type SessionRow = AccountRow & { expires_at: string };

type InviteRow = {
  token_hash: string;
  mentor_id: string;
  created_by_user_id: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_person_id: string | null;
};

export type PersistentInvite = {
  token: string;
  mentorId: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedBy: { id: string; name: string; nickname: string | null } | null;
};

export type InviteInspection =
  | { state: "missing"; record: null }
  | { state: "expired" | "accepted" | "pending"; record: PersistentInvite };

export type ContentViewer = { userId?: string; personId?: string; role?: "member" | "admin" };

const PERSON_SELECT = `
  SELECT p.id, p.name, p.nickname, p.mentor_id, p.relation_scope, p.bio,
    p.is_featured, p.status, p.destination, p.version, p.role, p.joined_at,
    p.tags_json, p.created_at, p.updated_at,
    p.contact_email, p.education, p.experience, p.skills_json, p.links_json,
    c.id AS cohort_id, c.label AS cohort_label, c.year AS cohort_year,
    c.sort_order AS cohort_sort_order, c.description AS cohort_description,
    (SELECT a.id FROM attachments a WHERE a.person_id = p.id AND a.category = 'avatar' AND a.status = 'ready' ORDER BY a.created_at DESC LIMIT 1) AS avatar_attachment_id
  FROM people p
  LEFT JOIN cohorts c ON c.id = p.cohort_id`;

const destinationLabels: Record<NonNullable<Person["destination"]>, string> = {
  big_tech: "大厂",
  postgraduate_985: "985研",
  postgraduate_211: "211研",
  startup: "创业",
  further_study: "继续深造",
  other: "其他",
};

function parseTags(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function parseStringList(value: string | null | undefined) {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  } catch {
    return [];
  }
}

function parseLinks(value: string | null | undefined) {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is { label: string; url: string } => Boolean(item && typeof item === "object" && typeof (item as { label?: unknown }).label === "string" && typeof (item as { url?: unknown }).url === "string")) : [];
  } catch {
    return [];
  }
}

function mapPerson(row: PersonRow): StoredPerson {
  const cohort = row.cohort_id ? {
    id: row.cohort_id,
    name: row.cohort_label ?? "未分届次",
    year: row.cohort_year ?? 0,
    memberCount: 0,
    description: row.cohort_description ?? "",
  } satisfies Cohort : null;
  return {
    person: {
      id: row.id,
      name: row.name,
      nickname: row.nickname,
      avatarUrl: row.avatar_attachment_id ? `/api/attachments/${row.avatar_attachment_id}` : null,
      role: row.role,
      generation: cohort?.name ?? "未分届次",
      joinedAt: row.joined_at ?? row.created_at.slice(0, 10),
      status: row.status,
      destination: row.destination,
      tags: parseTags(row.tags_json),
      relationScope: row.relation_scope,
      isFeatured: Boolean(row.is_featured),
      mentorId: row.mentor_id,
      bio: row.bio,
      contactEmail: row.contact_email,
      education: row.education,
      experience: row.experience,
      skills: parseStringList(row.skills_json),
      links: parseLinks(row.links_json),
    },
    cohort,
    cohortSortOrder: row.cohort_sort_order,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSummary(record: StoredPerson) {
  const { person, cohort } = record;
  return {
    id: person.id,
    name: person.name,
    nickname: person.nickname,
    avatarUrl: person.avatarUrl,
    cohort: cohort ? { id: cohort.id, label: cohort.name, year: cohort.year || null, sortOrder: record.cohortSortOrder ?? (cohort.year ? cohort.year - 2019 : 99) } : null,
    relationScope: person.relationScope,
    isFeatured: person.isFeatured,
    status: person.status,
    destination: person.destination,
  };
}

function publicUser(row: AccountRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    personId: row.person_id,
    role: row.role,
  };
}

export class D1Persistence {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  private async people() {
    const result = await this.db.prepare(`${PERSON_SELECT} ORDER BY COALESCE(c.year, 9999), p.created_at, p.id`).all<PersonRow>();
    return result.results.map(mapPerson);
  }

  async tree() {
    const records = await this.people();
    const lineage = analyzeLineage(records.map(({ person }) => person));
    const nodes: TreeNode[] = records.map((record) => ({
      ...toSummary(record),
      mentorId: record.person.mentorId,
      depth: lineage.depthById.get(record.person.id) ?? null,
      directStudentIds: [...(lineage.directStudentIdsByMentorId.get(record.person.id) ?? [])],
      role: record.person.role,
      generation: record.person.generation,
      joinedAt: record.person.joinedAt,
      tags: record.person.tags,
      bio: record.person.bio,
      education: record.person.education,
      experience: record.person.experience,
      skills: record.person.skills,
      links: record.person.links,
    }));
    return {
      rootPersonId: lineage.rootIds[0] ?? null,
      nodes,
      edges: records.flatMap(({ person }) => person.mentorId
        ? [{ id: `edge-${person.id}`, mentorId: person.mentorId, studentId: person.id }]
        : []),
      generatedAt: new Date().toISOString(),
    };
  }

  async personDetail(id: string, viewer?: ContentViewer) {
    const records = await this.people();
    const byId = new Map(records.map((record) => [record.person.id, record]));
    const record = byId.get(id);
    if (!record) return null;
    const mentor = record.person.mentorId ? byId.get(record.person.mentorId) : null;
    const students = records.filter(({ person }) => person.mentorId === id);
    return {
      ...toSummary(record),
      role: record.person.role,
      generation: record.person.generation,
      joinedAt: record.person.joinedAt,
      tags: record.person.tags,
      mentor: mentor ? toSummary(mentor) : null,
      students: students.map(toSummary),
      bio: record.person.bio,
      education: record.person.education,
      experience: record.person.experience,
      skills: record.person.skills,
      links: record.person.links,
      featuredNote: record.person.isFeatured ? "谱系中的重要节点" : null,
      resume: (await this.attachments(id, viewer)).find((item) => item.category === "resume") ?? null,
      achievements: viewer && (viewer.role === "admin" || viewer.personId === id) ? await this.achievements(id) : [],
      attachments: await this.attachments(id, viewer),
      contactEmail: viewer && (viewer.role === "admin" || viewer.personId === id) ? record.person.contactEmail : null,
      version: record.version,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  async achievements(personId: string) {
    const result = await this.db.prepare(`SELECT id, person_id AS personId, kind, title, content, occurred_on AS occurredOn,
      date_precision AS datePrecision, version, created_at AS createdAt, updated_at AS updatedAt
      FROM achievements WHERE person_id = ? ORDER BY occurred_on DESC, created_at DESC`).bind(personId).all();
    return result.results;
  }

  async createAchievement(personId: string, input: { kind: string; title: string; content: string; occurredOn?: string | null; datePrecision?: string | null }) {
    const id = `achievement-${crypto.randomUUID()}`;
    await this.db.prepare(`INSERT INTO achievements (id, person_id, kind, title, content, occurred_on, date_precision)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, personId, input.kind, input.title, input.content, input.occurredOn ?? null, input.datePrecision ?? null).run();
    return (await this.achievements(personId)).find((item) => item.id === id) ?? null;
  }

  async updateAchievement(personId: string, id: string, version: number, input: { kind?: string; title?: string; content?: string; occurredOn?: string | null; datePrecision?: string | null }) {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [field, column] of [["kind", "kind"], ["title", "title"], ["content", "content"], ["occurredOn", "occurred_on"], ["datePrecision", "date_precision"]] as const) {
      if (field in input) { fields.push(`${column} = ?`); values.push(input[field]); }
    }
    if (!fields.length) return null;
    fields.push("version = version + 1", "updated_at = datetime('now')");
    const result = await this.db.prepare(`UPDATE achievements SET ${fields.join(", ")} WHERE id = ? AND person_id = ? AND version = ?`)
      .bind(...values, id, personId, version).run();
    if ((result.meta.changes ?? 0) === 0) return null;
    return (await this.achievements(personId)).find((item) => item.id === id) ?? null;
  }

  async deleteAchievement(personId: string, id: string, version: number) {
    const result = await this.db.prepare("DELETE FROM achievements WHERE id = ? AND person_id = ? AND version = ?")
      .bind(id, personId, version).run();
    return (result.meta.changes ?? 0) > 0;
  }

  async attachments(personId: string, viewer?: ContentViewer) {
    const canViewMembers = Boolean(viewer?.userId);
    const canViewPrivate = viewer?.role === "admin" || viewer?.personId === personId;
    const result = await this.db.prepare(`SELECT id, person_id AS personId, achievement_id AS achievementId, original_name AS originalName,
      mime_type AS mimeType, size, category, visibility, status, NULL AS url, created_at AS createdAt, updated_at AS updatedAt
      FROM attachments WHERE person_id = ? AND status = 'ready' AND (category = 'avatar' OR (visibility = 'members' AND ? = 1) OR (visibility = 'private' AND ? = 1)) ORDER BY created_at DESC`).bind(personId, canViewMembers ? 1 : 0, canViewPrivate ? 1 : 0).all();
    return result.results;
  }

  async attachment(id: string) {
    return this.db.prepare("SELECT id, person_id AS personId, object_key AS objectKey, original_name AS originalName, mime_type AS mimeType, size, category, visibility, status FROM attachments WHERE id = ?")
      .bind(id).first<{ id: string; personId: string; objectKey: string; originalName: string; mimeType: string; size: number; category: string; visibility: string; status: string }>();
  }

  async addAttachment(personId: string, file: File, category: string, visibility: string, files: R2Bucket) {
    const id = `attachment-${crypto.randomUUID()}`;
    const objectKey = `people/${personId}/${id}`;
    const body = await file.arrayBuffer();
    await files.put(objectKey, body, { httpMetadata: { contentType: file.type } });
    try {
      await this.db.prepare(`INSERT INTO attachments (id, person_id, object_key, original_name, mime_type, size, category, visibility, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready')`).bind(id, personId, objectKey, file.name, file.type, body.byteLength, category, visibility).run();
    } catch (error) {
      await files.delete(objectKey);
      throw error;
    }
    return this.attachment(id);
  }

  async removeAttachment(personId: string, id: string, files: R2Bucket) {
    const item = await this.attachment(id);
    if (!item || item.personId !== personId) return false;
    await this.db.prepare("UPDATE attachments SET status = 'deleted', updated_at = datetime('now') WHERE id = ? AND person_id = ? AND status = 'ready'")
      .bind(id, personId).run();
    await files.delete(item.objectKey);
    return true;
  }

  async searchPeople(query: string, limit: number) {
    const text = query.toLocaleLowerCase();
    const records = await this.people();
    const matches = records.filter(({ person }) => [
      person.name,
      person.nickname ?? "",
      person.role,
      person.generation,
      person.status === "archived" ? "毕业" : "在读",
      person.destination ? destinationLabels[person.destination] : "",
      ...person.tags,
    ].join(" ").toLocaleLowerCase().includes(text));
    return { items: matches.slice(0, limit).map(toSummary), total: matches.length };
  }

  async cohorts() {
    const rows = await this.db.prepare(`
      SELECT c.id, c.label AS name, c.year, c.sort_order, c.description, COUNT(p.id) AS member_count
      FROM cohorts c LEFT JOIN people p ON p.cohort_id = c.id
      GROUP BY c.id ORDER BY COALESCE(c.year, 9999), c.sort_order, c.id
    `).all<{ id: string; name: string; year: number | null; sort_order: number; description: string | null; member_count: number }>();
    return rows.results.map((row) => ({
      id: row.id,
      name: row.name,
      year: row.year ?? 0,
      sortOrder: row.sort_order,
      memberCount: Number(row.member_count),
      description: row.description ?? "",
    } satisfies Cohort));
  }

  async cohortDetail(id: string) {
    const cohorts = await this.cohorts();
    const cohort = cohorts.find((candidate) => candidate.id === id);
    if (!cohort) return null;
    const records = (await this.people()).filter((record) => record.cohort?.id === id);
    return {
      id: cohort.id,
      label: cohort.name,
      name: cohort.name,
      year: cohort.year,
      sortOrder: cohort.sortOrder ?? (cohort.year ? cohort.year - 2019 : 99),
      description: cohort.description,
      lineagePeople: records.filter(({ person }) => person.relationScope === "lineage").map(toSummary),
      guestPeople: records.filter(({ person }) => person.relationScope === "cohort_guest").map(toSummary),
      memberCount: records.length,
    };
  }

  private async issueSession(account: AccountRow, now = Date.now()) {
    const token = createOpaqueToken("session");
    const tokenHash = await hashToken(token);
    const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
    await this.db.prepare("INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .bind(tokenHash, account.id, expiresAt).run();
    return { token, expiresAt, user: publicUser(account) } satisfies Session;
  }

  async login(email: string, password: string, now = Date.now()): Promise<LoginResult> {
    const normalizedEmail = normalizeEmail(email);
    const attempt = await this.db.prepare("SELECT failures, window_started_at AS windowStartedAt, blocked_until AS blockedUntil FROM login_attempts WHERE email = ?")
      .bind(normalizedEmail).first<{ failures: number; windowStartedAt: string; blockedUntil: string | null }>();
    const windowMs = 15 * 60 * 1000;
    const blockMs = 15 * 60 * 1000;
    let failures = attempt && now - Date.parse(attempt.windowStartedAt) < windowMs ? attempt.failures : 0;
    if (attempt?.blockedUntil && Date.parse(attempt.blockedUntil) > now) {
      return { status: "rate_limited", retryAfterSeconds: Math.ceil((Date.parse(attempt.blockedUntil) - now) / 1000) };
    }
    const account = await this.db.prepare(`
      SELECT id, email, display_name, person_id, role, password_salt, password_hash
      FROM users WHERE lower(email) = ? AND status = 'active'
    `).bind(normalizedEmail).first<AccountRow>();
    if (!account || !await verifyPassword(password, account.password_salt, account.password_hash)) {
      failures += 1;
      const blockedUntil = failures >= 5 ? new Date(now + blockMs).toISOString() : null;
      await this.db.prepare(`INSERT INTO login_attempts (email, failures, window_started_at, blocked_until) VALUES (?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET failures = excluded.failures, window_started_at = excluded.window_started_at, blocked_until = excluded.blocked_until`)
        .bind(normalizedEmail, failures, new Date(now).toISOString(), blockedUntil).run();
      if (blockedUntil) return { status: "rate_limited", retryAfterSeconds: Math.ceil(blockMs / 1000) };
      return { status: "invalid" };
    }
    await this.db.prepare("DELETE FROM login_attempts WHERE email = ?").bind(normalizedEmail).run();
    return { status: "success", session: await this.issueSession(account, now) };
  }

  private async register(input: {
    displayName: string;
    email: string;
    password: string;
    personId: string;
    nickname: string | null;
    mentorId: string | null;
    inviteTokenHash?: string;
    now?: number;
  }) {
    const now = input.now ?? Date.now();
    const email = normalizeEmail(input.email);
    const existing = await this.db.prepare("SELECT id FROM users WHERE lower(email) = ?").bind(email).first<{ id: string }>();
    if (existing) return null;

    const credentials = await createPasswordFields(input.password);
    const accountId = `account-${crypto.randomUUID()}`;
    const year = new Date(now).getUTCFullYear();
    const cohortId = `cohort-${year}`;
    const joinedAt = new Date(now).toISOString().slice(0, 10);
    const sessionToken = createOpaqueToken("session");
    const sessionTokenHash = await hashToken(sessionToken);
    const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();

    const statements = [
      this.db.prepare(`
        INSERT INTO cohorts (id, label, year, sort_order, description)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING
      `).bind(cohortId, `${year}届`, year, year - 2019, `${year} 届成员。`),
      this.db.prepare(`
        INSERT INTO people (
          id, name, nickname, mentor_id, cohort_id, relation_scope, bio,
          is_featured, status, destination, role, joined_at, tags_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'active', NULL, '星谱成员', ?, '[]')
      `).bind(
        input.personId,
        input.displayName.trim(),
        input.nickname,
        input.mentorId,
        cohortId,
        input.mentorId ? "lineage" : "cohort_guest",
        "刚刚加入星谱，个人简介等待补充。",
        joinedAt,
      ),
      this.db.prepare(`
        INSERT INTO users (
          id, person_id, role, status, email, display_name,
          password_salt, password_hash, invite_token_hash
        ) VALUES (?, ?, 'member', 'active', ?, ?, ?, ?, ?)
      `).bind(accountId, input.personId, email, input.displayName.trim(), credentials.passwordSalt, credentials.passwordHash, input.inviteTokenHash ?? null),
      this.db.prepare("INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
        .bind(sessionTokenHash, accountId, expiresAt),
    ];
    if (input.inviteTokenHash) {
      statements.push(this.db.prepare(`
        UPDATE invitations SET accepted_at = ?, accepted_person_id = ?
        WHERE token_hash = ? AND accepted_at IS NULL
      `).bind(new Date(now).toISOString(), input.personId, input.inviteTokenHash));
    }

    try {
      await this.db.batch(statements);
    } catch (error) {
      if (String(error).toLocaleLowerCase().includes("unique")) return null;
      throw error;
    }

    const account: AccountRow = {
      id: accountId,
      email,
      display_name: input.displayName.trim(),
      person_id: input.personId,
      role: "member",
      password_salt: credentials.passwordSalt,
      password_hash: credentials.passwordHash,
    };
    return { token: sessionToken, expiresAt, user: publicUser(account) } satisfies Session;
  }

  async registerAccount(displayName: string, email: string, password: string, personId: string, now = Date.now()) {
    return this.register({ displayName, email, password, personId, nickname: null, mentorId: null, now });
  }

  async session(authorization: string | undefined, now = Date.now()) {
    const token = bearerToken(authorization);
    if (!token) return null;
    const tokenHash = await hashToken(token);
    const row = await this.db.prepare(`
      SELECT u.id, u.email, u.display_name, u.person_id, u.role,
        u.password_salt, u.password_hash, s.expires_at
      FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND u.status = 'active'
    `).bind(tokenHash).first<SessionRow>();
    if (!row) return null;
    if (Date.parse(row.expires_at) <= now) {
      await this.db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(tokenHash).run();
      return null;
    }
    return { token, expiresAt: row.expires_at, user: publicUser(row) } satisfies Session;
  }

  async deleteSession(authorization: string | undefined) {
    const token = bearerToken(authorization);
    if (!token) return false;
    const result = await this.db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(await hashToken(token)).run();
    return (result.meta.changes ?? 0) > 0;
  }

  async updateProfile(personId: string, input: { version: number; nickname?: string | null; bio?: string; destination?: Person["destination"]; contactEmail?: string | null; education?: string | null; experience?: string | null; skills?: string[]; links?: { label: string; url: string }[] }) {
    const assignments: string[] = [];
    const values: unknown[] = [];
    if ("nickname" in input) { assignments.push("nickname = ?"); values.push(input.nickname ?? null); }
    if (input.bio !== undefined) { assignments.push("bio = ?"); values.push(input.bio); }
    if ("destination" in input) { assignments.push("destination = ?"); values.push(input.destination ?? null); }
    if ("contactEmail" in input) { assignments.push("contact_email = ?"); values.push(input.contactEmail ?? null); }
    if ("education" in input) { assignments.push("education = ?"); values.push(input.education ?? null); }
    if ("experience" in input) { assignments.push("experience = ?"); values.push(input.experience ?? null); }
    if ("skills" in input) { assignments.push("skills_json = ?"); values.push(JSON.stringify(input.skills ?? [])); }
    if ("links" in input) { assignments.push("links_json = ?"); values.push(JSON.stringify(input.links ?? [])); }
    assignments.push("version = version + 1", "updated_at = datetime('now')");
    const result = await this.db.prepare(`UPDATE people SET ${assignments.join(", ")} WHERE id = ? AND version = ?`)
      .bind(...values, personId, input.version).run();
    if ((result.meta.changes ?? 0) === 0) return null;
    return this.personDetail(personId);
  }

  async createInvite(mentorId: string, createdByUserId: string, now = Date.now(), ttlMs = INVITE_TTL_MS) {
    const token = createOpaqueToken("invite");
    const tokenHash = await hashToken(token);
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + ttlMs).toISOString();
    await this.db.prepare(`
      INSERT INTO invitations (token_hash, mentor_id, created_by_user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(tokenHash, mentorId, createdByUserId, expiresAt, createdAt).run();
    return { token, mentorId, createdAt, expiresAt, acceptedAt: null, acceptedBy: null } satisfies PersistentInvite;
  }

  async inspectInvite(token: string, now = Date.now()): Promise<InviteInspection> {
    const row = await this.db.prepare(`
      SELECT token_hash, mentor_id, created_by_user_id, created_at, expires_at,
        accepted_at, accepted_person_id
      FROM invitations WHERE token_hash = ?
    `).bind(await hashToken(token)).first<InviteRow>();
    if (!row) return { state: "missing", record: null };
    const acceptedPerson = row.accepted_person_id ? await this.db.prepare(
      "SELECT id, name, nickname FROM people WHERE id = ?",
    ).bind(row.accepted_person_id).first<{ id: string; name: string; nickname: string | null }>() : null;
    const record: PersistentInvite = {
      token,
      mentorId: row.mentor_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      acceptedAt: row.accepted_at,
      acceptedBy: acceptedPerson,
    };
    if (Date.parse(row.expires_at) <= now) return { state: "expired", record };
    if (row.accepted_at) return { state: "accepted", record };
    return { state: "pending", record };
  }

  async acceptInvite(token: string, input: { name: string; nickname: string | null; email: string; password: string }, now = Date.now()) {
    const inspected = await this.inspectInvite(token, now);
    if (inspected.state !== "pending") return { state: inspected.state, record: inspected.record, session: null } as const;
    const tokenHash = await hashToken(token);
    const personId = `invited-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const session = await this.register({
      displayName: input.name,
      email: input.email,
      password: input.password,
      personId,
      nickname: input.nickname,
      mentorId: inspected.record.mentorId,
      inviteTokenHash: tokenHash,
      now,
    });
    if (!session) return { state: "email-conflict", record: inspected.record, session: null } as const;
    const record: PersistentInvite = {
      ...inspected.record,
      acceptedAt: new Date(now).toISOString(),
      acceptedBy: { id: personId, name: input.name, nickname: input.nickname },
    };
    return { state: "accepted-now", record, session } as const;
  }
}

export function persistence(db: D1Database) {
  return new D1Persistence(db);
}
