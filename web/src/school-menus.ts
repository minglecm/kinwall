/** Provider-independent published school menus. Defaults are read-only and have no saved meal id. */
export interface SchoolMenu {
  id: string; schoolContactId: string | null; name: string; sourceName: string | null; sourceUrl: string | null
  archived: boolean; lastSyncedAt: string | null; createdAt: string; updatedAt: string
}
export interface SchoolMenuEntry {
  menuId: string; date: string; availability: 'available' | 'not_served'; title: string | null
  description: string | null; sourceUrl: string | null; updatedAt: string
}
export interface SchoolMenuSettings { schoolContactId: string; lunchMenuId: string | null; useForMeals: boolean }
export interface SchoolLunchFallback {
  origin: 'school_menu'; menuId: string; schoolContactId: string; schoolName: string; menuName: string
  date: string; slot: 'lunch'; title: string; description: string | null; sourceUrl: string | null
  sourceName: string | null; lastSyncedAt: string | null; eaterIds: string[]
}
export type SchoolMenuInput = Pick<SchoolMenu, 'name' | 'schoolContactId'> & Partial<Pick<SchoolMenu, 'sourceName' | 'sourceUrl'>>
export const schoolLunchKey = (lunch: SchoolLunchFallback) => `${lunch.menuId}:${lunch.date}`
export const schoolLunchVisibleTo = (lunch: SchoolLunchFallback, memberId: string | null) => !memberId || lunch.eaterIds.includes(memberId)
export const schoolLunchDraft = (lunch: SchoolLunchFallback, memberId?: string | null): { date: string; slot: 'lunch'; eaterIds: string[] } => ({ date: lunch.date, slot: 'lunch', eaterIds: memberId && lunch.eaterIds.includes(memberId) ? [memberId] : lunch.eaterIds })
