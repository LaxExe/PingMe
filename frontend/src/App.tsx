import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { seedDefaults, getAllReminders, updateReminder, getDB, triggerPushSync } from './db'
import { syncFromWorker, pullDbFromWorker } from './services/workerApi'
import HomePage from './pages/HomePage'
import NewReminderPage from './pages/NewReminderPage'
import SettingsPage from './pages/SettingsPage'
import AppLayout from './components/AppLayout'

export default function App() {
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
      setRefreshKey(k => k + 1)
      await doSync()
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

  return (
    <BrowserRouter>
      <AppLayout>
        <Routes>
          <Route path="/" element={<HomePage refreshKey={refreshKey} />} />
          <Route path="/new" element={<NewReminderPage onSaved={() => { setRefreshKey(k => k + 1) }} />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  )
}