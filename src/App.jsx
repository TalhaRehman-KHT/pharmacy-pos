import { useEffect, useState } from 'react'
import Badge from './components/Badge.jsx'
import Button from './components/Button.jsx'
import Toast, { ToastRegion, ToastScope } from './components/Toast.jsx'
import { auth, setup } from './lib/api.js'
import Billing from './pages/Billing.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Expiry from './pages/Expiry.jsx'
import Login from './pages/Login.jsx'
import LowStock from './pages/LowStock.jsx'
import Medicines from './pages/Medicines.jsx'
import Reports from './pages/Reports.jsx'
import SalesHistory from './pages/SalesHistory.jsx'
import Settings from './pages/Settings.jsx'
import Setup from './pages/Setup.jsx'
import StockEntry from './pages/StockEntry.jsx'
import Users from './pages/Users.jsx'
import './App.css'

// State-based navigation; enough until the page count justifies a router dependency.
// The first page is the landing page. ownerOnly pages are hidden from a salesman; that is a
// convenience only, since the main process rejects their channels for the salesman role.
const PAGES = [
  { id: 'dashboard', label: 'Dashboard', component: Dashboard },
  { id: 'medicines', label: 'Medicines', component: Medicines },
  { id: 'stock-entry', label: 'Stock Entry', component: StockEntry },
  { id: 'billing', label: 'Billing', component: Billing },
  { id: 'sales-history', label: 'Sales History', component: SalesHistory },
  { id: 'low-stock', label: 'Low Stock', component: LowStock },
  { id: 'expiry', label: 'Expiry', component: Expiry },
  { id: 'reports', label: 'Reports', component: Reports, ownerOnly: true },
  { id: 'users', label: 'Users', component: Users, ownerOnly: true },
  { id: 'settings', label: 'Settings', component: Settings, ownerOnly: true },
]

function App() {
  // 'loading' | 'error' | 'setup' | 'signed-out' | 'signed-in'
  const [status, setStatus] = useState('loading')
  const [startupError, setStartupError] = useState('')
  // A display copy of the main-process session; changing it grants nothing
  const [user, setUser] = useState(null)

  useEffect(() => {
    let cancelled = false
    // auth:current restores the session after a window reload, since it is held by the main process
    Promise.all([setup.isNeeded(), auth.current()])
      .then(([needsSetup, current]) => {
        if (cancelled) return
        setUser(current)
        setStatus(needsSetup ? 'setup' : current ? 'signed-in' : 'signed-out')
      })
      .catch((err) => {
        if (cancelled) return
        setStartupError(err.message)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  function handleSignedIn(signedIn) {
    setUser(signedIn)
    setStatus('signed-in')
  }

  async function handleSignOut() {
    try {
      await auth.logout()
    } finally {
      setUser(null)
      setStatus('signed-out')
    }
  }

  if (status === 'loading') return null
  if (status === 'error') {
    return (
      <div className="app-startup-error">
        <Toast tone="error" inline>
          {startupError}
        </Toast>
      </div>
    )
  }
  if (status === 'setup') return <Setup onComplete={handleSignedIn} />
  if (status === 'signed-out' || !user) return <Login onSignedIn={handleSignedIn} />
  // Keyed by user so the next person to sign in starts on the landing page with fresh page state
  return <Shell key={user.id} user={user} onSignOut={handleSignOut} />
}

function Shell({ user, onSignOut }) {
  const pages = PAGES.filter((p) => !p.ownerOnly || user.role === 'owner')
  const [pageId, setPageId] = useState(pages[0].id)
  const Page = (pages.find((p) => p.id === pageId) ?? pages[0]).component

  return (
    <ToastScope>
      <div className="app">
        <nav className="app-nav">
          <span className="app-brand">
            <BrandIcon />
            Pharmacy POS
          </span>
          {pages.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`nav-link${p.id === pageId ? ' active' : ''}`}
              aria-current={p.id === pageId ? 'page' : undefined}
              onClick={() => setPageId(p.id)}
            >
              {p.label}
            </button>
          ))}
          <div className="app-user">
            <span className="app-user-name">{user.full_name || user.username}</span>
            <Badge>{user.role}</Badge>
            <Button size="small" onClick={onSignOut}>
              Sign out
            </Button>
          </div>
        </nav>
        {/* Every page's error and success messages land here, so they are always in the same spot */}
        <ToastRegion className="app-messages" />
        <main className="app-content">
          <Page onNavigate={setPageId} currentUser={user} />
        </main>
      </div>
    </ToastScope>
  )
}

function BrandIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="20" height="20" rx="5" fill="currentColor" />
      <path d="M12 7v10M7 12h10" stroke="var(--on-accent)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export default App
