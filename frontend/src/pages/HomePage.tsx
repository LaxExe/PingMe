import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAllReminders, getAllCategories, deleteReminder, updateReminder, getSettings } from '../db'
import { Reminder, Category, PresetTimes } from '../types'
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
    <div className="app-container">
      {/* Sidebar Navigation - Desktop App view */}
      <div className="desktop-sidebar">
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--color-text)', marginBottom: 28 }}>
            PingMe
          </h1>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button 
              className="primary" 
              onClick={() => navigate('/new')}
              style={{ width: '100%', padding: '12px', justifyContent: 'center' }}
            >
              ＋ New Reminder
            </button>
            <button 
              onClick={() => navigate('/settings')}
              style={{ width: '100%', padding: '12px', justifyContent: 'center', marginTop: 8 }}
            >
              ⚙️ Settings
            </button>
          </nav>
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            System Status
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-text)', display: 'inline-block' }}></span>
            Active and Syncing
          </div>
        </div>
      </div>

      {/* Main Dashboard Layout */}
      <div className="dashboard-layout">
        
        {/* Top Bar - Mobile only */}
        <div className="mobile-only" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--color-text)' }}>PingMe</h1>
          <button 
            onClick={() => navigate('/settings')}
            style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg)', width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}
          >
            ⚙️
          </button>
        </div>

        {/* Main Categories and Reminders */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
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
                  gap: 12
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
                    paddingBottom: 4,
                    borderBottom: '1px solid var(--color-border)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {cat.name}
                    </span>
                    <span style={{ fontSize: 11, background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', padding: '2px 8px', borderRadius: 12, fontWeight: 600 }}>
                      {catReminders.length}
                    </span>
                  </div>
                  {!cat.isPersistent && (
                    <span style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>
                      {isCollapsed ? '▼' : '▲'}
                    </span>
                  )}
                </div>

                {/* Reminders List */}
                {!isCollapsed && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {catReminders.length === 0 ? (
                      <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', fontStyle: 'italic', padding: '16px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--color-border)', textAlign: 'center' }}>
                        No reminders in this list
                      </div>
                    ) : (
                      catReminders.map(reminder => {
                        const isSwiped = swipedReminderId === reminder.id
                        
                        return (
                          <div 
                            key={reminder.id}
                            className="reminder-card-container"
                          >
                            {/* Underlay Delete Button - Swipe trigger on mobile */}
                            <div 
                              className="mobile-only"
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

                            {/* Card Content wrapper */}
                            <div
                              className="reminder-card-content"
                              onTouchStart={(e) => handleTouchStart(e, reminder.id)}
                              onTouchMove={handleTouchMove}
                              onTouchEnd={(e) => handleTouchEnd(e, reminder.id)}
                              onMouseDown={(e) => handleMouseDown(e, reminder.id)}
                              onMouseUp={handleMouseUp}
                              style={{
                                transform: isSwiped ? 'translateX(-80px)' : 'translateX(0px)',
                                cursor: 'grab'
                              }}
                            >
                              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.4 }}>
                                {reminder.text}
                              </div>
                              
                              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 4 }}>
                                {/* Next Ping Time */}
                                <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <span>🔔</span> {formatDateTime(reminder.nextPingAt)}
                                </span>

                                {/* Recurrence Badge */}
                                {reminder.recurrence !== 'none' && (
                                  <span style={{ fontSize: 11, background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text)', padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontWeight: 600 }}>
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
                                      background: 'var(--color-bg)', 
                                      color: 'var(--color-danger)', 
                                      padding: '2px 8px', 
                                      borderRadius: 'var(--radius-sm)', 
                                      fontWeight: 700,
                                      cursor: 'pointer',
                                      border: '1px solid var(--color-danger)'
                                    }}
                                  >
                                    ⚠️ Tap to reschedule calls
                                  </span>
                                )}
                              </div>

                              {/* Desktop Hover Action - Delete Button */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDelete(reminder.id)
                                }}
                                className="desktop-action-btn danger"
                                style={{
                                  position: 'absolute',
                                  right: 12,
                                  top: '50%',
                                  transform: 'translateY(-50%)',
                                  padding: '8px 12px',
                                  fontSize: 13,
                                  zIndex: 3
                                }}
                              >
                                🗑️ Delete
                              </button>
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

        {/* Floating Action Button - Mobile only */}
        <button
          onClick={() => navigate('/new')}
          className="mobile-only"
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            borderRadius: '50%',
            width: 56,
            height: 56,
            fontSize: 28,
            background: 'var(--color-text)',
            color: 'var(--color-bg)',
            border: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            cursor: 'pointer'
          }}
        >
          ＋
        </button>

        {/* Rescheduling Modal Overlay */}
        {reschedulingReminder && presets && (
          <div 
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.4)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: window.innerWidth > 768 ? 'center' : 'flex-end',
              justifyContent: 'center',
              zIndex: 1000,
              animation: 'fadeIn 0.2s ease-out'
            }}
            onClick={() => setReschedulingReminder(null)}
          >
            <div 
              style={{
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                width: '100%',
                maxWidth: 460,
                borderTopLeftRadius: 'var(--radius-lg)',
                borderTopRightRadius: 'var(--radius-lg)',
                borderBottomLeftRadius: window.innerWidth > 768 ? 'var(--radius-lg)' : 0,
                borderBottomRightRadius: window.innerWidth > 768 ? 'var(--radius-lg)' : 0,
                padding: 24,
                display: 'flex',
                flexDirection: 'column',
                gap: 20,
                boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
                animation: 'slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
              }}
              onClick={e => e.stopPropagation()}
            >
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>Reschedule Reminder</h3>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>"{reschedulingReminder.text}"</p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Today options */}
                {!isTonightPast(presets) && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Today</div>
                    {getTodayOptions(presets).map(opt => (
                      <button 
                        key={opt.slot} 
                        onClick={() => handleRescheduleSelect(opt.timestamp)}
                        style={{ width: '100%', padding: '12px 14px', textAlign: 'left', display: 'flex', justifyContent: 'space-between', background: 'var(--color-bg)' }}
                      >
                        <span style={{ fontWeight: 600 }}>{opt.label}</span>
                        <span style={{ color: 'var(--color-text-secondary)' }}>
                          {new Date(opt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </button>
                    ))}
                  </>
                )}

                {/* Tomorrow options */}
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>Tomorrow</div>
                {getTomorrowOptions(presets).map(opt => (
                  <button 
                    key={opt.slot} 
                    onClick={() => handleRescheduleSelect(opt.timestamp)}
                    style={{ width: '100%', padding: '12px 14px', textAlign: 'left', display: 'flex', justifyContent: 'space-between', background: 'var(--color-bg)' }}
                  >
                    <span style={{ fontWeight: 600 }}>{opt.label}</span>
                    <span style={{ color: 'var(--color-text-secondary)' }}>
                      {new Date(opt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </button>
                ))}
              </div>

              <button 
                onClick={() => setReschedulingReminder(null)}
                style={{ width: '100%', padding: 12, border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', fontWeight: 600 }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
export { formatDateTime }