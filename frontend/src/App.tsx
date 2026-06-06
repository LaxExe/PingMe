import { useEffect, useState } from 'react'
declare module 'react-router-dom'
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import { seedDefaults, getAllReminders, updateReminder } from './db'
import { rescheduleAll, setOnPing } from './scheduler'
import { syncFromWorker } from './services/workerApi'
import { Reminder } from './types'
import HomePage from './pages/HomePage'
import NewReminderPage from './pages/NewReminderPage'
import SettingsPage from './pages/SettingsPage'
import PingOverlay from './components/PingOverlay'

function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const currentPath = location.pathname

  return (
    <div className="app-container">
      {/* Desktop Sidebar */}
      <div className="desktop-sidebar">
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--color-text)', marginBottom: 28 }}>
            PingMe
          </h1>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Link to="/" className={`sidebar-link ${currentPath === '/' ? 'active' : ''}`}>
              <span style={{ fontSize: 18 }}>🔔</span>
              <span>Reminders</span>
            </Link>
            <Link to="/new" className={`sidebar-link ${currentPath === '/new' ? 'active' : ''}`}>
              <span style={{ fontSize: 18 }}>＋</span>
              <span>New Reminder</span>
            </Link>
            <Link to="/settings" className={`sidebar-link ${currentPath === '/settings' ? 'active' : ''}`}>
              <span style={{ fontSize: 18 }}>⚙️</span>
              <span>Settings</span>
            </Link>
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

      {/* Main Content Area */}
      <div className="dashboard-layout">
        {children}
      </div>

      {/* Mobile Tab Bar */}
      <div className="mobile-tab-bar">
        <Link to="/" className={`tab-item ${currentPath === '/' ? 'active' : ''}`}>
          <span className="tab-icon">🔔</span>
          <span>Reminders</span>
        </Link>
        <Link to="/new" className={`tab-item ${currentPath === '/new' ? 'active' : ''}`}>
          <span className="tab-icon">＋</span>
          <span>New</span>
        </Link>
        <Link to="/settings" className={`tab-item ${currentPath === '/settings' ? 'active' : ''}`}>
          <span className="tab-icon">⚙️</span>
          <span>Settings</span>
        </Link>
      </div>
    </div>
  )
}

export default function App() {
  const [activePing, setActivePing] = useState<Reminder | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    async function init() {
      await seedDefaults()
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