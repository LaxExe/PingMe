import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { addReminder, getAllCategories, getSettings } from '../db'
import { scheduleReminder } from '../services/workerApi'
import { generateId } from '../services/timeUtils'
import { Reminder, RecurrenceRule, Category, PresetTimes } from '../types'

export default function NewReminderPage({ onSaved }: Props) {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [categoryId, setCategoryId] = useState('inbox')
  const [presets, setPresets] = useState<PresetTimes | null>(null)
  
  // Scheduler States
  const [selectedDay, setSelectedDay] = useState<string>('today')
  const [customDate, setCustomDate] = useState<string>('')
  
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string>('morning')
  const [customTime, setCustomTime] = useState<string>('12:00')

  // Recurrence rule
  const [recurrenceType, setRecurrenceType] = useState<'none' | 'daily' | 'weekly' | 'custom'>('none')
  const [customInterval, setCustomInterval] = useState('15')
  
  // Validation errors
  const [errors, setErrors] = useState<{ text?: string; schedule?: string }>({})

  useEffect(() => {
    async function load() {
      const [cats, settings] = await Promise.all([getAllCategories(), getSettings()])
      setCategories(cats)
      if (settings) {
        setPresets(settings.presets)
      }
    }
    load()
    
    // Set custom date default to tomorrow
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    setCustomDate(tomorrow.toISOString().split('T')[0])
  }, [])

  // Calculate preset days options dynamically
  const getSchedulerDays = () => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const results = []
    const now = new Date()
    
    results.push({ key: 'today', label: 'Today' })
    results.push({ key: 'tomorrow', label: 'Tomorrow' })
    
    // Next 3 days (offset 2, 3, 4)
    for (let i = 2; i < 5; i++) {
      const d = new Date()
      d.setDate(now.getDate() + i)
      const dayName = days[d.getDay()]
      results.push({
        key: dayName.toLowerCase(),
        label: dayName
      })
    }
    return results
  }

  const handleSave = async () => {
    const newErrors: { text?: string; schedule?: string } = {}
    
    if (!text.trim()) {
      newErrors.text = 'Reminder text is required'
    }

    // Calculate final scheduled timestamp
    let targetDate = new Date()
    
    if (selectedDay === 'today') {
      // today
    } else if (selectedDay === 'tomorrow') {
      targetDate.setDate(targetDate.getDate() + 1)
    } else if (selectedDay === 'custom') {
      if (customDate) {
        const [y, m, d] = customDate.split('-').map(Number)
        targetDate.setFullYear(y, m - 1, d)
      } else {
        newErrors.schedule = 'Please select a custom date'
      }
    } else {
      // day of week
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
      const targetDayIndex = days.indexOf(selectedDay)
      const currentDayIndex = targetDate.getDay()
      let diff = targetDayIndex - currentDayIndex
      if (diff <= 0) diff += 7
      targetDate.setDate(targetDate.getDate() + diff)
    }

    // Set time
    let timeStr = '09:00'
    const fallbackPresets = { morning: '09:00', afternoon: '13:00', evening: '18:00', night: '21:00' }
    const activePresets = presets || fallbackPresets

    if (selectedTimeSlot === 'custom') {
      if (customTime) {
        timeStr = customTime
      } else {
        newErrors.schedule = 'Please select a custom time'
      }
    } else {
      timeStr = activePresets[selectedTimeSlot as keyof PresetTimes] || '09:00'
    }

    const [hours, minutes] = timeStr.split(':').map(Number)
    targetDate.setHours(hours, minutes, 0, 0)
    const scheduledTimestamp = targetDate.getTime()

    if (scheduledTimestamp < Date.now()) {
      newErrors.schedule = 'Scheduled time must be in the future'
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

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
      scheduledAt: scheduledTimestamp,
      nextPingAt: scheduledTimestamp,
      categoryId,
      recurrence: finalRecurrence,
      status: 'pending',
      isPersistent: categoryId === 'persistent',
      attemptCount: 0,
      callsStopped: false,
      createdAt: Date.now()
    }

    await addReminder(reminder)

    // Register with Worker
    if (settings && settings.phoneNumber) {
      scheduleReminder(reminder).catch(() => {})
    }

    onSaved()
    navigate('/')
  }

  const activePresets = presets || { morning: '09:00', afternoon: '13:00', evening: '18:00', night: '21:00' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%' }}>
      {/* Page Header */}
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--color-text)' }}>New Reminder</h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 2 }}>Create a persistent reminder schedule</p>
      </div>

      {/* Main Spacious Cards Layout */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        
        {/* Card 1: Reminder Text */}
        <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 20 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Reminder text
          </label>
          <textarea
            value={text}
            onChange={e => {
              setText(e.target.value)
              if (errors.text) setErrors({ ...errors, text: undefined })
            }}
            placeholder="What needs to be done? (e.g. Turn off the oven, take medication)"
            rows={3}
            autoFocus
            style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg)', resize: 'none', width: '100%', fontSize: 15 }}
          />
          {errors.text && (
            <span style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 6, display: 'block', fontWeight: 600 }}>{errors.text}</span>
          )}
        </div>

        {/* Card 2: Custom Date & Time Scheduler */}
        <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          {/* Day selection */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Select Day
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {getSchedulerDays().map(day => (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => setSelectedDay(day.key)}
                  className={`pill-button ${selectedDay === day.key ? 'active' : ''}`}
                >
                  {day.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setSelectedDay('custom')}
                className={`pill-button ${selectedDay === 'custom' ? 'active' : ''}`}
              >
                Custom Date...
              </button>
            </div>

            {selectedDay === 'custom' && (
              <div style={{ marginTop: 12, animation: 'slideUp 0.15s ease-out' }}>
                <input
                  type="date"
                  value={customDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={e => setCustomDate(e.target.value)}
                  style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg)', maxWidth: 220 }}
                />
              </div>
            )}
          </div>

          {/* Time selection */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Select Time
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {(['morning', 'afternoon', 'evening', 'night'] as const).map(slot => (
                <button
                  key={slot}
                  type="button"
                  onClick={() => setSelectedTimeSlot(slot)}
                  className={`pill-button ${selectedTimeSlot === slot ? 'active' : ''}`}
                  style={{ textTransform: 'capitalize' }}
                >
                  {slot} ({activePresets[slot]})
                </button>
              ))}
              <button
                type="button"
                onClick={() => setSelectedTimeSlot('custom')}
                className={`pill-button ${selectedTimeSlot === 'custom' ? 'active' : ''}`}
              >
                Custom Time...
              </button>
            </div>

            {selectedTimeSlot === 'custom' && (
              <div style={{ marginTop: 12, animation: 'slideUp 0.15s ease-out' }}>
                <input
                  type="time"
                  value={customTime}
                  onChange={e => setCustomTime(e.target.value)}
                  style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg)', maxWidth: 160 }}
                />
              </div>
            )}
          </div>

          {errors.schedule && (
            <span style={{ fontSize: 12, color: 'var(--color-danger)', fontWeight: 600 }}>{errors.schedule}</span>
          )}
        </div>

        {/* Card 3: Repeat & Category options */}
        <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          
          {/* Recurrence selection */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Repeat
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', marginTop: 12, animation: 'slideUp 0.15s ease-out', maxWidth: 300 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Every</span>
                <input
                  type="number"
                  min="1"
                  value={customInterval}
                  onChange={e => setCustomInterval(e.target.value)}
                  style={{ width: 80, padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}
                />
                <span style={{ fontSize: 13, fontWeight: 600 }}>minutes</span>
              </div>
            )}
          </div>

          {/* Category selection */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Category List
            </label>
            <select
              value={categoryId}
              onChange={e => setCategoryId(e.target.value)}
              style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg)', fontSize: 14 }}
            >
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>
        </div>

      </div>

      {/* Primary Save Button */}
      <button
        onClick={handleSave}
        className="primary"
        style={{
          width: '100%',
          padding: 16,
          fontSize: 15,
          fontWeight: 700,
          borderRadius: 'var(--radius-lg)'
        }}
      >
        Save Reminder
      </button>
    </div>
  )
}

interface Props {
  onSaved: () => void
}