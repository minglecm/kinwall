import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const ADMIN = 'kw_test_admin';
const date = '2026-11-24';
async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(import.meta.dirname, '../migrations'));
  const env = { DB: db, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as unknown as Env;
  const app = createApp(), pending: Promise<unknown>[] = [];
  const req = async (url: string, method = 'GET', body?: unknown, key = ADMIN) => {
    const r = await app.request(url, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} } as never);
    while (pending.length) await Promise.all(pending.splice(0));
    const text = await r.text(); let json: any; try { json = JSON.parse(text); } catch { json = { error: text }; } return { status: r.status, json };
  };
  const features = (await req('/api/settings')).json.features;
  await req('/api/settings', 'PATCH', { features: { ...features, school: true }, timezone: 'America/New_York' });
  const members = [];
  for (const [name, grownUp] of [['Alex', true], ['Sam', true], ['Maya', false], ['Leo', false]] as const) members.push((await req('/api/members', 'POST', { name, grownUp, color: '#336699' })).json);
  const [alex, sam, maya, leo] = members;
  const school = (await req('/api/contacts', 'POST', { name: 'Maple Grove School', kind: 'organization' })).json;
  for (const m of [maya, leo]) await req(`/api/school/kids/${m.id}`, 'PUT', { mode: 'enrolled', schoolContactId: school.id });
  const wall = (await req('/api/keys', 'POST', { name: 'Kitchen wall', scope: 'display' })).json.key;
  const menu = (await req('/api/school/menus', 'POST', { schoolContactId: school.id, name: 'School lunch', sourceName: 'Example connector', sourceUrl: 'https://example.org/menu' })).json;
  const sync = (entries: unknown[], from = date, to = date) => req(`/api/school/menus/${menu.id}/entries/sync`, 'PUT', { from, to, entries });
  const entry = { date, availability: 'available', title: 'Chicken tenders or pizza', description: 'Carrots, fruit and milk.' };
  const plan = () => req(`/api/meal-plan?from=${date}&to=${date}`);
  return { db, req, features, alex, sam, maya, leo, school, menu, wall, sync, entry, plan };
}

test('school menus: parents create a shell; wall reads but cannot manage or import', async () => {
  const t = await setup();
  assert.equal(t.menu.name, 'School lunch');
  assert.equal((await t.req(`/api/meal-plan?from=${date}&to=${date}`, 'GET', undefined, t.wall)).status, 200);
  assert.equal((await t.req('/api/school/menus', 'GET', undefined, t.wall)).status, 200);
  assert.equal((await t.req('/api/school/menus', 'POST', { name: 'No', schoolContactId: t.school.id }, t.wall)).status, 403);
  assert.equal((await t.req(`/api/school/menus/${t.menu.id}/entries/sync`, 'PUT', { from: date, to: date, entries: [t.entry] }, t.wall)).status, 403);
  assert.equal((await t.req(`/api/school/menu-settings/${t.school.id}`, 'GET', undefined, t.wall)).json.useForMeals, false);
  assert.equal((await t.req('/api/meal-plan?from=2026-02-30&to=2026-03-01')).status, 400);
  await t.req('/api/settings', 'PATCH', { features: { ...t.features, school: false } });
  assert.equal((await t.req('/api/school/menus')).status, 404);
  assert.deepEqual((await t.plan()).json.schoolLunches, []);
});

