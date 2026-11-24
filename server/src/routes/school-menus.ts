import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { emit } from '../bus.ts';
import { ErrorSchema } from '../schemas.ts';
import { MealRangeSchema } from '../meal-schemas.ts';
import { readFeatures } from './settings.ts';
import { menuApi, readSchoolMenus, readSchoolMenuEntries, readSchoolMenuSettings, type MenuRow } from '../school-menus.ts';
import { SchoolMenuInputSchema, SchoolMenuPatchSchema, SchoolMenuSchema, SchoolMenuEntrySchema, SchoolMenuSyncSchema, SchoolMenuSettingsInputSchema, SchoolMenuSettingsSchema, MealPlanSchema } from '../school-menu-schemas.ts';
import { readMealPlan } from '../meal-plan.ts';

export const schoolMenuRoutes = createRouter();
const tags = ['School'], security = [{ Bearer: [] }], params = z.object({ id: z.string() });
const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const answer = <T extends z.ZodType>(schema: T) => ({ description: 'ok', ...json(schema) });
const errors = { 400: answer(ErrorSchema), 403: answer(ErrorSchema), 404: answer(ErrorSchema) };
const ok = z.object({ ok: z.boolean() });
schoolMenuRoutes.use('/api/school/*', async (c, next) => {
  if (!(await readFeatures(c.env.DB)).school) return c.json({ error: 'School is turned off in Settings → General → Features' }, 404);
  return next();
});
const find = (db: Parameters<typeof readSchoolMenus>[0], id: string) => db.prepare('SELECT * FROM school_menus WHERE id = ?').bind(id).first<MenuRow>();
const contact = (db: Parameters<typeof readSchoolMenus>[0], id: string) => db.prepare('SELECT id FROM contacts WHERE id = ?').bind(id).first();

