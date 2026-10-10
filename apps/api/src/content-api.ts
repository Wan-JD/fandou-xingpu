import { Hono } from "hono";
import { achievementInputSchema } from "../../../packages/shared/src/schemas.ts";
import { persistence } from "./persistence.ts";
import type { Env } from "./types.ts";

const error = (status: 400 | 401 | 404 | 409 | 413 | 415 | 503, code: string, message: string) =>
  new Response(JSON.stringify({ error: { code, message } }), { status, headers: { "Content-Type": "application/json" } });

const contentApi = new Hono<{ Bindings: Env }>();

async function session(c: any) {
  if (!c.env?.DB) return null;
  return persistence(c.env.DB).session(c.req.header("Authorization"));
}

contentApi.post("/achievements", async (c) => {
  const current = await session(c);
  if (!current) return error(401, "UNAUTHENTICATED", "请先登录");
  const parsed = achievementInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return error(400, "VALIDATION_ERROR", "事迹内容无效");
  const item = await persistence(c.env.DB!).createAchievement(current.user.personId, parsed.data);
  return c.json({ data: item, meta: { demo: false } }, 201);
});

contentApi.patch("/achievements/:id", async (c) => {
  const current = await session(c);
  if (!current) return error(401, "UNAUTHENTICATED", "请先登录");
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const version = Number(body?.version);
  if (!Number.isInteger(version) || version < 1) return error(400, "VERSION_REQUIRED", "缺少版本");
  const validKind = body?.kind === undefined || body.kind === "achievement" || body.kind === "honor";
  const validTitle = body?.title === undefined || (typeof body.title === "string" && body.title.trim().length > 0 && body.title.trim().length <= 200);
  const validContent = body?.content === undefined || (typeof body.content === "string" && body.content.trim().length > 0 && body.content.trim().length <= 20_000);
  if (!validKind || !validTitle || !validContent) return error(400, "VALIDATION_ERROR", "事迹内容无效");
  const item = await persistence(c.env.DB!).updateAchievement(current.user.personId, c.req.param("id"), version, {
    ...(body?.kind !== undefined ? { kind: body.kind as string } : {}),
    ...(body?.title !== undefined ? { title: String(body.title).trim() } : {}),
    ...(body?.content !== undefined ? { content: String(body.content).trim() } : {}),
    ...(body?.occurredOn !== undefined ? { occurredOn: body.occurredOn as string | null } : {}),
    ...(body?.datePrecision !== undefined ? { datePrecision: body.datePrecision as string | null } : {}),
  });
  if (!item) return error(409, "VERSION_CONFLICT", "事迹已更新，请刷新后重试");
  return c.json({ data: item, meta: { demo: false } });
});

contentApi.delete("/achievements/:id", async (c) => {
  const current = await session(c);
  if (!current) return error(401, "UNAUTHENTICATED", "请先登录");
  const version = Number(c.req.query("version"));
  if (!Number.isInteger(version) || version < 1) return error(400, "VERSION_REQUIRED", "缺少版本");
  if (!await persistence(c.env.DB!).deleteAchievement(current.user.personId, c.req.param("id"), version)) return error(409, "VERSION_CONFLICT", "事迹已更新，请刷新后重试");
  return c.body(null, 204);
});

contentApi.post("/attachments", async (c) => {
  const current = await session(c);
  if (!current) return error(401, "UNAUTHENTICATED", "请先登录");
  if (!c.env.FILES) return error(503, "R2_REQUIRED", "附件存储尚未配置");
  const form = await c.req.parseBody();
  const file = form.file;
  const category = typeof form.category === "string" ? form.category : "other";
  const visibility = typeof form.visibility === "string" ? form.visibility : "members";
  if (!(file instanceof File)) return error(400, "FILE_REQUIRED", "请选择文件");
  const allowed = new Set(["avatar", "resume", "photo", "certificate", "other"]);
  if (!allowed.has(category) || !["members", "private"].includes(visibility)) return error(400, "VALIDATION_ERROR", "文件分类无效");
  const max = category === "avatar" ? 2 * 1024 * 1024 : file.type === "application/pdf" ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
  if (file.size > max) return error(413, "FILE_TOO_LARGE", "文件超过大小限制");
  if (!(["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type))) return error(415, "UNSUPPORTED_MEDIA_TYPE", "仅支持 JPG、PNG、WebP 或 PDF");
  const item = await persistence(c.env.DB!).addAttachment(current.user.personId, file, category, visibility, c.env.FILES);
  return c.json({ data: item, meta: { demo: false } }, 201);
});

contentApi.delete("/attachments/:id", async (c) => {
  const current = await session(c);
  if (!current) return error(401, "UNAUTHENTICATED", "请先登录");
  if (!c.env.FILES) return error(503, "R2_REQUIRED", "附件存储尚未配置");
  const item = await persistence(c.env.DB!).attachment(c.req.param("id"));
  if (!item || item.personId !== current.user.personId) return error(404, "ATTACHMENT_NOT_FOUND", "附件不存在");
  await persistence(c.env.DB!).removeAttachment(current.user.personId, item.id, c.env.FILES);
  return c.body(null, 204);
});

export const attachmentApi = new Hono<{ Bindings: Env }>();
attachmentApi.get("/:id", async (c) => {
  if (!c.env?.DB || !c.env.FILES) return error(503, "STORAGE_REQUIRED", "附件存储尚未配置");
  const item = await persistence(c.env.DB).attachment(c.req.param("id"));
  if (!item || item.status !== "ready") return error(404, "ATTACHMENT_NOT_FOUND", "附件不存在");
  const current = await persistence(c.env.DB).session(c.req.header("Authorization"));
  if (item.category !== "avatar" && (!current || (item.visibility === "private" && current.user.personId !== item.personId && current.user.role !== "admin"))) {
    return error(401, "UNAUTHENTICATED", "请先登录");
  }
  const object = await c.env.FILES.get(item.objectKey);
  if (!object) return error(404, "ATTACHMENT_NOT_FOUND", "附件不存在");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(item.originalName)}`);
  headers.set("Cache-Control", item.category === "avatar" ? "public, max-age=300" : "private, no-store");
  return new Response(object.body, { headers });
});

export default contentApi;
