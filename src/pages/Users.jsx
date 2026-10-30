import { useCallback, useEffect, useState } from 'react'
import Badge from '../components/Badge.jsx'
import Button from '../components/Button.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import EmptyState from '../components/EmptyState.jsx'
import Field from '../components/Field.jsx'
import Input from '../components/Input.jsx'
import Modal, { ModalActions } from '../components/Modal.jsx'
import PasswordInput from '../components/PasswordInput.jsx'
import Table from '../components/Table.jsx'
import Toast from '../components/Toast.jsx'
import { users as api } from '../lib/api.js'
import { formatLocalDate } from '../lib/format.js'
import { useRowFlash } from '../lib/useRowFlash.js'

const MIN_PASSWORD_LENGTH = 6

// Owner only. The main process rejects every users:* channel for a salesman; App also hides the page.
export default function Users({ currentUser }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [adding, setAdding] = useState(false)
  // The user whose password is being reset, or null
  const [resetting, setResetting] = useState(null)
  // The user waiting for their deactivation to be confirmed, or null
  const [deactivating, setDeactivating] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [rowFlash, flashRow] = useRowFlash()

  useEffect(() => {
    let cancelled = false
    api
      .list()
      .then((data) => {
        if (cancelled) return
        setRows(data)
        setError('')
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const reload = () => setReloadKey((k) => k + 1)
  const closeAdd = useCallback(() => setAdding(false), [])
  const closeReset = useCallback(() => setResetting(null), [])

  async function handleDeactivate(row) {
    setDeactivating(null)
    setNotice('')
    try {
      await api.deactivate(row.id)
      reload()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="users">
      <header className="page-header">
        <h1>Users</h1>
        <Button variant="primary" onClick={() => setAdding(true)}>
          Add salesman
        </Button>
      </header>

      {error && (
        <Toast tone="error" onDismiss={() => setError('')}>
          {error}
        </Toast>
      )}
      {notice && (
        <Toast tone="success" onDismiss={() => setNotice('')}>
          {notice}
        </Toast>
      )}

      {!loading && rows.length === 0 && !error ? (
        <EmptyState>No users.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Full name</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              <th className="actions" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isSelf = row.id === currentUser.id
              const rowClass = [!row.is_active && 'inactive', rowFlash(row.id)].filter(Boolean).join(' ')
              return (
                <tr key={row.id} className={rowClass || undefined}>
                  <td className="mono">
                    {row.username}
                    {isSelf && <Badge>You</Badge>}
                  </td>
                  <td>{row.full_name}</td>
                  <td className="capitalize">{row.role}</td>
                  <td>{row.is_active ? 'Active' : <Badge>Deactivated</Badge>}</td>
                  <td>{formatLocalDate(row.created_at)}</td>
                  <td className="actions">
                    {row.is_active ? (
                      <>
                        <Button size="small" onClick={() => setResetting(row)}>
                          Reset password
                        </Button>
                        {!isSelf && (
                          <Button variant="danger" size="small" onClick={() => setDeactivating(row)}>
                            Deactivate
                          </Button>
                        )}
                      </>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}

      {adding && (
        <AddSalesman
          onClose={closeAdd}
          onSaved={(user) => {
            setAdding(false)
            setNotice(`Added ${user.username}.`)
            flashRow(user.id)
            reload()
          }}
        />
      )}

      {resetting && (
        <ResetPassword
          user={resetting}
          onClose={closeReset}
          onSaved={(user) => {
            setResetting(null)
            setNotice(`Password reset for ${user.username}.`)
          }}
        />
      )}

      {deactivating && (
        <ConfirmDialog
          title={`Deactivate ${deactivating.username}?`}
          confirmLabel="Deactivate"
          onConfirm={() => handleDeactivate(deactivating)}
          onCancel={() => setDeactivating(null)}
        >
          <p>They will no longer be able to sign in.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}

function AddSalesman({ onClose, onSaved }) {
  const [form, setForm] = useState({ username: '', full_name: '', password: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    const found = {}
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(form.username.trim())) {
      found.username = '3 to 32 characters: letters, digits, dot, dash or underscore.'
    }
    Object.assign(found, validatePasswords(form.password, form.confirm))
    setErrors(found)
    if (Object.keys(found).length) return

    setSaving(true)
    setSaveError('')
    try {
      onSaved(await api.create({ username: form.username, full_name: form.full_name, password: form.password }))
    } catch (err) {
      setSaveError(err.message)
      setSaving(false)
    }
  }

  return (
    <Modal title="Add salesman" as="form" onSubmit={handleSubmit} noValidate onBackdrop={onClose} onEscape={onClose}>
      {saveError && <Toast tone="error">{saveError}</Toast>}

      <div className="form-grid">
        <Field label="Username" error={errors.username} required>
          <Input value={form.username} onChange={set('username')} autoComplete="off" autoFocus />
        </Field>
        <Field label="Full name">
          <Input value={form.full_name} onChange={set('full_name')} />
        </Field>
        <Field label="Password" error={errors.password} required>
          <PasswordInput value={form.password} onChange={set('password')} autoComplete="new-password" />
        </Field>
        <Field label="Confirm password" error={errors.confirm} required>
          <PasswordInput value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
        </Field>
      </div>

      <ModalActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          {saving ? 'Saving...' : 'Add salesman'}
        </Button>
      </ModalActions>
    </Modal>
  )
}

function ResetPassword({ user, onClose, onSaved }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState({})
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    const found = validatePasswords(password, confirm)
    setErrors(found)
    if (Object.keys(found).length) return

    setSaving(true)
    setSaveError('')
    try {
      onSaved(await api.resetPassword(user.id, password))
    } catch (err) {
      setSaveError(err.message)
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`Reset password for ${user.username}`}
      as="form"
      onSubmit={handleSubmit}
      noValidate
      onBackdrop={onClose}
      onEscape={onClose}
    >
      {saveError && <Toast tone="error">{saveError}</Toast>}

      <div className="form-grid">
        <Field label="New password" error={errors.password} required>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            autoFocus
          />
        </Field>
        <Field label="Confirm password" error={errors.confirm} required>
          <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </Field>
      </div>

      <ModalActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          {saving ? 'Saving...' : 'Reset password'}
        </Button>
      </ModalActions>
    </Modal>
  )
}

function validatePasswords(password, confirm) {
  if (password.length < MIN_PASSWORD_LENGTH) return { password: `At least ${MIN_PASSWORD_LENGTH} characters.` }
  if (confirm !== password) return { confirm: 'Passwords do not match.' }
  return {}
}
