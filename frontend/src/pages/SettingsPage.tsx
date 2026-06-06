import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSettings, saveSettings, getAllCategories, addCategory, updateCategory, deleteCategory } from '../db'
import { pushSettingsToWorker } from '../services/workerApi'
import { Settings, Category } from '../types'
import { generateId } from '../services/timeUtils'

export const ArrowLeftIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
    <line x1="19" y1="12" x2="5" y2="12"></line>
    <polyline points="12 19 5 12 12 5"></polyline>
  </svg>
)

export const EditIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
    <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
  </svg>
)

export const TrashIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}>
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>
)

export const LockIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
  </svg>
)

export const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}>
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
)

export default function SettingsPage() {
  const navigate = useNavigate()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [newCategoryName, setNewCategoryName] = useState('')
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [editingCategoryName, setEditingCategoryName] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    async function load() {
      const [s, c] = await Promise.all([getSettings(), getAllCategories()])
      setSettings(s)
      setCategories(c)
    }
    load()
  }, [])

  async function handleSave() {
    if (!settings) return
    await saveSettings(settings)
    pushSettingsToWorker(settings).catch(() => {})
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleAddCategory(e?: React.FormEvent) {
    if (e) e.preventDefault()
    if (!newCategoryName.trim()) return
    const name = newCategoryName.trim()
    const cat: Category = { id: generateId(), name, isPersistent: false, order: categories.length }
    await addCategory(cat)
    setCategories(prev => [...prev, cat])
    setNewCategoryName('')
  }

  async function handleDeleteCategory(id: string) {
    if (confirm('Are you sure you want to delete this category? Any reminders inside will be moved to Inbox.')) {
      await deleteCategory(id)
      setCategories(prev => prev.filter(c => c.id !== id))
    }
  }

  async function startEditing(cat: Category) {
    setEditingCategoryId(cat.id)
    setEditingCategoryName(cat.name)
  }

  async function saveCategoryRename() {
    if (!editingCategoryId || !editingCategoryName.trim()) return
    const id = editingCategoryId
    const name = editingCategoryName.trim()
    const cat = categories.find(c => c.id === id)
    if (!cat) return
    const updated = { ...cat, name }
    await updateCategory(updated)
    setCategories(prev => prev.map(c => c.id === id ? updated : c))
    setEditingCategoryId(null)
  }

  if (!settings) {
    return (
      <div style={{ padding: 24, display: 'flex', justifyContent: 'center', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
        Loading…
      </div>
    )
  }

  return (
    <div className="dashboard-layout">
      {/* Top Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
        <button 
          onClick={() => navigate(-1)} 
          style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg)', padding: '8px 14px', fontSize: 13, borderRadius: 'var(--radius-md)', display: 'inline-flex', alignItems: 'center' }}
        >
          <ArrowLeftIcon />
          <span>Back</span>
        </button>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--color-text)' }}>Settings</h1>
      </div>

      {/* Toast notification */}
      {saved && (
        <div style={{
          position: 'fixed',
          top: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--color-text)',
          color: 'var(--color-bg)',
          padding: '12px 24px',
          borderRadius: 'var(--radius-md)',
          fontWeight: 600,
          border: '1px solid var(--color-text)',
          zIndex: 1000,
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          Saved successfully
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* Section: You */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>You</h2>
          <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6, fontWeight: 600 }}>Your Name</label>
              <input 
                value={settings.name} 
                onChange={e => setSettings({ ...settings, name: e.target.value })} 
                placeholder="e.g. John Doe" 
                style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg)' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6, fontWeight: 600 }}>Phone Number</label>
              <input 
                type="tel"
                value={settings.phoneNumber} 
                onChange={e => setSettings({ ...settings, phoneNumber: e.target.value })} 
                placeholder="+14165550123" 
                style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg)' }}
              />
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 6, display: 'block', lineHeight: 1.4 }}>Used for reminder calls (E.164 format: +1 followed by digits)</span>
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6, fontWeight: 600 }}>Timezone</label>
              <input 
                value={settings.timezone} 
                readOnly 
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-secondary)', cursor: 'not-allowed' }} 
              />
            </div>
          </div>
        </div>

        {/* Section: Preset push times */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Preset push times</h2>
          <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 18 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {(['morning', 'afternoon', 'evening', 'night'] as const).map(slot => (
                <div key={slot} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: 13, color: 'var(--color-text-secondary)', textTransform: 'capitalize', fontWeight: 600 }}>{slot}</label>
                  <input 
                    type="time" 
                    value={settings.presets[slot]} 
                    onChange={e => setSettings({
                      ...settings,
                      presets: {
                        ...settings.presets,
                        [slot]: e.target.value
                      }
                    })} 
                    style={{ 
                      border: '1px solid var(--color-border)', 
                      borderRadius: 'var(--radius-md)', 
                      background: 'var(--color-bg)',
                      padding: '4px 8px',
                      fontSize: '13px',
                      height: '32px',
                      width: '100px',
                      flexShrink: 0
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Section: Call settings */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Call settings</h2>
          <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Re-ping interval:</span>
              <input 
                type="number" 
                value={settings.repingIntervalMinutes || ''} 
                onChange={e => setSettings({ ...settings, repingIntervalMinutes: parseInt(e.target.value) || 10 })} 
                style={{ width: 80, padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg)' }}
              />
              <span style={{ fontSize: 14, fontWeight: 600 }}>minutes</span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
              If a call goes unanswered, PingMe will try again after this many minutes. After 3 unanswered calls, it will stop calling.
            </p>
          </div>
        </div>

        {/* Section: Categories */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Categories</h2>
          <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {categories.map((cat) => {
                if (cat.isPersistent) return null
                const isEditing = editingCategoryId === cat.id
                return (
                  <div 
                    key={cat.id} 
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px 18px',
                      borderBottom: '1px solid var(--color-border)'
                    }}
                  >
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                        <input 
                          value={editingCategoryName} 
                          onChange={e => setEditingCategoryName(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && saveCategoryRename()}
                          autoFocus
                          style={{ padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg)' }}
                        />
                        <button className="primary" onClick={saveCategoryRename} style={{ padding: '6px 12px' }}>Save</button>
                        <button onClick={() => setEditingCategoryId(null)} style={{ padding: '6px 12px', border: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>Cancel</button>
                      </div>
                    ) : (
                      <>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{cat.name}</span>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={() => startEditing(cat)} style={{ padding: '6px 10px', fontSize: 12, border: '1px solid var(--color-border)', background: 'var(--color-bg)', display: 'inline-flex', alignItems: 'center' }}>
                            <EditIcon />
                            Rename
                          </button>
                          <button className="danger" onClick={() => handleDeleteCategory(cat.id)} style={{ padding: '6px 10px', fontSize: 12, display: 'inline-flex', alignItems: 'center' }}>
                            <TrashIcon />
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
              
              {/* Persistent Categories (Lock icon, Read-only) */}
              {categories.map((cat) => {
                if (!cat.isPersistent) return null
                return (
                  <div 
                    key={cat.id} 
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px 18px',
                      background: 'var(--color-bg-secondary)',
                      borderBottom: '1px solid var(--color-border)',
                      color: 'var(--color-text-secondary)'
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{cat.name}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.02em', display: 'flex', alignItems: 'center' }}>
                      <LockIcon />
                      Locked
                    </span>
                  </div>
                )
              })}

              {/* Add Category Row */}
              <form onSubmit={handleAddCategory} style={{ display: 'flex', gap: 8, padding: 18 }}>
                <input 
                  value={newCategoryName} 
                  onChange={e => setNewCategoryName(e.target.value)} 
                  placeholder="New category name"
                  style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg)' }}
                />
                <button type="submit" className="primary" style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}>
                  <PlusIcon />
                  Add
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <button 
          onClick={handleSave} 
          className="primary"
          style={{
            width: '100%',
            padding: 16,
            fontSize: 15,
            fontWeight: 700,
            borderRadius: 'var(--radius-lg)',
            marginTop: 12
          }}
        >
          Save All Settings
        </button>
      </div>
    </div>
  )
}
export { addCategory, updateCategory, deleteCategory, generateId }