schoolMenuRoutes.openapi(createRoute({ method: 'get', path: '/api/school/menus', tags, security, summary: 'List school menus; archived=all includes archived menus', request: { query: z.object({ schoolContactId: z.string().optional(), archived: z.enum(['all']).optional() }) }, responses: { 200: answer(z.array(SchoolMenuSchema)), ...errors } }), async c => {
  const q = c.req.valid('query'); return c.json(await readSchoolMenus(c.env.DB, q.schoolContactId, q.archived === 'all'), 200);
});
schoolMenuRoutes.openapi(createRoute({ method: 'post', path: '/api/school/menus', tags, security, summary: 'Create an empty school lunch menu for an external importer (admin)', request: { body: json(SchoolMenuInputSchema) }, responses: { 201: answer(SchoolMenuSchema), ...errors } }), async c => {
  const input = c.req.valid('json');
  if (!await contact(c.env.DB, input.schoolContactId)) return c.json({ error: 'school contact not found' }, 400);
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await c.env.DB.prepare('INSERT INTO school_menus (id, school_contact_id, name, source_name, source_url, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').bind(id, input.schoolContactId, input.name, input.sourceName ?? null, input.sourceUrl ?? null, now, now).run();
  emit(c, 'school.changed', { id, kind: 'menu' }); return c.json(menuApi((await find(c.env.DB, id))!), 201);
});
schoolMenuRoutes.openapi(createRoute({ method: 'get', path: '/api/school/menus/{id}', tags, security, summary: 'Read school menu metadata', request: { params }, responses: { 200: answer(SchoolMenuSchema), ...errors } }), async c => {
  const menu = await find(c.env.DB, c.req.valid('param').id);
  return menu ? c.json(menuApi(menu), 200) : c.json({ error: 'school menu not found' }, 404);
});
schoolMenuRoutes.openapi(createRoute({ method: 'patch', path: '/api/school/menus/{id}', tags, security, summary: 'Edit or archive menu metadata without editing published entries (admin)', request: { params, body: json(SchoolMenuPatchSchema) }, responses: { 200: answer(SchoolMenuSchema), ...errors } }), async c => {
  const { id } = c.req.valid('param'), old = await find(c.env.DB, id);
  if (!old) return c.json({ error: 'school menu not found' }, 404);
  const input = { ...menuApi(old), ...c.req.valid('json') }, now = new Date().toISOString();
  if (input.schoolContactId && !await contact(c.env.DB, input.schoolContactId)) return c.json({ error: 'school contact not found' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE school_menus SET school_contact_id = ?, name = ?, source_name = ?, source_url = ?, archived = ?, updated_at = ? WHERE id = ?').bind(input.schoolContactId, input.name, input.sourceName ?? null, input.sourceUrl ?? null, input.archived ? 1 : 0, now, id),
    ...(input.archived || input.schoolContactId !== old.school_contact_id ? [c.env.DB.prepare('UPDATE school_menu_settings SET lunch_menu_id = NULL, use_for_meals = 0, updated_at = ? WHERE lunch_menu_id = ?').bind(now, id)] : []),
  ]);
  emit(c, 'school.changed', { id, kind: 'menu' }); return c.json(menuApi((await find(c.env.DB, id))!), 200);
});
schoolMenuRoutes.openapi(createRoute({ method: 'delete', path: '/api/school/menus/{id}', tags, security, summary: 'Delete a school menu and its entries (admin)', request: { params }, responses: { 200: answer(ok), ...errors } }), async c => {
  const { id } = c.req.valid('param');
  if (!await find(c.env.DB, id)) return c.json({ error: 'school menu not found' }, 404);
  await c.env.DB.batch([c.env.DB.prepare('UPDATE school_menu_settings SET lunch_menu_id = NULL, use_for_meals = 0, updated_at = ? WHERE lunch_menu_id = ?').bind(new Date().toISOString(), id), c.env.DB.prepare('DELETE FROM school_menus WHERE id = ?').bind(id)]);
  emit(c, 'school.changed', { id, kind: 'menu' }); return c.json({ ok: true }, 200);
});
schoolMenuRoutes.openapi(createRoute({ method: 'get', path: '/api/school/menus/{id}/entries', tags, security, summary: 'Read dated school lunch menu entries', request: { params, query: MealRangeSchema }, responses: { 200: answer(z.array(SchoolMenuEntrySchema)), ...errors } }), async c => {
  const { id } = c.req.valid('param'), { from, to } = c.req.valid('query');
  if (!await find(c.env.DB, id)) return c.json({ error: 'school menu not found' }, 404);
  return c.json(await readSchoolMenuEntries(c.env.DB, id, from, to), 200);
});
const SyncResult = z.object({ created: z.number(), updated: z.number(), deleted: z.number(), lastSyncedAt: z.string() });
schoolMenuRoutes.openapi(createRoute({ method: 'put', path: '/api/school/menus/{id}/entries/sync', tags, security, summary: 'Atomically replace this menu inside an inclusive date window (admin); empty entries clears that window', request: { params, body: json(SchoolMenuSyncSchema) }, responses: { 200: answer(SyncResult), ...errors } }), async c => {
  const { id } = c.req.valid('param'), { from, to, entries } = c.req.valid('json');
  const menu = await find(c.env.DB, id);
  if (!menu) return c.json({ error: 'school menu not found' }, 404);
  if (menu.archived) return c.json({ error: 'restore the menu before importing entries' }, 400);
  const now = new Date().toISOString(), db = c.env.DB;
  // Counts, upserts, bounded removal and freshness are one DB transaction, including on Workers.
  const payload = JSON.stringify(entries);
  const [counts] = await db.batch<{ created: number; updated: number; deleted: number }>([
    db.prepare(`SELECT
      (SELECT count(*) FROM json_each(?1) j WHERE NOT EXISTS (SELECT 1 FROM school_menu_entries e WHERE e.menu_id = ?2 AND e.date = j.value->>'date')) AS created,
      (SELECT count(*) FROM json_each(?1) j JOIN school_menu_entries e ON e.menu_id = ?2 AND e.date = j.value->>'date' WHERE e.availability IS NOT j.value->>'availability' OR e.title IS NOT j.value->>'title' OR e.description IS NOT j.value->>'description' OR e.source_url IS NOT j.value->>'sourceUrl') AS updated,
      (SELECT count(*) FROM school_menu_entries e WHERE e.menu_id = ?2 AND e.date BETWEEN ?3 AND ?4 AND NOT EXISTS (SELECT 1 FROM json_each(?1) j WHERE j.value->>'date' = e.date)) AS deleted`).bind(payload, id, from, to),
    db.prepare(`INSERT INTO school_menu_entries (menu_id,date,availability,title,description,source_url,updated_at)
      SELECT ?1,value->>'date',value->>'availability',value->>'title',value->>'description',value->>'sourceUrl',?3 FROM json_each(?2) WHERE 1
      ON CONFLICT(menu_id,date) DO UPDATE SET availability=excluded.availability,title=excluded.title,description=excluded.description,source_url=excluded.source_url,updated_at=excluded.updated_at
      WHERE school_menu_entries.availability IS NOT excluded.availability OR school_menu_entries.title IS NOT excluded.title OR school_menu_entries.description IS NOT excluded.description OR school_menu_entries.source_url IS NOT excluded.source_url`).bind(id, payload, now),
    db.prepare("DELETE FROM school_menu_entries WHERE menu_id = ?1 AND date BETWEEN ?2 AND ?3 AND date NOT IN (SELECT value->>'date' FROM json_each(?4))").bind(id, from, to, payload),
    db.prepare('UPDATE school_menus SET last_synced_at = ? WHERE id = ?').bind(now, id),
  ]);
  emit(c, 'school.changed', { id, kind: 'menu', from, to });
  return c.json({ ...counts.results[0], lastSyncedAt: now }, 200);
});
const settingParams = z.object({ schoolContactId: z.string() });
schoolMenuRoutes.openapi(createRoute({ method: 'get', path: '/api/school/menu-settings/{schoolContactId}', tags, security, summary: 'Read school-wide lunch selection (off until a parent enables it)', request: { params: settingParams }, responses: { 200: answer(SchoolMenuSettingsSchema), ...errors } }), async c => {
  const { schoolContactId } = c.req.valid('param');
  if (!await contact(c.env.DB, schoolContactId)) return c.json({ error: 'school contact not found' }, 404);
  return c.json((await readSchoolMenuSettings(c.env.DB)).find(s => s.schoolContactId === schoolContactId) ?? { schoolContactId, lunchMenuId: null, useForMeals: false }, 200);
});
schoolMenuRoutes.openapi(createRoute({ method: 'put', path: '/api/school/menu-settings/{schoolContactId}', tags, security, summary: 'Select a school lunch menu and optionally use it in Meals (admin)', request: { params: settingParams, body: json(SchoolMenuSettingsInputSchema) }, responses: { 200: answer(SchoolMenuSettingsSchema), ...errors } }), async c => {
  const { schoolContactId } = c.req.valid('param'), input = c.req.valid('json');
  if (!await contact(c.env.DB, schoolContactId)) return c.json({ error: 'school contact not found' }, 404);
  if (input.lunchMenuId) {
    const menu = await find(c.env.DB, input.lunchMenuId);
    if (!menu || menu.archived || menu.school_contact_id !== schoolContactId) return c.json({ error: 'select an active menu from this school' }, 400);
  }
  await c.env.DB.prepare('INSERT INTO school_menu_settings (school_contact_id,lunch_menu_id,use_for_meals,updated_at) VALUES (?,?,?,?) ON CONFLICT(school_contact_id) DO UPDATE SET lunch_menu_id=excluded.lunch_menu_id,use_for_meals=excluded.use_for_meals,updated_at=excluded.updated_at').bind(schoolContactId, input.lunchMenuId, input.useForMeals ? 1 : 0, new Date().toISOString()).run();
  emit(c, 'school.changed', { id: schoolContactId, kind: 'menu_settings' }); return c.json({ schoolContactId, ...input }, 200);
});
schoolMenuRoutes.openapi(createRoute({ method: 'get', path: '/api/meal-plan', tags: ['Meals'], security, summary: 'Saved meals plus read-only school lunch defaults; no meal records are created', request: { query: MealRangeSchema }, responses: { 200: answer(MealPlanSchema), ...errors } }), async c => {
  const { from, to } = c.req.valid('query'); return c.json(await readMealPlan(c.env.DB, from, to), 200);
});
