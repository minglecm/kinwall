import type { KinwallDb } from './db.ts';
import { readMeals } from './meals.ts';
import { readSchoolLunches } from './school-menus.ts';

export async function readMealPlan(db: KinwallDb, from: string, to: string) {
  const meals = await readMeals(db, from, to);
  return { meals, schoolLunches: await readSchoolLunches(db, from, to, meals) };
}
