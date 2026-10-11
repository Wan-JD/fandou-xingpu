import type { Cohort, Person, TreeNode } from "./types.ts";
import { analyzeLineage } from "./lib/lineage.ts";
import {
  SESSION_TTL_MS,
  bearerToken,
  createOpaqueToken,
  createPasswordFields,
  hashToken,
  normalizeEmail,
  normalizePhone,
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
  member_type: "formal" | "probationary";
  destination: Person["destination"];
  group_role: Person["groupRole"];
  motto: string | null;
  cover_theme: string | null;
  version: number;
  role: string;
  joined_at: string | null;
  tags_json: string;
  created_at: string;
  updated_at: string;
  cohort_id: string | null;
  cohort_year_direct: number | null;
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
  email: string | null;
  phone: string | null;
  display_name: string;
  person_id: string;
  role: "member" | "admin";
  password_salt: string;
  password_hash: string;
  must_change_password: number;
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

type ClaimRow = {
  token_hash: string;
  person_id: string;
  created_by_user_id: string;
  created_at: string;
  expires_at: string;
  claimed_at: string | null;
  claimed_by_user_id: string | null;
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

export type PersonClaim = {
  token: string;
  personId: string;
  createdAt: string;
  expiresAt: string;
  claimedAt: string | null;
};

export type ClaimInspection =
  | { state: "missing"; claim: null; person: null }
  | { state: "expired" | "claimed" | "pending"; claim: PersonClaim; person: Person };

export type ContentViewer = { userId?: string; personId?: string; role?: "member" | "admin" };

const PERSON_SELECT = `
  SELECT p.id, p.name, p.nickname, p.mentor_id, p.relation_scope, p.bio,
    p.is_featured, p.status, p.member_type, p.destination, p.group_role, p.motto, p.cover_theme, p.version, p.role, p.joined_at,
    p.tags_json, p.created_at, p.updated_at,
    p.contact_email, p.education, p.experience, p.skills_json, p.links_json,
    p.cohort_year AS cohort_year_direct,
    c.id AS cohort_id, c.label AS cohort_label, c.year AS cohort_year,
    c.sort_order AS cohort_sort_order, c.description AS cohort_description,
    (SELECT a.id FROM attachments a WHERE a.person_id = p.id AND a.category = 'avatar' AND a.status = 'ready' ORDER BY a.created_at DESC LIMIT 1) AS avatar_attachment_id
  FROM people p
  LEFT JOIN cohorts c ON c.id = p.cohort_id`;

const destinationLabels: Record<NonNullable<Person["destination"]>, string> = {
  big_tech: "大厂",
  postgraduate_985: "985研",
  postgraduate_211: "211研",
  other: "其他",
};

const groupRoleLabels: Record<NonNullable<Person["groupRole"]>, string> = {
  leader: "组长",
  vice_leader: "副组长",
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

const attachmentCategoryLabels: Record<string, string> = {
  avatar: "头像",
  resume: "简历",
  photo: "照片",
  certificate: "证书",
  other: "附件",
};

const attachmentMimeExtensions: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

function safeAttachmentPersonName(value: string | null | undefined) {
  return (value ?? "星谱成员").replace(/[\\/:*?\"<>|]/g, "").trim() || "星谱成员";
}

function attachmentExtension(originalName: string | null | undefined, mimeType: string) {
  return (originalName?.match(/(\.[A-Za-z0-9]{1,12})$/)?.[1] ?? attachmentMimeExtensions[mimeType] ?? "").toLowerCase();
}

function normalizedAttachmentName(personName: string | null | undefined, category: string, originalName: string | null | undefined, mimeType: string, id: string, createdAt?: string | null) {
  const label = attachmentCategoryLabels[category] ?? "附件";
  const extension = attachmentExtension(originalName, mimeType);
  const date = createdAt?.slice(0, 10).replace(/-/g, "") ?? new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = category === "photo" || category === "certificate" || category === "other" ? `-${date}-${id.slice(-4)}` : "";
  return `${safeAttachmentPersonName(personName)}${label}${suffix}${extension}`;
}

function mapPerson(row: PersonRow): StoredPerson {
  const cohortYear = row.cohort_year_direct ?? row.cohort_year;
  const cohort = cohortYear ? {
    id: `cohort-${cohortYear}`,
    name: `${cohortYear}级`,
    year: cohortYear,
    memberCount: 0,
    description: row.cohort_description ?? "",
  } satisfies Cohort : null;
  return {
    person: {
      id: row.id,
      name: row.name,
      nickname: row.nickname,
      avatarUrl: row.avatar_attachment_id ? `/api/attachments/${row.avatar_attachment_id}` : null,
      cohortYear,
      role: row.role,
      generation: cohort?.name ?? "未分级",
      joinedAt: row.joined_at ?? row.created_at.slice(0, 10),
      status: row.status,
      memberType: row.member_type,
      destination: row.destination,
      groupRole: row.group_role ?? null,
      tags: parseTags(row.tags_json),
      relationScope: row.relation_scope,
      isFeatured: Boolean(row.is_featured),
      mentorId: row.mentor_id,
      bio: row.bio,
      motto: row.motto,
      coverTheme: row.cover_theme,
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
    // Keep a null compatibility slot for older clients; nicknames are no longer populated or editable.
    nickname: null,
    avatarUrl: person.avatarUrl,
    cohortYear: person.cohortYear,
    cohort: cohort ? { id: cohort.id, label: cohort.name, year: cohort.year || null, sortOrder: record.cohortSortOrder ?? (cohort.year ? cohort.year - 2019 : 99) } : null,
    relationScope: person.relationScope,
    isFeatured: person.isFeatured,
    status: person.status,
    memberType: person.memberType,
    destination: person.destination,
    groupRole: person.groupRole,
  };
}

function publicUser(row: AccountRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    displayName: row.display_name,
    personId: row.person_id,
    role: row.role,
    mustChangePassword: Boolean(row.must_change_password),
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
      motto: record.person.motto ?? null,
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
    // Root-first ancestor chain; the visited set guards against legacy cycles.
    const lineagePath: StoredPerson[] = [];
    const visited = new Set([id]);
    for (let cursor = mentor ?? undefined; cursor && !visited.has(cursor.person.id); cursor = cursor.person.mentorId ? byId.get(cursor.person.mentorId) : undefined) {
      visited.add(cursor.person.id);
      lineagePath.unshift(cursor);
    }
    const childrenOf = new Map<string, string[]>();
    records.forEach(({ person }) => {
      if (!person.mentorId) return;
      childrenOf.set(person.mentorId, [...(childrenOf.get(person.mentorId) ?? []), person.id]);
    });
    const descendants = new Set<string>();
    const queue = [...(childrenOf.get(id) ?? [])];
    while (queue.length) {
      const next = queue.shift()!;
      if (next === id || descendants.has(next)) continue;
      descendants.add(next);
      queue.push(...(childrenOf.get(next) ?? []));
    }
    const cohortPeers = record.person.cohortYear
      ? records.filter(({ person }) => person.id !== id && person.cohortYear === record.person.cohortYear).slice(0, 12)
      : [];
    const canViewMembers = Boolean(viewer?.userId);
    const attachments = await this.attachments(id, viewer);
    const postCount = await this.db.prepare("SELECT COUNT(*) AS count FROM posts WHERE person_id = ? AND (visibility = 'public' OR ? = 1)")
      .bind(id, canViewMembers ? 1 : 0).first<{ count: number }>();
    return {
      ...toSummary(record),
      role: record.person.role,
      generation: record.person.generation,
      joinedAt: record.person.joinedAt,
      mentorId: record.person.mentorId,
      tags: record.person.tags,
      mentor: mentor ? toSummary(mentor) : null,
      students: students.map(toSummary),
      lineagePath: lineagePath.map(toSummary),
      descendantCount: descendants.size,
      cohortPeers: cohortPeers.map(toSummary),
      postCount: Number(postCount?.count ?? 0),
      bio: record.person.bio,
      motto: record.person.motto ?? null,
      coverTheme: record.person.coverTheme ?? null,
      education: record.person.education,
      experience: record.person.experience,
      skills: record.person.skills,
      links: record.person.links,
      featuredNote: record.person.isFeatured ? "谱系中的重要节点" : null,
      resume: attachments.find((item) => item.category === "resume") ?? null,
      // 事迹与荣誉和成员可见附件保持同一范围：登录成员可见，匿名访客不可见。
      achievements: canViewMembers ? await this.achievements(id) : [],
      attachments,
      // 联系邮箱属于个人资料的一部分，和简介/教育经历一样对所有访客展示。
      contactEmail: record.person.contactEmail,
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

  async attachments(personId: string, viewer?: ContentViewer): Promise<Array<{
    id: string; personId: string; achievementId: string | null; originalName: string; mimeType: string;
    size: number; category: string; visibility: string; status: string; url: string | null; createdAt: string; updatedAt: string;
  }>> {
    const canViewMembers = Boolean(viewer?.userId);
    const canViewPrivate = viewer?.role === "admin" || viewer?.personId === personId;
    const person = await this.db.prepare("SELECT name FROM people WHERE id = ?").bind(personId).first<{ name: string }>();
    const result = await this.db.prepare(`SELECT id, person_id AS personId, achievement_id AS achievementId, original_name AS originalName,
      mime_type AS mimeType, size, category, visibility, status, NULL AS url, created_at AS createdAt, updated_at AS updatedAt
      FROM attachments WHERE person_id = ? AND status = 'ready' AND category <> 'avatar' AND post_id IS NULL AND ((visibility = 'members' AND ? = 1) OR (visibility = 'private' AND ? = 1)) ORDER BY created_at DESC`).bind(personId, canViewMembers ? 1 : 0, canViewPrivate ? 1 : 0).all<{
        id: string; personId: string; achievementId: string | null; originalName: string; mimeType: string;
        size: number; category: string; visibility: string; status: string; url: string | null; createdAt: string; updatedAt: string;
      }>();
    return result.results.map((item) => ({ ...item, originalName: normalizedAttachmentName(person?.name, String(item.category), String(item.originalName), String(item.mimeType), String(item.id), String(item.createdAt)) }));
  }

  async attachment(id: string) {
    const row = await this.db.prepare(`SELECT a.id, a.person_id AS personId, a.object_key AS objectKey, a.original_name AS originalName,
      a.mime_type AS mimeType, a.size, a.category, a.visibility, a.status, a.created_at AS createdAt, p.name AS personName,
      a.post_id AS postId, post.visibility AS postVisibility
      FROM attachments a JOIN people p ON p.id = a.person_id LEFT JOIN posts post ON post.id = a.post_id WHERE a.id = ?`).bind(id).first<{
        id: string; personId: string; objectKey: string; originalName: string; mimeType: string; size: number;
        category: string; visibility: string; status: string; createdAt: string; personName: string;
        postId: string | null; postVisibility: "public" | "members" | null;
      }>();
    if (!row) return null;
    return { ...row, originalName: normalizedAttachmentName(row.personName, row.category, row.originalName, row.mimeType, row.id, row.createdAt) };
  }

  async addAttachment(personId: string, file: File, category: string, visibility: string, files: R2Bucket) {
    const id = `attachment-${crypto.randomUUID()}`;
    const objectKey = `people/${personId}/${id}`;
    const body = await file.arrayBuffer();
    const person = await this.db.prepare("SELECT name FROM people WHERE id = ?").bind(personId).first<{ name: string }>();
    const displayName = normalizedAttachmentName(person?.name, category, file.name, file.type, id);
    await files.put(objectKey, body, { httpMetadata: { contentType: file.type } });
    try {
      const previous = category === "avatar" || category === "resume"
        ? await this.db.prepare("SELECT id, object_key AS objectKey FROM attachments WHERE person_id = ? AND category = ? AND status = 'ready'")
          .bind(personId, category).all<{ id: string; objectKey: string }>()
        : { results: [] as { id: string; objectKey: string }[] };
      const statements: D1PreparedStatement[] = [];
      if (category === "avatar" || category === "resume") {
        statements.push(this.db.prepare("UPDATE attachments SET status = 'deleted', updated_at = datetime('now') WHERE person_id = ? AND category = ? AND status = 'ready'").bind(personId, category));
      }
      statements.push(this.db.prepare(`INSERT INTO attachments (id, person_id, object_key, original_name, mime_type, size, category, visibility, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready')`).bind(id, personId, objectKey, displayName, file.type, body.byteLength, category, visibility));
      await this.db.batch(statements);
      await Promise.all(previous.results.map((item) => files.delete(item.objectKey).catch(() => undefined)));
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
      person.destination ? destinationLabels[person.destination] ?? "" : "",
      person.groupRole ? groupRoleLabels[person.groupRole] : "",
      ...person.tags,
    ].join(" ").toLocaleLowerCase().includes(text));
    return { items: matches.slice(0, limit).map(toSummary), total: matches.length };
  }

  async cohorts() {
    const rows = await this.db.prepare(`
      SELECT COALESCE(p.cohort_year, c.year) AS year, COUNT(p.id) AS member_count
      FROM people p LEFT JOIN cohorts c ON c.id = p.cohort_id
      WHERE COALESCE(p.cohort_year, c.year) IS NOT NULL
      GROUP BY COALESCE(p.cohort_year, c.year)
      ORDER BY year
    `).all<{ year: number; member_count: number }>();
    return rows.results.map((row) => ({
      id: `cohort-${row.year}`,
      name: `${row.year}级`,
      year: row.year,
      sortOrder: row.year - 2019,
      memberCount: Number(row.member_count),
      description: `${row.year}级成员。`,
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

  async login(identifier: string, password: string, now = Date.now()): Promise<LoginResult> {
    const trimmedIdentifier = identifier.trim();
    const phoneCandidate = normalizePhone(trimmedIdentifier);
    const kind = trimmedIdentifier.includes("@")
      ? "email"
      : /^[+\d\s()-]+$/.test(trimmedIdentifier) && /^\+?\d{6,20}$/.test(phoneCandidate)
        ? "phone"
        : "name";
    const normalizedIdentifier = kind === "email"
      ? normalizeEmail(trimmedIdentifier)
      : kind === "phone"
        ? phoneCandidate
        : trimmedIdentifier.toLocaleLowerCase();
    const attemptKey = `${kind}:${normalizedIdentifier}`;
    const attempt = await this.db.prepare("SELECT failures, window_started_at AS windowStartedAt, blocked_until AS blockedUntil FROM login_attempts WHERE email = ?")
      .bind(attemptKey).first<{ failures: number; windowStartedAt: string; blockedUntil: string | null }>();
    const windowMs = 15 * 60 * 1000;
    const blockMs = 15 * 60 * 1000;
    let failures = attempt && now - Date.parse(attempt.windowStartedAt) < windowMs ? attempt.failures : 0;
    if (attempt?.blockedUntil && Date.parse(attempt.blockedUntil) > now) {
      return { status: "rate_limited", retryAfterSeconds: Math.ceil((Date.parse(attempt.blockedUntil) - now) / 1000) };
    }
    const lookup = kind === "email"
      ? "lower(u.email) = ?"
      : kind === "phone"
        ? "u.phone = ?"
        : "lower(p.name) = ?";
    const matches = await this.db.prepare(`
      SELECT u.id, u.email, u.phone, u.display_name, u.person_id, u.role,
        u.password_salt, u.password_hash, u.must_change_password
      FROM users u JOIN people p ON p.id = u.person_id
      WHERE ${lookup} AND u.status = 'active'
      ORDER BY u.created_at, u.id
      LIMIT 2
    `).bind(normalizedIdentifier).all<AccountRow>();
    if (matches.results.length > 1) return { status: "ambiguous" };
    const account = matches.results[0] ?? null;
    if (!account || !await verifyPassword(password, account.password_salt, account.password_hash)) {
      failures += 1;
      const blockedUntil = failures >= 5 ? new Date(now + blockMs).toISOString() : null;
      await this.db.prepare(`INSERT INTO login_attempts (email, failures, window_started_at, blocked_until) VALUES (?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET failures = excluded.failures, window_started_at = excluded.window_started_at, blocked_until = excluded.blocked_until`)
        .bind(attemptKey, failures, new Date(now).toISOString(), blockedUntil).run();
      if (blockedUntil) return { status: "rate_limited", retryAfterSeconds: Math.ceil(blockMs / 1000) };
      return { status: "invalid" };
    }
    await this.db.prepare("DELETE FROM login_attempts WHERE email = ?").bind(attemptKey).run();
    return { status: "success", session: await this.issueSession(account, now) };
  }

  private async register(input: {
    displayName: string;
    email: string | null;
    phone?: string | null;
    password: string;
    personId: string;
    nickname: string | null;
    mentorId: string | null;
    inviteTokenHash?: string;
    now?: number;
  }) {
    const now = input.now ?? Date.now();
    const email = input.email ? normalizeEmail(input.email) : null;
    const phone = input.phone ? normalizePhone(input.phone) : null;
    const existing = await this.db.prepare("SELECT id FROM users WHERE lower(email) = ? OR (? IS NOT NULL AND phone = ?)")
      .bind(email, phone, phone).first<{ id: string }>();
    if (existing) return null;

    const credentials = await createPasswordFields(input.password);
    const accountId = `account-${crypto.randomUUID()}`;
    const year = new Date(now).getUTCFullYear();
    const joinedAt = new Date(now).toISOString().slice(0, 10);
    const sessionToken = createOpaqueToken("session");
    const sessionTokenHash = await hashToken(sessionToken);
    const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();

    const statements = [
      this.db.prepare(`
        INSERT INTO people (
          id, name, nickname, mentor_id, cohort_id, cohort_year, relation_scope, bio,
          is_featured, status, destination, role, joined_at, tags_json
        ) VALUES (?, ?, NULL, ?, NULL, ?, ?, ?, 0, 'active', NULL, '星谱成员', ?, '[]')
      `).bind(
        input.personId,
        input.displayName.trim(),
        input.mentorId,
        year,
        "lineage",
        "刚刚加入星谱，个人简介等待补充。",
        joinedAt,
      ),
      this.db.prepare(`
        INSERT INTO users (
          id, person_id, role, status, email, phone, display_name,
          password_salt, password_hash, invite_token_hash, activated_at
        ) VALUES (?, ?, 'member', 'active', ?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(accountId, input.personId, email, phone, input.displayName.trim(), credentials.passwordSalt, credentials.passwordHash, input.inviteTokenHash ?? null),
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
      phone,
      display_name: input.displayName.trim(),
      person_id: input.personId,
      role: "member",
      password_salt: credentials.passwordSalt,
      password_hash: credentials.passwordHash,
      must_change_password: 0,
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
      SELECT u.id, u.email, u.phone, u.display_name, u.person_id, u.role,
        u.password_salt, u.password_hash, u.must_change_password, s.expires_at
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

  async changePassword(authorization: string | undefined, currentPassword: string, newPassword: string) {
    const token = bearerToken(authorization);
    if (!token) return { state: "unauthenticated" } as const;
    const tokenHash = await hashToken(token);
    const account = await this.db.prepare(`
      SELECT u.id, u.password_salt, u.password_hash
      FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'
    `).bind(tokenHash, new Date().toISOString()).first<{ id: string; password_salt: string; password_hash: string }>();
    if (!account) return { state: "unauthenticated" } as const;
    if (!await verifyPassword(currentPassword, account.password_salt, account.password_hash)) {
      return { state: "invalid-current-password" } as const;
    }
    const credentials = await createPasswordFields(newPassword);
    await this.db.batch([
      this.db.prepare(`UPDATE users SET password_salt = ?, password_hash = ?, must_change_password = 0,
        activated_at = COALESCE(activated_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`)
        .bind(credentials.passwordSalt, credentials.passwordHash, account.id),
      this.db.prepare("DELETE FROM auth_sessions WHERE user_id = ? AND token_hash <> ?").bind(account.id, tokenHash),
    ]);
    return { state: "updated" } as const;
  }

  async updateProfile(personId: string, input: { version: number; bio?: string; destination?: Person["destination"]; memberType?: Person["memberType"] | null; groupRole?: Person["groupRole"]; motto?: string | null; coverTheme?: string | null; contactEmail?: string | null; education?: string | null; experience?: string | null; skills?: string[]; links?: { label: string; url: string }[] }) {
    const assignments: string[] = [];
    const values: unknown[] = [];
    if (input.bio !== undefined) { assignments.push("bio = ?"); values.push(input.bio); }
    if ("destination" in input) { assignments.push("destination = ?"); values.push(input.destination ?? null); }
    if ("memberType" in input) { assignments.push("member_type = ?"); values.push(input.memberType ?? "formal"); }
    if ("groupRole" in input) { assignments.push("group_role = ?"); values.push(input.groupRole ?? null); }
    if ("motto" in input) { assignments.push("motto = ?"); values.push(input.motto || null); }
    if ("coverTheme" in input) { assignments.push("cover_theme = ?"); values.push(input.coverTheme ?? null); }
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

  async updateMentoredStudent(mentorId: string, personId: string, input: {
    version: number;
    name?: string;
    cohortYear?: number | null;
    memberType?: Person["memberType"];
    groupRole?: Person["groupRole"];
    status?: Person["status"];
  }) {
    const assignments: string[] = [];
    const values: unknown[] = [];
    if (input.name !== undefined) { assignments.push("name = ?"); values.push(input.name.trim()); }
    if ("cohortYear" in input) { assignments.push("cohort_year = ?, cohort_id = NULL"); values.push(input.cohortYear ?? null); }
    if (input.memberType !== undefined) { assignments.push("member_type = ?"); values.push(input.memberType); }
    if ("groupRole" in input) { assignments.push("group_role = ?"); values.push(input.groupRole ?? null); }
    if (input.status !== undefined) { assignments.push("status = ?"); values.push(input.status); }
    if (!assignments.length) return null;
    assignments.push("version = version + 1", "updated_at = datetime('now')");
    const result = await this.db.prepare(`
      UPDATE people SET ${assignments.join(", ")}
      WHERE id = ? AND mentor_id = ? AND version = ?
    `).bind(...values, personId, mentorId, input.version).run();
    if ((result.meta.changes ?? 0) === 0) return null;
    if (input.name !== undefined) {
      await this.db.prepare("UPDATE users SET display_name = ?, updated_at = datetime('now') WHERE person_id = ?")
        .bind(input.name.trim(), personId).run();
    }
    return this.personDetail(personId);
  }

  /** Direct students of a mentor with account and claim state for the student studio. */
  async listStudents(mentorId: string, now = Date.now()) {
    const rows = await this.db.prepare(`
      SELECT p.id AS person_id, p.name, p.member_type, p.status, p.cohort_year, p.version, p.created_at, p.joined_at,
        p.destination, p.group_role, p.role,
        c.expires_at, c.claimed_at,
        u.id AS account_id, u.email, u.phone, u.status AS account_status, u.must_change_password, u.activated_at,
        (SELECT COUNT(*) FROM people s WHERE s.mentor_id = p.id) AS student_count,
        (SELECT a.id FROM attachments a WHERE a.person_id = p.id AND a.category = 'avatar' AND a.status = 'ready' ORDER BY a.created_at DESC LIMIT 1) AS avatar_id
      FROM people p
      LEFT JOIN person_claims c ON c.person_id = p.id
      LEFT JOIN users u ON u.person_id = p.id
      WHERE p.mentor_id = ?
      ORDER BY p.created_at DESC
    `).bind(mentorId).all<{
      person_id: string; name: string; member_type: Person["memberType"]; status: Person["status"]; cohort_year: number | null;
      version: number; created_at: string; joined_at: string | null; destination: Person["destination"]; group_role: Person["groupRole"]; role: string;
      expires_at: string | null; claimed_at: string | null;
      account_id: string | null; email: string | null; phone: string | null; account_status: "active" | "disabled" | null;
      must_change_password: number | null; activated_at: string | null; student_count: number; avatar_id: string | null;
    }>();
    return rows.results.map((row) => {
      const claimState = row.expires_at === null ? null : row.claimed_at ? "claimed" : Date.parse(row.expires_at) <= now ? "expired" : "pending";
      const activated = Boolean(row.activated_at);
      return {
        personId: row.person_id,
        name: row.name,
        memberType: row.member_type,
        status: row.status,
        groupRole: row.group_role ?? null,
        destination: row.destination,
        role: row.role,
        version: row.version,
        cohort: row.cohort_year ? { id: `cohort-${row.cohort_year}`, label: `${row.cohort_year}级`, year: row.cohort_year } : null,
        avatarUrl: row.avatar_id ? `/api/attachments/${row.avatar_id}` : null,
        studentCount: Number(row.student_count ?? 0),
        createdAt: row.created_at,
        joinedAt: row.joined_at ?? row.created_at.slice(0, 10),
        expiresAt: row.expires_at ?? "",
        claimedAt: row.claimed_at,
        account: row.account_id ? {
          identifier: row.email ?? row.phone ?? row.name,
          status: row.account_status ?? "active",
          activated,
          mustChangePassword: Boolean(row.must_change_password),
          canResetPassword: !activated && row.account_status === "active",
        } : null,
        claim: claimState ? { state: claimState, expiresAt: row.expires_at } : null,
        // Legacy summary kept for older clients of /me/placeholder-students.
        state: row.email || row.phone ? "account-created" : row.claimed_at ? "claimed" : row.expires_at && Date.parse(row.expires_at) <= now ? "expired" : "pending",
      };
    });
  }

  /**
   * A mentor may re-issue the initial password only while the delegated account has never
   * been activated by its owner. Once the student sets a password the mentor loses this ability.
   */
  async resetStudentInitialPassword(mentorId: string, personId: string) {
    const account = await this.db.prepare(`
      SELECT u.id, u.email, u.phone, p.name
      FROM users u JOIN people p ON p.id = u.person_id
      WHERE u.person_id = ? AND p.mentor_id = ? AND u.status = 'active' AND u.activated_at IS NULL
    `).bind(personId, mentorId).first<{ id: string; email: string | null; phone: string | null; name: string }>();
    if (!account) return { state: "not-allowed" } as const;
    const temporaryPassword = `X${crypto.randomUUID().replace(/-/g, "").slice(0, 11)}!`;
    const credentials = await createPasswordFields(temporaryPassword);
    const result = await this.db.batch([
      this.db.prepare(`UPDATE users SET password_salt = ?, password_hash = ?, must_change_password = 1, updated_at = datetime('now')
        WHERE id = ? AND activated_at IS NULL`).bind(credentials.passwordSalt, credentials.passwordHash, account.id),
      this.db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(account.id),
    ]);
    if ((result[0]?.meta.changes ?? 0) === 0) return { state: "not-allowed" } as const;
    return { state: "reset", account: { identifier: account.email ?? account.phone ?? account.name, temporaryPassword, mustChangePassword: true } } as const;
  }

  async listMentorInvites(mentorId: string, now = Date.now()) {
    const rows = await this.db.prepare(`
      SELECT i.token_hash AS id, i.created_at, i.expires_at, i.accepted_at, i.revoked_at,
        i.accepted_person_id, p.name AS accepted_name
      FROM invitations i LEFT JOIN people p ON p.id = i.accepted_person_id
      WHERE i.mentor_id = ?
      ORDER BY i.created_at DESC
      LIMIT 50
    `).bind(mentorId).all<{ id: string; created_at: string; expires_at: string; accepted_at: string | null; revoked_at: string | null; accepted_person_id: string | null; accepted_name: string | null }>();
    return rows.results.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      acceptedAt: row.accepted_at,
      revokedAt: row.revoked_at,
      acceptedPerson: row.accepted_person_id ? { id: row.accepted_person_id, name: row.accepted_name ?? "" } : null,
      state: row.revoked_at ? "revoked" : row.accepted_at ? "accepted" : Date.parse(row.expires_at) <= now ? "expired" : "pending",
    }));
  }

  async revokeMentorInvite(mentorId: string, inviteId: string, actorUserId: string) {
    const result = await this.db.prepare(`
      UPDATE invitations SET revoked_at = datetime('now'), revoked_by_user_id = ?, expires_at = ?
      WHERE token_hash = ? AND mentor_id = ? AND accepted_at IS NULL AND revoked_at IS NULL
    `).bind(actorUserId, new Date().toISOString(), inviteId, mentorId).run();
    return (result.meta.changes ?? 0) > 0;
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

  async createPlaceholder(mentorId: string, createdByUserId: string, input: {
    name: string;
    loginIdentifier: string | null;
    cohortYear: number | null;
    memberType: "formal" | "probationary";
    joinedAt: string | null;
  }, now = Date.now(), allowNonLineage = false) {
    const mentor = await this.db.prepare("SELECT id, relation_scope FROM people WHERE id = ?")
      .bind(mentorId).first<{ id: string; relation_scope: string }>();
    if (!mentor) return { state: "mentor-not-found" } as const;
    // Administrators may manage the tree even when their own profile is a
    // cohort guest (the bootstrap account is intentionally kept outside the
    // lineage). Regular members remain restricted to lineage mentors.
    if (mentor.relation_scope !== "lineage" && !allowNonLineage) return { state: "mentor-not-lineage" } as const;
    const personId = `placeholder-${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const supplied = input.loginIdentifier?.trim() ?? "";
    const isEmail = supplied.includes("@");
    const normalizedPhone = normalizePhone(supplied);
    const isPhone = !isEmail && /^\+?\d{6,20}$/.test(normalizedPhone);
    if (supplied && !isEmail && !isPhone) return { state: "invalid-identifier" } as const;
    const email = isEmail ? normalizeEmail(supplied) : null;
    const phone = isPhone ? normalizedPhone : null;
    const duplicate = await this.db.prepare("SELECT id FROM users WHERE (email IS NOT NULL AND lower(email) = ?) OR (phone IS NOT NULL AND phone = ?)")
      .bind(email, phone).first<{ id: string }>();
    if (duplicate) return { state: "identifier-conflict" } as const;
    const accountId = `account-${crypto.randomUUID()}`;
    const temporaryPassword = `X${crypto.randomUUID().replace(/-/g, "").slice(0, 11)}!`;
    const credentials = await createPasswordFields(temporaryPassword);
    const identifier = email ?? phone ?? input.name.trim();
    const claimToken = createOpaqueToken("claim");
    const claimTokenHash = await hashToken(claimToken);
    const claimCreatedAt = new Date(now).toISOString();
    const claimExpiresAt = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
    await this.db.batch([
      this.db.prepare(`
        INSERT INTO people (
          id, name, nickname, mentor_id, cohort_id, cohort_year, relation_scope, bio,
          is_featured, status, member_type, role, joined_at, tags_json
        ) VALUES (?, ?, NULL, ?, NULL, ?, 'lineage', ?, 0, 'active', ?, '待认领成员', ?, '[]')
      `).bind(personId, input.name, mentorId, input.cohortYear,
        "这个节点由师傅代为保留，等待本人接手账号。", input.memberType, input.joinedAt),
      this.db.prepare(`INSERT INTO users (id, person_id, role, status, email, phone, display_name, password_salt, password_hash, must_change_password)
        VALUES (?, ?, 'member', 'active', ?, ?, ?, ?, ?, 1)`)
        .bind(accountId, personId, email, phone, input.name.trim(), credentials.passwordSalt, credentials.passwordHash),
      this.db.prepare(`INSERT INTO person_claims (token_hash, person_id, created_by_user_id, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)`)
        .bind(claimTokenHash, personId, createdByUserId, claimExpiresAt, claimCreatedAt),
    ]);
    const person = await this.personDetail(personId);
    return { state: "created", personId, person, token: claimToken, expiresAt: claimExpiresAt, account: { identifier, temporaryPassword, mustChangePassword: true } } as const;
  }

  async listPlaceholders(mentorId: string) {
    return this.listStudents(mentorId);
  }

  async rotatePlaceholderClaim(mentorId: string, personId: string, now = Date.now(), ttlMs = 30 * 24 * 60 * 60 * 1000) {
    const row = await this.db.prepare(`
      SELECT c.token_hash, c.claimed_at
      FROM person_claims c JOIN people p ON p.id = c.person_id
      WHERE c.person_id = ? AND p.mentor_id = ?
    `).bind(personId, mentorId).first<{ token_hash: string; claimed_at: string | null }>();
    if (!row) return { state: "not-found" } as const;
    if (row.claimed_at) return { state: "claimed" } as const;
    const token = createOpaqueToken("claim");
    const tokenHash = await hashToken(token);
    const expiresAt = new Date(now + ttlMs).toISOString();
    const result = await this.db.prepare(`UPDATE person_claims SET token_hash = ?, expires_at = ?, created_at = ?, claimed_at = NULL, claimed_by_user_id = NULL WHERE token_hash = ? AND claimed_at IS NULL`)
      .bind(tokenHash, expiresAt, new Date(now).toISOString(), row.token_hash).run();
    if ((result.meta.changes ?? 0) === 0) return { state: "claimed" } as const;
    return { state: "rotated", token, expiresAt } as const;
  }

  async inspectClaim(token: string, now = Date.now()): Promise<ClaimInspection> {
    const row = await this.db.prepare(`
      SELECT token_hash, person_id, created_by_user_id, created_at, expires_at, claimed_at, claimed_by_user_id
      FROM person_claims WHERE token_hash = ?
    `).bind(await hashToken(token)).first<ClaimRow>();
    if (!row) return { state: "missing", claim: null, person: null };
    const record: PersonClaim = { token, personId: row.person_id, createdAt: row.created_at, expiresAt: row.expires_at, claimedAt: row.claimed_at };
    const person = await this.personDetail(row.person_id);
    if (!person) return { state: "missing", claim: null, person: null };
    if (row.claimed_at) return { state: "claimed", claim: record, person };
    if (Date.parse(row.expires_at) <= now) return { state: "expired", claim: record, person };
    return { state: "pending", claim: record, person };
  }

  async claimPlaceholder(token: string, input: { name?: string; nickname?: string | null; email: string | null; phone?: string | null; password: string }, now = Date.now()) {
    const inspected = await this.inspectClaim(token, now);
    if (inspected.state !== "pending") return { state: inspected.state, claim: inspected.claim, person: inspected.person, session: null } as const;
    const email = input.email ? normalizeEmail(input.email) : null;
    const phone = input.phone ? normalizePhone(input.phone) : null;
    const existing = await this.db.prepare("SELECT id, person_id FROM users WHERE lower(email) = ? OR (? IS NOT NULL AND phone = ?) OR person_id = ?")
      .bind(email, phone, phone, inspected.claim.personId).first<{ id: string; person_id: string }>();
    if (existing && existing.person_id !== inspected.claim.personId) return { state: "email-conflict", claim: inspected.claim, person: inspected.person, session: null } as const;
    const accountId = existing?.id ?? `account-${crypto.randomUUID()}`;
    const credentials = await createPasswordFields(input.password);
    const sessionToken = createOpaqueToken("session");
    const sessionTokenHash = await hashToken(sessionToken);
    const claimTokenHash = await hashToken(token);
    const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
    const displayName = input.name?.trim() || inspected.person.name;
    const claimedAt = new Date(now).toISOString();
    const claimResult = await this.db.prepare(`UPDATE person_claims SET claimed_at = ?, claimed_by_user_id = ?
      WHERE token_hash = ? AND claimed_at IS NULL AND expires_at > ?`)
      .bind(claimedAt, accountId, claimTokenHash, claimedAt).run();
    if ((claimResult.meta.changes ?? 0) === 0) {
      return { state: "claimed", claim: inspected.claim, person: inspected.person, session: null } as const;
    }
    try {
      await this.db.batch([
        this.db.prepare(`UPDATE people SET name = ?, role = '星谱成员', version = version + 1, updated_at = datetime('now') WHERE id = ?`)
          .bind(displayName, inspected.claim.personId),
        existing
          ? this.db.prepare(`UPDATE users SET email = ?, phone = ?, display_name = ?, password_salt = ?, password_hash = ?, must_change_password = 0, activated_at = COALESCE(activated_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`)
            .bind(email, phone, displayName, credentials.passwordSalt, credentials.passwordHash, accountId)
          : this.db.prepare(`INSERT INTO users (id, person_id, role, status, email, phone, display_name, password_salt, password_hash, activated_at)
            VALUES (?, ?, 'member', 'active', ?, ?, ?, ?, ?, datetime('now'))`)
            .bind(accountId, inspected.claim.personId, email, phone, displayName, credentials.passwordSalt, credentials.passwordHash),
        this.db.prepare("INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
          .bind(sessionTokenHash, accountId, expiresAt),
      ]);
    } catch (error) {
      await this.db.prepare("UPDATE person_claims SET claimed_at = NULL, claimed_by_user_id = NULL WHERE token_hash = ? AND claimed_by_user_id = ?")
        .bind(claimTokenHash, accountId).run();
      if (String(error).toLocaleLowerCase().includes("unique")) return { state: "email-conflict", claim: inspected.claim, person: inspected.person, session: null } as const;
      throw error;
    }
    const account: AccountRow = {
      id: accountId, email, phone, display_name: displayName, person_id: inspected.claim.personId,
      role: "member", password_salt: credentials.passwordSalt, password_hash: credentials.passwordHash, must_change_password: 0,
    };
    const profile = await this.personDetail(inspected.claim.personId);
    return { state: "claimed-now", claim: { ...inspected.claim, claimedAt }, person: profile, session: { token: sessionToken, expiresAt, user: publicUser(account) } satisfies Session } as const;
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

  async acceptInvite(token: string, input: { name: string; nickname: string | null; email: string | null; phone?: string | null; password: string }, now = Date.now()) {
    const inspected = await this.inspectInvite(token, now);
    if (inspected.state !== "pending") return { state: inspected.state, record: inspected.record, session: null } as const;
    const tokenHash = await hashToken(token);
    const personId = `invited-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const session = await this.register({
      displayName: input.name,
      email: input.email,
      phone: input.phone,
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
