import { useEffect, useState } from 'react'

// If type declarations for 'react-router-dom' are not installed in the environment,
// provide a minimal module declaration to avoid TS "Cannot find module" errors.
declare module 'react-router-dom'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { seedDefaults, getAllReminders, updateReminder, getDB, triggerPushSync } from './db'
import { rescheduleAll, setOnPing } from './scheduler'
import { syncFromWorker, pullDbFromWorker } from './services/workerApi'
import { Reminder } from './types'
import HomePage from './pages/HomePage'
import NewReminderPage from './pages/NewReminderPage'
import SettingsPage from './pages/SettingsPage'
import PingOverlay from './components/PingOverlay'
import AppLayout from './components/AppLayout'

export default function App() {
  const [activePing, setActivePing] = useState<Reminder | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    async function init() {
      try {
        const remoteDb = await pullDbFromWorker()
        if (remoteDb && remoteDb.reminders) {
          const db = await getDB()
          // Overwrite reminders
          await db.clear('reminders')
          for (const r of remoteDb.reminders) {
            await db.put('reminders', r)
          }
          // Overwrite categories
          await db.clear('categories')
          for (const c of remoteDb.categories) {
            await db.put('categories', c)
          }
          // Overwrite settings
          await db.clear('settings')
          await db.put('settings', { ...remoteDb.settings, id: 'settings' } as never)
        } else {
          // If no remote DB exists, seed defaults and push them to the worker
          await seedDefaults()
          await triggerPushSync()
        }
      } catch (err) {
        // Fallback to local IndexedDB on network failure
        await seedDefaults()
      }
      await doSync()
      setOnPing((reminder) => setActivePing(reminder))
      await rescheduleAll()
    }
    init()
  }, [])

  async function doSync() {
    try {
      const { actions } = await syncFromWorker()
      for (const action of actions) {
        if (action.type === 'done') {
          const all = await getAllReminders()
          const r = all.find(x => x.id === action.reminderId)
          if (r) await updateReminder({ ...r, status: 'done' })
        } else if (action.type === 'rescheduled') {
          const all = await getAllReminders()
          const r = all.find(x => x.id === action.reminderId)
          if (r) await updateReminder({ ...r, nextPingAt: action.nextPingAt, status: 'pending' })
        } else if (action.type === 'callsStopped') {
          const all = await getAllReminders()
          const r = all.find(x => x.id === action.reminderId)
          if (r) await updateReminder({ ...r, callsStopped: true })
        } else if (action.type === 'attemptIncremented') {
          const all = await getAllReminders()
          const r = all.find(x => x.id === action.reminderId)
          if (r) await updateReminder({ ...r, attemptCount: action.attemptCount })
        }
      }
      setRefreshKey(k => k + 1)
    } catch {
      // Worker not configured yet — silent fail during development
    }
  }

  function handlePingResolved() {
    setActivePing(null)
    setRefreshKey(k => k + 1)
    rescheduleAll()
  }

  return (
    <BrowserRouter>
      {activePing && (
        <PingOverlay reminder={activePing} onResolved={handlePingResolved} />
      )}
      <AppLayout>
        <Routes>
          <Route path="/" element={<HomePage refreshKey={refreshKey} />} />
          <Route path="/new" element={<NewReminderPage onSaved={() => { setRefreshKey(k => k + 1); rescheduleAll() }} />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  )
}