import { createContext, useContext, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertIcon, CheckIcon, CloseIcon, InfoIcon } from './icons.jsx'
import './Toast.css'

// Error and success messages always appear in one place: the message strip under the navigation bar for a
// page, or under the title inside a dialog. A page keeps owning its message state exactly as before; a
// <Toast> just renders into the nearest <ToastRegion> instead of wherever it sits in the markup.
//   <ToastScope> ... <ToastRegion /> ... <Toast tone="error">{error}</Toast> ... </ToastScope>
// inline renders in place instead, for a standing notice that describes a section (e.g. "no recovery code
// yet") rather than reporting what just happened.

const RegionContext = createContext(null)

export function ToastScope({ children }) {
  const [node, setNode] = useState(null)
  return <RegionContext.Provider value={{ node, setNode }}>{children}</RegionContext.Provider>
}

export function ToastRegion({ className }) {
  const scope = useContext(RegionContext)
  return <div ref={scope?.setNode} className={['toast-region', className].filter(Boolean).join(' ')} />
}

const ICONS = { error: AlertIcon, warning: AlertIcon, success: CheckIcon, info: InfoIcon }

// tone: 'error' | 'warning' | 'success' | 'info'. onDismiss adds a close button.
export default function Toast({ tone = 'info', inline = false, onDismiss, children }) {
  const scope = useContext(RegionContext)
  const Icon = ICONS[tone]
  const toast = (
    <div className={`toast toast-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={18} />
      <div className="toast-body">{children}</div>
      {onDismiss && (
        <button type="button" className="toast-dismiss" aria-label="Dismiss message" onClick={onDismiss}>
          <CloseIcon size={16} />
        </button>
      )}
    </div>
  )
  if (inline || !scope) return toast
  // The region mounts in the same commit as the page; render once it exists
  return scope.node ? createPortal(toast, scope.node) : null
}
