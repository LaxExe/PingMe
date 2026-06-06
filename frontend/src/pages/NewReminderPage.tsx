import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { addReminder, getAllCategories, getSettings } from '../db'
import { scheduleReminder } from '../services/workerApi'
import { generateId } from '../services/timeUtils'
import { Reminder, RecurrenceRule, Category } from '../types'

interface Props {
  onSaved: () => void
}

export default function NewReminderPage({ onSaved }: Props) {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [recurrenceType, setRecurrenceType] = useState<'none' | 'daily' | 'weekly' | 'custom'>('none')
  const [customInterval, setCustomInterval] = useState('15')
  const [categoryId, setCategoryId] = useState('inbox')
  const [categories, setCategories] = useState<Category[]>([])
  
  // Validation errors
  const [errors, setErrors] = useState<{ text?: string; scheduledAt?: string }>({})

  // Format current time to YYYY-MM-DDTHH:MM for min attribute
  const getMinDateTimeString = () => {
    const now = new Date()
    const tzOffset = now.getTimezoneOffset() * 60000
    return new Date(now.getTime() - tzOffset).toISOString().slice(0, 16)
  }

  useEffect(() => {
    async function load() {
      const cats = await getAllCategories()
      setCategories(cats)
    }
    load()
  }, [])

  async function handleSave() {
    const newErrors: { text?: string; scheduledAt?: string } = {}
    
    if (!text.trim()) {
      newErrors.text = 'Reminder text is required'
    }

    if (!scheduledAt) {
      newErrors.scheduledAt = 'Please select a date and time'
    } else {
      const selectedTime = new Date(scheduledAt).getTime()
      if (selectedTime < Date.now()) {
        newErrors.scheduledAt = 'Scheduled time must be in the future'
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    const ts = new Date(scheduledAt).getTime()
    const settings = await getSettings()

    // Determine final recurrence rule
    let finalRecurrence: RecurrenceRule = 'none'
    if (recurrenceType === 'daily') finalRecurrence = 'daily'
    else if (recurrenceType === 'weekly') finalRecurrence = 'weekly'
    else if (recurrenceType === 'custom') {
      const mins = parseInt(customInterval)
      finalRecurrence = isNaN(mins) || mins <= 0 ? 'none' : mins
    }

    const reminder: Reminder = {
      id: generateId(),
      text: text.trim(),
      scheduledAt: ts,
      nextPingAt: ts,
      categoryId,
      recurrence: finalRecurrence,
      status: 'pending',
      isPersistent: categoryId === 'persistent',
      attemptCount: 0,
      callsStopped: false,
      createdAt: Date.now()
    }

    await addReminder(reminder)

    // Register with Worker (non-blocking)
    if (settings && settings.phoneNumber) {
      scheduleReminder(reminder).catch(() => {})
    }

    onSaved()
    navigate('/')
  }

  return (
    <div style={{ padding: 16, maxWidth: 600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button 
          onClick={() => navigate(-1)} 
          style={{ border: 'none', background: 'none', padding: '4px 8px', fontSize: 16, display: 'flex', alignItems: 'center' }}
        >
          ← Back
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>New reminder</h1>
      </div>

      {/* Form Container */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Reminder Text */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>
            What do you need to be reminded of?
          </label>
          <textarea
            value={text}
            onChange={e => {
              setText(e.target.value)
              if (errors.text) setErrors({ ...errors, text: undefined })
            }}
            placeholder="e.g. Call the bank, take medication"
            rows={4}
            autoFocus
            style={{ width: '100%', resize: 'none' }}
          />
          {errors.text && (
            <span style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 4, display: 'block' }}>{errors.text}</span>
          )}
        </div>

        {/* Date + Time Picker */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>
            First Ping Time
          </label>
          <input
            type="datetime-local"
            value={scheduledAt}
            min={getMinDateTimeString()}
            onChange={e => {
              setScheduledAt(e.target.value)
              if (errors.scheduledAt) setErrors({ ...errors, scheduledAt: undefined })
            }}
          />
          {errors.scheduledAt && (
            <span style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 4, display: 'block' }}>{errors.scheduledAt}</span>
          )}
        </div>

        {/* Recurrence Selector */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>
            Repeat
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
            {(['none', 'daily', 'weekly', 'custom'] as const).map(type => (
              <button
                key={type}
                type="button"
                onClick={() => setRecurrenceType(type)}
                style={{
                  padding: '10px 4px',
                  fontSize: 13,
                  fontWeight: recurrenceType === type ? 600 : 400,
                  background: recurrenceType === type ? 'var(--color-accent)' : 'transparent',
                  color: recurrenceType === type ? '#fff' : 'var(--color-text)',
                  borderColor: recurrenceType === type ? 'var(--color-accent)' : 'var(--color-border)'
                }}
              >
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>

          {recurrenceType === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, animation: 'fadeIn 0.15s ease-out' }}>
              <span style={{ fontSize: 14 }}>Every</span>
              <input
                type="number"
                min="1"
                value={customInterval}
                onChange={e => setCustomInterval(e.target.value)}
                style={{ width: 80, padding: '6px 10px' }}
              />
              <span style={{ fontSize: 14 }}>minutes</span>
            </div>
          )}
        </div>

        {/* Category Dropdown */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>
            Category
          </label>
          <select
            value={categoryId}
            onChange={e => setCategoryId(e.target.value)}
          >
            {categories.map(cat => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
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
          marginTop: 20
        }}
      >
        Save Reminder
      </button>
    </div>
  )
}
export { getAllCategories, getSettings }