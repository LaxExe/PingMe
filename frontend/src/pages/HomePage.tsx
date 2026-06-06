import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAllReminders, getAllCategories, deleteReminder, updateReminder, getSettings } from '../db'
import { Reminder, Category, PresetTimes, PushOption } from '../types'
import { formatDateTime, getTodayOptions, getTomorrowOptions, isTonightPast } from '../services/timeUtils'
import { rescheduleAll } from '../scheduler'
import { cancelSchedule, scheduleReminder } from '../services/workerApi'

interface Props {
  refreshKey: number
}

export default function HomePage({ refreshKey }: Props) {
  const navigate = useNavigate()
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [presets, setPresets] = useState<PresetTimes | null>(null)
  
  // Collapse state: key is categoryId, value is boolean (true if collapsed)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  
  // Swipe-to-delete state: tracks which reminder card is swiped open
  const [swipedReminderId, setSwipedReminderId] = useState<string | null>(null)
  const touchStartX = useRef<number>(0)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  // Rescheduling modal state
  const [reschedulingReminder, setReschedulingReminder] = useState<Reminder | null>(null)

  useEffect(() => {
    async function load() {
      const [r, c, s] = await Promise.all([getAllReminders(), getAllCategories(), getSettings()])
      setReminders(r)
      setCategories(c)
      if (s) setPresets(s.presets)
      await rescheduleAll()
    }
    load()
  }, [refreshKey])

  // --- Handlers ---
  const toggleCollapse = (catId: string, isPersistent: boolean) => {
    if (isPersistent) return // Persistent box never collapses
    setCollapsed(prev => ({
      ...prev,
      [catId]: !prev[catId]
    }))
  }

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this reminder?')) {
      await deleteReminder(id)
      await cancelSchedule(id).catch(() => {})
      setReminders(prev => prev.filter(r => r.id !== id))
      await rescheduleAll()
    }
    setSwipedReminderId(null)
  }

  // --- Touch / Swipe & Long-Press Gestures ---
  const handleTouchStart = (e: React.TouchEvent, reminderId: string) => {
    touchStartX.current = e.touches[0].clientX
    
    // Setup long press timer
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    longPressTimer.current = setTimeout(() => {
      setSwipedReminderId(reminderId)
    }, 600) // 600ms hold triggers delete button reveal
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    const touchMoveX = e.touches[0].clientX
    const diff = touchStartX.current - touchMoveX
    
    // If user moves finger significantly, cancel long press
    if (Math.abs(diff) > 10) {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }
    }
  }

  const handleTouchEnd = (e: React.TouchEvent, reminderId: string) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }

    const touchEndX = e.changedTouches[0].clientX
    const diff = touchStartX.current - touchEndX

    if (diff > 50) {
      // Swiped left
      setSwipedReminderId(reminderId)
    } else if (diff < -50) {
      // Swiped right - close it
      if (swipedReminderId === reminderId) {
        setSwipedReminderId(null)
      }
    }
  }

  // Desktop support
  const handleMouseDown = (e: React.MouseEvent, reminderId: string) => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    longPressTimer.current = setTimeout(() => {
      setSwipedReminderId(reminderId)
    }, 600)
  }

  const handleMouseUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  // --- Reschedule Flow ---
  const handleRescheduleSelect = async (timestamp: number) => {
    if (!reschedulingReminder) return
    
    const updated: Reminder = {
      ...reschedulingReminder,
      nextPingAt: timestamp,
      attemptCount: 0,
      callsStopped: false,
      status: 'pending'
    }

    await updateReminder(updated)
    await scheduleReminder(updated).catch(() => {})
    await rescheduleAll()
    
    // Refresh local list
    const r = await getAllReminders()
    setReminders(r)
    setReschedulingReminder(null)
  }

  // Helper to format recurrence readable text
  const formatRecurrence = (rule: Reminder['recurrence']): string => {
    if (rule === 'none') return ''
    if (rule === 'daily') return 'Daily'
    if (rule === 'weekly') return 'Weekly'
    if (typeof rule === 'number') return `Every ${rule}m`
    return ''
  }

  return (
    <div style={{ padding: '16px 16px 80px 16px', maxWidth: 600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24, position: 'relative' }}>
      
      {/* Top Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--color-accent)' }}>PingMe</h1>
        <button 
          onClick={() => navigate('/settings')}
          style={{ border: 'none', background: 'var(--color-bg-secondary)', width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}
        >
          ⚙️
        </button>
      </div>

      {/* Main Categories and Reminders */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {categories.map(cat => {
          const catReminders = reminders.filter(r => r.categoryId === cat.id && r.status !== 'done')
          const isCollapsed = collapsed[cat.id] || false
          
          return (
            <div 
              key={cat.id} 
              style={{
                order: cat.isPersistent ? 999 : cat.order, // Ensure Persistent Box is at the bottom
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}
            >
              {/* Category Header */}
              <div 
                onClick={() => toggleCollapse(cat.id, cat.isPersistent)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: cat.isPersistent ? 'default' : 'pointer',
                  padding: '4px 0'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {cat.name}
                  </span>
                  <span style={{ fontSize: 11, background: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)', padding: '2px 6px', borderRadius: 8 }}>
                    {catReminders.length}
                  </span>
                </div>
                {!cat.isPersistent && (
                  <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                    {isCollapsed ? '▼' : '▲'}
                  </span>
                )}
              </div>

              {/* Reminders List */}
              {!isCollapsed && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {catReminders.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', fontStyle: 'italic', padding: '12px 16px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', border: '0.5px dashed var(--color-border)' }}>
                      No reminders here
                    </div>
                  ) : (
                    catReminders.map(reminder => {
                      const isSwiped = swipedReminderId === reminder.id
                      
                      return (
                        <div 
                          key={reminder.id}
                          style={{
                            position: 'relative',
                            overflow: 'hidden',
                            borderRadius: 'var(--radius-lg)'
                          }}
                        >
                          {/* Underlay Delete Button */}
                          <div 
                            style={{
                              position: 'absolute',
                              right: 0,
                              top: 0,
                              bottom: 0,
                              width: 80,
                              background: 'var(--color-danger-bg)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              zIndex: 1
                            }}
                          >
                            <button 
                              onClick={() => handleDelete(reminder.id)}
                              style={{
                                width: '100%',
                                height: '100%',
                                background: 'none',
                                border: 'none',
                                color: 'var(--color-danger)',
                                fontWeight: 600,
                                padding: 0
                              }}
                            >
                              Delete
                            </button>
                          </div>

                          {/* Card Content */}
                          <div
                            onTouchStart={(e) => handleTouchStart(e, reminder.id)}
                            onTouchMove={handleTouchMove}
                            onTouchEnd={(e) => handleTouchEnd(e, reminder.id)}
                            onMouseDown={(e) => handleMouseDown(e, reminder.id)}
                            onMouseUp={handleMouseUp}
                            style={{
                              background: 'var(--color-bg)',
                              border: '0.5px solid var(--color-border)',
                              padding: '14px 16px',
                              borderRadius: 'var(--radius-lg)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                              position: 'relative',
                              zIndex: 2,
                              transition: 'transform 0.2s ease-out',
                              transform: isSwiped ? 'translateX(-80px)' : 'translateX(0px)',
                              cursor: 'grab'
                            }}
                          >
                            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-text)' }}>
                              {reminder.text}
                            </div>
                            
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 2 }}>
                              {/* Next Ping Time */}
                              <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                                🔔 {formatDateTime(reminder.nextPingAt)}
                              </span>

                              {/* Recurrence Badge */}
                              {reminder.recurrence !== 'none' && (
                                <span style={{ fontSize: 11, background: 'var(--color-accent-bg)', color: 'var(--color-accent)', padding: '2px 6px', borderRadius: 'var(--radius-sm)', fontWeight: 500 }}>
                                  🔄 {formatRecurrence(reminder.recurrence)}
                                </span>
                              )}

                              {/* Calls Stopped Warning Badge */}
                              {reminder.callsStopped && (
                                <span 
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setReschedulingReminder(reminder)
                                  }}
                                  style={{ 
                                    fontSize: 11, 
                                    background: 'var(--color-warning-bg)', 
                                    color: 'var(--color-warning)', 
                                    padding: '2px 8px', 
                                    borderRadius: 'var(--radius-sm)', 
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    border: '0.5px solid var(--color-warning)'
                                  }}
                                >
                                  ⚠️ Calls stopped — tap to reschedule
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Floating Action Button */}
      <button
        onClick={() => navigate('/new')}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          borderRadius: '50%',
          width: 56,
          height: 56,
          fontSize: 28,
          background: 'var(--color-accent)',
          color: '#fff',
          border: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
          cursor: 'pointer'
        }}
      >
        ＋
      </button>

      {/* Rescheduling Modal / Sheet overlay */}
      {reschedulingReminder && presets && (
        <div 
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={() => setReschedulingReminder(null)}
        >
          <div 
            style={{
              background: 'var(--color-bg)',
              width: '100%',
              maxWidth: 500,
              borderTopLeftRadius: 'var(--radius-lg)',
              borderTopRightRadius: 'var(--radius-lg)',
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              animation: 'slideUp 0.25s ease-out'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 600 }}>Reschedule Reminder</h3>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>"{reschedulingReminder.text}"</p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Today options */}
              {!isTonightPast(presets) && (
                <>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>Today</div>
                  {getTodayOptions(presets).map(opt => (
                    <button 
                      key={opt.slot} 
                      onClick={() => handleRescheduleSelect(opt.timestamp)}
                      style={{ width: '100%', padding: '12px 16px', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}
                    >
                      <span>{opt.label}</span>
                      <span style={{ color: 'var(--color-text-secondary)' }}>
                        {new Date(opt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </button>
                  ))}
                </>
              )}

              {/* Tomorrow options */}
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', marginTop: 8 }}>Tomorrow</div>
              {getTomorrowOptions(presets).map(opt => (
                <button 
                  key={opt.slot} 
                  onClick={() => handleRescheduleSelect(opt.timestamp)}
                  style={{ width: '100%', padding: '12px 16px', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}
                >
                  <span>{opt.label}</span>
                  <span style={{ color: 'var(--color-text-secondary)' }}>
                    {new Date(opt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
              ))}
            </div>

            <button 
              onClick={() => setReschedulingReminder(null)}
              style={{ width: '100%', padding: 12, border: 'none', background: 'var(--color-bg-secondary)', fontWeight: 500 }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
export { formatDateTime }