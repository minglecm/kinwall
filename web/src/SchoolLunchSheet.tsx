import { useState } from 'react'
import Sheet from './Sheet.tsx'
import { useApp } from './AppContext.tsx'
import { api } from './api.ts'
import MealSheet, { EaterAvatars } from './MealSheet.tsx'
import RecipeSheet from './RecipeSheet.tsx'
import type { Me } from './types.ts'
import { formatDate, t } from './i18n.ts'
import type { SchoolLunchFallback } from './school-menus.ts'
import { schoolLunchDraft } from './school-menus.ts'
import type { Recipe } from './meal-types.ts'

export function SchoolLunchFacts({ lunch }: { lunch: SchoolLunchFallback }) {
  return <><p className="field-hint">{t('From the school menu')} · {lunch.schoolName}</p>
    <p><strong>{lunch.title}</strong></p>
    {lunch.description && <p className="school-menu-text">{lunch.description}</p>}
    {lunch.sourceName && <p className="field-hint">{lunch.sourceName}</p>}
    {lunch.sourceUrl && <p><a className="sheet-link" href={lunch.sourceUrl} target="_blank" rel="noopener noreferrer">{t('View original menu')}</a></p>}
    {lunch.lastSyncedAt && <p className="field-hint">{t('Last received: {date}', { date: formatDate(new Date(lunch.lastSyncedAt), { dateStyle: 'medium', timeStyle: 'short' }) })}</p>}
  </>
}
export default function SchoolLunchSheet({ lunch, onClose, onPlan }: { lunch: SchoolLunchFallback; onClose: () => void; onPlan?: () => void }) {
  const { members, parentDevice, selectedMemberId, reloadCore, toast } = useApp()
  const [planning, setPlanning] = useState<{ recipes: Recipe[]; me: Awaited<ReturnType<typeof api.meStrict>> } | null>(null)
  const [busy, setBusy] = useState(false)
  const plan = async () => {
    if (onPlan) { onPlan(); return }
    setBusy(true)
    try { const [recipes, me] = await Promise.all([api.getRecipes(true), api.meStrict()]); setPlanning({ recipes, me }) }
    catch { toast(t('Could not load lunch planning. Try again.')) }
    finally { setBusy(false) }
  }
  // Keep the existing meal editor and its authorization; defaults never become editable meal ids.
  return <>
    <Sheet title={t('School lunch · {date}', { date: formatDate(new Date(`${lunch.date}T12:00:00`), { weekday: 'long', month: 'short', day: 'numeric' }) })} onClose={onClose}
      actions={parentDevice && !planning ? <button className="btn btn-primary" disabled={busy} onClick={() => void plan()}>{t('Plan a different lunch')}</button> : undefined}>
      <SchoolLunchFacts lunch={lunch} /><EaterAvatars ids={lunch.eaterIds} members={members} />
    </Sheet>
    {planning && <AlternativeLunch lunch={lunch} memberId={selectedMemberId} recipes={planning.recipes} me={planning.me} onClose={() => setPlanning(null)} onSaved={() => { reloadCore(); onClose() }} />}
  </>
}
// Kept separate so opening details doesn't create or save anything.
function AlternativeLunch({ lunch, memberId, recipes, me, onClose, onSaved }: { lunch: SchoolLunchFallback; memberId: string | null; recipes: Recipe[]; me: Me; onClose: () => void; onSaved: () => void }) {
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  return <><MealSheet meal={null} initial={schoolLunchDraft(lunch, memberId)} recipes={recipes} admin={me.scope === 'admin'} owner={me.owner} me={me} onClose={onClose} onSaved={onSaved} onRecipe={setRecipe} />{recipe && <RecipeSheet recipe={recipe} library={recipes} admin={false} onClose={() => setRecipe(null)} onSaved={() => setRecipe(null)} />}</>
}

export function SchoolLunchRow({ lunch, onOpen, next = false }: { lunch: SchoolLunchFallback; onOpen: () => void; next?: boolean }) {
  const { members } = useApp()
  return <li><button type="button" className={`snap-row school-menu-row${next ? ' today-meal-next' : ''}`} onClick={onOpen}>
    <span className="snap-main"><span className="board-when">{next ? t('School lunch · Next') : t('School lunch')} · {lunch.schoolName}</span><span className="snap-title">{lunch.title}</span>
      <EaterAvatars ids={lunch.eaterIds} members={members} /><span className="snap-meta">{t('From the school menu')}</span></span>
  </button></li>
}
