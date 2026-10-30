import { useEffect, useId } from 'react'
import { ToastRegion, ToastScope } from './Toast.jsx'
import './Modal.css'

// A dialog over a dimmed backdrop, faded in briefly. Messages from a <Toast> inside it appear under the title.
// as="form" makes the dialog itself the form (pass onSubmit and noValidate through).
// onBackdrop: called on a click outside the dialog; leave it out when that must not close it.
// onEscape: called on Escape from anywhere in the window; leave it out when the dialog handles its own keys.
// tone="danger" marks a dialog that confirms something destructive. size: 'sm' | 'md' | 'lg'.
// Other props (role, onKeyDown, aria-label, …) go to the dialog element.
export default function Modal({
  title,
  as: Tag = 'div',
  size = 'md',
  tone,
  role = 'dialog',
  onBackdrop,
  onEscape,
  className,
  children,
  ...props
}) {
  const titleId = useId()

  useEffect(() => {
    if (!onEscape) return
    const onKey = (e) => {
      if (e.key === 'Escape') onEscape()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onEscape])

  const classes = ['modal', `modal-${size}`, tone === 'danger' && 'modal-danger', className]

  return (
    <div className="modal-backdrop" onMouseDown={(e) => onBackdrop && e.target === e.currentTarget && onBackdrop()}>
      <Tag
        role={role}
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        {...props}
        className={classes.filter(Boolean).join(' ')}
      >
        <ToastScope>
          {title && <h2 id={titleId}>{title}</h2>}
          <ToastRegion className="modal-messages" />
          {children}
        </ToastScope>
      </Tag>
    </div>
  )
}

// The button row at the bottom of a dialog
export function ModalActions({ children }) {
  return <div className="modal-actions">{children}</div>
}
