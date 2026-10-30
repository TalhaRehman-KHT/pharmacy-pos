import Button from './Button.jsx'
import Modal, { ModalActions } from './Modal.jsx'

// Asks before a destructive action (deactivating a medicine or a user). Drawn as a danger dialog, with
// Cancel focused so a stray Enter does nothing. Escape or a click outside cancels.
export default function ConfirmDialog({ title, confirmLabel, onConfirm, onCancel, children }) {
  return (
    <Modal title={title} role="alertdialog" size="sm" tone="danger" onBackdrop={onCancel} onEscape={onCancel}>
      {children}
      <ModalActions>
        <Button onClick={onCancel} autoFocus>
          Cancel
        </Button>
        <Button variant="danger-solid" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </ModalActions>
    </Modal>
  )
}