test('school menus: bounded snapshots are atomic, repeatable and preserve entries outside the window', async () => {
  const t = await setup();
  assert.equal((await t.sync([t.entry])).status, 200);
  assert.deepEqual(((await t.sync([t.entry])).json), { created: 0, updated: 0, deleted: 0, lastSyncedAt: (await t.req(`/api/school/menus/${t.menu.id}`)).json.lastSyncedAt });
  const before = (await t.req(`/api/school/menus/${t.menu.id}/entries?from=${date}&to=2026-11-30`)).json;
  for (const entries of [[t.entry, t.entry], [{ ...t.entry, date: '2026-02-30' }], [{ ...t.entry, date: '2026-11-30' }]]) {
    assert.equal((await t.sync(entries)).status, 400);
    assert.deepEqual((await t.req(`/api/school/menus/${t.menu.id}/entries?from=${date}&to=2026-11-30`)).json, before);
  }
  assert.equal((await t.sync([{ ...t.entry, date: '2026-11-30' }], '2026-11-30', '2026-11-30')).json.created, 1);
  assert.equal((await t.sync([{ ...t.entry, title: 'Updated lunch' }])).json.updated, 1);
  assert.equal((await t.sync([])).json.deleted, 1);
  assert.equal((await t.req(`/api/school/menus/${t.menu.id}/entries?from=${date}&to=2026-11-30`)).json.length, 1);
});

test('school menus: per-child fallback uses eaters, with everyone and packed lunches taking precedence', async () => {
  const t = await setup();
  await t.sync([t.entry]);
  assert.deepEqual((await t.plan()).json.schoolLunches, []);
  assert.equal((await t.req(`/api/school/menu-settings/${t.school.id}`, 'PUT', { lunchMenuId: t.menu.id, useForMeals: true })).status, 200);
  const fallback = (await t.plan()).json.schoolLunches;
  assert.deepEqual(fallback[0].eaterIds.sort(), [t.maya.id, t.leo.id].sort());
  assert.equal(fallback[0].origin, 'school_menu');
  assert.equal(fallback[0].id, undefined);
  const adult = (await t.req('/api/meals', 'POST', { date, slot: 'lunch', title: 'Soup', eaterIds: [t.alex.id], assigneeMemberId: t.maya.id })).json;
  assert.equal((await t.plan()).json.schoolLunches[0].eaterIds.length, 2);
  const packed = (await t.req('/api/meals', 'POST', { date, slot: 'lunch', title: 'Packed lunch', eaterIds: [t.maya.id] })).json;
  assert.deepEqual((await t.plan()).json.schoolLunches[0].eaterIds, [t.leo.id]);
  await t.req(`/api/meals/${packed.id}`, 'DELETE');
  assert.equal((await t.plan()).json.schoolLunches[0].eaterIds.length, 2);
  await t.req(`/api/meals/${adult.id}`, 'PATCH', { eaterIds: [] });
  assert.deepEqual((await t.plan()).json.schoolLunches, []);
  assert.equal((await t.req(`/api/meals?from=${date}&to=${date}`)).json.length, 1);
  assert.equal((await t.req(`/api/meals/projection?from=${date}&to=${date}`)).json.items.length, 0);
});

test('school menus: school days and feature switches gate fallbacks, menu updates do not write meals', async () => {
  const t = await setup(); await t.sync([t.entry]);
  await t.req(`/api/school/menu-settings/${t.school.id}`, 'PUT', { lunchMenuId: t.menu.id, useForMeals: true });
  for (const [kind, count] of [['off', 0], ['half', 1], ['school', 1]] as const) {
    await t.req(`/api/school/days/${t.maya.id}/${date}`, 'PUT', { kind });
    await t.req(`/api/school/days/${t.leo.id}/${date}`, 'PUT', { kind });
    assert.equal((await t.plan()).json.schoolLunches.length, count);
  }
  await t.sync([{ ...t.entry, availability: 'not_served', title: null }]);
  assert.deepEqual((await t.plan()).json.schoolLunches, []);
  await t.sync([t.entry]);
  await t.req('/api/settings', 'PATCH', { features: { ...t.features, school: true, meals: false } });
  assert.deepEqual((await t.plan()).json.schoolLunches, []);
  assert.equal((await t.req(`/api/school/menus/${t.menu.id}/entries?from=${date}&to=${date}`)).json.length, 1);
  assert.equal((await t.db.prepare('SELECT count(*) AS n FROM meals').first<{ n: number }>())!.n, 0);
});

