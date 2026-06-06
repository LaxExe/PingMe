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
      <div style={{ padding: 16, display: 'flex', justifyContent: 'center', color: 'var(--color-text-secondary)' }}>
        Loading…
      </div>
    )
  }

  return (
    <div style={{ padding: '16px 16px 80px 16px', maxWidth: 600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Top Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button 
          onClick={() => navigate(-1)} 
          style={{ border: 'none', background: 'none', padding: '4px 8px', fontSize: 16, display: 'flex', alignItems: 'center' }}
        >
          ← Back
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>Settings</h1>
      </div>

      {/* Toast notification */}
      {saved && (
        <div style={{
          position: 'fixed',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--color-success-bg)',
          color: 'var(--color-success)',
          padding: '10px 20px',
          borderRadius: 'var(--radius-md)',
          fontWeight: 500,
          border: '0.5px solid var(--color-success)',
          zIndex: 1000,
          animation: 'fadeIn 0.2s ease-out'
        }}>
          Saved successfully
        </div>
      )}

      {/* Section: You */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', tracking: '0.05em' }}>You</h2>
        <div style={{ background: 'var(--color-bg)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>Your Name</label>
            <input 
              value={settings.name} 
              onChange={e => setSettings({ ...settings, name: e.target.value })} 
              placeholder="e.g. John Doe" 
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>Phone Number</label>
            <input 
              type="tel"
              value={settings.phoneNumber} 
              onChange={e => setSettings({ ...settings, phoneNumber: e.target.value })} 
              placeholder="+14165550123" 
            />
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4, display: 'block' }}>Used for reminder calls (E.164 format: +1 followed by digits)</span>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>Timezone</label>
            <input 
              value={settings.timezone} 
              readOnly 
              style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)', cursor: 'not-allowed' }} 
            />
          </div>
        </div>
      </div>

      {/* Section: Preset push times */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', tracking: '0.05em' }}>Preset push times</h2>
        <div style={{ background: 'var(--color-bg)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {(['morning', 'afternoon', 'evening', 'night'] as const).map(slot => (
              <div key={slot}>
                <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4, textTransform: 'capitalize' }}>{slot}</label>
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
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Section: Call settings */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', tracking: '0.05em' }}>Call settings</h2>
        <div style={{ background: 'var(--color-bg)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14 }}>Re-ping interval:</span>
            <input 
              type="number" 
              value={settings.repingIntervalMinutes || ''} 
              onChange={e => setSettings({ ...settings, repingIntervalMinutes: parseInt(e.target.value) || 10 })} 
              style={{ width: 80, padding: '6px 10px' }}
            />
            <span style={{ fontSize: 14 }}>minutes</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
            If a call goes unanswered, PingMe will try again after this many minutes. After 3 unanswered calls, it will stop calling.
          </p>
        </div>
      </div>

      {/* Section: Categories */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', tracking: '0.05em' }}>Categories</h2>
        <div style={{ background: 'var(--color-bg)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
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
                    padding: '12px 16px',
                    borderBottom: '0.5px solid var(--color-border)'
                  }}
                >
                  {isEditing ? (
                    <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                      <input 
                        value={editingCategoryName} 
                        onChange={e => setEditingCategoryName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && saveCategoryRename()}
                        autoFocus
                        style={{ padding: '6px 10px' }}
                      />
                      <button onClick={saveCategoryRename} style={{ padding: '6px 12px', background: 'var(--color-accent)', color: '#fff', border: 'none' }}>Save</button>
                      <button onClick={() => setEditingCategoryId(null)} style={{ padding: '6px 12px' }}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <span style={{ fontSize: 14 }}>{cat.name}</span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => startEditing(cat)} style={{ padding: '4px 8px', fontSize: 12 }}>✏️ Edit</button>
                        <button onClick={() => handleDeleteCategory(cat.id)} style={{ padding: '4px 8px', fontSize: 12, color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}>🗑️ Delete</button>
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
                    padding: '12px 16px',
                    background: 'var(--color-bg-secondary)',
                    borderBottom: '0.5px solid var(--color-border)',
                    color: 'var(--color-text-secondary)'
                  }}
                >
                  <span style={{ fontSize: 14 }}>{cat.name}</span>
                  <span style={{ fontSize: 14 }}>🔒 Locked</span>
                </div>
              )
            })}

            {/* Add Category Row */}
            <form onSubmit={handleAddCategory} style={{ display: 'flex', gap: 8, padding: 16 }}>
              <input 
                value={newCategoryName} 
                onChange={e => setNewCategoryName(e.target.value)} 
                placeholder="New category name"
                style={{ flex: 1 }}
              />
              <button type="submit" style={{ background: 'var(--color-accent)', color: '#fff', border: 'none' }}>
                ＋ Add
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <button 
        onClick={handleSave} 
        style={{
          width: '100%',
          background: 'var(--color-accent)',
          color: '#fff',
          border: 'none',
          padding: 16,
          fontSize: 16,
          fontWeight: 600,
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