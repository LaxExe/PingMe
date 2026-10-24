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
      if (!actions || actions.length === 0) return

      const all = await getAllReminders()
      let hasChanges = false

      for (const action of actions) {
        const r = all.find(x => x.id === action.reminderId)
        if (!r) continue

        if (action.type === 'done' && r.status !== 'done') {
          r.status = 'done'
          await updateReminder(r)
          hasChanges = true
        } else if (action.type === 'rescheduled') {
          r.nextPingAt = action.nextPingAt
          r.status = 'pending'
          await updateReminder(r)
          hasChanges = true
        } else if (action.type === 'callsStopped' && !r.callsStopped) {
          r.callsStopped = true
          await updateReminder(r)
          hasChanges = true
        } else if (action.type === 'attemptIncremented') {
          r.attemptCount = action.attemptCount
          await updateReminder(r)
          hasChanges = true
        }
      }

      if (hasChanges) {
        setRefreshKey(k => k + 1)
      }
    } catch {
      // Worker not configured yet or offline
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