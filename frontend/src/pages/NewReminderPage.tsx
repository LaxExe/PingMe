import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { addReminder, getAllCategories, getSettings } from '../db'
import { scheduleReminder } from '../services/workerApi'
import { generateId } from '../services/timeUtils'
import { Reminder, RecurrenceRule, Category } from '../types'

interface Props {
  onSaved: () => void
}

export const ArrowLeftIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
    <line x1="19" y1="12" x2="5" y2="12"></line>
    <polyline points="12 19 5 12 12 5"></polyline>
  </svg>
)

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

    // Determine final recurrence ruleasdf
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
    <div className="dashboard-layout">
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--color-text)' }}>New Reminder</h1>
      </div>

      {/* Form Container */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Reminder Text */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
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
            style={{ width: '100%', resize: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}
          />
          {errors.text && (
            <span style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 6, display: 'block', fontWeight: 500 }}>{errors.text}</span>
          )}
        </div>

        {/* Date + Time Picker */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
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
            style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg)' }}
          />
          {errors.scheduledAt && (
            <span style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 6, display: 'block', fontWeight: 500 }}>{errors.scheduledAt}</span>
          )}
        </div>

        {/* Recurrence Selector */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
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
                  fontWeight: recurrenceType === type ? 700 : 500,
                  background: recurrenceType === type ? 'var(--color-text)' : 'transparent',
                  color: recurrenceType === type ? 'var(--color-bg)' : 'var(--color-text)',
                  borderColor: recurrenceType === type ? 'var(--color-text)' : 'var(--color-border)',
                  borderRadius: 'var(--radius-md)'
                }}
              >
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>

          {recurrenceType === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', animation: 'slideUp 0.15s ease-out' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Every</span>
              <input
                type="number"
                min="1"
                value={customInterval}
                onChange={e => setCustomInterval(e.target.value)}
                style={{ width: 80, padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)' }}
              />
              <span style={{ fontSize: 13, fontWeight: 600 }}>minutes</span>
            </div>
          )}
        </div>

        {/* Category Dropdown */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Category
          </label>
          <select
            value={categoryId}
            onChange={e => setCategoryId(e.target.value)}
            style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg)' }}
          >
            {categories.map(cat => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
        <button
          onClick={() => navigate('/')}
          style={{
            flex: 1,
            padding: 16,
            fontSize: 15,
            fontWeight: 700,
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border)',
            background: 'transparent'
          }}
        >
          Inbox
        </button>
        <button
          onClick={handleSave}
          className="primary"
          style={{
            flex: 2,
            padding: 16,
            fontSize: 15,
            fontWeight: 700,
            borderRadius: 'var(--radius-lg)'
          }}
        >
          Save Reminder
        </button>
      </div>
    </div>
  )
}
export { getAllCategories, getSettings }