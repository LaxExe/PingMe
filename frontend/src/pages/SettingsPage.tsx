import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSettings, saveSettings, getAllCategories, addCategory, updateCategory, deleteCategory } from '../db'
import { pushSettingsToWorker } from '../services/workerApi'
import { Settings, Category } from '../types'
import { generateId } from '../services/timeUtils'

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
    <div style={{ padding: '24px 16px 80px 16px', maxWidth: 580, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28, animation: 'fadeIn 0.3s ease-out' }}>
      {/* Top Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button 
          onClick={() => navigate(-1)} 
          style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg)', padding: '6px 12px', fontSize: 13, borderRadius: 'var(--radius-md)' }}
        >
          ← Back
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Settings</h1>
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {(['morning', 'afternoon', 'evening', 'night'] as const).map(slot => (
              <div key={slot}>
                <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6, textTransform: 'capitalize', fontWeight: 600 }}>{slot}</label>
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
                  style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg)' }}
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
                        <button onClick={() => startEditing(cat)} style={{ padding: '6px 10px', fontSize: 12, border: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>✏️ Rename</button>
                        <button className="danger" onClick={() => handleDeleteCategory(cat.id)} style={{ padding: '6px 10px', fontSize: 12 }}>🗑️ Delete</button>
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
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.02em', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>🔒</span> Locked
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
              <button type="submit" className="primary" style={{ flexShrink: 0 }}>
                ＋ Add
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
  )
}
export { addCategory, updateCategory, deleteCategory, generateId }