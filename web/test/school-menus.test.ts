import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schoolLunchKey, schoolLunchVisibleTo, schoolLunchDraft, type SchoolLunchFallback } from '../src/school-menus.ts';
const lunch: SchoolLunchFallback = { origin: 'school_menu', menuId: 'menu', schoolContactId: 'school', menuName: 'School lunch', schoolName: 'Maple Grove School', date: '2026-11-24', slot: 'lunch', title: 'Pizza', description: 'Fruit and milk.', sourceUrl: null, sourceName: null, lastSyncedAt: null, eaterIds: ['maya','leo'] };
test('school lunch display keys follow the menu and date, not menu corrections', () => {
  assert.equal(schoolLunchKey(lunch), schoolLunchKey({ ...lunch, title: 'Updated menu' }));
  assert.notEqual(schoolLunchKey(lunch), schoolLunchKey({ ...lunch, date: '2026-11-25' }));
});
test('school lunch defaults belong only to their eligible eaters', () => {
  assert(schoolLunchVisibleTo(lunch, null)); assert(schoolLunchVisibleTo(lunch, 'maya')); assert(!schoolLunchVisibleTo(lunch, 'alex'));
});
test('planning an alternative preselects the date, lunch and relevant children', () => {
  assert.deepEqual(schoolLunchDraft(lunch), { date: lunch.date, slot: 'lunch', eaterIds: ['maya','leo'] });
  assert.deepEqual(schoolLunchDraft(lunch, 'maya').eaterIds, ['maya']);
});
