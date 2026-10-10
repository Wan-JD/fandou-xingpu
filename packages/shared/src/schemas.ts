import { z } from "zod";

export const idSchema = z.string().trim().min(1).max(128);
export const relationScopeSchema = z.enum(["lineage", "cohort_guest"]);
export const personStatusSchema = z.enum(["active", "archived"]);
export const destinationSchema = z.enum(["big_tech", "postgraduate_985", "postgraduate_211", "startup", "further_study", "other"]);
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
  nickname: z.string().trim().max(100).nullable().optional(),
  destination: destinationSchema.nullable().optional(),
  contactEmail: z.string().trim().email().max(254).nullable().optional(),
  education: z.string().trim().max(10_000).nullable().optional(),
  experience: z.string().trim().max(20_000).nullable().optional(),
  skills: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  links: z.array(profileLinkSchema).max(20).optional(),
  version: z.number().int().min(1),
}).strict();

export const sessionLoginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(6).max(100),
}).strict();

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

export const idParamsSchema = z.object({ id: idSchema });

export type TreeQueryInput = z.infer<typeof treeQuerySchema>;
export type PersonSearchQueryInput = z.infer<typeof personSearchQuerySchema>;
export type PersonUpdateInput = z.infer<typeof personUpdateSchema>;
export type SessionLoginInput = z.infer<typeof sessionLoginSchema>;
export type SessionRegisterInput = z.infer<typeof sessionRegisterSchema>;
export type AchievementInput = z.infer<typeof achievementInputSchema>;