test('school menus: archive disconnects, cross-school selection is rejected, and export round trips', async () => {
  const t = await setup(); await t.sync([t.entry]);
  await t.req(`/api/school/menu-settings/${t.school.id}`, 'PUT', { lunchMenuId: t.menu.id, useForMeals: true });
  const other = (await t.req('/api/contacts', 'POST', { name: 'Another school', kind: 'organization' })).json;
  assert.equal((await t.req(`/api/school/menu-settings/${other.id}`, 'PUT', { lunchMenuId: t.menu.id, useForMeals: true })).status, 400);
  const file = (await t.req('/api/export')).json;
  assert.equal(file.schoolMenus.length, 1); assert.equal(file.schoolMenuEntries.length, 1);
  const b = await setup();
  assert.equal((await b.req('/api/import', 'POST', file)).status, 200);
  assert.equal((await b.req(`/api/school/menus/${t.menu.id}/entries?from=${date}&to=${date}`)).json.length, 1);
  assert.equal((await t.req(`/api/school/menus/${t.menu.id}`, 'PATCH', { archived: true })).status, 200);
  assert.equal((await t.req(`/api/school/menu-settings/${t.school.id}`)).json.useForMeals, false);
  assert.deepEqual((await t.plan()).json.schoolLunches, []);
});

test('school menus: Board and personal snapshots share defaults and refresh after meal overrides', async ctx => {
  ctx.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-24T12:00:00Z') });
  const t = await setup(); await t.sync([t.entry]);
  await t.req(`/api/school/menu-settings/${t.school.id}`, 'PUT', { lunchMenuId: t.menu.id, useForMeals: true });
  const board = (await t.req('/api/board?days=7')).json;
  assert.equal(board.schoolLunches.length, 1);
  assert.deepEqual((await t.req(`/api/snapshot?member=${t.maya.id}&range=day`)).json.schoolLunches[0], board.schoolLunches[0]);
  assert.deepEqual((await t.req(`/api/snapshot?member=${t.alex.id}&range=day`)).json.schoolLunches, []);
  await t.req('/api/meals', 'POST', { date, slot: 'lunch', title: 'Packed lunch', eaterIds: [t.maya.id] });
  assert.deepEqual((await t.req('/api/board?days=7')).json.schoolLunches[0].eaterIds, [t.leo.id]);
  assert.deepEqual((await t.req(`/api/snapshot?member=${t.maya.id}&range=day`)).json.schoolLunches, []);
  assert.equal((await t.req(`/api/snapshot?member=${t.leo.id}&range=week`)).json.schoolLunches.length, 1);
  assert.equal((await t.req(`/api/snapshot?member=${t.leo.id}&range=day`)).json.meals.some((m: any) => m.title === 'Packed lunch'), false, 'a personal day does not show a sibling’s packed lunch');
  assert.equal((await t.req('/api/school/menus', 'GET', undefined, t.wall)).status, 200);
});

test('school menus: missing days, weekends, summer, home education and school changes do not supply lunch', async () => {
  const t = await setup();
  await t.sync([t.entry, { ...t.entry, date: '2026-11-28' }], date, '2026-11-28');
  await t.req(`/api/school/menu-settings/${t.school.id}`, 'PUT', { lunchMenuId: t.menu.id, useForMeals: true });
  assert.deepEqual((await t.req('/api/meal-plan?from=2026-11-28&to=2026-11-28')).json.schoolLunches, []);
  assert.deepEqual((await t.req('/api/meal-plan?from=2026-11-25&to=2026-11-25')).json.schoolLunches, []);
  await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'home' });
  assert.deepEqual((await t.plan()).json.schoolLunches[0].eaterIds, [t.leo.id]);
  await t.req(`/api/school/kids/${t.leo.id}`, 'PUT', { mode: 'enrolled', lastDay: '2026-11-23' });
  assert.deepEqual((await t.plan()).json.schoolLunches, []);
});

