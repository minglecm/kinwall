import type { KinwallDb } from './db.ts';
import type { Meal } from './meal-schemas.ts';
import type { SchoolMenu, SchoolMenuEntry, SchoolMenuSettings, SchoolLunchFallback } from './school-menu-schemas.ts';
import { readFeatures } from './routes/settings.ts';
import { classifyDay, loadSchoolDays } from './school-days.ts';

export type MenuRow = { id: string; school_contact_id: string | null; name: string; source_name: string | null; source_url: string | null; archived: number; last_synced_at: string | null; created_at: string; updated_at: string };
export const menuApi = (r: MenuRow): SchoolMenu => ({ id: r.id, schoolContactId: r.school_contact_id, name: r.name, sourceName: r.source_name, sourceUrl: r.source_url, archived: !!r.archived, lastSyncedAt: r.last_synced_at, createdAt: r.created_at, updatedAt: r.updated_at });
export type EntryRow = { menu_id: string; date: string; availability: 'available' | 'not_served'; title: string | null; description: string | null; source_url: string | null; updated_at: string };
export const entryApi = (r: EntryRow): SchoolMenuEntry => ({ menuId: r.menu_id, date: r.date, availability: r.availability, title: r.title, description: r.description, sourceUrl: r.source_url, updatedAt: r.updated_at });
export async function readSchoolMenus(db: KinwallDb, schoolContactId?: string, archived = true): Promise<SchoolMenu[]> {
  const { results } = await db.prepare('SELECT * FROM school_menus WHERE (?1 IS NULL OR school_contact_id = ?1) AND (?2 = 1 OR archived = 0) ORDER BY name, id').bind(schoolContactId ?? null, archived ? 1 : 0).all<MenuRow>();
  return results.map(menuApi);
}
export async function readSchoolMenuEntries(db: KinwallDb, menuId?: string, from?: string, to?: string): Promise<SchoolMenuEntry[]> {
  const query = menuId
    ? db.prepare('SELECT * FROM school_menu_entries WHERE menu_id = ? AND date BETWEEN ? AND ? ORDER BY date').bind(menuId, from ?? '0000-01-01', to ?? '9999-12-31')
    : db.prepare('SELECT * FROM school_menu_entries ORDER BY menu_id, date');
  const { results } = await query.all<EntryRow>();
  return results.map(entryApi);
}
export async function readSchoolMenuSettings(db: KinwallDb): Promise<SchoolMenuSettings[]> {
  const { results } = await db.prepare('SELECT * FROM school_menu_settings ORDER BY school_contact_id').all<{ school_contact_id: string; lunch_menu_id: string | null; use_for_meals: number }>();
  return results.map(r => ({ schoolContactId: r.school_contact_id, lunchMenuId: r.lunch_menu_id, useForMeals: !!r.use_for_meals }));
}

/** A read-only default, never a saved meal. Resolve the whole date range once for all children. */
export async function readSchoolLunches(db: KinwallDb, from: string, to: string, meals: Pick<Meal, 'date' | 'slot' | 'eaterIds'>[], flags?: { school?: boolean; meals: boolean }): Promise<SchoolLunchFallback[]> {
  const features = flags ?? await readFeatures(db);
  if (!features.school || !features.meals) return [];
  const { results } = await db.prepare(`SELECT e.*, k.member_id, m.school_contact_id, m.name AS menu_name, m.source_name,
    m.source_url AS menu_url, m.last_synced_at, c.name AS school_name
    FROM school_menu_settings s JOIN school_menus m ON m.id = s.lunch_menu_id AND m.school_contact_id = s.school_contact_id AND m.archived = 0
    JOIN school_menu_entries e ON e.menu_id = m.id AND e.date BETWEEN ? AND ? AND e.availability = 'available'
    JOIN school_kids k ON k.school_contact_id = s.school_contact_id AND k.mode = 'enrolled'
    JOIN members p ON p.id = k.member_id AND p.grown_up = 0 JOIN contacts c ON c.id = m.school_contact_id
    WHERE s.use_for_meals = 1 ORDER BY e.date, m.name, p.sort, p.name`).bind(from, to).all<EntryRow & { member_id: string; school_contact_id: string; menu_name: string; source_name: string | null; menu_url: string | null; last_synced_at: string | null; school_name: string }>();
  if (!results.length) return [];
  const { kids, settings, tz } = await loadSchoolDays(db, from, to, [...new Set(results.map(r => r.member_id))]);
  const lunches = new Map<string, SchoolLunchFallback>();
  const planned = new Map<string, Pick<Meal, 'date' | 'slot' | 'eaterIds'>[]>();
  for (const m of meals) if (m.slot === 'lunch') planned.set(m.date, [...(planned.get(m.date) ?? []), m]);
  for (const r of results) {
    if ((planned.get(r.date) ?? []).some(m => !m.eaterIds.length || m.eaterIds.includes(r.member_id))) continue;
    const kid = kids.get(r.member_id);
    if (!kid) continue;
    const day = classifyDay(kid, r.date, settings.rules, tz).kind;
    if (day !== 'school' && day !== 'half') continue;
    const key = `${r.menu_id}:${r.date}`;
    let lunch = lunches.get(key);
    if (!lunch) {
      lunch = { origin: 'school_menu', menuId: r.menu_id, schoolContactId: r.school_contact_id, schoolName: r.school_name, menuName: r.menu_name, date: r.date, slot: 'lunch', title: r.title!, description: r.description, sourceUrl: r.source_url ?? r.menu_url, sourceName: r.source_name, lastSyncedAt: r.last_synced_at, eaterIds: [] };
      lunches.set(key, lunch);
    }
    lunch.eaterIds.push(r.member_id);
  }
  return [...lunches.values()];
}
