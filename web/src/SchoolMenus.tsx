import { useEffect, useId, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import Sheet from './Sheet.tsx'
import PickField from './PickField.tsx'
import { LoadError } from './a11y.tsx'
import { useDialog } from './dialog.tsx'
import { formatDate, t } from './i18n.ts'
import { addDayKeys } from './library.ts'
import type { SchoolMenu, SchoolMenuEntry, SchoolMenuInput, SchoolMenuSettings } from './school-menus.ts'
import type { Contact } from './contact-types.ts'

export function SchoolMenuSettingsField({ schoolContactId }: { schoolContactId: string }) {
  const { refreshTick, reloadCore, toast } = useApp()
  const id = useId()
  const [data, setData] = useState<{ menus: SchoolMenu[]; setting: SchoolMenuSettings } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { let live = true; Promise.all([api.getSchoolMenus(schoolContactId), api.getSchoolMenuSettings(schoolContactId)]).then(([menus, setting]) => { if (live) { setData({ menus, setting }); setError(null) } }).catch(e => { if (live) setError(e) }); return () => { live = false } }, [schoolContactId, refreshTick])
  const save = async (setting: SchoolMenuSettings) => {
    setBusy(true)
    try { const saved = await api.putSchoolMenuSettings(schoolContactId, { lunchMenuId: setting.lunchMenuId, useForMeals: setting.useForMeals }); setData(d => d && { ...d, setting: saved }); reloadCore() }
    catch { toast(t('Could not save the school menu settings. Try again.')) }
    finally { setBusy(false) }
  }
  if (error) return <p className="field-error" role="alert">{t('Could not load the school menu settings.')}</p>
  if (!data) return <p role="status">{t('Loading school menus…')}</p>
  return <fieldset disabled={busy} className="school-menu-settings"><legend>{t('School lunch menu')}</legend>
    <PickField id={id} label={t('School lunch menu')} value={data.setting.lunchMenuId ? [data.setting.lunchMenuId] : []} none={t('None')}
      options={[{ value: '', label: t('None') }, ...data.menus.map(m => ({ value: m.id, label: m.name }))]}
      onChange={ids => void save({ ...data.setting, lunchMenuId: ids[0] || null, useForMeals: !!ids[0] && data.setting.useForMeals })} />
    <label className="school-check"><input type="checkbox" checked={data.setting.useForMeals} disabled={!data.setting.lunchMenuId || busy} onChange={e => void save({ ...data.setting, useForMeals: e.target.checked })} />{t('Show school lunch when nothing else is planned')}</label>
    <p className="field-hint">{t('Shared by the kids at this school. A lunch you plan for a child takes its place.')}</p>
    {!data.menus.length && <p className="field-hint">{t('Create a menu in School → Menus, then connect another app to add its days.')}</p>}
  </fieldset>
}