test('school menus: deleting a contact preserves menus, merging transfers them and target selection wins', async () => {
  const t = await setup(); await t.sync([t.entry]);
  await t.req(`/api/school/menu-settings/${t.school.id}`, 'PUT', { lunchMenuId: t.menu.id, useForMeals: true });
  const target = (await t.req('/api/contacts', 'POST', { name: 'Maple Grove School', kind: 'organization' })).json;
  assert.equal((await t.req('/api/contacts/merge', 'POST', { targetId: target.id, sourceId: t.school.id, confirm: true })).status, 200);
  assert.equal((await t.req(`/api/school/menus/${t.menu.id}`)).json.schoolContactId, target.id);
  assert.equal((await t.req(`/api/school/menu-settings/${target.id}`)).json.lunchMenuId, t.menu.id);
  assert.equal((await t.plan()).json.schoolLunches[0].eaterIds.length, 2);
  assert.equal((await t.req(`/api/contacts/${target.id}`, 'DELETE')).status, 200);
  assert.equal((await t.req(`/api/school/menus/${t.menu.id}`)).json.schoolContactId, null);
  assert.equal((await t.req(`/api/school/menus/${t.menu.id}/entries?from=${date}&to=${date}`)).json.length, 1);
  assert.deepEqual((await t.plan()).json.schoolLunches, []);
});

test('school menus: metadata links are never fetched and dated reads use the menu/date index', async () => {
  const t = await setup();
  const real = globalThis.fetch; let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error('no network expected'); }) as typeof fetch;
  try {
    await t.sync([{ ...t.entry, sourceUrl: 'https://example.org/dated-menu' }]);
    await t.req(`/api/school/menus/${t.menu.id}/entries?from=${date}&to=${date}`);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = real; }
  const plan = (await t.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM school_menu_entries WHERE menu_id = ? AND date >= ? AND date <= ? ORDER BY menu_id, date').bind(t.menu.id, date, date).all<{ detail: string }>()).results;
  assert(plan.some(r => /SEARCH.*school_menu_entries.*INDEX/.test(r.detail)));
  const file = (await t.req('/api/export')).json;
  delete file.schoolMenus; delete file.schoolMenuEntries; delete file.schoolMenuSettings;
  assert.equal((await t.req('/api/import', 'POST', file)).status, 200);
  assert.equal((await t.req(`/api/school/menus/${t.menu.id}`)).status, 200, 'an old export does not remove existing menus');
});

test('school menus: different schools resolve independently and a merge preserves the destination default', async () => {
  const t = await setup(); await t.sync([t.entry]);
  await t.req(`/api/school/menu-settings/${t.school.id}`, 'PUT', { lunchMenuId: t.menu.id, useForMeals: true });
  const other = (await t.req('/api/contacts', 'POST', { name: 'Another school', kind: 'organization' })).json;
  const menu = (await t.req('/api/school/menus', 'POST', { schoolContactId: other.id, name: 'Lunch' })).json;
  await t.req(`/api/school/menus/${menu.id}/entries/sync`, 'PUT', { from: date, to: date, entries: [{ ...t.entry, title: 'Other school lunch' }] });
  await t.req(`/api/school/menu-settings/${other.id}`, 'PUT', { lunchMenuId: menu.id, useForMeals: true });
  await t.req(`/api/school/kids/${t.leo.id}`, 'PUT', { mode: 'enrolled', schoolContactId: other.id });
  const lunches = (await t.plan()).json.schoolLunches;
  assert.equal(lunches.length, 2);
  assert.deepEqual(lunches.find((l: any) => l.menuId === t.menu.id).eaterIds, [t.maya.id]);
  assert.deepEqual(lunches.find((l: any) => l.menuId === menu.id).eaterIds, [t.leo.id]);
  await t.req(`/api/school/menu-settings/${other.id}`, 'PUT', { lunchMenuId: menu.id, useForMeals: false });
  assert.equal((await t.req('/api/contacts/merge', 'POST', { targetId: other.id, sourceId: t.school.id, confirm: true })).status, 200);
  assert.deepEqual((await t.req(`/api/school/menu-settings/${other.id}`)).json, { schoolContactId: other.id, lunchMenuId: menu.id, useForMeals: false });
  assert.deepEqual((await t.plan()).json.schoolLunches, []);
});
