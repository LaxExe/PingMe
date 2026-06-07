import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAllReminders, getAllCategories, deleteReminder, updateReminder, getSettings } from '../db'
import { Reminder, Category, PresetTimes } from '../types'
import { formatDateTime, getTodayOptions, getTomorrowOptions, isTonightPast } from '../services/timeUtils'
import { cancelSchedule, scheduleReminder } from '../services/workerApi'

interface Props {
  refreshKey: number
}

// Minimalistic Monochrome SVGs
export const SettingsIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
  </svg>
)

export const PlusIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
)

export const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    <line x1="10" y1="11" x2="10" y2="17"></line>
    <line x1="14" y1="11" x2="14" y2="17"></line>
  </svg>
)

export const BellIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, flexShrink: 0 }}>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
  </svg>
)

export const RepeatIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, flexShrink: 0 }}>
    <polyline points="17 1 21 5 17 9"></polyline>
    <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
    <polyline points="7 23 3 19 7 15"></polyline>
    <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
  </svg>
)

export const AlertIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6, flexShrink: 0 }}>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
    <line x1="12" y1="9" x2="12" y2="13"></line>
    <line x1="12" y1="17" x2="12.01" y2="17"></line>
  </svg>
)

export const LockIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6, flexShrink: 0 }}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
  </svg>
)

export default function HomePage({ refreshKey }: Props) {
  const navigate = useNavigate()
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [presets, setPresets] = useState<PresetTimes | null>(null)
  
  // Collapse state: key is categoryId, value is boolean (true if collapsed)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  
  // Swipe-to-delete state for mobile swipe gesture
  const [swipedReminderId, setSwipedReminderId] = useState<string | null>(null)
  const touchStartX = useRef<number>(0)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  // Drag and drop states
  const [draggedReminderId, setDraggedReminderId] = useState<string | null>(null)
  const [dragOverCategoryId, setDragOverCategoryId] = useState<string | null>(null)

  // Rescheduling modal state
  const [reschedulingReminder, setReschedulingReminder] = useState<Reminder | null>(null)

  useEffect(() => {
    async function load() {
      const [r, c, s] = await Promise.all([getAllReminders(), getAllCategories(), getSettings()])
      setReminders(r)
      setCategories(c)
      if (s) setPresets(s.presets)
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
    }
    setSwipedReminderId(null)
  }

  // --- Drag and Drop Handlers ---
  const handleDragStart = (e: React.DragEvent, reminderId: string) => {
    e.dataTransfer.setData('text/plain', reminderId)
    setDraggedReminderId(reminderId)
  }

  const handleDrop = async (e: React.DragEvent, targetCategoryId: string) => {
    e.preventDefault()
    const reminderId = e.dataTransfer.getData('text/plain') || draggedReminderId
    if (!reminderId) return

    const reminder = reminders.find(r => r.id === reminderId)
    if (reminder && reminder.categoryId !== targetCategoryId) {
      const updated: Reminder = {
        ...reminder,
        categoryId: targetCategoryId,
        isPersistent: targetCategoryId === 'persistent'
      }
      await updateReminder(updated)
      await scheduleReminder(updated).catch(() => {})

      const r = await getAllReminders()
      setReminders(r)
    }
    setDraggedReminderId(null)
  }

  // --- Touch Swipe Gestures (Mobile only) ---
  const handleTouchStart = (e: React.TouchEvent, reminderId: string) => {
    touchStartX.current = e.touches[0].clientX
    
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    longPressTimer.current = setTimeout(() => {
      setSwipedReminderId(reminderId)
    }, 600)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    const touchMoveX = e.touches[0].clientX
    const diff = touchStartX.current - touchMoveX
    
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
      setSwipedReminderId(reminderId)
    } else if (diff < -50) {
      if (swipedReminderId === reminderId) {
        setSwipedReminderId(null)
      }
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
    <div className="dashboard-layout">
      
      {/* Top Bar - Mobile only header */}
      <div className="mobile-only" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--color-text)' }}>PingMe</h1>
        <button 
          onClick={() => navigate('/settings')}
          style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg)', width: 52, height: 52, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <SettingsIcon />
        </button>
      </div>

      {/* Desktop Header */}
      <div className="desktop-only" style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--color-text)' }}>Reminders</h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>Manage and track your active reminder triggers.</p>
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
                  paddingBottom: 6,
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
                  <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', width: 14, textAlign: 'center' }}>
                    {isCollapsed ? '▼' : '▲'}
                  </span>
                )}
              </div>

              {/* Reminders List - Droppable Area */}
              {!isCollapsed && (
                <div 
                  onDragEnter={(e) => { e.preventDefault(); setDragOverCategoryId(cat.id); }}
                  onDragOver={(e) => e.preventDefault()}
                  onDragLeave={() => setDragOverCategoryId(null)}
                  onDrop={(e) => { handleDrop(e, cat.id); setDragOverCategoryId(null); }}
                  style={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: 10,
                    padding: '8px',
                    borderRadius: 'var(--radius-lg)',
                    border: dragOverCategoryId === cat.id ? '1px dashed var(--color-text)' : '1px solid transparent',
                    background: dragOverCategoryId === cat.id ? 'var(--color-bg-secondary)' : 'transparent',
                    transition: 'all 0.2s ease',
                    minHeight: 48
                  }}
                >
                  {catReminders.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', fontStyle: 'italic', padding: '16px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--color-border)', textAlign: 'center', width: '100%' }}>
                      No reminders in this list
                    </div>
                  ) : (
                    catReminders.map(reminder => {
                      const isSwiped = swipedReminderId === reminder.id
                      
                      return (
                        <div 
                          key={reminder.id}
                          className="reminder-card-container"
                          draggable={true}
                          onDragStart={(e) => handleDragStart(e, reminder.id)}
                          onDragEnd={() => setDraggedReminderId(null)}
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
                              <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center' }}>
                                <BellIcon />
                                {formatDateTime(reminder.nextPingAt)}
                              </span>

                              {/* Recurrence Badge */}
                              {reminder.recurrence !== 'none' && (
                                <span style={{ fontSize: 11, background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text)', padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>
                                  <RepeatIcon />
                                  {formatRecurrence(reminder.recurrence)}
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
                                    border: '1px solid var(--color-danger)',
                                    display: 'inline-flex',
                                    alignItems: 'center'
                                  }}
                                >
                                  <AlertIcon />
                                  Tap to reschedule calls
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
                              <TrashIcon />
                              Delete
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
        <PlusIcon />
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
  )
}
export { formatDateTime }