import { Hono } from "hono";
import { POST_IMAGE_LIMITS, postInputSchema, postUpdateSchema } from "../../../packages/shared/src/schemas.ts";
import type { PostKind, PostStatus } from "../../../packages/shared/src/types.ts";
import { persistence, type ContentViewer } from "./persistence.ts";
import type { Env } from "./types.ts";

// 动态只出现在作者本人的主页；公开动态匿名可读，成员动态需要登录，草稿只有作者本人可见。
type PostRow = {
  id: string; personId: string; title: string | null; content: string; visibility: "public" | "members";
  kind: PostKind; status: PostStatus; publishedAt: string | null;
  isPinned: number; version: number; createdAt: string; updatedAt: string; likeCount: number; liked: number;
};

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const PAGE_MAX = 30;

const error = (status: 400 | 401 | 404 | 409 | 413 | 415 | 503, code: string, message: string) =>
  new Response(JSON.stringify({ error: { code, message } }), { status, headers: { "Content-Type": "application/json" } });

export class PostStore {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  private async hydrate(rows: PostRow[]) {
    if (!rows.length) return [];
    const placeholders = rows.map(() => "?").join(", ");
    const images = await this.db.prepare(`SELECT id, post_id AS postId FROM attachments
      WHERE post_id IN (${placeholders}) AND status = 'ready' ORDER BY created_at, id`)
      .bind(...rows.map((row) => row.id)).all<{ id: string; postId: string }>();
    return rows.map((row) => ({
      id: row.id,
      personId: row.personId,
      title: row.title,
      content: row.content,
      visibility: row.visibility,
      kind: row.kind,
      status: row.status ?? "published",
      publishedAt: row.publishedAt ?? null,
      isPinned: Boolean(row.isPinned),
      images: images.results.filter((image) => image.postId === row.id).map((image) => ({ id: image.id, url: `/api/attachments/${image.id}` })),
      likeCount: Number(row.likeCount ?? 0),
      likedByViewer: Boolean(row.liked),
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  private select(where: string) {
    return `SELECT p.id, p.person_id AS personId, p.title, p.content, p.visibility, p.kind, p.status, p.published_at AS publishedAt, p.is_pinned AS isPinned, p.version,
        p.created_at AS createdAt, p.updated_at AS updatedAt,
        (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS likeCount,
        (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked
      FROM posts p WHERE ${where}`;
  }

  async list(personId: string, viewer: ContentViewer | undefined, offset: number, limit: number) {
    const canViewMembers = Boolean(viewer?.userId);
    const rows = await this.db.prepare(`${this.select("p.person_id = ? AND p.status = 'published' AND (p.visibility = 'public' OR ? = 1)")}
      ORDER BY p.is_pinned DESC, p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`)
      .bind(viewer?.userId ?? "", personId, canViewMembers ? 1 : 0, limit + 1, offset).all<PostRow>();
    const items = await this.hydrate(rows.results.slice(0, limit));
    return { items, hasMore: rows.results.length > limit };
  }

  async get(id: string, viewerUserId = "") {
    const row = await this.db.prepare(this.select("p.id = ?")).bind(viewerUserId, id).first<PostRow>();
    return row ? (await this.hydrate([row]))[0] : null;
  }

  /** A single post for reading: drafts only for their author, member posts only for signed-in viewers. */
  async readable(id: string, viewer: ContentViewer | undefined) {
    const post = await this.get(id, viewer?.userId ?? "");
    if (!post) return null;
    if (post.status === "draft") return viewer?.personId === post.personId ? post : null;
    if (post.visibility === "members" && !viewer?.userId) return null;
    return post;
  }

  async drafts(personId: string) {
    const rows = await this.db.prepare(`${this.select("p.person_id = ? AND p.status = 'draft'")} ORDER BY p.updated_at DESC, p.id DESC LIMIT 50`)
      .bind("", personId).all<PostRow>();
    return this.hydrate(rows.results);
  }

  private async storeImages(personId: string, postId: string, files: File[], bucket: R2Bucket) {
    const stored: string[] = [];
    try {
      for (const file of files) {
        const id = `attachment-${crypto.randomUUID()}`;
        const objectKey = `people/${personId}/posts/${postId}/${id}`;
        const body = await file.arrayBuffer();
        await bucket.put(objectKey, body, { httpMetadata: { contentType: file.type } });
        stored.push(objectKey);
        await this.db.prepare(`INSERT INTO attachments (id, person_id, post_id, object_key, original_name, mime_type, size, category, visibility, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'other', 'members', 'ready', ?)`)
          .bind(id, personId, postId, objectKey, file.name.slice(0, 200) || "image", file.type, body.byteLength, new Date().toISOString()).run();
      }
    } catch (cause) {
      await Promise.all(stored.map((key) => bucket.delete(key).catch(() => undefined)));
      if (stored.length) {
        await this.db.prepare(`UPDATE attachments SET status = 'deleted' WHERE post_id = ? AND object_key IN (${stored.map(() => "?").join(", ")})`)
          .bind(postId, ...stored).run().catch(() => undefined);
      }
      throw cause;
    }
  }

  async create(personId: string, input: { kind: PostKind; title?: string | null; content: string; visibility: "public" | "members"; status?: PostStatus }, files: File[], bucket: R2Bucket | undefined) {
    const id = `post-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const status = input.status ?? "published";
    await this.db.prepare(`INSERT INTO posts (id, person_id, title, content, visibility, kind, status, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, personId, input.title?.trim() || null, input.content, input.visibility, input.kind, status, status === "published" ? now : null, now, now).run();
    if (files.length && bucket) {
      try {
        await this.storeImages(personId, id, files, bucket);
      } catch (cause) {
        await this.db.prepare("DELETE FROM posts WHERE id = ?").bind(id).run();
        throw cause;
      }
    }
    return this.get(id);
  }

  async update(personId: string, id: string, input: { version: number; kind?: PostKind; title?: string | null; content?: string; visibility?: "public" | "members"; isPinned?: boolean; status?: PostStatus; publishNow?: boolean }) {
    const assignments: string[] = [];
    const values: unknown[] = [];
    if ("title" in input) { assignments.push("title = ?"); values.push(input.title?.trim() || null); }
    if (input.kind !== undefined) { assignments.push("kind = ?"); values.push(input.kind); }
    if (input.content !== undefined) { assignments.push("content = ?"); values.push(input.content); }
    if (input.visibility !== undefined) { assignments.push("visibility = ?"); values.push(input.visibility); }
    if (input.isPinned !== undefined) { assignments.push("is_pinned = ?"); values.push(input.isPinned ? 1 : 0); }
    const now = new Date().toISOString();
    if (input.status !== undefined) { assignments.push("status = ?"); values.push(input.status); }
    // Publishing a draft dates the post from the moment it goes live, so it lands at the top of the feed.
    if (input.publishNow) { assignments.push("published_at = ?", "created_at = ?"); values.push(now, now); }
    if (!assignments.length) return null;
    assignments.push("version = version + 1", "updated_at = ?");
    values.push(now);
    const statements = [
      this.db.prepare(`UPDATE posts SET ${assignments.join(", ")} WHERE id = ? AND person_id = ? AND version = ?`).bind(...values, id, personId, input.version),
    ];
    // 置顶是唯一的：置顶一条动态会取消同一主页上的其它置顶。
    if (input.isPinned) statements.unshift(this.db.prepare(`UPDATE posts SET is_pinned = 0
      WHERE person_id = ? AND id <> ? AND is_pinned = 1
        AND EXISTS (SELECT 1 FROM posts target WHERE target.id = ? AND target.person_id = ? AND target.version = ?)`)
      .bind(personId, id, id, personId, input.version));
    const results = await this.db.batch(statements);
    if ((results[results.length - 1]?.meta.changes ?? 0) === 0) return null;
    return this.get(id);
  }

  async remove(personId: string, id: string, bucket: R2Bucket | undefined) {
    const objects = await this.db.prepare("SELECT object_key AS objectKey FROM attachments WHERE post_id = ? AND person_id = ? AND status <> 'deleted'")
      .bind(id, personId).all<{ objectKey: string }>();
    const results = await this.db.batch([
      this.db.prepare("UPDATE attachments SET status = 'deleted', updated_at = datetime('now') WHERE post_id = ? AND person_id = ?").bind(id, personId),
      this.db.prepare("DELETE FROM posts WHERE id = ? AND person_id = ?").bind(id, personId),
    ]);
    if ((results[1]?.meta.changes ?? 0) === 0) return false;
    if (bucket && objects.results.length) await bucket.delete(objects.results.map((item) => item.objectKey)).catch(() => undefined);
    return true;
  }

  async owned(personId: string, id: string) {
    return this.db.prepare("SELECT id, version, kind, content, status FROM posts WHERE id = ? AND person_id = ?").bind(id, personId).first<{ id: string; version: number; kind: PostKind; content: string; status: PostStatus }>();
  }

  async imageCount(id: string) {
    const row = await this.db.prepare("SELECT COUNT(*) AS count FROM attachments WHERE post_id = ? AND status = 'ready'").bind(id).first<{ count: number }>();
    return Number(row?.count ?? 0);
  }

  async addImages(personId: string, id: string, files: File[], bucket: R2Bucket) {
    await this.storeImages(personId, id, files, bucket);
    await this.db.prepare("UPDATE posts SET version = version + 1, updated_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
    return this.get(id);
  }

  async removeImage(personId: string, postId: string, attachmentId: string, bucket: R2Bucket | undefined) {
    const image = await this.db.prepare("SELECT object_key AS objectKey FROM attachments WHERE id = ? AND post_id = ? AND person_id = ? AND status = 'ready'")
      .bind(attachmentId, postId, personId).first<{ objectKey: string }>();
    if (!image) return null;
    await this.db.batch([
      this.db.prepare("UPDATE attachments SET status = 'deleted', updated_at = datetime('now') WHERE id = ?").bind(attachmentId),
      this.db.prepare("UPDATE posts SET version = version + 1, updated_at = ? WHERE id = ?").bind(new Date().toISOString(), postId),
    ]);
    await bucket?.delete(image.objectKey).catch(() => undefined);
    return this.get(postId);
  }

  async setLike(postId: string, userId: string, liked: boolean) {
    const post = await this.db.prepare("SELECT id FROM posts WHERE id = ? AND status = 'published'").bind(postId).first();
    if (!post) return null;
    await (liked
      ? this.db.prepare("INSERT OR IGNORE INTO post_likes (post_id, user_id) VALUES (?, ?)").bind(postId, userId)
      : this.db.prepare("DELETE FROM post_likes WHERE post_id = ? AND user_id = ?").bind(postId, userId)).run();
    const count = await this.db.prepare("SELECT COUNT(*) AS count FROM post_likes WHERE post_id = ?").bind(postId).first<{ count: number }>();
    return { likeCount: Number(count?.count ?? 0), likedByViewer: liked };
  }
}

function imageFiles(value: unknown) {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return list.filter((item): item is File => item instanceof File && item.size > 0);
}

function imageProblem(files: File[], kind: PostKind, existing = 0) {
  const limit = POST_IMAGE_LIMITS[kind];
  if (files.length + existing > limit) return error(400, "TOO_MANY_IMAGES", `${kind === "experience" ? "经验分享" : "随手记"}最多 ${limit} 张图片`);
  if (files.some((file) => !IMAGE_TYPES.has(file.type))) return error(415, "UNSUPPORTED_MEDIA_TYPE", "动态图片仅支持 JPG、PNG 或 WebP");
  if (files.some((file) => file.size > IMAGE_MAX_BYTES)) return error(413, "FILE_TOO_LARGE", "单张图片不能超过 5 MB");
  return null;
}

async function currentSession(c: { env: Env; req: { header: (name: string) => string | undefined } }) {
  if (!c.env?.DB) return null;
  return persistence(c.env.DB).session(c.req.header("Authorization"));
}

/** `GET /api/people/:id/posts` */
export async function listPersonPosts(c: any) {
  if (!c.env?.DB) return error(503, "DATABASE_UNAVAILABLE", "内容数据库未配置");
  const offset = Math.max(0, Number.parseInt(c.req.query("offset") ?? "0", 10) || 0);
  const limit = Math.min(PAGE_MAX, Math.max(1, Number.parseInt(c.req.query("limit") ?? "10", 10) || 10));
  const session = await currentSession(c);
  const viewer = session ? { userId: session.user.id, personId: session.user.personId, role: session.user.role } : undefined;
  const result = await new PostStore(c.env.DB).list(c.req.param("id"), viewer, offset, limit);
  return c.json({ data: result.items, meta: { offset, limit, hasMore: result.hasMore } });
}

/** `GET /api/posts/:id` */
export async function readPost(c: any) {
  if (!c.env?.DB) return error(503, "DATABASE_UNAVAILABLE", "内容数据库未配置");
  const session = await currentSession(c);
  const viewer = session ? { userId: session.user.id, personId: session.user.personId, role: session.user.role } : undefined;
  const post = await new PostStore(c.env.DB).readable(c.req.param("id"), viewer);
  if (!post) return error(session ? 404 : 401, session ? "POST_NOT_FOUND" : "UNAUTHENTICATED", session ? "动态不存在或不可见" : "动态不存在，或需要登录后查看");
  return c.json({ data: post });
}

export const myPostsApi = new Hono<{ Bindings: Env }>();

myPostsApi.get("/drafts", async (c) => {
  const session = await currentSession(c);
  if (!session) return error(401, "UNAUTHENTICATED", "请先登录");
  const drafts = await new PostStore(c.env.DB!).drafts(session.user.personId);
  return c.json({ data: drafts, meta: { total: drafts.length } });
});

myPostsApi.post("/", async (c) => {
  const session = await currentSession(c);
  if (!session) return error(401, "UNAUTHENTICATED", "请先登录");
  const form = await c.req.parseBody({ all: true }).catch(() => null);
  if (!form) return error(400, "VALIDATION_ERROR", "动态内容无效");
  const parsed = postInputSchema.safeParse({
    kind: typeof form.kind === "string" ? form.kind : undefined,
    title: typeof form.title === "string" ? form.title : undefined,
    content: typeof form.content === "string" ? form.content : "",
    visibility: typeof form.visibility === "string" ? form.visibility : undefined,
    status: typeof form.status === "string" ? form.status : undefined,
  });
  if (!parsed.success) return error(400, "VALIDATION_ERROR", "请检查动态类型和正文长度（随手记最多 10000 字，经验分享最多 100000 字）");
  const files = imageFiles(form.images);
  const problem = imageProblem(files, parsed.data.kind);
  if (problem) return problem;
  if (files.length && !c.env.FILES) return error(503, "R2_REQUIRED", "图片存储尚未配置");
  const post = await new PostStore(c.env.DB!).create(session.user.personId, parsed.data, files, c.env.FILES);
  return c.json({ data: post }, 201);
});

myPostsApi.patch("/:id", async (c) => {
  const session = await currentSession(c);
  if (!session) return error(401, "UNAUTHENTICATED", "请先登录");
  const parsed = postUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return error(400, "VALIDATION_ERROR", "动态内容无效");
  const store = new PostStore(c.env.DB!);
  const existing = await store.owned(session.user.personId, c.req.param("id"));
  if (!existing) return error(404, "POST_NOT_FOUND", "动态不存在");
  const effectiveKind = parsed.data.kind ?? existing.kind;
  const effectiveContent = parsed.data.content ?? existing.content;
  const effectiveStatus = parsed.data.status ?? existing.status ?? "published";
  if (effectiveKind === "note" && effectiveContent.length > 10_000) return error(400, "VALIDATION_ERROR", "随手记正文不能超过 10000 字");
  if (effectiveStatus === "published" && !effectiveContent.trim()) return error(400, "VALIDATION_ERROR", "正文不能为空");
  if (existing.status === "published" && parsed.data.status === "draft") return error(409, "ALREADY_PUBLISHED", "已发布的动态不能退回草稿");
  if (effectiveStatus === "draft" && parsed.data.isPinned) return error(409, "DRAFT_NOT_PINNABLE", "草稿不能置顶");
  if (await store.imageCount(existing.id) > POST_IMAGE_LIMITS[effectiveKind]) return error(400, "TOO_MANY_IMAGES", `切换为随手记前请将图片减少到 ${POST_IMAGE_LIMITS[effectiveKind]} 张以内`);
  const publishNow = existing.status === "draft" && parsed.data.status === "published";
  const post = await store.update(session.user.personId, c.req.param("id"), { ...parsed.data, publishNow });
  if (!post) return error(409, "VERSION_CONFLICT", "动态不存在或已被更新，请刷新后重试");
  return c.json({ data: post });
});

myPostsApi.delete("/:id", async (c) => {
  const session = await currentSession(c);
  if (!session) return error(401, "UNAUTHENTICATED", "请先登录");
  if (!await new PostStore(c.env.DB!).remove(session.user.personId, c.req.param("id"), c.env.FILES)) return error(404, "POST_NOT_FOUND", "动态不存在");
  return c.body(null, 204);
});

myPostsApi.post("/:id/images", async (c) => {
  const session = await currentSession(c);
  if (!session) return error(401, "UNAUTHENTICATED", "请先登录");
  if (!c.env.FILES) return error(503, "R2_REQUIRED", "图片存储尚未配置");
  const store = new PostStore(c.env.DB!);
  const id = c.req.param("id");
  const post = await store.owned(session.user.personId, id);
  if (!post) return error(404, "POST_NOT_FOUND", "动态不存在");
  const form = await c.req.parseBody({ all: true }).catch(() => null);
  const files = imageFiles(form?.images);
  if (!files.length) return error(400, "FILE_REQUIRED", "请选择图片");
  const problem = imageProblem(files, post.kind, await store.imageCount(id));
  if (problem) return problem;
  return c.json({ data: await store.addImages(session.user.personId, id, files, c.env.FILES) }, 201);
});

myPostsApi.delete("/:id/images/:attachmentId", async (c) => {
  const session = await currentSession(c);
  if (!session) return error(401, "UNAUTHENTICATED", "请先登录");
  const post = await new PostStore(c.env.DB!).removeImage(session.user.personId, c.req.param("id"), c.req.param("attachmentId"), c.env.FILES);
  if (!post) return error(404, "IMAGE_NOT_FOUND", "图片不存在");
  return c.json({ data: post });
});

export const postReactionsApi = new Hono<{ Bindings: Env }>();

postReactionsApi.get("/:id", readPost);

for (const [method, liked] of [["put", true], ["delete", false]] as const) {
  postReactionsApi[method]("/:id/like", async (c) => {
    const session = await currentSession(c);
    if (!session) return error(401, "UNAUTHENTICATED", "登录后才能点亮动态");
    const result = await new PostStore(c.env.DB!).setLike(c.req.param("id"), session.user.id, liked);
    if (!result) return error(404, "POST_NOT_FOUND", "动态不存在");
    return c.json({ data: result });
  });
}