export default function SchoolMenus({ from, to, parent }: { from: string; to: string; parent: boolean }) {
  const { refreshTick, reloadCore, toast } = useApp()
  const [menus, setMenus] = useState<SchoolMenu[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [selected, setSelected] = useState('')
  const [entries, setEntries] = useState<SchoolMenuEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [entriesLoaded, setEntriesLoaded] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [tick, setTick] = useState(0)
  const [editing, setEditing] = useState<SchoolMenu | 'new' | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [configuringSchool, setConfiguringSchool] = useState<string | null>(null)
  const menu = menus.find(m => m.id === selected)
  useEffect(() => {
    let live = true
    Promise.all([api.getSchoolMenus(undefined, parent && showArchived), api.getContacts()]).then(([ms, cs]) => { if (live) { setMenus(ms); setContacts(cs); setSelected(id => ms.some(m => m.id === id) ? id : ms[0]?.id ?? ''); setLoaded(true); setError(null) } }).catch(e => { if (live) setError(e) })
    return () => { live = false }
  }, [refreshTick, tick, parent, showArchived])
  useEffect(() => {
    let live = true; setEntriesLoaded(false)
    if (selected) api.getSchoolMenuEntries(selected, from, to).then(es => { if (live) { setEntries(es); setEntriesLoaded(true); setError(null) } }).catch(e => { if (live) setError(e) })
    else { setEntries([]); setEntriesLoaded(true) }
    return () => { live = false }
  }, [selected, from, to, tick, refreshTick])
  const saved = (m?: SchoolMenu) => { setEditing(null); if (m) setSelected(m.id); setTick(n => n + 1); reloadCore() }
  const dates = Array.from({ length: 7 }, (_, i) => addDayKeys(from, i)).filter(d => d <= to)
  return <section className="school-menus" aria-label={t('School menus')}>
    <div className="school-menu-heading"><p className="field-hint">{t('What school is serving, supplied by an app your family connects.')}</p>{parent && <button className="btn btn-secondary" onClick={() => setEditing('new')}>{t('New menu')}</button>}</div>
    {error ? <LoadError what={t('school menus')} error={error} onRetry={() => setTick(n => n + 1)} /> : !loaded ? <p role="status">{t('Loading school menus…')}</p> : !menus.length ? <p className="snap-empty">{t('No school menus yet. Create a menu, then connect another app to add its days.')}</p> : <>
      <PickField id="school-menu-browse" label={t('Menu')} value={[selected]} none={t('None')} options={menus.map(m => ({ value: m.id, label: m.name, detail: contacts.find(c => c.id === m.schoolContactId)?.name ?? t('School removed') }))} onChange={ids => setSelected(ids[0] ?? '')} />
      {menu && <>
        <div className="school-menu-heading"><h2>{contacts.find(c => c.id === menu.schoolContactId)?.name ?? t('School removed')}</h2>{parent && <div className="meal-actions">{menu.schoolContactId && !menu.archived && <button className="btn btn-secondary" onClick={() => setConfiguringSchool(menu.schoolContactId)}>{t('Lunch settings')}</button>}<button className="btn btn-secondary" onClick={() => setEditing(menu)}>{t('Manage menu')}</button></div>}</div>
        {menu.archived && <p className="chip-static">{t('Archived')}</p>}
        <p className="field-hint">{menu.lastSyncedAt ? t('Last received: {date}', { date: formatDate(new Date(menu.lastSyncedAt), { dateStyle: 'medium', timeStyle: 'short' }) }) : t('No menu days received yet.')}</p>
        {menu.sourceName && <p className="field-hint">{menu.sourceName}</p>}
        {menu.sourceUrl && <p><a href={menu.sourceUrl} className="sheet-link" target="_blank" rel="noopener noreferrer">{t('View original menu')}</a></p>}
        {!entriesLoaded ? <p role="status">{t('Loading school menus…')}</p> : <div className="school-menu-days">{dates.map(date => {
          const entry = entries.find(e => e.date === date)
          return <article className="school-menu-day" key={date}><h3><time dateTime={date}>{formatDate(new Date(`${date}T12:00:00`), { weekday: 'long', month: 'short', day: 'numeric' })}</time></h3>
            <p><strong>{!entry ? t('Menu not available') : entry.availability === 'not_served' ? t('Lunch not served') : entry.title}</strong></p>
            {entry?.description && <p className="school-menu-text">{entry.description}</p>}
            {entry?.sourceUrl && <a className="sheet-link" href={entry.sourceUrl} target="_blank" rel="noopener noreferrer">{t('View original menu')}</a>}
          </article>
        })}</div>}
      </>}
    </>}
    {parent && <label className="school-check"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />{t('Show archived menus')}</label>}
    {configuringSchool && <Sheet title={t('School lunch settings')} onClose={() => setConfiguringSchool(null)}><SchoolMenuSettingsField schoolContactId={configuringSchool} /></Sheet>}
    {editing && <SchoolMenuEditor menu={editing === 'new' ? null : editing} contacts={contacts} onClose={() => setEditing(null)} onSaved={saved} toast={toast} />}
  </section>
}

function SchoolMenuEditor({ menu, contacts, onClose, onSaved, toast }: { menu: SchoolMenu | null; contacts: Contact[]; onClose: () => void; onSaved: (m?: SchoolMenu) => void; toast: (text: string) => void }) {
  const dialog = useDialog(), id = useId()
  const [name, setName] = useState(menu?.name ?? '')
  const [school, setSchool] = useState(menu?.schoolContactId ?? '')
  const [sourceName, setSourceName] = useState(menu?.sourceName ?? '')
  const [sourceUrl, setSourceUrl] = useState(menu?.sourceUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    setBusy(true); setError('')
    try {
      const input: SchoolMenuInput = { name, schoolContactId: school || null, sourceName: sourceName || null, sourceUrl: sourceUrl || null }
      const saved = menu ? await api.updateSchoolMenu(menu.id, input) : await api.createSchoolMenu(input)
      onSaved(saved); toast(t('Saved: {name}', { name: saved.name }))
    } catch { setError(t('Could not save the menu. Check its school, name and link.')) }
    finally { setBusy(false) }
  }
  const archive = async () => { if (!menu) return; setBusy(true); try { onSaved(await api.updateSchoolMenu(menu.id, { archived: !menu.archived })) } catch { setError(t('Could not save the menu. Try again.')) } finally { setBusy(false) } }
  const remove = async () => {
    if (!menu || !await dialog.confirm({ title: t('Delete “{name}”?', { name: menu.name }), body: t('This removes the menu and all its published days.'), confirmLabel: t('Delete'), danger: true })) return
    setBusy(true); try { await api.deleteSchoolMenu(menu.id); onSaved() } catch { setError(t('Could not delete the menu. Try again.')) } finally { setBusy(false) }
  }
  return <Sheet title={menu ? t('Manage menu') : t('New school menu')} onClose={onClose} dirty="auto" actions={<button className="btn btn-primary" disabled={busy || !name.trim() || !school} onClick={() => void save()}>{t('Save')}</button>}>
    <div className="field"><label htmlFor={`${id}-name`}>{t('Menu name')}</label><input id={`${id}-name`} value={name} maxLength={200} onChange={e => setName(e.target.value)} /></div>
    <PickField id={`${id}-school`} label={t('School')} search value={school ? [school] : []} none={t('Choose a school')} options={contacts.map(c => ({ value: c.id, label: c.name }))} onChange={ids => setSchool(ids[0] ?? '')} />
    <div className="field"><label htmlFor={`${id}-source`}>{t('Source name (optional)')}</label><input id={`${id}-source`} value={sourceName} maxLength={200} onChange={e => setSourceName(e.target.value)} /></div>
    <div className="field"><label htmlFor={`${id}-url`}>{t('Menu website (optional)')}</label><input id={`${id}-url`} type="url" value={sourceUrl} maxLength={2000} onChange={e => setSourceUrl(e.target.value)} /></div>
    {menu ? <div className="field"><label htmlFor={`${id}-import`}>{t('Menu ID for another app')}</label><input id={`${id}-import`} readOnly value={menu.id} /><button type="button" className="btn btn-secondary" onClick={() => void navigator.clipboard.writeText(menu.id).then(() => toast(t('Menu ID copied'))).catch(() => setError(t('Could not copy. Select the menu ID and copy it.')))}>{t('Copy menu ID')}</button><p className="field-hint">{t('Give this ID to the app that adds the menu days. Published days are read-only here.')}</p></div> : <p className="field-hint">{t('Save the menu first, then give its ID to the app that adds its days.')}</p>}
    {error && <p role="alert" className="field-error">{error}</p>}
    {menu && <div className="sheet-danger-zone"><button className="btn btn-secondary" disabled={busy} onClick={() => void archive()}>{menu.archived ? t('Restore menu') : t('Archive menu')}</button><button className="link-btn link-danger" disabled={busy} onClick={() => void remove()}>{t('Delete menu')}</button></div>}
  </Sheet>
}
