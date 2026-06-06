import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

interface AppLayoutProps {
  children: React.ReactNode
}

// Minimalistic SVG Icons
export const ListIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6"></line>
    <line x1="8" y1="12" x2="21" y2="12"></line>
    <line x1="8" y1="18" x2="21" y2="18"></line>
    <line x1="3" y1="6" x2="3.01" y2="6"></line>
    <line x1="3" y1="12" x2="3.01" y2="12"></line>
    <line x1="3" y1="18" x2="3.01" y2="18"></line>
  </svg>
)

export const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
)

export const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
  </svg>
)

export default function AppLayout({ children }: AppLayoutProps) {
  const navigate = useNavigate()
  const location = useLocation()
  
  const currentPath = location.pathname

  return (
    <div className="app-container">
      {/* Sidebar Navigation - Shared Desktop view */}
      <div className="desktop-sidebar">
        <div>
          <h1 
            onClick={() => navigate('/')}
            style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--color-text)', marginBottom: 28, cursor: 'pointer' }}
          >
            PingMe
          </h1>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button 
              onClick={() => navigate('/')}
              style={{ 
                width: '100%', 
                padding: '10px 14px', 
                justifyContent: 'flex-start',
                background: currentPath === '/' ? 'var(--color-text)' : 'transparent',
                color: currentPath === '/' ? 'var(--color-bg)' : 'var(--color-text)',
                borderColor: currentPath === '/' ? 'var(--color-text)' : 'var(--color-border)',
                fontWeight: currentPath === '/' ? 700 : 500
              }}
            >
              <ListIcon />
              <span>Reminders</span>
            </button>
            <button 
              onClick={() => navigate('/new')}
              style={{ 
                width: '100%', 
                padding: '10px 14px', 
                justifyContent: 'flex-start',
                background: currentPath === '/new' ? 'var(--color-text)' : 'transparent',
                color: currentPath === '/new' ? 'var(--color-bg)' : 'var(--color-text)',
                borderColor: currentPath === '/new' ? 'var(--color-text)' : 'var(--color-border)',
                fontWeight: currentPath === '/new' ? 700 : 500
              }}
            >
              <PlusIcon />
              <span>New Reminder</span>
            </button>
            <button 
              onClick={() => navigate('/settings')}
              style={{ 
                width: '100%', 
                padding: '10px 14px', 
                justifyContent: 'flex-start',
                background: currentPath === '/settings' ? 'var(--color-text)' : 'transparent',
                color: currentPath === '/settings' ? 'var(--color-bg)' : 'var(--color-text)',
                borderColor: currentPath === '/settings' ? 'var(--color-text)' : 'var(--color-border)',
                fontWeight: currentPath === '/settings' ? 700 : 500
              }}
            >
              <SettingsIcon />
              <span>Settings</span>
            </button>
          </nav>
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            System Status
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-text)', display: 'inline-block' }}></span>
            Sync Active
          </div>
        </div>
      </div>

      {/* Main Content Pane */}
      {children}
    </div>
  )
}
