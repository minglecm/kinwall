import { z } from '@hono/zod-openapi';
import { MealDateSchema, MealRangeSchema, MealSchema } from './meal-schemas.ts';

const link = z.string().url().max(2000).refine(s => /^https?:\/\//i.test(s), 'must be an HTTP or HTTPS URL').nullable();
export const SchoolMenuInputSchema = z.object({
  schoolContactId: z.string().min(1), name: z.string().trim().min(1).max(200),
  sourceName: z.string().trim().max(200).nullable().optional(), sourceUrl: link.optional(),
}).strict();
export const SchoolMenuPatchSchema = SchoolMenuInputSchema.partial().extend({ schoolContactId: z.string().min(1).nullable().optional(), archived: z.boolean().optional() }).strict();
export const SchoolMenuSchema = SchoolMenuInputSchema.extend({
  id: z.string(), schoolContactId: z.string().nullable(), sourceName: z.string().nullable(), sourceUrl: link,
  archived: z.boolean(), lastSyncedAt: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(),
}).openapi('SchoolMenu');
export const SchoolMenuEntryInputSchema = z.object({
  date: MealDateSchema, availability: z.enum(['available', 'not_served']).default('available'),
  title: z.string().trim().min(1).max(200).nullable().default(null),
  description: z.string().trim().max(10000).nullable().default(null), sourceUrl: link.default(null),
}).strict().refine(e => e.availability !== 'available' || !!e.title, 'available entries require a title');
export const SchoolMenuEntrySchema = SchoolMenuEntryInputSchema.safeExtend({ menuId: z.string(), updatedAt: z.string() }).openapi('SchoolMenuEntry');
export const SchoolMenuSyncSchema = MealRangeSchema.safeExtend({ entries: z.array(SchoolMenuEntryInputSchema).max(367) }).strict().superRefine((s, ctx) => {
  const seen = new Set<string>();
  s.entries.forEach((e, i) => {
    if (seen.has(e.date) || e.date < s.from || e.date > s.to) ctx.addIssue({ code: 'custom', path: ['entries', i, 'date'], message: 'dates must be unique and inside the sync window' });
    seen.add(e.date);
  });
});
export const SchoolMenuSettingsInputSchema = z.object({ lunchMenuId: z.string().min(1).nullable(), useForMeals: z.boolean() }).strict()
  .refine(s => !s.useForMeals || !!s.lunchMenuId, 'select a menu before enabling school lunch');
export const SchoolMenuSettingsSchema = SchoolMenuSettingsInputSchema.safeExtend({ schoolContactId: z.string() }).openapi('SchoolMenuSettings');
export const SchoolLunchFallbackSchema = z.object({
  origin: z.literal('school_menu'), menuId: z.string(), schoolContactId: z.string(), schoolName: z.string(), menuName: z.string(),
  date: MealDateSchema, slot: z.literal('lunch'), title: z.string(), description: z.string().nullable(), sourceUrl: link,
  sourceName: z.string().nullable(), lastSyncedAt: z.string().nullable(), eaterIds: z.array(z.string()).min(1),
}).openapi('SchoolLunchFallback');
export const MealPlanSchema = z.object({ meals: z.array(MealSchema), schoolLunches: z.array(SchoolLunchFallbackSchema) }).openapi('MealPlan');
export type SchoolMenu = z.infer<typeof SchoolMenuSchema>;
export type SchoolMenuEntry = z.infer<typeof SchoolMenuEntrySchema>;
export type SchoolMenuSettings = z.infer<typeof SchoolMenuSettingsSchema>;
export type SchoolLunchFallback = z.infer<typeof SchoolLunchFallbackSchema>;
