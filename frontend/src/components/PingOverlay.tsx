import { useEffect, useState } from 'react'
import { Reminder } from '../types'
import { updateReminder, deleteReminder, getSettings } from '../db'
import { startRing, stopRing } from '../scheduler'
import { scheduleReminder, cancelSchedule } from '../services/workerApi'
import { getTodayOptions, getTomorrowOptions, isTonightPast } from '../services/timeUtils'

interface Props {
  reminder: Reminder
  onResolved: () => void
}

type Screen = 'main' | 'snooze' | 'push-day' | 'push-today' | 'push-tomorrow'

export default function PingOverlay({ reminder, onResolved }: Props) {
  const [screen, setScreen] = useState<Screen>('main')
  const [snoozeInput, setSnoozeInput] = useState('')
  const [presets, setPresets] = useState<{ morning: string; afternoon: string; evening: string; night: string } | null>(null)

  useEffect(() => {
    startRing(reminder.text)
    getSettings().then(s => setPresets(s.presets))
    return () => stopRing()
  }, [reminder])

  async function handleDone() {
    stopRing()
    if (reminder.isPersistent) {
      await updateReminder({ ...reminder, status: 'done', callsStopped: false, attemptCount: 0 })
    } else {
      await deleteReminder(reminder.id)
      cancelSchedule(reminder.id).catch(() => {})
    }
    onResolved()
  }

  async function handleSnooze(minutes: number) {
    stopRing()
    const nextPingAt = Date.now() + minutes * 60 * 1000
    const updated: Reminder = { ...reminder, status: 'snoozed', nextPingAt, attemptCount: 0, callsStopped: false }
    await updateReminder(updated)
    scheduleReminder(updated).catch(() => {})
    onResolved()
  }

  async function handlePush(timestamp: number) {
    stopRing()
    const updated: Reminder = { ...reminder, status: 'pushed', nextPingAt: timestamp, attemptCount: 0, callsStopped: false }
    await updateReminder(updated)
    scheduleReminder(updated).catch(() => {})
    onResolved()
  }

  if (!presets) return null

  const todayOptions = getTodayOptions(presets)
  const tomorrowOptions = getTomorrowOptions(presets)
  const tonightPast = isTonightPast(presets)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.5)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
      animation: 'fadeIn 0.25s ease-out'
    }}>
      <div style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
        padding: 32,
        width: '100%',
        maxWidth: 420,
        display: 'flex',
        flexDirection: 'column',
        animation: 'scaleUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
      }}>
        {/* Header Label */}
        <p style={{ 
          fontSize: 11, 
          fontWeight: 700, 
          color: 'var(--color-text-tertiary)', 
          textTransform: 'uppercase', 
          letterSpacing: '0.08em',
          marginBottom: 8 
        }}>
          Reminder Alert
        </p>

        {/* Reminder Text */}
        <p style={{ 
          fontSize: 22, 
          fontWeight: 700, 
          lineHeight: 1.35,
          color: 'var(--color-text)',
          marginBottom: 28,
          letterSpacing: '-0.01em'
        }}>
          {reminder.text}
        </p>

        {/* Main Screen */}
        {screen === 'main' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button 
              onClick={handleDone} 
              className="primary"
              style={{ 
                padding: '16px', 
                borderRadius: 'var(--radius-md)', 
                fontWeight: 700,
                fontSize: 16,
                width: '100%'
              }}
            >
              ✓ Done
            </button>
            <button 
              onClick={() => setScreen('snooze')} 
              style={{ 
                padding: '14px', 
                fontSize: 15,
                fontWeight: 600,
                borderColor: 'var(--color-border)',
                background: 'var(--color-bg)',
                width: '100%'
              }}
            >
              Snooze
            </button>
            <button 
              onClick={() => tonightPast ? setScreen('push-tomorrow') : setScreen('push-day')} 
              style={{ 
                padding: '14px',
                fontSize: 15,
                fontWeight: 600,
                borderColor: 'var(--color-border)',
                background: 'var(--color-bg)',
                width: '100%'
              }}
            >
              Push to later
            </button>
          </div>
        )}

        {/* Snooze Screen */}
        {screen === 'snooze' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Snooze for how long?</p>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[5, 15, 30, 60, 180].map(m => (
                <button 
                  key={m} 
                  onClick={() => handleSnooze(m)}
                  style={{ padding: '12px 8px', fontSize: 14, fontWeight: 600, border: '1px solid var(--color-border)', background: 'var(--color-bg)' }}
                >
                  {m < 60 ? `${m} min` : `${m / 60} hr`}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <input
                type="number" 
                max="999" 
                placeholder="Custom minutes"
                value={snoozeInput}
                onChange={e => setSnoozeInput(e.target.value.slice(0, 3))}
                style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg)' }}
              />
              {snoozeInput && (
                <button 
                  onClick={() => handleSnooze(parseInt(snoozeInput))}
                  className="primary"
                  style={{ padding: '10px 16px', fontWeight: 700 }}
                >
                  Confirm
                </button>
              )}
            </div>

            <button 
              onClick={() => setScreen('main')} 
              style={{ 
                marginTop: 8, 
                color: 'var(--color-text-secondary)', 
                border: 'none', 
                background: 'none',
                alignSelf: 'center',
                fontSize: 13,
                fontWeight: 600
              }}
            >
              ← Back
            </button>
          </div>
        )}

        {/* Push Day Screen */}
        {screen === 'push-day' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>When would you like to push this to?</p>
            <button 
              onClick={() => setScreen(todayOptions.length ? 'push-today' : 'push-tomorrow')}
              style={{ padding: '14px', fontSize: 15, fontWeight: 600, border: '1px solid var(--color-border)', background: 'var(--color-bg)' }}
            >
              Today
            </button>
            <button 
              onClick={() => setScreen('push-tomorrow')}
              style={{ padding: '14px', fontSize: 15, fontWeight: 600, border: '1px solid var(--color-border)', background: 'var(--color-bg)' }}
            >
              Tomorrow
            </button>
            <button 
              onClick={() => setScreen('main')} 
              style={{ 
                marginTop: 8, 
                color: 'var(--color-text-secondary)', 
                border: 'none', 
                background: 'none',
                alignSelf: 'center',
                fontSize: 13,
                fontWeight: 600
              }}
            >
              ← Back
            </button>
          </div>
        )}

        {/* Push Today Screen */}
        {screen === 'push-today' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {todayOptions.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>Tonight has passed — showing tomorrow's options.</p>
            ) : (
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Available slots for today:</p>
            )}
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(todayOptions.length ? todayOptions : tomorrowOptions).map(opt => (
                <button 
                  key={opt.slot} 
                  onClick={() => handlePush(opt.timestamp)}
                  style={{ 
                    padding: '14px 16px', 
                    fontSize: 14, 
                    fontWeight: 600,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)'
                  }}
                >
                  <span>{opt.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    {new Date(opt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
              ))}
            </div>

            <button 
              onClick={() => setScreen('push-day')} 
              style={{ 
                marginTop: 8, 
                color: 'var(--color-text-secondary)', 
                border: 'none', 
                background: 'none',
                alignSelf: 'center',
                fontSize: 13,
                fontWeight: 600
              }}
            >
              ← Back
            </button>
          </div>
        )}

        {/* Push Tomorrow Screen */}
        {screen === 'push-tomorrow' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {tonightPast ? (
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>Tonight's options have passed. Schedule for tomorrow:</p>
            ) : (
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Tomorrow's preset times:</p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {tomorrowOptions.map(opt => (
                <button 
                  key={opt.slot} 
                  onClick={() => handlePush(opt.timestamp)}
                  style={{ 
                    padding: '14px 16px', 
                    fontSize: 14, 
                    fontWeight: 600,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)'
                  }}
                >
                  <span>{opt.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    {new Date(opt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
              ))}
            </div>

            {!tonightPast && (
              <button 
                onClick={() => setScreen('push-day')} 
                style={{ 
                  marginTop: 8, 
                  color: 'var(--color-text-secondary)', 
                  border: 'none', 
                  background: 'none',
                  alignSelf: 'center',
                  fontSize: 13,
                  fontWeight: 600
                }}
              >
                ← Back
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
export { getTodayOptions, getTomorrowOptions, isTonightPast }