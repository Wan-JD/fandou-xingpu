import { z } from "zod";
import { isValidDateOnly } from "./domain.ts";
import { isValidEmail, parseAccountIdentifier } from "./account-identifiers.ts";

export const idSchema = z.string().trim().min(1).max(128);
export const relationScopeSchema = z.enum(["lineage", "cohort_guest"]);
export const personStatusSchema = z.enum(["active", "archived"]);
export const memberTypeSchema = z.enum(["formal", "probationary"]);
export const destinationSchema = z.enum(["big_tech", "postgraduate_985", "postgraduate_211", "other"]);
export const groupRoleSchema = z.enum(["leader", "vice_leader"]);
export const coverThemeSchema = z.enum(["nebula", "aurora", "dawn", "abyss"]);
export const postVisibilitySchema = z.enum(["public", "members"]);
export const postKindSchema = z.enum(["note", "experience"]);
export const postStatusSchema = z.enum(["draft", "published"]);
export const joinSeasonSchema = z.enum(["spring", "autumn"]);
export const birthdaySchema = z.string().refine(isValidDateOnly, "请输入真实的出生日期");
export const datePrecisionSchema = z.enum(["year", "month", "day"]);
export const achievementKindSchema = z.enum(["achievement", "honor"]);
export const profileLinkSchema = z.object({ label: z.string().trim().min(1).max(80), url: z.string().trim().url().max(500).refine((value) => /^https?:\/\//i.test(value), "链接必须使用 HTTP 或 HTTPS 协议") }).strict();

export const treeQuerySchema = z.object({
  rootPersonId: idSchema.optional(),
  includeGuests: z.coerce.boolean().optional().default(false),
  maxDepth: z.coerce.number().int().min(0).max(100).optional(),
});

export const personSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const personUpdateSchema = z.object({
  bio: z.string().trim().max(10_000).optional(),
  destination: destinationSchema.nullable().optional(),
  birthday: birthdaySchema.nullable().optional(),
  joinedYear: z.number().int().min(1900).max(2200).optional(),
  joinedSeason: joinSeasonSchema.optional(),
  motto: z.string().trim().max(120).nullable().optional(),
  coverTheme: coverThemeSchema.nullable().optional(),
  contactEmail: z.string().trim().email().max(254).nullable().optional(),
  education: z.string().trim().max(10_000).nullable().optional(),
  experience: z.string().trim().max(20_000).nullable().optional(),
  skills: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  links: z.array(profileLinkSchema).max(20).optional(),
  version: z.number().int().min(1),
}).strict().superRefine((value, ctx) => {
  if ((value.joinedYear === undefined) !== (value.joinedSeason === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [value.joinedYear === undefined ? "joinedYear" : "joinedSeason"], message: "进组年份和季节必须同时填写" });
  }
});

export const accountIdentifierSchema = z.string().trim().min(1).max(254)
  .refine((value) => parseAccountIdentifier(value) !== null, "请输入有效的邮箱或手机号");

export const sessionLoginSchema = z.object({
  identifier: accountIdentifierSchema.optional(),
  // Kept for clients deployed before the identifier field was introduced.
  email: z.string().trim().max(254).refine(isValidEmail, "请输入有效的邮箱").optional(),
  password: z.string().min(6).max(100),
}).strict().refine((value) => Boolean(value.identifier || value.email), { message: "请输入有效的邮箱或手机号", path: ["identifier"] });

export const sessionRegisterSchema = z.object({
  displayName: z.string().trim().min(2).max(50),
  email: z.string().trim().email().max(254),
  password: z.string().min(6).max(100),
}).strict();

export const achievementInputSchema = z.object({
  kind: achievementKindSchema,
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(20_000),
  occurredOn: z.string().regex(/^\d{4}(?:-\d{2})?(?:-\d{2})?$/).nullable().optional(),
  datePrecision: datePrecisionSchema.nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.occurredOn && value.datePrecision) {
    const expectedLength = { year: 4, month: 7, day: 10 }[value.datePrecision];
    if (value.occurredOn.length !== expectedLength) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["occurredOn"], message: "日期格式与精度不匹配" });
    }
  }
});

export const postInputSchema = z.object({
  kind: postKindSchema.optional().default("note"),
  title: z.string().trim().max(120).nullable().optional(),
  // Drafts may be saved empty; published posts need a body.
  content: z.string().trim().max(100_000).optional().default(""),
  visibility: postVisibilitySchema.optional().default("public"),
  status: postStatusSchema.optional().default("published"),
}).strict().superRefine((value, ctx) => {
  if (value.status === "published" && !value.content) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["content"], message: "正文不能为空" });
  if (value.kind === "note" && value.content.length > 10_000) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["content"], message: "随手记正文不能超过 10000 字" });
});

export const postUpdateSchema = z.object({
  kind: postKindSchema.optional(),
  title: z.string().trim().max(120).nullable().optional(),
  content: z.string().trim().max(100_000).optional(),
  visibility: postVisibilitySchema.optional(),
  isPinned: z.boolean().optional(),
  status: postStatusSchema.optional(),
  version: z.number().int().min(1),
}).strict().superRefine((value, ctx) => {
  if (value.kind === "note" && value.content && value.content.length > 10_000) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["content"], message: "随手记正文不能超过 10000 字" });
});

export const POST_IMAGE_LIMITS = { note: 6, experience: 24 } as const;
export const POST_IMAGE_LIMIT = POST_IMAGE_LIMITS.note;

export const idParamsSchema = z.object({ id: idSchema });

export type TreeQueryInput = z.infer<typeof treeQuerySchema>;
export type PersonSearchQueryInput = z.infer<typeof personSearchQuerySchema>;
export type PersonUpdateInput = z.infer<typeof personUpdateSchema>;
export type SessionLoginInput = z.infer<typeof sessionLoginSchema>;
export type SessionRegisterInput = z.infer<typeof sessionRegisterSchema>;
export type AchievementInput = z.infer<typeof achievementInputSchema>;
export type PostInput = z.infer<typeof postInputSchema>;
export type PostUpdateInput = z.infer<typeof postUpdateSchema>;
